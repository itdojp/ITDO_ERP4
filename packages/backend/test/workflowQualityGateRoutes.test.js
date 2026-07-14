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

function errorCode(body) {
  if (typeof body?.error === 'string') return body.error;
  return body?.error?.code;
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

test('GET /action-policies rejects invalid flowType before querying', async () => {
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => {
        throw new Error('actionPolicy.findMany should not be called');
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/action-policies?flowType=unknown',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 400, res.body);
        assert.equal(errorCode(JSON.parse(res.body)), 'invalid_flowType');
      });
    },
  );
});

test('GET /action-policies applies filters and stable ordering', async () => {
  let capturedFindManyArgs = null;
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async (args) => {
        capturedFindManyArgs = args;
        return [
          {
            id: 'policy-1',
            flowType: 'invoice',
            actionKey: 'submit',
            priority: 10,
            isEnabled: true,
          },
        ];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/action-policies?flowType=invoice&actionKey=submit&isEnabled=true',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(JSON.parse(res.body)?.items?.[0]?.id, 'policy-1');
      });
    },
  );
  assert.deepEqual(capturedFindManyArgs, {
    where: { flowType: 'invoice', actionKey: 'submit', isEnabled: true },
    orderBy: [{ flowType: 'asc' }, { actionKey: 'asc' }, { priority: 'desc' }],
  });
});

test('POST /action-policies trims actionKey and writes audit metadata', async () => {
  const auditEntries = [];
  let createdData = null;
  await withPrismaStubs(
    {
      'actionPolicy.create': async ({ data }) => {
        createdData = data;
        return {
          id: 'policy-created',
          ...data,
          createdAt: new Date('2026-07-14T00:00:00.000Z'),
          updatedAt: new Date('2026-07-14T00:00:00.000Z'),
        };
      },
      'auditLog.create': async ({ data }) => {
        auditEntries.push(data);
        return { id: `audit-${auditEntries.length}`, ...data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/action-policies',
          headers: adminHeaders(),
          payload: {
            flowType: 'invoice',
            actionKey: '  submit  ',
            priority: 5,
            isEnabled: true,
            subjects: { roles: ['admin'] },
            stateConstraints: { status: ['draft'] },
            requireReason: true,
            guards: [],
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(JSON.parse(res.body)?.id, 'policy-created');
      });
    },
  );
  assert.equal(createdData?.actionKey, 'submit');
  assert.equal(createdData?.createdBy, 'admin-user');
  assert.equal(createdData?.updatedBy, 'admin-user');
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0]?.action, 'action_policy_created');
  assert.equal(auditEntries[0]?.targetId, 'policy-created');
  assert.equal(auditEntries[0]?.metadata?.actionKey, 'submit');
});

test('PATCH /action-policies/:id rejects blank actionKey before transaction', async () => {
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/action-policies/policy-1',
          headers: adminHeaders(),
          payload: { actionKey: '   ' },
        });
        assert.equal(res.statusCode, 400, res.body);
        assert.equal(errorCode(JSON.parse(res.body)), 'actionKey_required');
      });
    },
  );
});

test('POST /action-policies/evaluate normalizes actor arrays and returns decision', async () => {
  let capturedFindManyArgs = null;
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async (args) => {
        capturedFindManyArgs = args;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/action-policies/evaluate',
          headers: adminHeaders(),
          payload: {
            flowType: 'invoice',
            actionKey: ' submit ',
            actor: {
              userId: ' actor-1 ',
              roles: ['admin', 'mgmt'],
              groupIds: ['group-1'],
              groupAccountIds: ['ga-1'],
            },
            reasonText: ' approved ',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.allowed, false);
        assert.equal(body?.reason, 'no_matching_policy');
      });
    },
  );
  assert.equal(capturedFindManyArgs?.where?.flowType, 'invoice');
  assert.equal(capturedFindManyArgs?.where?.actionKey, 'submit');
  assert.deepEqual(capturedFindManyArgs?.orderBy, [
    { priority: 'desc' },
    { createdAt: 'desc' },
  ]);
});

