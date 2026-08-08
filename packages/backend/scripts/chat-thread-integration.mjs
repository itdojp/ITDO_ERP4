import assert from 'node:assert/strict';
import pg from 'pg';

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.CHAT_THREAD_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_chat_thread_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_chat_thread_test database',
  );
}

const [{ prisma }, { buildServer }, { prismaChatThreadRepository }] =
  await Promise.all([
    import('../dist/services/db.js'),
    import('../dist/server.js'),
    import('../dist/adapters/chat/prismaChatThreadAdapter.js'),
  ]);

const roomId = 'thread-private-room';
const otherRoomId = 'thread-other-room';
const projectId = 'thread-project';
const ownerId = 'thread-owner';
const rootId = 'thread-root';
const deletedRootId = 'thread-deleted-root';
const deleteRaceRootId = 'thread-delete-race-root';
const fixedReplyAt = new Date('2026-08-08T01:00:00.000Z');
const fixedReplyTimestamp = '2026-08-08 01:00:00.000';
const ownerHeaders = {
  'x-user-id': ownerId,
  'x-roles': 'user',
};
const concurrentPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function expectRejected(operation, label) {
  await assert.rejects(operation, undefined, label);
}

function responseMessageIds(response) {
  return response.json().items.map((item) => item.id);
}

function tamperLastCharacter(value) {
  const replacement = value.endsWith('A') ? 'B' : 'A';
  return `${value.slice(0, -1)}${replacement}`;
}

