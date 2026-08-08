import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const baseline = process.env.CHAT_THREAD_OLD_APP_BASE_SHA;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
const mode = process.env.CHAT_THREAD_OLD_APP_MODE;

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.CHAT_THREAD_OLD_APP_CONFIRM !== '1' ||
  !baseline ||
  !oldRoot ||
  !currentRoot ||
  !['seed', 'current-before', 'old-after', 'current-after'].includes(mode) ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_chat_thread_old_app_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback Chat thread old-app database',
  );
}

const appRoot = mode === 'seed' || mode === 'old-after' ? oldRoot : currentRoot;
const load = (path) => import(pathToFileURL(`${appRoot}/${path}`).href);
const roomId = 'old-app-thread-room';
const rootId = 'old-app-thread-root';
const postMigrationRootId = 'old-app-post-migration-root';
const ownerId = 'old-app-thread-owner';

if (mode === 'seed') {
  const { prisma } = await load('packages/backend/dist/services/db.js');
  try {
    await prisma.chatRoom.create({
      data: {
        id: roomId,
        type: 'private_group',
        name: 'Old application thread room',
        isOfficial: false,
      },
    });
    await prisma.chatRoomMember.create({
      data: { roomId, userId: ownerId },
    });
    await prisma.chatMessage.create({
      data: {
        id: rootId,
        roomId,
        userId: ownerId,
        body: 'Old application root body',
        tags: ['legacy'],
        reactions: { like: ['old-app-reactor'] },
        mentions: { userIds: ['old-app-mentioned'] },
        mentionsAll: false,
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
      },
    });
    await prisma.chatAckRequest.create({
      data: {
        id: 'old-app-ack-request',
        messageId: rootId,
        roomId,
        requiredUserIds: [ownerId],
        createdBy: ownerId,
      },
    });
    await prisma.chatAttachment.create({
      data: {
        id: 'old-app-attachment',
        messageId: rootId,
        provider: 'local',
        providerKey: 'synthetic-old-app-key',
        originalName: 'synthetic.txt',
        sizeBytes: 9,
        createdBy: ownerId,
      },
    });
    await prisma.chatReadState.create({
      data: {
        roomId,
        userId: ownerId,
        lastReadAt: new Date('2026-08-08T00:00:00.000Z'),
      },
    });
    console.log(JSON.stringify({ mode, result: 'SEEDED', baseline }));
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'current-before') {
  const [{ prisma }, { prismaChatThreadRepository }] = await Promise.all([
    load('packages/backend/dist/services/db.js'),
    load('packages/backend/dist/adapters/chat/prismaChatThreadAdapter.js'),
  ]);
  try {
    const root = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: rootId },
      include: { ackRequest: true, attachments: true },
    });
    assert.equal(root.messageType, 'text');
    assert.equal(root.parentMessageId, null);
    assert.equal(root.threadRootId, null);
    assert.equal(root.ackRequest.id, 'old-app-ack-request');
    assert.equal(root.attachments[0].id, 'old-app-attachment');
    const timeline = await prismaChatThreadRepository.listRootTimeline({
      roomId,
      limit: 20,
    });
    assert.deepEqual(
      timeline.map((entry) => entry.id),
      [rootId],
    );
    assert.equal(timeline[0].replyCount, 0);
    console.log(
      JSON.stringify({ mode, result: 'PASS', additiveDefaults: true }),
    );
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'old-after') {
  const [{ prisma }, { buildServer }] = await Promise.all([
    load('packages/backend/dist/services/db.js'),
    load('packages/backend/dist/server.js'),
  ]);
  let server;
  try {
    await prisma.chatMessage.update({
      where: { id: rootId },
      data: {
        body: 'Old application updated root body',
        reactions: { like: ['old-app-reactor', ownerId] },
        updatedBy: ownerId,
      },
    });
    await prisma.chatMessage.create({
      data: {
        id: postMigrationRootId,
        roomId,
        userId: ownerId,
        body: 'Old application post-migration root',
        createdAt: new Date('2026-08-08T00:01:00.000Z'),
      },
    });
    server = await buildServer({ logger: false });
    const response = await server.inject({
      method: 'GET',
      url: `/chat-rooms/${roomId}/messages?limit=20`,
      headers: { 'x-user-id': ownerId, 'x-roles': 'user' },
    });
    assert.equal(response.statusCode, 200, response.body);
    const items = response.json().items;
    assert.deepEqual(
      items.map((item) => item.id),
      [postMigrationRootId, rootId],
    );
    const legacyResponse = items.find((item) => item.id === rootId);
    assert.equal(legacyResponse.body, 'Old application updated root body');
    assert.equal(legacyResponse.ackRequest.id, 'old-app-ack-request');
    assert.equal(legacyResponse.attachments[0].id, 'old-app-attachment');
    assert.equal(Object.hasOwn(legacyResponse, 'messageType'), false);
    assert.equal(Object.hasOwn(legacyResponse, 'parentMessageId'), false);
    assert.equal(Object.hasOwn(legacyResponse, 'threadRootId'), false);
    assert.equal(Object.hasOwn(legacyResponse, 'replyCount'), false);
    assert.equal(Object.hasOwn(legacyResponse, 'lastReplyAt'), false);
    console.log(
      JSON.stringify({ mode, result: 'PASS', oldResponseStable: true }),
    );
  } finally {
    if (server) await server.close();
    else await prisma.$disconnect();
  }
} else {
  const [{ prisma }, { prismaChatThreadRepository }] = await Promise.all([
    load('packages/backend/dist/services/db.js'),
    load('packages/backend/dist/adapters/chat/prismaChatThreadAdapter.js'),
  ]);
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { id: { in: [rootId, postMigrationRootId] } },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.messageType, 'text');
      assert.equal(row.parentMessageId, null);
      assert.equal(row.threadRootId, null);
    }
    assert.equal(rows[0].body, 'Old application updated root body');
    const timeline = await prismaChatThreadRepository.listRootTimeline({
      roomId,
      limit: 20,
    });
    assert.deepEqual(
      timeline.map((entry) => entry.id),
      [postMigrationRootId, rootId],
    );
    console.log(
      JSON.stringify({
        mode,
        result: 'PASS',
        oldWritePreserved: true,
        rootContractPreserved: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
