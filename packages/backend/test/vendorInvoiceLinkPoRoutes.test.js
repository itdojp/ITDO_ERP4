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

test('POST /vendor-invoices/:id/link-po requires reason in fallback mode after submit status', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-001',
        status: 'approved',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        purchaseOrderId: 'po-001',
        deletedAt: null,
      }),
      'purchaseOrder.findUnique': async () => ({
        id: 'po-002',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        deletedAt: null,
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/vendor-invoices/vi-001/link-po',
          headers: adminHeaders(),
          payload: {
            purchaseOrderId: 'po-002',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'REASON_REQUIRED');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /vendor-invoices/:id/link-po updates PO and writes override/link audit logs', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const auditActions = [];
  let capturedUpdateArgs = null;
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-001',
        status: 'approved',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        purchaseOrderId: 'po-001',
        deletedAt: null,
      }),
      'purchaseOrder.findUnique': async () => ({
        id: 'po-002',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        deletedAt: null,
      }),
      'vendorInvoice.update': async (args) => {
        capturedUpdateArgs = args;
        return {
          id: 'vi-001',
          purchaseOrderId: 'po-002',
          purchaseOrder: { id: 'po-002', poNo: 'PO-2026-002' },
        };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/vendor-invoices/vi-001/link-po',
          headers: adminHeaders(),
          payload: {
            purchaseOrderId: 'po-002',
            reasonText: 'PO mapping correction',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.purchaseOrderId, 'po-002');
        assert.equal(capturedUpdateArgs?.where?.id, 'vi-001');
        assert.equal(capturedUpdateArgs?.data?.purchaseOrderId, 'po-002');
        assert.deepEqual(auditActions, [
          'vendor_invoice_link_po_override',
          'vendor_invoice_link_po',
        ]);
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /vendor-invoices/:id/link-po rejects purchase order project mismatch', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-001',
        status: 'draft',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        purchaseOrderId: null,
        deletedAt: null,
      }),
      'purchaseOrder.findUnique': async () => ({
        id: 'po-002',
        projectId: 'project-999',
        vendorId: 'vendor-001',
        deletedAt: null,
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/vendor-invoices/vi-001/link-po',
          headers: adminHeaders(),
          payload: {
            purchaseOrderId: 'po-002',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_PURCHASE_ORDER');
        assert.match(body?.error?.message ?? '', /project/i);
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /vendor-invoices/:id/unlink-po requires reason in fallback mode after submit status', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-001',
        status: 'approved',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        purchaseOrderId: 'po-001',
        deletedAt: null,
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/vendor-invoices/vi-001/unlink-po',
          headers: adminHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'REASON_REQUIRED');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /vendor-invoices/:id/unlink-po clears PO and writes override/unlink audit logs', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const auditActions = [];
  let capturedUpdateArgs = null;
  await withPrismaStubs(
    {
      'actionPolicy.findMany': async () => [],
      'vendorInvoice.findUnique': async () => ({
        id: 'vi-001',
        status: 'approved',
        projectId: 'project-001',
        vendorId: 'vendor-001',
        purchaseOrderId: 'po-001',
        deletedAt: null,
      }),
      'vendorInvoice.update': async (args) => {
        capturedUpdateArgs = args;
        return {
          id: 'vi-001',
          purchaseOrderId: null,
          purchaseOrder: null,
        };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: `audit-${auditActions.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/vendor-invoices/vi-001/unlink-po',
          headers: adminHeaders(),
          payload: {
            reasonText: 'Split settlement handling',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.purchaseOrderId, null);
        assert.equal(capturedUpdateArgs?.where?.id, 'vi-001');
        assert.equal(capturedUpdateArgs?.data?.purchaseOrderId, null);
        assert.deepEqual(auditActions, [
          'vendor_invoice_unlink_po_override',
          'vendor_invoice_unlink_po',
        ]);
      } finally {
        await server.close();
      }
    },
  );
});
