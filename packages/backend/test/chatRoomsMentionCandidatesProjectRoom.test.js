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

function headers() {
  return {
    'x-user-id': 'requester',
    'x-roles': 'admin',
    'x-project-ids': 'proj-1',
    'x-group-ids': '',
  };
}

test('GET /chat-rooms/:roomId/mention-candidates includes project members for project room', async () => {
  let chatRoomMemberCalled = false;
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => ({
        id: 'proj-1',
        type: 'project',
        isOfficial: true,
        groupId: null,
        viewerGroupIds: [],
        posterGroupIds: [],
        deletedAt: null,
        allowExternalUsers: false,
      }),
      'chatRoomMember.findMany': async () => {
        chatRoomMemberCalled = true;
        return [{ userId: 'external-member' }];
      },
      'projectMember.findMany': async () => [{ userId: 'project-member' }],
      'userAccount.findMany': async () => [
        {
          userName: 'requester',
          externalId: 'requester',
          displayName: 'Requester',
        },
        {
          userName: 'project-member',
          externalId: 'project-member',
          displayName: 'Project Member',
        },
        {
          userName: 'external-member',
          externalId: 'external-member',
          displayName: 'External Member',
        },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/chat-rooms/proj-1/mention-candidates',
          headers: headers(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        const userIds = Array.isArray(body?.users)
          ? body.users.map((user) => user.userId).sort()
          : [];
        assert.deepEqual(userIds, ['project-member', 'requester']);
      });
    },
  );
  assert.equal(chatRoomMemberCalled, false);
});

test('GET /chat-rooms/:roomId/mention-candidates includes room members when project room allows external users', async () => {
  await withPrismaStubs(
    {
      'chatRoom.findUnique': async () => ({
        id: 'proj-1',
        type: 'project',
        isOfficial: true,
        groupId: null,
        viewerGroupIds: [],
        posterGroupIds: [],
        deletedAt: null,
        allowExternalUsers: true,
      }),
      'chatRoomMember.findMany': async () => [{ userId: 'external-member' }],
      'projectMember.findMany': async () => [{ userId: 'project-member' }],
      'userAccount.findMany': async () => [
        {
          userName: 'requester',
          externalId: 'requester',
          displayName: 'Requester',
        },
        {
          userName: 'project-member',
          externalId: 'project-member',
          displayName: 'Project Member',
        },
        {
          userName: 'external-member',
          externalId: 'external-member',
          displayName: 'External Member',
        },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/chat-rooms/proj-1/mention-candidates',
          headers: headers(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        const userIds = Array.isArray(body?.users)
          ? body.users.map((user) => user.userId).sort()
          : [];
        assert.deepEqual(userIds, [
          'external-member',
          'project-member',
          'requester',
        ]);
      });
    },
  );
});
