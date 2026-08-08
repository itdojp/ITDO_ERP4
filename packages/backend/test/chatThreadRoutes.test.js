import assert from 'node:assert/strict';
import test from 'node:test';

import { prismaChatThreadRepository } from '../dist/adapters/chat/prismaChatThreadAdapter.js';
import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const now = new Date('2026-08-08T00:00:00.000Z');

function message(overrides = {}) {
  return {
    id: 'root-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'user-1',
    body: 'Synthetic body',
    tags: null,
    reactions: null,
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: now,
    createdBy: 'user-1',
    updatedAt: now,
    updatedBy: 'user-1',
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  };
}

function withStubs(snapshotRepository, run) {
  const originalSnapshot = prismaChatThreadRepository.withReadSnapshot;
  const originalAuditCreate = prisma.auditLog.create;
  const auditEntries = [];
  prismaChatThreadRepository.withReadSnapshot = async (operation) =>
    operation(snapshotRepository);
  prisma.auditLog.create = async ({ data }) => {
    auditEntries.push(data);
    return { id: 'audit-1' };
  };
  return Promise.resolve()
    .then(() => run(auditEntries))
    .finally(() => {
      prismaChatThreadRepository.withReadSnapshot = originalSnapshot;
      prisma.auditLog.create = originalAuditCreate;
    });
}

function readableRepository(overrides = {}) {
  const root = message();
  const reply = message({
    id: 'reply-1',
    parentMessageId: root.id,
    threadRootId: root.id,
    body: 'Synthetic reply',
    createdAt: new Date('2026-08-08T00:01:00.000Z'),
  });
  return {
    resolveMessage: async () => ({
      id: root.id,
      roomId: root.roomId,
      parentMessageId: null,
      threadRootId: null,
    }),
    canReadRoom: async () => true,
    readThread: async () => ({
      root,
      replies: [reply],
      replyCount: 1,
      lastReplyAt: reply.createdAt,
      hasMore: false,
    }),
    ...overrides,
  };
}

async function withServer(repository, run) {
  const previousAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'header';
  try {
    await withStubs(repository, async (auditEntries) => {
      const server = await buildServer({ logger: false });
      try {
        await run(server, auditEntries);
      } finally {
        await server.close();
      }
    });
  } finally {
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
  }
}

const headers = {
  'x-user-id': 'user-1',
  'x-roles': 'user',
  'x-project-ids': 'project-1',
};

test('GET thread returns explicit root, reply, aggregate, and pagination fields', async () => {
  await withServer(readableRepository(), async (server, auditEntries) => {
    const response = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=25',
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.root.id, 'root-1');
    assert.equal(body.root.replyCount, 1);
    assert.equal(body.replies[0].parentMessageId, 'root-1');
    assert.equal(body.replies[0].threadRootId, 'root-1');
    assert.equal(body.replyCount, 1);
    assert.equal(body.lastReplyAt, '2026-08-08T00:01:00.000Z');
    assert.equal(body.nextCursor, null);
    assert.equal(Object.hasOwn(body, '_count'), false);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0].metadata.replyCount, 1);
    assert.equal(auditEntries[0].metadata.returnedReplyCount, 1);
    assert.equal(Object.hasOwn(auditEntries[0].metadata, 'roomId'), false);
    assert.equal(JSON.stringify(auditEntries).includes('room-1'), false);
    assert.equal(JSON.stringify(auditEntries).includes('Synthetic'), false);
  });
});

test('GET thread normalizes missing and unauthorized messages to the same 404', async () => {
  for (const repository of [
    readableRepository({ resolveMessage: async () => null }),
    readableRepository({ canReadRoom: async () => false }),
  ]) {
    await withServer(repository, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/hidden/thread',
        headers,
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), {
        error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
      });
    });
  }
});

test('GET thread rejects invalid limit and cursor with sanitized errors', async () => {
  await withServer(readableRepository(), async (server) => {
    const limitResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=0',
      headers,
    });
    assert.equal(limitResponse.statusCode, 400, limitResponse.body);
    const overLimitResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=201',
      headers,
    });
    assert.equal(overLimitResponse.statusCode, 400, overLimitResponse.body);
    const cursorResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?cursor=invalid',
      headers,
    });
    assert.equal(cursorResponse.statusCode, 400, cursorResponse.body);
    assert.equal(cursorResponse.json().error.code, 'INVALID_CURSOR');
    assert.equal(cursorResponse.body.includes('root-1'), false);
  });
});

test('GET thread returns deleted roots and replies as content-free placeholders', async () => {
  const deleted = message({
    body: null,
    deletedAt: now,
    deletedReason: 'author_deleted',
  });
  await withServer(
    readableRepository({
      readThread: async () => ({
        root: deleted,
        replies: [
          message({
            id: 'reply-deleted',
            parentMessageId: deleted.id,
            threadRootId: deleted.id,
            body: null,
            deletedAt: now,
            deletedReason: 'author_deleted',
          }),
        ],
        replyCount: 1,
        lastReplyAt: now,
        hasMore: false,
      }),
    }),
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/root-1/thread',
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.root.deleted, true);
      assert.equal(body.root.body, null);
      assert.equal(body.replies[0].deleted, true);
      assert.equal(body.replies[0].body, null);
    },
  );
});
