import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
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

function vendorInvoiceForEdit() {
  return {
    id: 'vi-001',
    status: 'received',
    projectId: 'proj-001',
    vendorId: 'vendor-001',
    purchaseOrderId: null,
    currency: 'JPY',
    totalAmount: 1100,
    deletedAt: null,
  };
}

function withVendorInvoicePolicyEnv(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

test('PUT /vendor-invoices/:id/allocations: phase2_core required action denies when policy is missing', async () => {
  await withVendorInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'vendorInvoice.findUnique': async () => vendorInvoiceForEdit(),
        'actionPolicy.findMany': async () => [],
        $transaction: async () => {
          transactionCalled += 1;
          throw new Error('unexpected transaction in deny path');
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PUT',
            url: '/vendor-invoices/vi-001/allocations',
            headers: adminHeaders(),
            payload: {
              allocations: [
                { projectId: 'proj-001', amount: 1000, taxAmount: 100 },
              ],
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(transactionCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('PUT /vendor-invoices/:id/allocations: policy allow reaches downstream update path (not ACTION_POLICY_DENIED)', async () => {
  await withVendorInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    let deleteManyCalled = 0;
    let createManyCalled = 0;
    let updateCalled = 0;

    await withPrismaStubs(
      {
        'vendorInvoice.findUnique': async () => vendorInvoiceForEdit(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-vi-allocations-allow',
            flowType: 'vendor_invoice',
            actionKey: 'update_allocations',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        'project.findMany': async () => [{ id: 'proj-001' }],
        'vendorInvoiceAllocation.findMany': async () => [
          {
            id: 'alloc-001',
            vendorInvoiceId: 'vi-001',
            projectId: 'proj-001',
            amount: 1000,
            taxRate: 10,
            taxAmount: 100,
          },
        ],
        'auditLog.create': async () => ({ id: 'audit-vi-alloc-001' }),
        $transaction: async (callback) => {
          transactionCalled += 1;
          return callback({
            vendorInvoiceAllocation: {
              deleteMany: async () => {
                deleteManyCalled += 1;
                return { count: 0 };
              },
              createMany: async () => {
                createManyCalled += 1;
                return { count: 1 };
              },
            },
            vendorInvoice: {
              update: async () => {
                updateCalled += 1;
                return { id: 'vi-001' };
              },
            },
          });
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PUT',
            url: '/vendor-invoices/vi-001/allocations',
            headers: adminHeaders(),
            payload: {
              allocations: [
                {
                  projectId: 'proj-001',
                  amount: 1000,
                  taxRate: 10,
                  taxAmount: 100,
                },
              ],
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.items?.length, 1);
          assert.equal(payload?.totals?.grossTotal, 1100);
          assert.equal(transactionCalled, 1);
          assert.equal(deleteManyCalled, 1);
          assert.equal(createManyCalled, 1);
          assert.equal(updateCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('PUT /vendor-invoices/:id/lines: phase2_core required action denies when policy is missing', async () => {
  await withVendorInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'vendorInvoice.findUnique': async () => vendorInvoiceForEdit(),
        'actionPolicy.findMany': async () => [],
        $transaction: async () => {
          transactionCalled += 1;
          throw new Error('unexpected transaction in deny path');
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PUT',
            url: '/vendor-invoices/vi-001/lines',
            headers: adminHeaders(),
            payload: {
              lines: [
                {
                  lineNo: 1,
                  description: 'Consulting fee',
                  quantity: 1,
                  unitPrice: 1000,
                  amount: 1000,
                  taxAmount: 100,
                },
              ],
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(transactionCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('PUT /vendor-invoices/:id/lines: policy allow reaches downstream update path (not ACTION_POLICY_DENIED)', async () => {
  await withVendorInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    let deleteManyCalled = 0;
    let createManyCalled = 0;
    let updateCalled = 0;

    await withPrismaStubs(
      {
        'vendorInvoice.findUnique': async () => vendorInvoiceForEdit(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-vi-lines-allow',
            flowType: 'vendor_invoice',
            actionKey: 'update_lines',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        'vendorInvoiceLine.findMany': async () => [
          {
            id: 'line-001',
            vendorInvoiceId: 'vi-001',
            lineNo: 1,
            description: 'Consulting fee',
            quantity: 1,
            unitPrice: 1000,
            amount: 1000,
            taxRate: 10,
            taxAmount: 100,
            grossAmount: 1100,
            purchaseOrderLineId: null,
          },
        ],
        'auditLog.create': async () => ({ id: 'audit-vi-line-001' }),
        $transaction: async (callback) => {
          transactionCalled += 1;
          return callback({
            vendorInvoiceLine: {
              deleteMany: async () => {
                deleteManyCalled += 1;
                return { count: 0 };
              },
              createMany: async () => {
                createManyCalled += 1;
                return { count: 1 };
              },
            },
            vendorInvoice: {
              update: async () => {
                updateCalled += 1;
                return { id: 'vi-001' };
              },
            },
          });
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PUT',
            url: '/vendor-invoices/vi-001/lines',
            headers: adminHeaders(),
            payload: {
              lines: [
                {
                  lineNo: 1,
                  description: 'Consulting fee',
                  quantity: 1,
                  unitPrice: 1000,
                  amount: 1000,
                  taxRate: 10,
                  taxAmount: 100,
                },
              ],
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.items?.length, 1);
          assert.equal(payload?.totals?.grossTotal, 1100);
          assert.equal(transactionCalled, 1);
          assert.equal(deleteManyCalled, 1);
          assert.equal(createManyCalled, 1);
          assert.equal(updateCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});