test('GET /period-locks denies non admin/mgmt role', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/period-locks',
      headers: userHeaders(),
    });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(JSON.parse(res.body)?.error?.code, 'forbidden');
  });
});

test('GET /period-locks applies scope/project/period filters', async () => {
  let capturedFindManyArgs = null;
  await withPrismaStubs(
    {
      'periodLock.findMany': async (args) => {
        capturedFindManyArgs = args;
        return [{ id: 'lock-1', scope: 'project', projectId: 'proj-1' }];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/period-locks?scope=project&projectId=proj-1&period=2026-07',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(JSON.parse(res.body)?.items?.[0]?.id, 'lock-1');
      });
    },
  );
  assert.deepEqual(capturedFindManyArgs, {
    where: { scope: 'project', projectId: 'proj-1', period: '2026-07' },
    orderBy: { closedAt: 'desc' },
  });
});

test('POST /period-locks validates scope/projectId before writes', async () => {
  await withServer(async (server) => {
    const missingProject = await server.inject({
      method: 'POST',
      url: '/period-locks',
      headers: adminHeaders(),
      payload: { period: '2026-07', scope: 'project' },
    });
    assert.equal(missingProject.statusCode, 400, missingProject.body);
    assert.equal(
      JSON.parse(missingProject.body)?.error?.code,
      'MISSING_PROJECT_ID',
    );

    const invalidGlobal = await server.inject({
      method: 'POST',
      url: '/period-locks',
      headers: adminHeaders(),
      payload: { period: '2026-07', scope: 'global', projectId: 'proj-1' },
    });
    assert.equal(invalidGlobal.statusCode, 400, invalidGlobal.body);
    assert.equal(JSON.parse(invalidGlobal.body)?.error?.code, 'INVALID_SCOPE');
  });
});

test('POST /period-locks returns conflict for existing lock', async () => {
  await withPrismaStubs(
    {
      'periodLock.findFirst': async () => ({ id: 'lock-existing' }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/period-locks',
          headers: adminHeaders(),
          payload: { period: '2026-07', scope: 'global' },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.equal(JSON.parse(res.body)?.error?.code, 'ALREADY_EXISTS');
      });
    },
  );
});

test('POST /period-locks verifies project and stores closedBy', async () => {
  let createdData = null;
  await withPrismaStubs(
    {
      'periodLock.findFirst': async () => null,
      'project.findUnique': async () => ({ id: 'proj-1' }),
      'periodLock.create': async ({ data }) => {
        createdData = data;
        return { id: 'lock-created', ...data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/period-locks',
          headers: adminHeaders(),
          payload: {
            period: '2026-07',
            scope: 'project',
            projectId: 'proj-1',
            reason: 'monthly close',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(JSON.parse(res.body)?.id, 'lock-created');
      });
    },
  );
  assert.equal(createdData?.period, '2026-07');
  assert.equal(createdData?.scope, 'project');
  assert.equal(createdData?.projectId, 'proj-1');
  assert.equal(createdData?.closedBy, 'admin-user');
  assert.ok(createdData?.closedAt instanceof Date);
});

test('DELETE /period-locks/:id maps not found and deletes existing lock', async () => {
  const deletedIds = [];
  await withPrismaStubs(
    {
      'periodLock.findUnique': async ({ where }) =>
        where.id === 'missing' ? null : { id: where.id },
      'periodLock.delete': async ({ where }) => {
        deletedIds.push(where.id);
        return { id: where.id };
      },
    },
    async () => {
      await withServer(async (server) => {
        const missing = await server.inject({
          method: 'DELETE',
          url: '/period-locks/missing',
          headers: adminHeaders(),
        });
        assert.equal(missing.statusCode, 404, missing.body);
        assert.equal(JSON.parse(missing.body)?.error?.code, 'NOT_FOUND');

        const deleted = await server.inject({
          method: 'DELETE',
          url: '/period-locks/lock-1',
          headers: adminHeaders(),
        });
        assert.equal(deleted.statusCode, 200, deleted.body);
        assert.equal(JSON.parse(deleted.body)?.ok, true);
      });
    },
  );
  assert.deepEqual(deletedIds, ['lock-1']);
});
