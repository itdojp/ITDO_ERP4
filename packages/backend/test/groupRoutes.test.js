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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
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

test('GET /groups denies non admin/mgmt user', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/groups',
      headers: userHeaders(),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  });
});

test('GET /groups returns mapped fields and sorting query', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'groupAccount.findMany': async (args) => {
        capturedArgs = args;
        return [
          {
            id: 'g-1',
            displayName: 'Finance',
            externalId: null,
            active: true,
            scimMeta: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            _count: { memberships: 2 },
          },
          {
            id: 'g-2',
            displayName: 'SCIM Managed',
            externalId: 'scim-001',
            active: true,
            scimMeta: null,
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            _count: { memberships: 5 },
          },
        ];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/groups',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 2);
        assert.equal(body?.items?.[0]?.memberCount, 2);
        assert.equal(body?.items?.[0]?.isScimManaged, false);
        assert.equal(body?.items?.[1]?.isScimManaged, true);
      });
    },
  );
  assert.deepEqual(capturedArgs?.orderBy, { displayName: 'asc' });
  assert.deepEqual(capturedArgs?.select?._count, { select: { memberships: true } });
});

test('GET /groups/:groupId/members returns NOT_FOUND for unknown group', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/groups/group-missing/members',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('POST /groups rejects duplicate displayName', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findFirst': async () => ({ id: 'g-1' }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/groups',
          headers: adminHeaders(),
          payload: { displayName: 'Finance' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'GROUP_EXISTS');
      });
    },
  );
});

test('POST /groups returns MISSING_USERS when unresolved users are requested', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findFirst': async () => null,
      'userAccount.findMany': async () => [{ id: 'u-1', userName: 'alice' }],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/groups',
          headers: adminHeaders(),
          payload: { displayName: 'Finance', userIds: ['alice', 'missing-user'] },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'MISSING_USERS');
        assert.deepEqual(body?.error?.missing, ['missing-user']);
      });
    },
  );
});

test('POST /groups creates group, members and audit log', async () => {
  let capturedCreateArgs = null;
  let capturedCreateManyArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'groupAccount.findFirst': async () => null,
      'userAccount.findMany': async () => [
        { id: 'u-1', userName: 'alice' },
        { id: 'u-2', userName: 'bob' },
      ],
      'groupAccount.create': async (args) => {
        capturedCreateArgs = args;
        return { id: 'g-new', displayName: args.data.displayName, active: true };
      },
      'userGroup.createMany': async (args) => {
        capturedCreateManyArgs = args;
        return { count: 2 };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/groups',
          headers: adminHeaders(),
          payload: {
            displayName: '  Finance  ',
            userIds: ['alice', 'alice', 'u-2'],
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.id, 'g-new');
        assert.equal(body?.displayName, 'Finance');
        assert.equal(body?.active, true);
      });
    },
  );
  assert.equal(capturedCreateArgs?.data?.displayName, 'Finance');
  assert.equal(capturedCreateArgs?.data?.createdBy, 'admin-user');
  assert.equal(capturedCreateArgs?.data?.updatedBy, 'admin-user');
  assert.deepEqual(capturedCreateManyArgs, {
    data: [
      { groupId: 'g-new', userId: 'u-1' },
      { groupId: 'g-new', userId: 'u-2' },
    ],
    skipDuplicates: true,
  });
  assert.deepEqual(auditActions, ['group_created']);
});

test('PATCH /groups/:groupId rejects SCIM-managed group', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => ({
        id: 'g-1',
        displayName: 'Finance',
        externalId: 'scim-1',
        scimMeta: null,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/groups/g-1',
          headers: adminHeaders(),
          payload: { displayName: 'Finance2' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'SCIM_MANAGED_GROUP');
      });
    },
  );
});

test('PATCH /groups/:groupId rejects blank displayName after trim', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => ({
        id: 'g-1',
        displayName: 'Finance',
        externalId: null,
        scimMeta: null,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/groups/g-1',
          headers: adminHeaders(),
          payload: { displayName: '   ' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'DISPLAY_NAME_REQUIRED');
      });
    },
  );
});

test('PATCH /groups/:groupId updates mutable fields and writes audit log', async () => {
  let capturedUpdateArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => ({
        id: 'g-1',
        displayName: 'Finance',
        externalId: null,
        scimMeta: null,
      }),
      'groupAccount.findFirst': async () => null,
      'groupAccount.update': async (args) => {
        capturedUpdateArgs = args;
        return {
          id: 'g-1',
          displayName: args.data.displayName,
          active: args.data.active,
        };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/groups/g-1',
          headers: adminHeaders(),
          payload: { displayName: '  Finance Ops  ', active: false },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.displayName, 'Finance Ops');
        assert.equal(body?.active, false);
      });
    },
  );
  assert.equal(capturedUpdateArgs?.where?.id, 'g-1');
  assert.equal(capturedUpdateArgs?.data?.displayName, 'Finance Ops');
  assert.equal(capturedUpdateArgs?.data?.active, false);
  assert.equal(capturedUpdateArgs?.data?.updatedBy, 'admin-user');
  assert.deepEqual(auditActions, ['group_updated']);
});

test('POST /groups/:groupId/members returns MISSING_USERS when unresolved users exist', async () => {
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => ({
        id: 'g-1',
        externalId: null,
        scimMeta: null,
      }),
      'userAccount.findMany': async () => [{ id: 'u-1', userName: 'alice' }],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/groups/g-1/members',
          headers: adminHeaders(),
          payload: { userIds: ['alice', 'missing-user'] },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'MISSING_USERS');
      });
    },
  );
});

test('DELETE /groups/:groupId/members removes members and writes audit log', async () => {
  let capturedDeleteArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'groupAccount.findUnique': async () => ({
        id: 'g-1',
        externalId: null,
        scimMeta: null,
      }),
      'userAccount.findMany': async () => [{ id: 'u-1', userName: 'alice' }],
      'userGroup.deleteMany': async (args) => {
        capturedDeleteArgs = args;
        return { count: 1 };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'DELETE',
          url: '/groups/g-1/members',
          headers: adminHeaders(),
          payload: { userIds: ['alice'] },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.ok, true);
        assert.equal(body?.requested, 1);
        assert.equal(body?.removed, 1);
      });
    },
  );
  assert.deepEqual(capturedDeleteArgs, {
    where: { groupId: 'g-1', userId: { in: ['u-1'] } },
  });
  assert.deepEqual(auditActions, ['group_members_removed']);
});
