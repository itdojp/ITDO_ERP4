import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const model = segments.length > 1 ? segments[0] : null;
    const method = segments.length > 1 ? segments[1] : segments[0];
    const target = model ? prisma[model] : prisma;
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
      SCIM_BEARER_TOKEN: 'scim-test-token',
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

function scimHeaders() {
  return {
    authorization: 'Bearer scim-test-token',
  };
}

function buildScimUser(overrides = {}) {
  return {
    id: 'ua-1',
    externalId: 'employee-1',
    userName: 'employee.user',
    displayName: 'Employee User',
    givenName: null,
    familyName: null,
    active: true,
    emails: null,
    phoneNumbers: null,
    department: null,
    organization: null,
    managerUserId: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('PUT /scim/v2/Users/:id deactivates previous personal GA member when identifier changes', async () => {
  const memberUpserts = [];
  const memberDeactivations = [];
  const auditLogs = [];
  await withPrismaStubs(
    {
      $transaction: async (handler) => handler(prisma),
      'userAccount.findUnique': async () => buildScimUser(),
      'userAccount.findFirst': async () => null,
      'userAccount.update': async () =>
        buildScimUser({
          externalId: 'employee-2',
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        }),
      'groupAccount.upsert': async () => ({ id: 'general_affairs' }),
      'chatRoom.upsert': async () => ({ id: 'pga_room_1' }),
      'chatRoomMember.upsert': async (args) => {
        memberUpserts.push(args);
        return { roomId: 'pga_room_1', userId: 'employee-2', role: 'owner' };
      },
      'chatRoomMember.updateMany': async (args) => {
        memberDeactivations.push(args);
        return { count: 1 };
      },
      'auditLog.create': async (args) => {
        auditLogs.push(args.data);
        return { id: `audit-${auditLogs.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PUT',
          url: '/scim/v2/Users/ua-1',
          headers: scimHeaders(),
          payload: {
            userName: 'employee.user',
            externalId: 'employee-2',
            displayName: 'Employee User',
            active: true,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );

  assert.equal(memberUpserts.length, 1);
  assert.equal(memberUpserts[0]?.where?.roomId_userId?.userId, 'employee-2');
  assert.equal(memberDeactivations.length, 1);
  assert.equal(memberDeactivations[0]?.where?.userId, 'employee-1');
  assert.equal(
    memberDeactivations[0]?.data?.deletedReason,
    'scim_user_identifier_changed',
  );
  const actions = auditLogs.map((entry) => entry.action);
  assert.equal(actions.includes('personal_ga_room_member_reactivated'), true);
  assert.equal(actions.includes('personal_ga_room_member_deactivated'), true);
  assert.equal(actions.includes('scim_user_update'), true);
});

test('PUT /scim/v2/Users/:id deactivates personal GA member when active=false', async () => {
  const memberDeactivations = [];
  const auditLogs = [];
  await withPrismaStubs(
    {
      $transaction: async (handler) => handler(prisma),
      'userAccount.findUnique': async () => buildScimUser(),
      'userAccount.findFirst': async () => null,
      'userAccount.update': async () =>
        buildScimUser({
          active: false,
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        }),
      'groupAccount.upsert': async () => {
        throw new Error('groupAccount.upsert should not be called');
      },
      'chatRoom.upsert': async () => {
        throw new Error('chatRoom.upsert should not be called');
      },
      'chatRoomMember.upsert': async () => {
        throw new Error('chatRoomMember.upsert should not be called');
      },
      'chatRoomMember.updateMany': async (args) => {
        memberDeactivations.push(args);
        return { count: 1 };
      },
      'auditLog.create': async (args) => {
        auditLogs.push(args.data);
        return { id: `audit-${auditLogs.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PUT',
          url: '/scim/v2/Users/ua-1',
          headers: scimHeaders(),
          payload: {
            userName: 'employee.user',
            externalId: 'employee-1',
            displayName: 'Employee User',
            active: false,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );

  assert.equal(memberDeactivations.length, 1);
  assert.equal(memberDeactivations[0]?.where?.userId, 'employee-1');
  assert.equal(
    memberDeactivations[0]?.data?.deletedReason,
    'scim_user_deactivated',
  );
  const actions = auditLogs.map((entry) => entry.action);
  assert.equal(actions.includes('personal_ga_room_member_deactivated'), true);
  assert.equal(actions.includes('personal_ga_room_member_reactivated'), false);
  assert.equal(actions.includes('scim_user_update'), true);
});

test('PATCH /scim/v2/Users/:id switches personal GA member when externalId is replaced', async () => {
  const memberUpserts = [];
  const memberDeactivations = [];
  const auditLogs = [];
  await withPrismaStubs(
    {
      $transaction: async (handler) => handler(prisma),
      'userAccount.findUnique': async () => buildScimUser(),
      'userAccount.update': async (args) =>
        buildScimUser({
          externalId: args?.data?.externalId ?? 'employee-2',
          updatedAt: new Date('2026-03-03T00:00:00.000Z'),
        }),
      'groupAccount.upsert': async () => ({ id: 'general_affairs' }),
      'chatRoom.upsert': async () => ({ id: 'pga_room_1' }),
      'chatRoomMember.upsert': async (args) => {
        memberUpserts.push(args);
        return { roomId: 'pga_room_1', userId: 'employee-2', role: 'owner' };
      },
      'chatRoomMember.updateMany': async (args) => {
        memberDeactivations.push(args);
        return { count: 1 };
      },
      'auditLog.create': async (args) => {
        auditLogs.push(args.data);
        return { id: `audit-${auditLogs.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/scim/v2/Users/ua-1',
          headers: scimHeaders(),
          payload: {
            Operations: [
              {
                op: 'replace',
                path: 'externalId',
                value: {
                  externalId: 'employee-2',
                },
              },
            ],
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );

  assert.equal(memberUpserts.length, 1);
  assert.equal(memberUpserts[0]?.where?.roomId_userId?.userId, 'employee-2');
  assert.equal(memberDeactivations.length, 1);
  assert.equal(memberDeactivations[0]?.where?.userId, 'employee-1');
  const actions = auditLogs.map((entry) => entry.action);
  assert.equal(actions.includes('personal_ga_room_member_reactivated'), true);
  assert.equal(actions.includes('personal_ga_room_member_deactivated'), true);
  assert.equal(actions.includes('scim_user_patch'), true);
});

test('PATCH /scim/v2/Users/:id remove active deactivates personal GA member', async () => {
  const memberDeactivations = [];
  const auditLogs = [];
  await withPrismaStubs(
    {
      $transaction: async (handler) => handler(prisma),
      'userAccount.findUnique': async () => buildScimUser(),
      'userAccount.update': async () =>
        buildScimUser({
          active: false,
          updatedAt: new Date('2026-03-03T00:00:00.000Z'),
        }),
      'groupAccount.upsert': async () => {
        throw new Error('groupAccount.upsert should not be called');
      },
      'chatRoom.upsert': async () => {
        throw new Error('chatRoom.upsert should not be called');
      },
      'chatRoomMember.upsert': async () => {
        throw new Error('chatRoomMember.upsert should not be called');
      },
      'chatRoomMember.updateMany': async (args) => {
        memberDeactivations.push(args);
        return { count: 1 };
      },
      'auditLog.create': async (args) => {
        auditLogs.push(args.data);
        return { id: `audit-${auditLogs.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/scim/v2/Users/ua-1',
          headers: scimHeaders(),
          payload: {
            Operations: [
              {
                op: 'remove',
                path: 'active',
              },
            ],
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );

  assert.equal(memberDeactivations.length, 1);
  assert.equal(memberDeactivations[0]?.where?.userId, 'employee-1');
  assert.equal(
    memberDeactivations[0]?.data?.deletedReason,
    'scim_user_deactivated',
  );
  const actions = auditLogs.map((entry) => entry.action);
  assert.equal(actions.includes('personal_ga_room_member_deactivated'), true);
  assert.equal(actions.includes('personal_ga_room_member_reactivated'), false);
  assert.equal(actions.includes('scim_user_patch'), true);
});
