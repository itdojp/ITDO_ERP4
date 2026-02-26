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

test('vendor docs read routes deny non admin/mgmt role', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/vendor-invoices',
      headers: userHeaders(),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  });
});

test('GET /vendor-quotes applies filters and fixed take limit', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'vendorQuote.findMany': async (args) => {
        capturedArgs = args;
        return [{ id: 'vq-1', projectId: 'proj-1' }];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-quotes?projectId=proj-1&vendorId=vendor-1&status=approved',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
      });
    },
  );
  assert.equal(capturedArgs?.where?.projectId, 'proj-1');
  assert.equal(capturedArgs?.where?.vendorId, 'vendor-1');
  assert.equal(capturedArgs?.where?.status, 'approved');
  assert.equal(capturedArgs?.take, 100);
  assert.deepEqual(capturedArgs?.orderBy, { createdAt: 'desc' });
});

test('GET /vendor-quotes/:id returns NOT_FOUND when quote is missing', async () => {
  await withPrismaStubs(
    {
      'vendorQuote.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-quotes/vq-missing',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('GET /vendor-invoices applies filters and includes purchase order relation', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'vendorInvoice.findMany': async (args) => {
        capturedArgs = args;
        return [{ id: 'vi-1', projectId: 'proj-1' }];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices?projectId=proj-1&vendorId=vendor-1&status=received',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
      });
    },
  );
  assert.equal(capturedArgs?.where?.projectId, 'proj-1');
  assert.equal(capturedArgs?.where?.vendorId, 'vendor-1');
  assert.equal(capturedArgs?.where?.status, 'received');
  assert.deepEqual(capturedArgs?.include, {
    purchaseOrder: { select: { id: true, poNo: true } },
  });
  assert.equal(capturedArgs?.take, 100);
});

test('GET /vendor-invoices/:id returns NOT_FOUND when invoice is missing', async () => {
  await withPrismaStubs(
    {
      'vendorInvoice.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices/vi-missing',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('GET /vendor-invoices/:id/allocations returns NOT_FOUND for deleted invoice', async () => {
  await withPrismaStubs(
    {
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-1',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices/vi-1/allocations',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('GET /vendor-invoices/:id/allocations returns invoice and allocation rows', async () => {
  let capturedAllocArgs = null;
  await withPrismaStubs(
    {
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-1',
        status: 'received',
        projectId: 'proj-1',
        vendorId: 'vendor-1',
        purchaseOrderId: null,
        vendorInvoiceNo: 'INV-1',
        receivedDate: new Date('2026-01-01T00:00:00.000Z'),
        dueDate: null,
        currency: 'JPY',
        totalAmount: 1000,
        documentUrl: null,
        deletedAt: null,
      }),
      'vendorInvoiceAllocation.findMany': async (args) => {
        capturedAllocArgs = args;
        return [{ id: 'alloc-1', vendorInvoiceId: 'vi-1', projectId: 'proj-1' }];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices/vi-1/allocations',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.invoice?.id, 'vi-1');
        assert.equal(body?.items?.length, 1);
      });
    },
  );
  assert.deepEqual(capturedAllocArgs, {
    where: { vendorInvoiceId: 'vi-1' },
    orderBy: { createdAt: 'asc' },
  });
});

test('GET /vendor-invoices/:id/lines returns NOT_FOUND when invoice is missing', async () => {
  await withPrismaStubs(
    {
      'vendorInvoice.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices/vi-missing/lines',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      });
    },
  );
});

test('GET /vendor-invoices/:id/lines returns totals and PO line usage summary', async () => {
  await withPrismaStubs(
    {
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-1',
        status: 'received',
        projectId: 'proj-1',
        vendorId: 'vendor-1',
        purchaseOrderId: 'po-1',
        vendorInvoiceNo: 'INV-1',
        receivedDate: new Date('2026-01-01T00:00:00.000Z'),
        dueDate: null,
        currency: 'JPY',
        totalAmount: 100,
        documentUrl: null,
        deletedAt: null,
      }),
      'vendorInvoiceLine.findMany': async () => [
        {
          id: 'line-1',
          lineNo: 1,
          amount: 50,
          taxAmount: 10,
          grossAmount: 60,
          quantity: 4,
          purchaseOrderLineId: 'po-line-1',
        },
        {
          id: 'line-2',
          lineNo: 2,
          amount: 30,
          taxAmount: 6,
          grossAmount: 36,
          quantity: 5,
          purchaseOrderLineId: 'po-line-2',
        },
      ],
      'purchaseOrderLine.findMany': async () => [
        { id: 'po-line-1', quantity: 5 },
        { id: 'po-line-2', quantity: 6 },
      ],
      'vendorInvoiceLine.groupBy': async () => [
        { purchaseOrderLineId: 'po-line-1', _sum: { quantity: 1 } },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/vendor-invoices/vi-1/lines',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.invoice?.id, 'vi-1');
        assert.equal(body?.items?.length, 2);
        assert.equal(body?.totals?.amountTotal, 80);
        assert.equal(body?.totals?.taxTotal, 16);
        assert.equal(body?.totals?.grossTotal, 96);
        assert.equal(body?.totals?.diff, 4);
        assert.equal(body?.poLineUsage?.length, 2);
        assert.deepEqual(body?.poLineUsage?.[0], {
          purchaseOrderLineId: 'po-line-1',
          purchaseOrderQuantity: 5,
          existingQuantity: 1,
          requestedQuantity: 4,
          remainingQuantity: 0,
          exceeds: false,
        });
        assert.deepEqual(body?.poLineUsage?.[1], {
          purchaseOrderLineId: 'po-line-2',
          purchaseOrderQuantity: 6,
          existingQuantity: 0,
          requestedQuantity: 5,
          remainingQuantity: 1,
          exceeds: false,
        });
      });
    },
  );
});
