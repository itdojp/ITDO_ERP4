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

test('GET /integrations/hr/exports/users supports updatedSince and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'userAccount.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'user-001',
            userName: 'alice',
            displayName: 'Alice',
            updatedAt: new Date('2026-02-23T00:00:00.000Z'),
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/users?updatedSince=2026-02-20T00:00:00.000Z&limit=10&offset=2',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 2);
        assert.equal(Array.isArray(body.items), true);
        assert.equal(body.items.length, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 2);
  assert.equal(
    capturedFindMany?.where?.updatedAt?.gt instanceof Date,
    true,
  );
});

test('GET /integrations/hr/exports/users returns 400 for invalid updatedSince', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/integrations/hr/exports/users?updatedSince=invalid',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      const errorCode =
        typeof body.error === 'string' ? body.error : body?.error?.code;
      assert.equal(errorCode, 'invalid_updatedSince');
    } finally {
      await server.close();
    }
  });
});

test('GET /integrations/hr/exports/wellbeing returns data and enforces role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'wellbeingEntry.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'well-001',
            userId: 'user-001',
            status: 'good',
            entryDate: new Date('2026-02-23T00:00:00.000Z'),
            updatedAt: new Date('2026-02-23T00:00:00.000Z'),
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const forbidden = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/wellbeing',
          headers: {
            'x-user-id': 'normal-user',
            'x-roles': 'user',
          },
        });
        assert.equal(forbidden.statusCode, 403, forbidden.body);

        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/wellbeing?limit=5',
          headers: {
            'x-user-id': 'mgmt-user',
            'x-roles': 'mgmt',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(Array.isArray(body.items), true);
        assert.equal(body.items.length, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.orderBy?.entryDate, 'desc');
});
