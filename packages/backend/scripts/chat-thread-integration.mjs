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
const readBoundaryRoomId = 'thread-read-boundary-room';
const projectId = 'thread-project';
const projectAliasId = 'thread-project-canonical';
const projectAliasRoomId = 'thread-project-room-alias';
const ownerId = 'thread-owner';
const rootId = 'thread-root';
const deletedRootId = 'thread-deleted-root';
const deleteRaceRootId = 'thread-delete-race-root';
const routeDeleteRaceRootId = 'thread-route-delete-race-root';
const ackDeleteRaceRootId = 'thread-ack-delete-race-root';
const aclRaceUserId = 'thread-acl-race-user';
const fixedReplyAt = new Date('2026-08-08T01:00:00.000Z');
const fixedReplyTimestamp = '2026-08-08 01:00:00.000';
const ownerHeaders = {
  'x-user-id': ownerId,
  'x-roles': 'user',
};
const aclRaceHeaders = {
  'x-user-id': aclRaceUserId,
  'x-roles': 'user',
};
const concurrentPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function expectRejected(operation, label) {
  await assert.rejects(operation, undefined, label);
}

async function waitForLockWaiters(client, expected, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT count(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} lock waiter(s): ${label}`);
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
  await prisma.userAccount.createMany({
    data: [
      { id: ownerId, userName: ownerId, active: true },
      { id: 'thread-member', userName: 'thread-member', active: true },
      { id: 'thread-outsider', userName: 'thread-outsider', active: true },
      { id: aclRaceUserId, userName: aclRaceUserId, active: true },
    ],
  });
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
      {
        id: readBoundaryRoomId,
        type: 'private_group',
        name: 'Synthetic read boundary room',
        isOfficial: false,
      },
    ],
  });
  await prisma.chatRoomMember.createMany({
    data: [
      { roomId, userId: ownerId },
      { roomId, userId: 'thread-member' },
      { roomId, userId: aclRaceUserId },
      { roomId: otherRoomId, userId: ownerId },
      { roomId: readBoundaryRoomId, userId: ownerId },
    ],
  });
  await prisma.project.create({
    data: { id: projectId, code: 'THREAD-PROJECT', name: 'Thread project' },
  });
  await prisma.project.create({
    data: {
      id: projectAliasId,
      code: 'THREAD-ALIAS',
      name: 'Thread alias project',
    },
  });
  await prisma.chatRoom.createMany({
    data: [
      {
        id: projectId,
        type: 'project',
        name: 'Thread project room',
        isOfficial: true,
        projectId,
      },
      {
        id: projectAliasRoomId,
        type: 'project',
        name: 'Thread project alias room',
        isOfficial: true,
        projectId: projectAliasId,
      },
    ],
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: ownerId, role: 'leader' },
      { projectId, userId: 'thread-member', role: 'member' },
      { projectId: projectAliasId, userId: ownerId, role: 'leader' },
      {
        projectId: projectAliasId,
        userId: 'thread-member',
        role: 'member',
      },
    ],
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
      {
        id: 'thread-project-alias-root',
        roomId: projectAliasRoomId,
        userId: ownerId,
        body: 'Synthetic project alias root',
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
    await waitForLockWaiters(
      deleteClient,
      1,
      'reply insert behind root logical delete',
    );
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

  const aliasHeaders = {
    'x-user-id': ownerId,
    'x-roles': 'user',
    'x-project-ids': projectAliasId,
  };
  const aliasAckReply = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${projectAliasRoomId}/ack-requests`,
    headers: aliasHeaders,
    payload: {
      parentMessageId: 'thread-project-alias-root',
      body: 'Synthetic project alias acknowledgement',
      requiredUserIds: ['thread-member'],
    },
  });
  assert.equal(aliasAckReply.statusCode, 200, aliasAckReply.body);
  const aliasAckBody = aliasAckReply.json();
  assert.equal(aliasAckBody.roomId, projectAliasRoomId);
  assert.ok(aliasAckBody.ackRequest?.id);
  const aliasNotification = await prisma.appNotification.findFirstOrThrow({
    where: {
      userId: 'thread-member',
      kind: 'chat_ack_required',
      messageId: aliasAckBody.id,
    },
  });
  assert.equal(aliasNotification.projectId, projectAliasId);
  assert.equal(aliasNotification.payload.roomId, projectAliasRoomId);
  const aliasMessageNotification =
    await prisma.appNotification.findFirstOrThrow({
      where: {
        userId: 'thread-member',
        kind: 'chat_message',
        messageId: aliasAckBody.id,
      },
    });
  assert.equal(aliasMessageNotification.projectId, projectAliasId);
  assert.equal(aliasMessageNotification.payload.roomId, projectAliasRoomId);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        userId: ownerId,
        kind: 'chat_message',
        messageId: aliasAckBody.id,
      },
    }),
    0,
  );

  const projectAliasAckReply = await server.inject({
    method: 'POST',
    url: `/projects/${projectId}/chat-ack-requests`,
    headers: {
      'x-user-id': ownerId,
      'x-roles': 'user',
      'x-project-ids': projectId,
    },
    payload: {
      parentMessageId: 'thread-project-root',
      body: 'Synthetic legacy project acknowledgement reply',
      requiredUserIds: ['thread-member'],
    },
  });
  assert.equal(projectAliasAckReply.statusCode, 200, projectAliasAckReply.body);
  const projectAliasAckBody = projectAliasAckReply.json();
  const projectAliasMessageNotification =
    await prisma.appNotification.findFirstOrThrow({
      where: {
        userId: 'thread-member',
        kind: 'chat_message',
        messageId: projectAliasAckBody.id,
      },
    });
  assert.equal(projectAliasMessageNotification.projectId, projectId);
  assert.equal(projectAliasMessageNotification.payload.roomId, projectId);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        userId: ownerId,
        kind: 'chat_message',
        messageId: projectAliasAckBody.id,
      },
    }),
    0,
  );
  const aliasAckRead = await server.inject({
    method: 'GET',
    url: `/chat-ack-requests/${aliasAckBody.ackRequest.id}`,
    headers: aliasHeaders,
  });
  assert.equal(aliasAckRead.statusCode, 200, aliasAckRead.body);
  const hiddenAliasAck = await server.inject({
    method: 'GET',
    url: `/chat-ack-requests/${aliasAckBody.ackRequest.id}`,
    headers: { 'x-user-id': 'thread-outsider', 'x-roles': 'user' },
  });
  const missingAliasAck = await server.inject({
    method: 'GET',
    url: '/chat-ack-requests/thread-missing-ack-request',
    headers: { 'x-user-id': 'thread-outsider', 'x-roles': 'user' },
  });
  assert.equal(hiddenAliasAck.statusCode, 404, hiddenAliasAck.body);
  assert.equal(missingAliasAck.statusCode, 404, missingAliasAck.body);
  assert.deepEqual(hiddenAliasAck.json(), missingAliasAck.json());

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

  const behaviorRootId = 'thread-behavior-root';
  await prisma.chatMessage.create({
    data: {
      id: behaviorRootId,
      roomId,
      userId: ownerId,
      body: 'Synthetic behavior root',
    },
  });
  const futureThrough = new Date(Date.now() + 60_000).toISOString();
  const readBeforeReply = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${roomId}/read`,
    headers: ownerHeaders,
    payload: { through: futureThrough },
  });
  assert.equal(readBeforeReply.statusCode, 200, readBeforeReply.body);
  assert.ok(
    Date.parse(readBeforeReply.json().lastReadAt) < Date.parse(futureThrough),
  );

  const memberHeaders = {
    'x-user-id': 'thread-member',
    'x-roles': 'user',
  };
  const postedReply = await server.inject({
    method: 'POST',
    url: `/chat-messages/${behaviorRootId}/replies`,
    headers: memberHeaders,
    payload: {
      body: 'Synthetic behavior reply needle-2014',
      mentions: { userIds: [ownerId] },
    },
  });
  assert.equal(postedReply.statusCode, 201, postedReply.body);
  const postedReplyBody = postedReply.json();
  assert.equal(postedReplyBody.parentMessageId, behaviorRootId);
  assert.equal(postedReplyBody.threadRootId, behaviorRootId);

  const outsiderMentionReply = await server.inject({
    method: 'POST',
    url: `/chat-messages/${behaviorRootId}/replies`,
    headers: memberHeaders,
    payload: {
      body: 'Synthetic outsider mention must remain private',
      mentions: { userIds: ['thread-outsider'] },
    },
  });
  assert.equal(outsiderMentionReply.statusCode, 201, outsiderMentionReply.body);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: outsiderMentionReply.json().id,
        userId: 'thread-outsider',
        kind: 'chat_mention',
      },
    }),
    0,
  );
  const replySearchTimeline = await server.inject({
    method: 'GET',
    url: `/chat-rooms/${roomId}/messages?q=needle-2014`,
    headers: ownerHeaders,
  });
  assert.equal(replySearchTimeline.statusCode, 200, replySearchTimeline.body);
  assert.deepEqual(responseMessageIds(replySearchTimeline), [behaviorRootId]);

  const globalReplySearch = await server.inject({
    method: 'GET',
    url: '/chat-messages/search?q=needle-2014&limit=20',
    headers: ownerHeaders,
  });
  assert.equal(globalReplySearch.statusCode, 200, globalReplySearch.body);
  const searchedReply = globalReplySearch
    .json()
    .items.find((item) => item.id === postedReplyBody.id);
  assert.equal(searchedReply.parentMessageId, behaviorRootId);
  assert.equal(searchedReply.threadRootId, behaviorRootId);

  const invalidSearchBoundary = await server.inject({
    method: 'GET',
    url: '/chat-messages/search?q=needle-2014&beforeId=reply-only',
    headers: ownerHeaders,
  });
  assert.equal(
    invalidSearchBoundary.statusCode,
    400,
    invalidSearchBoundary.body,
  );

  const searchPageOne = await server.inject({
    method: 'GET',
    url: '/chat-messages/search?q=Synthetic%20reply&limit=2',
    headers: ownerHeaders,
  });
  assert.equal(searchPageOne.statusCode, 200, searchPageOne.body);
  const searchPageOneBody = searchPageOne.json();
  assert.equal(searchPageOneBody.items.length, 2);
  const searchPageTwo = await server.inject({
    method: 'GET',
    url: `/chat-messages/search?q=Synthetic%20reply&limit=2&before=${encodeURIComponent(searchPageOneBody.nextBefore)}&beforeId=${encodeURIComponent(searchPageOneBody.nextBeforeId)}`,
    headers: ownerHeaders,
  });
  assert.equal(searchPageTwo.statusCode, 200, searchPageTwo.body);
  assert.equal(
    searchPageTwo
      .json()
      .items.some((item) =>
        searchPageOneBody.items.some((first) => first.id === item.id),
      ),
    false,
  );

  const unreadAfterReply = await server.inject({
    method: 'GET',
    url: `/chat-rooms/${roomId}/unread`,
    headers: ownerHeaders,
  });
  assert.equal(unreadAfterReply.statusCode, 200, unreadAfterReply.body);
  assert.ok(unreadAfterReply.json().unreadCount >= 1);

  const reactionAdds = await Promise.all(
    [ownerHeaders, memberHeaders].map((headers) =>
      server.inject({
        method: 'POST',
        url: `/chat-messages/${postedReplyBody.id}/reactions`,
        headers,
        payload: { emoji: '👍' },
      }),
    ),
  );
  reactionAdds.forEach((response) =>
    assert.equal(response.statusCode, 200, response.body),
  );
  const reactionRow = await prisma.chatMessage.findUniqueOrThrow({
    where: { id: postedReplyBody.id },
    select: { reactions: true },
  });
  assert.equal(reactionRow.reactions['👍'].count, 2);
  assert.deepEqual(reactionRow.reactions['👍'].userIds.sort(), [
    'thread-member',
    ownerId,
  ]);
  const reactionRemovals = await Promise.all(
    [ownerHeaders, memberHeaders].map((headers) =>
      server.inject({
        method: 'DELETE',
        url: `/chat-messages/${postedReplyBody.id}/reactions`,
        headers,
        payload: { emoji: '👍' },
      }),
    ),
  );
  reactionRemovals.forEach((response) => {
    assert.equal(response.statusCode, 200, response.body);
  });
  assert.deepEqual(
    (
      await prisma.chatMessage.findUniqueOrThrow({
        where: { id: postedReplyBody.id },
        select: { reactions: true },
      })
    ).reactions,
    {},
  );

  const ackReply = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${roomId}/ack-requests`,
    headers: memberHeaders,
    payload: {
      parentMessageId: behaviorRootId,
      body: 'Synthetic reply acknowledgement',
      requiredUserIds: [ownerId],
      mentions: { userIds: ['thread-outsider'] },
    },
  });
  assert.equal(ackReply.statusCode, 200, ackReply.body);
  assert.equal(ackReply.json().parentMessageId, behaviorRootId);
  assert.ok(ackReply.json().ackRequest?.id);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: ackReply.json().id,
        userId: 'thread-outsider',
        kind: 'chat_mention',
      },
    }),
    0,
  );
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: ackReply.json().id,
        userId: ownerId,
        kind: 'chat_message',
      },
    }),
    1,
  );
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: ackReply.json().id,
        userId: 'thread-member',
        kind: 'chat_message',
      },
    }),
    0,
  );

  const mentionedAckReply = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${roomId}/ack-requests`,
    headers: memberHeaders,
    payload: {
      parentMessageId: behaviorRootId,
      body: 'Synthetic reply acknowledgement with valid mention',
      requiredUserIds: [ownerId],
      mentions: { userIds: [ownerId] },
    },
  });
  assert.equal(mentionedAckReply.statusCode, 200, mentionedAckReply.body);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: mentionedAckReply.json().id,
        userId: ownerId,
        kind: 'chat_mention',
      },
    }),
    1,
  );
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: mentionedAckReply.json().id,
        userId: ownerId,
        kind: 'chat_message',
      },
    }),
    0,
  );

  const suppressAllPosts = await server.inject({
    method: 'PATCH',
    url: `/chat-rooms/${roomId}/notification-setting`,
    headers: ownerHeaders,
    payload: { notifyAllPosts: false, muteUntil: null },
  });
  assert.equal(suppressAllPosts.statusCode, 200, suppressAllPosts.body);
  const suppressedAckReply = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${roomId}/ack-requests`,
    headers: memberHeaders,
    payload: {
      parentMessageId: behaviorRootId,
      body: 'Synthetic reply acknowledgement with all-post suppression',
      requiredUserIds: [ownerId],
    },
  });
  assert.equal(suppressedAckReply.statusCode, 200, suppressedAckReply.body);
  assert.equal(
    await prisma.appNotification.count({
      where: {
        messageId: suppressedAckReply.json().id,
        userId: ownerId,
        kind: 'chat_message',
      },
    }),
    0,
  );
  const restoreAllPosts = await server.inject({
    method: 'PATCH',
    url: `/chat-rooms/${roomId}/notification-setting`,
    headers: ownerHeaders,
    payload: { notifyAllPosts: true, muteUntil: null },
  });
  assert.equal(restoreAllPosts.statusCode, 200, restoreAllPosts.body);
  const replyAck = await server.inject({
    method: 'POST',
    url: `/chat-ack-requests/${ackReply.json().ackRequest.id}/ack`,
    headers: ownerHeaders,
  });
  assert.equal(replyAck.statusCode, 200, replyAck.body);
  assert.deepEqual(
    replyAck.json().acks.map((ack) => ack.userId),
    [ownerId],
  );
  const replyAckRevoke = await server.inject({
    method: 'POST',
    url: `/chat-ack-requests/${ackReply.json().ackRequest.id}/revoke`,
    headers: ownerHeaders,
  });
  assert.equal(replyAckRevoke.statusCode, 200, replyAckRevoke.body);
  assert.deepEqual(replyAckRevoke.json().acks, []);

  await prisma.chatMessage.createMany({
    data: [
      {
        id: routeDeleteRaceRootId,
        roomId,
        userId: ownerId,
        body: 'Synthetic route delete race root',
      },
      {
        id: ackDeleteRaceRootId,
        roomId,
        userId: ownerId,
        body: 'Synthetic ack delete race root',
      },
      {
        id: 'thread-acl-reply-root',
        roomId,
        userId: aclRaceUserId,
        body: 'Synthetic ACL reply race root',
      },
      {
        id: 'thread-acl-reaction-message',
        roomId,
        userId: aclRaceUserId,
        body: 'Synthetic ACL reaction race message',
      },
      {
        id: 'thread-acl-delete-message',
        roomId,
        userId: aclRaceUserId,
        body: 'Synthetic ACL delete race message',
      },
      {
        id: 'thread-room-acl-reply-root',
        roomId,
        userId: aclRaceUserId,
        body: 'Synthetic room ACL reply race root',
      },
    ],
  });

  for (const race of [
    {
      label: 'reply',
      request: {
        method: 'POST',
        url: '/chat-messages/thread-acl-reply-root/replies',
        headers: aclRaceHeaders,
        payload: { body: 'Must not survive reply ACL revocation race' },
      },
      assertNoMutation: async () => {
        assert.equal(
          await prisma.chatMessage.count({
            where: { body: 'Must not survive reply ACL revocation race' },
          }),
          0,
        );
      },
    },
    {
      label: 'reaction',
      request: {
        method: 'POST',
        url: '/chat-messages/thread-acl-reaction-message/reactions',
        headers: aclRaceHeaders,
        payload: { emoji: '🔒' },
      },
      assertNoMutation: async () => {
        const row = await prisma.chatMessage.findUniqueOrThrow({
          where: { id: 'thread-acl-reaction-message' },
          select: { reactions: true },
        });
        assert.equal(row.reactions, null);
      },
    },
    {
      label: 'delete',
      request: {
        method: 'DELETE',
        url: '/chat-messages/thread-acl-delete-message',
        headers: aclRaceHeaders,
        payload: { reason: 'user_retract' },
      },
      assertNoMutation: async () => {
        const row = await prisma.chatMessage.findUniqueOrThrow({
          where: { id: 'thread-acl-delete-message' },
          select: { deletedAt: true },
        });
        assert.equal(row.deletedAt, null);
      },
    },
  ]) {
    const aclClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    try {
      await aclClient.connect();
      await aclClient.query('BEGIN');
      await aclClient.query(
        `UPDATE "ChatRoomMember"
            SET "deletedAt" = now(), "updatedAt" = now()
          WHERE "roomId" = $1 AND "userId" = $2`,
        [roomId, aclRaceUserId],
      );
      let settled = false;
      const pendingRequest = server.inject(race.request).finally(() => {
        settled = true;
      });
      await waitForLockWaiters(
        aclClient,
        1,
        `${race.label} behind ACL revocation`,
      );
      assert.equal(
        settled,
        false,
        `${race.label} must wait for ACL revocation`,
      );
      await aclClient.query('COMMIT');
      const response = await pendingRequest;
      assert.equal(response.statusCode, 404, response.body);
      await race.assertNoMutation();
    } catch (error) {
      await aclClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await aclClient.end();
      await prisma.chatRoomMember.update({
        where: {
          roomId_userId: { roomId, userId: aclRaceUserId },
        },
        data: { deletedAt: null, deletedReason: null },
      });
    }
  }

  const roomAclClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await roomAclClient.connect();
    await roomAclClient.query('BEGIN');
    await roomAclClient.query(
      `UPDATE "ChatRoom"
          SET "posterGroupIds" = $2::jsonb, "updatedAt" = now()
        WHERE "id" = $1`,
      [roomId, JSON.stringify(['blocked-poster-group'])],
    );
    let settled = false;
    const pendingReply = server
      .inject({
        method: 'POST',
        url: '/chat-messages/thread-room-acl-reply-root/replies',
        headers: aclRaceHeaders,
        payload: { body: 'Must not survive room ACL update race' },
      })
      .finally(() => {
        settled = true;
      });
    await waitForLockWaiters(roomAclClient, 1, 'reply behind room ACL update');
    assert.equal(settled, false, 'reply must wait for room ACL update');
    await roomAclClient.query('COMMIT');
    const response = await pendingReply;
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(
      await prisma.chatMessage.count({
        where: { body: 'Must not survive room ACL update race' },
      }),
      0,
    );
  } catch (error) {
    await roomAclClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await roomAclClient.end();
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { posterGroupIds: [] },
    });
  }

  for (const [raceRootId, endpoint, body] of [
    [
      routeDeleteRaceRootId,
      `/chat-messages/${routeDeleteRaceRootId}/replies`,
      { body: 'Must not survive route root deletion race' },
    ],
    [
      ackDeleteRaceRootId,
      `/chat-rooms/${roomId}/ack-requests`,
      {
        parentMessageId: ackDeleteRaceRootId,
        body: 'Must not survive ack root deletion race',
        requiredUserIds: [ownerId],
      },
    ],
  ]) {
    const deleteRaceClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    try {
      await deleteRaceClient.connect();
      await deleteRaceClient.query('BEGIN');
      await deleteRaceClient.query(
        `UPDATE "ChatMessage"
            SET "deletedAt" = now(), "updatedAt" = now()
          WHERE "id" = $1`,
        [raceRootId],
      );
      let requestSettled = false;
      const pendingRequest = server
        .inject({
          method: 'POST',
          url: endpoint,
          headers: memberHeaders,
          payload: body,
        })
        .finally(() => {
          requestSettled = true;
        });
      await waitForLockWaiters(
        deleteRaceClient,
        1,
        'reply or ACK creation behind root deletion',
      );
      assert.equal(requestSettled, false);
      await deleteRaceClient.query('COMMIT');
      const response = await pendingRequest;
      assert.equal(response.statusCode, 404, response.body);
      assert.equal(
        await prisma.chatMessage.count({ where: { body: body.body } }),
        0,
      );
    } catch (error) {
      await deleteRaceClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await deleteRaceClient.end();
    }
  }

  const ackMutationRaces = [
    ['ack-delete-race-message', 'ack-delete-race-request'],
    ['ack-cancel-race-message', 'ack-cancel-race-request'],
    ['ack-acl-race-message', 'ack-acl-race-request'],
  ];
  for (const [messageId, requestId] of ackMutationRaces) {
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        roomId,
        userId: ownerId,
        body: 'Synthetic ACK mutation race',
        createdBy: ownerId,
        ackRequest: {
          create: {
            id: requestId,
            roomId,
            requiredUserIds: [ownerId],
            createdBy: ownerId,
          },
        },
      },
    });
  }

  await prisma.chatMessage.create({
    data: {
      id: 'ack-room-mismatch-message',
      roomId: otherRoomId,
      userId: ownerId,
      body: 'Synthetic inconsistent ACK relation',
      createdBy: ownerId,
      ackRequest: {
        create: {
          id: 'ack-room-mismatch-request',
          roomId,
          requiredUserIds: [ownerId],
          createdBy: ownerId,
        },
      },
    },
  });
  for (const [suffix, payload] of [
    ['ack', undefined],
    ['revoke', undefined],
    ['cancel', { reason: 'Synthetic mismatch must fail closed' }],
  ]) {
    const response = await server.inject({
      method: 'POST',
      url: `/chat-ack-requests/ack-room-mismatch-request/${suffix}`,
      headers: ownerHeaders,
      ...(payload ? { payload } : {}),
    });
    assert.equal(response.statusCode, 404, `${suffix}: ${response.body}`);
  }
  const mismatchedRequest = await prisma.chatAckRequest.findUniqueOrThrow({
    where: { id: 'ack-room-mismatch-request' },
    select: { canceledAt: true, acks: { select: { id: true } } },
  });
  assert.equal(mismatchedRequest.canceledAt, null);
  assert.deepEqual(mismatchedRequest.acks, []);

  const ackDeleteClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await ackDeleteClient.connect();
    await ackDeleteClient.query('BEGIN');
    await ackDeleteClient.query(
      `UPDATE "ChatMessage"
          SET "deletedAt" = now(), "updatedAt" = now()
        WHERE "id" = $1`,
      ['ack-delete-race-message'],
    );
    let settled = false;
    const pendingAck = server
      .inject({
        method: 'POST',
        url: '/chat-ack-requests/ack-delete-race-request/ack',
        headers: ownerHeaders,
      })
      .finally(() => {
        settled = true;
      });
    await waitForLockWaiters(ackDeleteClient, 1, 'ACK behind message deletion');
    assert.equal(settled, false);
    await ackDeleteClient.query('COMMIT');
    const response = await pendingAck;
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(
      await prisma.chatAck.count({
        where: { requestId: 'ack-delete-race-request' },
      }),
      0,
    );
  } catch (error) {
    await ackDeleteClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await ackDeleteClient.end();
  }

  const ackCancelClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await ackCancelClient.connect();
    await ackCancelClient.query('BEGIN');
    await ackCancelClient.query(
      `SELECT "id" FROM "ChatAckRequest" WHERE "id" = $1 FOR UPDATE`,
      ['ack-cancel-race-request'],
    );
    const pendingCancel = server.inject({
      method: 'POST',
      url: '/chat-ack-requests/ack-cancel-race-request/cancel',
      headers: ownerHeaders,
      payload: { reason: 'Synthetic serialization race' },
    });
    await waitForLockWaiters(
      ackCancelClient,
      1,
      'cancel behind ACK request lock',
    );
    const pendingAck = server.inject({
      method: 'POST',
      url: '/chat-ack-requests/ack-cancel-race-request/ack',
      headers: ownerHeaders,
    });
    await waitForLockWaiters(
      ackCancelClient,
      2,
      'cancel and acknowledge behind ACK request lock',
    );
    await ackCancelClient.query('COMMIT');
    const [cancelResponse, ackResponse] = await Promise.all([
      pendingCancel,
      pendingAck,
    ]);
    assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);
    assert.equal(ackResponse.statusCode, 409, ackResponse.body);
    assert.equal(
      await prisma.chatAck.count({
        where: { requestId: 'ack-cancel-race-request' },
      }),
      0,
    );
  } catch (error) {
    await ackCancelClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await ackCancelClient.end();
  }

  const ackAclClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await ackAclClient.connect();
    await ackAclClient.query('BEGIN');
    await ackAclClient.query(
      `UPDATE "ChatRoomMember"
          SET "deletedAt" = now(), "updatedAt" = now()
        WHERE "roomId" = $1 AND "userId" = $2`,
      [roomId, ownerId],
    );
    let settled = false;
    const pendingAck = server
      .inject({
        method: 'POST',
        url: '/chat-ack-requests/ack-acl-race-request/ack',
        headers: ownerHeaders,
      })
      .finally(() => {
        settled = true;
      });
    await waitForLockWaiters(ackAclClient, 1, 'ACK behind ACL revocation');
    assert.equal(settled, false);
    await ackAclClient.query('COMMIT');
    const response = await pendingAck;
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(
      await prisma.chatAck.count({
        where: { requestId: 'ack-acl-race-request' },
      }),
      0,
    );
  } catch (error) {
    await ackAclClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await ackAclClient.end();
    await prisma.chatRoomMember.update({
      where: { roomId_userId: { roomId, userId: ownerId } },
      data: { deletedAt: null, deletedReason: null },
    });
  }

  const deletedReply = await server.inject({
    method: 'DELETE',
    url: `/chat-messages/${postedReplyBody.id}`,
    headers: memberHeaders,
    payload: { reason: 'user_retract' },
  });
  assert.equal(deletedReply.statusCode, 200, deletedReply.body);
  assert.equal(deletedReply.json().deletedReason, 'user_retract');
  const notificationsAfterDelete = await server.inject({
    method: 'GET',
    url: '/notifications?limit=200',
    headers: ownerHeaders,
  });
  assert.equal(
    notificationsAfterDelete.statusCode,
    200,
    notificationsAfterDelete.body,
  );
  assert.ok(
    notificationsAfterDelete
      .json()
      .items.some(
        (item) =>
          item.kind === 'chat_mention' && item.payload?.redacted === true,
      ),
  );
  assert.equal(
    notificationsAfterDelete.body.includes(postedReplyBody.id),
    false,
  );
  assert.equal(
    notificationsAfterDelete.body.includes(
      'Synthetic behavior reply needle-2014',
    ),
    false,
  );
  const behaviorThread = await server.inject({
    method: 'GET',
    url: `/chat-messages/${behaviorRootId}/thread`,
    headers: ownerHeaders,
  });
  assert.equal(behaviorThread.statusCode, 200, behaviorThread.body);
  assert.equal(behaviorThread.json().replyCount, 5);
  assert.ok(
    behaviorThread
      .json()
      .replies.some((item) => item.id === ackReply.json().id),
  );
  assert.ok(
    behaviorThread
      .json()
      .replies.some((item) => item.id === mentionedAckReply.json().id),
  );
  assert.ok(
    behaviorThread
      .json()
      .replies.some((item) => item.id === suppressedAckReply.json().id),
  );
  const deletedPlaceholder = behaviorThread
    .json()
    .replies.find((item) => item.id === postedReplyBody.id);
  assert.equal(deletedPlaceholder.deleted, true);
  assert.equal(deletedPlaceholder.body, null);

  const highWaterValues = [
    new Date(Date.now() - 30_000),
    new Date(Date.now() - 10_000),
  ];
  await Promise.all(
    highWaterValues.map((through) =>
      server.inject({
        method: 'POST',
        url: `/chat-rooms/${roomId}/read`,
        headers: ownerHeaders,
        payload: { through: through.toISOString() },
      }),
    ),
  );
  const readState = await prisma.chatReadState.findUniqueOrThrow({
    where: { roomId_userId: { roomId, userId: ownerId } },
  });
  assert.ok(readState.lastReadAt >= highWaterValues[1]);

  const sameMillisecondAt = new Date(Date.now() - 1_000);
  const boundaryMessageId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const laterMessageId = '00000000-0000-4000-8000-000000000001';
  const boundaryMessage = await prisma.chatMessage.create({
    data: {
      id: boundaryMessageId,
      roomId: readBoundaryRoomId,
      userId: ownerId,
      body: 'Synthetic displayed same-millisecond message',
      createdAt: sameMillisecondAt,
    },
    select: { activitySequence: true },
  });
  const boundaryRead = await server.inject({
    method: 'POST',
    url: `/chat-rooms/${readBoundaryRoomId}/read`,
    headers: ownerHeaders,
    payload: {
      through: sameMillisecondAt.toISOString(),
      throughMessageId: boundaryMessageId,
    },
  });
  assert.equal(boundaryRead.statusCode, 200, boundaryRead.body);
  assert.equal(boundaryRead.json().lastReadMessageId, boundaryMessageId);
  const laterMessage = await prisma.chatMessage.create({
    data: {
      id: laterMessageId,
      roomId: readBoundaryRoomId,
      userId: ownerId,
      body: 'Synthetic later same-millisecond reply',
      parentMessageId: boundaryMessageId,
      threadRootId: boundaryMessageId,
      createdAt: sameMillisecondAt,
    },
    select: { activitySequence: true },
  });
  assert.ok(laterMessageId < boundaryMessageId);
  assert.ok(laterMessage.activitySequence > boundaryMessage.activitySequence);
  const sameMillisecondUnread = await server.inject({
    method: 'GET',
    url: `/chat-rooms/${readBoundaryRoomId}/unread`,
    headers: ownerHeaders,
  });
  assert.equal(
    sameMillisecondUnread.statusCode,
    200,
    sameMillisecondUnread.body,
  );
  assert.equal(sameMillisecondUnread.json().unreadCount, 1);
  assert.equal(
    sameMillisecondUnread.json().lastReadMessageId,
    boundaryMessageId,
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      postgres: 15,
      roots: roots.length,
      replies: replyIds.length,
      paginationPagesChecked: 2,
      unauthorizedNormalized: true,
      projectAliasCompatible: true,
      ackAliasMessageNotifications: true,
      ackAliasNotificationSuppression: true,
      rootTimelineExcludesReplies: true,
      concurrentRootDeleteFailsClosed: true,
      replyMutationAndAck: true,
      replySearch: true,
      stableReplySearchBoundary: true,
      replyUnreadHighWater: true,
      sameMillisecondUnreadBoundary: true,
      replyReaction: true,
      reactionConcurrency: true,
      outsiderMentionRedacted: true,
      routeDeleteRaceNormalized: true,
      ackDeleteRaceFailsClosed: true,
      ackRoomMismatchFailsClosed: true,
      ackCancelRaceSerialized: true,
      ackAclRevocationRaceFailsClosed: true,
      replyReactionDeleteAclRevocationRacesFailClosed: true,
      roomAclUpdateRaceFailsClosed: true,
      deletedNotificationRedacted: true,
      replyLogicalDelete: true,
    }),
  );
} finally {
  await concurrentPool.end().catch(() => undefined);
  if (server) await server.close();
  else await prisma.$disconnect();
}