let server;
try {
  await prisma.chatRoom.createMany({
    data: [
      {
        id: roomId,
        type: 'private_group',
        name: 'Synthetic thread room',
        isOfficial: false,
      },
      {
        id: otherRoomId,
        type: 'private_group',
        name: 'Synthetic other room',
        isOfficial: false,
      },
    ],
  });
  await prisma.chatRoomMember.createMany({
    data: [
      { roomId, userId: ownerId },
      { roomId: otherRoomId, userId: ownerId },
    ],
  });
  await prisma.project.create({
    data: { id: projectId, code: 'THREAD-PROJECT', name: 'Thread project' },
  });
  await prisma.chatRoom.create({
    data: {
      id: projectId,
      type: 'project',
      name: 'Thread project room',
      isOfficial: true,
      projectId,
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        id: rootId,
        roomId,
        userId: ownerId,
        body: 'Synthetic active root',
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
      },
      {
        id: 'thread-second-root',
        roomId,
        userId: ownerId,
        body: 'Synthetic second root',
        createdAt: new Date('2026-08-08T00:00:01.000Z'),
      },
      {
        id: deletedRootId,
        roomId,
        userId: ownerId,
        body: 'Must not be returned from the root timeline',
        deletedAt: new Date('2026-08-08T00:00:02.000Z'),
      },
      {
        id: deleteRaceRootId,
        roomId,
        userId: ownerId,
        body: 'Synthetic delete race root',
        createdAt: new Date('2026-08-08T00:00:03.000Z'),
      },
      {
        id: 'thread-project-root',
        roomId: projectId,
        userId: ownerId,
        body: 'Synthetic project root',
      },
    ],
  });

  const replyIds = Array.from(
    { length: 5 },
    (_, index) => `thread-reply-${String(index + 1).padStart(2, '0')}`,
  );
  await Promise.all(
    replyIds.map((id, index) =>
      concurrentPool.query(
        `INSERT INTO "ChatMessage"
          ("id", "roomId", "userId", "body", "parentMessageId",
           "threadRootId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $5, $6::timestamp, $6::timestamp)`,
        [
          id,
          roomId,
          index % 2 === 0 ? ownerId : 'thread-member',
          `Synthetic reply ${index + 1}`,
          rootId,
          fixedReplyTimestamp,
        ],
      ),
    ),
  );

  const deleteClient = await concurrentPool.connect();
  const insertClient = await concurrentPool.connect();
  try {
    await insertClient.query(`SET statement_timeout = '3s'`);
    await deleteClient.query('BEGIN');
    await deleteClient.query(
      `UPDATE "ChatMessage"
          SET "deletedAt" = '2026-08-08 00:00:04.000'::timestamp,
              "updatedAt" = '2026-08-08 00:00:04.000'::timestamp
        WHERE "id" = $1`,
      [deleteRaceRootId],
    );
    let raceInsertSettled = false;
    const raceInsert = insertClient
      .query(
        `INSERT INTO "ChatMessage"
          ("id", "roomId", "userId", "body", "parentMessageId",
           "threadRootId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $5, now(), now())`,
        [
          'thread-delete-race-reply',
          roomId,
          ownerId,
          'Must be rejected after concurrent root deletion',
          deleteRaceRootId,
        ],
      )
      .then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      )
      .finally(() => {
        raceInsertSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      raceInsertSettled,
      false,
      'reply insert must wait for an in-flight root logical delete',
    );
    await deleteClient.query('COMMIT');
    const raceResult = await raceInsert;
    assert.equal(
      raceResult.ok,
      false,
      'reply insert must fail closed after the root deletion commits',
    );
  } catch (error) {
    await deleteClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    deleteClient.release();
    insertClient.release();
  }
  await concurrentPool.end();
  await prisma.chatMessage.update({
    where: { id: replyIds[1] },
    data: {
      deletedAt: new Date('2026-08-08T02:00:00.000Z'),
      deletedReason: 'author_deleted',
    },
  });

  await expectRejected(
    prisma.chatMessage.create({
      data: {
        id: 'thread-half-linked',
        roomId,
        userId: ownerId,
        body: 'Rejected half link',
        parentMessageId: rootId,
      },
    }),
    'half-linked reply must be rejected',
  );
  await expectRejected(
    prisma.chatMessage.create({
      data: {
        id: 'thread-self-linked',
        roomId,
        userId: ownerId,
        body: 'Rejected self link',
        parentMessageId: 'thread-self-linked',
        threadRootId: 'thread-self-linked',
      },
    }),
    'self-linked reply must be rejected',
  );
  await expectRejected(
    prisma.chatMessage.create({
      data: {
        id: 'thread-cross-room',
        roomId: otherRoomId,
        userId: ownerId,
        body: 'Rejected cross-room link',
        parentMessageId: rootId,
        threadRootId: rootId,
      },
    }),
    'cross-room reply must be rejected',
  );
  await expectRejected(
    prisma.chatMessage.create({
      data: {
        id: 'thread-nested-reply',
        roomId,
        userId: ownerId,
        body: 'Rejected nested reply',
        parentMessageId: replyIds[0],
        threadRootId: replyIds[0],
      },
    }),
    'reply-to-reply must be rejected',
  );
  await expectRejected(
    prisma.chatMessage.create({
      data: {
        id: 'thread-deleted-root-reply',
        roomId,
        userId: ownerId,
        body: 'Rejected deleted-root reply',
        parentMessageId: deletedRootId,
        threadRootId: deletedRootId,
      },
    }),
    'new replies to a deleted root must be rejected',
  );
  await expectRejected(
    prisma.chatMessage.update({
      where: { id: replyIds[0] },
      data: { parentMessageId: 'thread-second-root' },
    }),
    'thread topology must be immutable',
  );
  await expectRejected(
    prisma.chatMessage.delete({ where: { id: rootId } }),
    'root physical deletion must be restricted while replies exist',
  );

  const roots = await prismaChatThreadRepository.listRootTimeline({
    roomId,
    limit: 20,
  });
  assert.deepEqual(
    roots.map((root) => root.id),
    ['thread-second-root', rootId],
  );
  const aggregate = roots.find((root) => root.id === rootId);
  assert.equal(aggregate.replyCount, 5);
  assert.equal(aggregate.lastReplyAt.toISOString(), fixedReplyAt.toISOString());

  server = await buildServer({ logger: false });
  const timeline = await server.inject({
    method: 'GET',
    url: `/chat-rooms/${roomId}/messages?limit=20`,
    headers: ownerHeaders,
  });
  assert.equal(timeline.statusCode, 200, timeline.body);
  assert.deepEqual(responseMessageIds(timeline), [
    'thread-second-root',
    rootId,
  ]);
  assert.equal(timeline.body.includes('thread-reply-'), false);
  assert.equal(timeline.json().items[1].replyCount, 5);

  const firstPage = await server.inject({
    method: 'GET',
    url: `/chat-messages/${rootId}/thread?limit=2`,
    headers: ownerHeaders,
  });
  assert.equal(firstPage.statusCode, 200, firstPage.body);
  const firstBody = firstPage.json();
  assert.deepEqual(
    firstBody.replies.map((reply) => reply.id),
    replyIds.slice(0, 2),
  );
  assert.equal(firstBody.replyCount, 5);
  assert.ok(firstBody.nextCursor);
  assert.equal(firstBody.replies[1].deleted, true);
  assert.equal(firstBody.replies[1].body, null);

  const secondPage = await server.inject({
    method: 'GET',
    url: `/chat-messages/${replyIds[0]}/thread?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    headers: ownerHeaders,
  });
  assert.equal(secondPage.statusCode, 200, secondPage.body);
  assert.deepEqual(
    secondPage.json().replies.map((reply) => reply.id),
    replyIds.slice(2, 4),
  );
  assert.equal(
    new Set([
      ...firstBody.replies.map((reply) => reply.id),
      ...secondPage.json().replies.map((reply) => reply.id),
    ]).size,
    4,
  );

  const tampered = await server.inject({
    method: 'GET',
    url: `/chat-messages/${rootId}/thread?cursor=${encodeURIComponent(tamperLastCharacter(firstBody.nextCursor))}`,
    headers: ownerHeaders,
  });
  assert.equal(tampered.statusCode, 400, tampered.body);
  const outsider = await server.inject({
    method: 'GET',
    url: `/chat-messages/${rootId}/thread`,
    headers: { 'x-user-id': 'thread-outsider', 'x-roles': 'user' },
  });
  assert.equal(outsider.statusCode, 404, outsider.body);
  const missing = await server.inject({
    method: 'GET',
    url: '/chat-messages/thread-missing/thread',
    headers: ownerHeaders,
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.deepEqual(outsider.json(), missing.json());

  const projectThread = await server.inject({
    method: 'GET',
    url: '/chat-messages/thread-project-root/thread',
    headers: {
      'x-user-id': ownerId,
      'x-roles': 'user',
      'x-project-ids': projectId,
    },
  });
  assert.equal(projectThread.statusCode, 200, projectThread.body);
  const legacyProjectTimeline = await server.inject({
    method: 'GET',
    url: `/projects/${projectId}/chat-messages`,
    headers: {
      'x-user-id': ownerId,
      'x-roles': 'user',
      'x-project-ids': projectId,
    },
  });
  assert.equal(
    legacyProjectTimeline.statusCode,
    200,
    legacyProjectTimeline.body,
  );
  assert.deepEqual(responseMessageIds(legacyProjectTimeline), [
    'thread-project-root',
  ]);

  const auditRows = await prisma.auditLog.findMany({
    where: { action: 'chat_thread_viewed' },
  });
  assert.ok(auditRows.length >= 3);
  const auditText = JSON.stringify(auditRows.map((row) => row.metadata));
  assert.equal(auditText.includes('Synthetic active root'), false);
  assert.equal(auditText.includes('Synthetic reply'), false);

  const indexes = await prisma.$queryRaw`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'ChatMessage'
  `;
  const indexNames = new Set(indexes.map((entry) => entry.indexname));
  for (const expected of [
    'ChatMessage_id_roomId_key',
    'ChatMessage_roomId_parentMessageId_createdAt_id_idx',
    'ChatMessage_threadRootId_createdAt_id_idx',
    'ChatMessage_threadRootId_deletedAt_createdAt_id_idx',
  ]) {
    assert.equal(indexNames.has(expected), true, `missing index: ${expected}`);
  }
  const constraints = await prisma.$queryRaw`
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = '"ChatMessage"'::regclass
  `;
  const constraintNames = new Set(constraints.map((entry) => entry.conname));
  for (const expected of [
    'ChatMessage_thread_shape_check',
    'ChatMessage_parentMessageId_roomId_fkey',
    'ChatMessage_threadRootId_roomId_fkey',
  ]) {
    assert.equal(
      constraintNames.has(expected),
      true,
      `missing constraint: ${expected}`,
    );
  }

  console.log(
    JSON.stringify({
      result: 'PASS',
      postgres: 15,
      roots: roots.length,
      replies: replyIds.length,
      paginationPagesChecked: 2,
      unauthorizedNormalized: true,
      projectAliasCompatible: true,
      rootTimelineExcludesReplies: true,
      concurrentRootDeleteFailsClosed: true,
    }),
  );
} finally {
  await concurrentPool.end().catch(() => undefined);
  if (server) await server.close();
  else await prisma.$disconnect();
}
