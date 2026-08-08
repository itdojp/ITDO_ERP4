import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const headers = {
  'x-user-id': 'user-read-route',
  'x-roles': 'user',
};

function room() {
  return {
    id: 'room-read-route',
    type: 'company',
    projectId: null,
    isOfficial: true,
    groupId: null,
    viewerGroupIds: [],
    posterGroupIds: [],
    deletedAt: null,
    allowExternalUsers: false,
  };
}

async function withReadRouteServer(run) {
  const originalFindRoom = prisma.chatRoom.findUnique;
  const originalTransaction = prisma.$transaction;
  let stored = null;
  const boundaryAt = new Date(Date.now() - 1_000);
  const tx = {
    chatMessage: {
      findFirst: async ({ where }) =>
        where.id === 'message-boundary' && where.roomId === 'room-read-route'
          ? {
              id: 'message-boundary',
              createdAt: boundaryAt,
              deletedAt: null,
              activitySequence: 100n,
            }
          : null,
    },
    chatReadState: {
      createMany: async ({ data }) => {
        if (stored) return { count: 0 };
        stored = { ...data };
        return { count: 1 };
      },
      updateMany: async ({ data }) => {
        stored = stored ?? { ...data };
        if (data.lastReadAt.getTime() >= stored.lastReadAt.getTime()) {
          stored = { ...stored, ...data };
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () =>
        stored
          ? {
              lastReadAt: stored.lastReadAt,
              lastReadMessageId: stored.lastReadMessageId ?? null,
            }
          : null,
    },
  };

  prisma.chatRoom.findUnique = async () => room();
  prisma.$transaction = async (operation) => operation(tx);
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    await run(server, boundaryAt);
  } finally {
    await server.close();
    prisma.chatRoom.findUnique = originalFindRoom;
    prisma.$transaction = originalTransaction;
  }
}

test('chat read route preserves bodyless and empty-object clients', async () => {
  await withReadRouteServer(async (server) => {
    for (const request of [
      { method: 'POST', url: '/chat-rooms/room-read-route/read', headers },
      {
        method: 'POST',
        url: '/chat-rooms/room-read-route/read',
        headers,
        payload: {},
      },
    ]) {
      const response = await server.inject(request);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(typeof response.json().lastReadAt, 'string');
      assert.equal(response.json().lastReadMessageId, null);
    }
  });
});

test('chat read route accepts a validated timestamp and message boundary', async () => {
  await withReadRouteServer(async (server, boundaryAt) => {
    const response = await server.inject({
      method: 'POST',
      url: '/chat-rooms/room-read-route/read',
      headers,
      payload: {
        through: boundaryAt.toISOString(),
        throughMessageId: 'message-boundary',
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      lastReadAt: boundaryAt.toISOString(),
      lastReadMessageId: 'message-boundary',
    });
  });
});

test('chat read route rejects unknown, malformed, and mismatched boundaries', async () => {
  await withReadRouteServer(async (server, boundaryAt) => {
    for (const payload of [
      { unknown: true },
      { through: 'invalid' },
      { throughMessageId: 'message-boundary' },
      {
        through: boundaryAt.toISOString(),
        throughMessageId: 'message-missing',
      },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/chat-rooms/room-read-route/read',
        headers,
        payload,
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.body.includes('message-missing'), false);
    }
  });
});
