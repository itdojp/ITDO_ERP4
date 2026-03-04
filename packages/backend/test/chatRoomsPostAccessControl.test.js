import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function withEnv(overrides, fn) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function withServer(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    },
  );
}

function userHeaders() {
  return {
    'x-user-id': 'user-1',
    'x-roles': 'user',
    'x-group-ids': 'viewer-group',
  };
}

test('POST /chat-rooms/:roomId/messages requires post access level', async () => {
  let createCalled = false;

  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => ({
        id: 'room-1',
        type: 'company',
        isOfficial: true,
        groupId: null,
        viewerGroupIds: ['viewer-group'],
        posterGroupIds: ['poster-group'],
        deletedAt: null,
        allowExternalUsers: false,
      }),
      'chatMessage.create': async () => {
        createCalled = true;
        throw new Error('chatMessage.create should not be called');
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/chat-rooms/room-1/messages',
          headers: userHeaders(),
          payload: { body: 'test message' },
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body?.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'forbidden_room_member');
      });
    },
  );

  assert.equal(createCalled, false);
});
