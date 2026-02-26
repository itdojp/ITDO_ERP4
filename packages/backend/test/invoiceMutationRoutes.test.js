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

function userHeaders(projectIds) {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
    'x-project-ids': projectIds,
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

test('GET /projects/:projectId/invoices rejects user outside project scope', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/proj-2/invoices',
      headers: userHeaders('proj-1'),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden_project');
  });
});

test('GET /projects/:projectId/invoices validates date query', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/projects/proj-1/invoices?from=not-a-date',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE');
    assert.equal(body?.error?.message, 'Invalid from date');
  });
});

test('GET /projects/:projectId/invoices applies filters and take limit', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'invoice.findMany': async (args) => {
        capturedArgs = args;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/projects/proj-1/invoices?status=approved&from=2026-01-01&to=2026-01-31',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.deepEqual(body?.items, []);
      });
    },
  );
  assert.equal(capturedArgs?.where?.projectId, 'proj-1');
  assert.equal(capturedArgs?.where?.status, 'approved');
  assert.equal(capturedArgs?.where?.issueDate?.gte?.getTime(), new Date('2026-01-01').getTime());
  assert.equal(capturedArgs?.where?.issueDate?.lte?.getTime(), new Date('2026-01-31').getTime());
  assert.deepEqual(capturedArgs?.include, { lines: true });
  assert.equal(capturedArgs?.take, 100);
});

test('POST /projects/:projectId/invoices/from-time-entries rejects malformed from/to payload', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/projects/proj-1/invoices/from-time-entries',
      headers: adminHeaders(),
      payload: {
        from: 'invalid-from',
        to: '2026-01-31',
        unitPrice: 4000,
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'VALIDATION_ERROR');
  });
});

test('POST /projects/:projectId/invoices/from-time-entries requires admin or mgmt', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/projects/proj-1/invoices/from-time-entries',
      headers: userHeaders('proj-1'),
      payload: {
        from: '2026-01-01',
        to: '2026-01-31',
        unitPrice: 4000,
      },
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  });
});

test('POST /projects/:projectId/invoices/from-time-entries validates date range', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/projects/proj-1/invoices/from-time-entries',
      headers: adminHeaders(),
      payload: {
        from: '2026-02-01',
        to: '2026-01-01',
        unitPrice: 4000,
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE_RANGE');
  });
});

test('POST /projects/:projectId/invoices/from-time-entries rejects non-positive unitPrice payload', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/projects/proj-1/invoices/from-time-entries',
      headers: adminHeaders(),
      payload: {
        from: '2026-01-01',
        to: '2026-01-31',
        unitPrice: 0,
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'VALIDATION_ERROR');
  });
});

test('POST /projects/:projectId/invoices/from-time-entries returns NOT_FOUND for deleted/missing project', async () => {
  await withPrismaStubs(
    {
      'project.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/proj-unknown/invoices/from-time-entries',
          headers: adminHeaders(),
          payload: {
            from: '2026-01-01',
            to: '2026-01-31',
            unitPrice: 4000,
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('POST /projects/:projectId/invoices/from-time-entries returns NO_TIME_ENTRIES when source rows are empty', async () => {
  await withPrismaStubs(
    {
      'project.findUnique': async () => ({
        id: 'proj-1',
        deletedAt: null,
        currency: 'JPY',
      }),
      'timeEntry.findMany': async () => [],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/proj-1/invoices/from-time-entries',
          headers: adminHeaders(),
          payload: {
            from: '2026-01-01',
            to: '2026-01-31',
            unitPrice: 4000,
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NO_TIME_ENTRIES');
      });
    },
  );
});

test('POST /invoices/:id/release-time-entries returns NOT_FOUND for unknown invoice', async () => {
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/invoices/inv-missing/release-time-entries',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('POST /invoices/:id/release-time-entries requires admin or mgmt', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/invoices/inv-1/release-time-entries',
      headers: userHeaders('proj-1'),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  });
});

test('POST /invoices/:id/release-time-entries rejects non-draft invoice', async () => {
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => ({
        id: 'inv-1',
        status: 'approved',
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/invoices/inv-1/release-time-entries',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_STATUS');
      });
    },
  );
});

test('POST /invoices/:id/release-time-entries clears billedInvoiceId and billedAt for draft invoice', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => ({
        id: 'inv-1',
        status: 'draft',
      }),
      'timeEntry.updateMany': async (args) => {
        capturedArgs = args;
        return { count: 3 };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/invoices/inv-1/release-time-entries',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.released, 3);
      });
    },
  );
  assert.deepEqual(capturedArgs, {
    where: { billedInvoiceId: 'inv-1' },
    data: { billedInvoiceId: null, billedAt: null },
  });
});

test('POST /invoices/:id/mark-paid validates paidAt format in handler', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/invoices/inv-1/mark-paid',
      headers: adminHeaders(),
      payload: { paidAt: 'not-a-date' },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE');
  });
});

test('POST /invoices/:id/mark-paid returns NOT_FOUND when invoice does not exist', async () => {
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/invoices/inv-missing/mark-paid',
          headers: adminHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('POST /invoices/:id/mark-paid rejects cancelled invoice status', async () => {
  let updateCalled = false;
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'invoice.findUnique': async () => ({
        id: 'inv-1',
        status: 'cancelled',
        projectId: 'proj-1',
        deletedAt: null,
      }),
      'invoice.update': async () => {
        updateCalled = true;
        return null;
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/invoices/inv-1/mark-paid',
          headers: adminHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_STATUS');
      });
    },
  );
  assert.equal(updateCalled, false);
});

test('POST /invoices/:id/mark-paid updates invoice and writes audit log', async () => {
  const paidAt = new Date('2026-02-01T00:00:00.000Z');
  let capturedUpdateArgs = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'invoice.findUnique': async () => ({
        id: 'inv-1',
        status: 'approved',
        projectId: 'proj-1',
        deletedAt: null,
      }),
      'invoice.update': async (args) => {
        capturedUpdateArgs = args;
        return {
          id: 'inv-1',
          status: 'paid',
          paidAt,
          paidBy: 'admin-user',
          updatedBy: 'admin-user',
          lines: [],
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
          method: 'POST',
          url: '/invoices/inv-1/mark-paid',
          headers: adminHeaders(),
          payload: { paidAt: '2026-02-01' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.status, 'paid');
        assert.equal(body?.paidBy, 'admin-user');
      });
    },
  );
  assert.equal(capturedUpdateArgs?.where?.id, 'inv-1');
  assert.equal(capturedUpdateArgs?.data?.status, 'paid');
  assert.equal(capturedUpdateArgs?.data?.paidBy, 'admin-user');
  assert.equal(capturedUpdateArgs?.data?.updatedBy, 'admin-user');
  assert.equal(capturedUpdateArgs?.data?.paidAt?.getTime(), paidAt.getTime());
  assert.deepEqual(capturedUpdateArgs?.include, { lines: true });
  assert.deepEqual(auditActions, ['invoice_mark_paid']);
});
