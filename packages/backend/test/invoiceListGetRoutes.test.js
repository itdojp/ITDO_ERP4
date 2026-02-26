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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function userHeaders(projectIds) {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
    'x-project-ids': projectIds,
  };
}

test('GET /invoices returns empty list for non-privileged user with no scope', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let invoiceFindManyCalled = false;
  await withPrismaStubs(
    {
      'projectMember.findMany': async () => [],
      'invoice.findMany': async () => {
        invoiceFindManyCalled = true;
        return [];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/invoices',
          headers: userHeaders(''),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.deepEqual(body?.items, []);
        assert.equal(invoiceFindManyCalled, false);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /invoices rejects project outside user scope', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'projectMember.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/invoices?projectId=proj-2',
          headers: userHeaders('proj-1'),
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'forbidden_project');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /invoices returns INVALID_DATE for malformed from query', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/invoices?from=invalid-date',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE');
    assert.equal(body?.error?.message, 'Invalid from date');
  } finally {
    await server.close();
  }
});

test('GET /invoices returns INVALID_DATE for malformed to query', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/invoices?to=bad-date',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE');
    assert.equal(body?.error?.message, 'Invalid to date');
  } finally {
    await server.close();
  }
});

test('GET /invoices applies query filters and take limit', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'invoice.findMany': async (args) => {
        capturedArgs = args;
        return [{ id: 'inv-1', projectId: 'proj-1' }];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/invoices?projectId=proj-1&status=approved&from=2026-01-01&to=2026-01-31',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedArgs?.where?.projectId, 'proj-1');
  assert.equal(capturedArgs?.where?.status, 'approved');
  assert.equal(capturedArgs?.where?.issueDate?.gte?.getTime(), new Date('2026-01-01').getTime());
  assert.equal(capturedArgs?.where?.issueDate?.lte?.getTime(), new Date('2026-01-31').getTime());
  assert.deepEqual(capturedArgs?.include, { lines: true });
  assert.deepEqual(capturedArgs?.orderBy, { createdAt: 'desc' });
  assert.equal(capturedArgs?.take, 100);
});

test('GET /invoices/:id returns NOT_FOUND when invoice is absent', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/invoices/inv-missing',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /invoices/:id rejects non-privileged user outside project scope', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'projectMember.findMany': async () => [],
      'invoice.findUnique': async () => ({
        id: 'inv-1',
        projectId: 'proj-2',
        lines: [],
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/invoices/inv-1',
          headers: userHeaders('proj-1'),
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'forbidden_project');
      } finally {
        await server.close();
      }
    },
  );
});
