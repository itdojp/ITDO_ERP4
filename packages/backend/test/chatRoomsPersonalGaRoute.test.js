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

function userHeaders(userId = 'employee-1') {
  return {
    'x-user-id': userId,
    'x-roles': 'user',
  };
}

test('GET /chat-rooms/personal-general-affairs ensures room and returns metadata', async () => {
  let capturedMemberUpsert = null;
  await withPrismaStubs(
    {
      'userAccount.findFirst': async () => ({
        id: 'ua-1',
        externalId: 'employee-1',
        userName: 'employee.user',
        displayName: 'Employee User',
      }),
      'groupAccount.upsert': async () => ({ id: 'general_affairs' }),
      'chatRoom.upsert': async () => ({ id: 'pga_test_room' }),
      'chatRoomMember.upsert': async (args) => {
        capturedMemberUpsert = args;
        return { roomId: 'pga_test_room', userId: 'employee-1', role: 'owner' };
      },
      'chatRoom.findUnique': async () => ({
        id: 'pga_test_room',
        name: '総務連絡:Employee User',
        type: 'private_group',
        isOfficial: true,
        viewerGroupIds: ['general_affairs'],
        posterGroupIds: ['general_affairs'],
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/chat-rooms/personal-general-affairs',
          headers: userHeaders('employee-1'),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.roomId, 'pga_test_room');
        assert.equal(body?.type, 'private_group');
        assert.equal(body?.isOfficial, true);
        assert.deepEqual(body?.viewerGroupIds, ['general_affairs']);
        assert.deepEqual(body?.posterGroupIds, ['general_affairs']);
      });
    },
  );

  assert.equal(
    capturedMemberUpsert?.where?.roomId_userId?.roomId,
    'pga_test_room',
  );
  assert.equal(
    capturedMemberUpsert?.where?.roomId_userId?.userId,
    'employee-1',
  );
});

test('GET /chat-rooms/personal-general-affairs returns USER_NOT_FOUND when auth user is not mapped', async () => {
  await withPrismaStubs(
    {
      'userAccount.findFirst': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/chat-rooms/personal-general-affairs',
          headers: userHeaders('missing-user'),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'USER_NOT_FOUND');
      });
    },
  );
});
