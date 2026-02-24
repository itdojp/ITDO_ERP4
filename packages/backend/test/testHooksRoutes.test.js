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
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
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

test('test hook route is disabled unless E2E_ENABLE_TEST_HOOKS=1', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '0',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 404);
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route requires admin or mgmt role', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: userHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 403, res.body);
        const payload = JSON.parse(res.body);
        assert.equal(payload?.error?.code, 'forbidden');
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route is disabled in production even when E2E_ENABLE_TEST_HOOKS=1', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'true',
      NODE_ENV: 'production',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 404);
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route validates approvalInstanceId', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: '   ' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const payload = JSON.parse(res.body);
        assert.equal(payload?.error?.code, 'INVALID_APPROVAL_INSTANCE_ID');
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route deletes evidence snapshots for an approval instance', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      let capturedWhere = null;
      await withPrismaStubs(
        {
          'evidenceSnapshot.deleteMany': async ({ where }) => {
            capturedWhere = where;
            return { count: 2 };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/__test__/evidence-snapshots/reset',
              headers: adminHeaders(),
              payload: { approvalInstanceId: 'approval-002' },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.deletedCount, 2);
            assert.deepEqual(capturedWhere, { approvalInstanceId: 'approval-002' });
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
