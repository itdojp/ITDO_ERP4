import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL ||= MIN_DATABASE_URL;

const { buildServer } = await import('../dist/server.js');
const { prisma } = await import('../dist/services/db.js');

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

function vendorInvoiceBase(overrides = {}) {
  return {
    id: 'vi-001',
    status: 'received',
    projectId: 'proj-001',
    vendorId: 'vendor-001',
    purchaseOrderId: null,
    currency: 'JPY',
    totalAmount: 1100,
    deletedAt: null,
    ...overrides,
  };
}

function withVendorInvoicePolicyEnv(preset, fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: preset,
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

function allowPolicy(actionKey) {
  return [
    {
      id: `policy-vendor-invoice-${actionKey}-allow`,
      flowType: 'vendor_invoice',
      actionKey,
      priority: 100,
      isEnabled: true,
      subjects: null,
      stateConstraints: null,
      requireReason: false,
      guards: null,
    },
  ];
}

for (const preset of ['phase2_core', 'phase3_strict']) {
  test(`PUT /vendor-invoices/:id/allocations: ${preset} required action denies when policy is missing`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceBase(),
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
                  {
                    projectId: 'proj-001',
                    amount: 1000,
                    taxRate: 0.1,
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

  test(`PUT /vendor-invoices/:id/allocations: ${preset} policy allow reaches downstream update path`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      let updateCalled = 0;
      let deleteManyCalled = 0;
      let createManyCalled = 0;
      let currentAllocations = [];

      const tx = {
        vendorInvoiceAllocation: {
          deleteMany: async () => {
            deleteManyCalled += 1;
            currentAllocations = [];
            return { count: 1 };
          },
          createMany: async ({ data }) => {
            createManyCalled += 1;
            currentAllocations = data.map((entry, index) => ({
              id: `alloc-${index + 1}`,
              createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
              ...entry,
            }));
            return { count: data.length };
          },
        },
        vendorInvoice: {
          update: async ({ where }) => {
            updateCalled += 1;
            return { id: where.id };
          },
        },
      };

      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceBase(),
          'actionPolicy.findMany': async () =>
            allowPolicy('update_allocations'),
          'project.findMany': async () => [{ id: 'proj-001' }],
          'vendorInvoiceAllocation.findMany': async () => currentAllocations,
          $transaction: async (callback) => {
            transactionCalled += 1;
            return callback(tx);
          },
          'auditLog.create': async () => ({ id: 'audit-alloc-001' }),
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
                    taxRate: 0.1,
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

  test(`PUT /vendor-invoices/:id/lines: ${preset} required action denies when policy is missing`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceBase(),
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
                    description: 'Service A',
                    quantity: 1,
                    unitPrice: 1000,
                    amount: 1000,
                    taxRate: 0.1,
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

  test(`PUT /vendor-invoices/:id/lines: ${preset} policy allow reaches downstream update path`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      let updateCalled = 0;
      let deleteManyCalled = 0;
      let createManyCalled = 0;
      let currentLines = [];

      const tx = {
        vendorInvoiceLine: {
          deleteMany: async () => {
            deleteManyCalled += 1;
            currentLines = [];
            return { count: 1 };
          },
          createMany: async ({ data }) => {
            createManyCalled += 1;
            currentLines = data.map((entry, index) => ({
              id: `line-${index + 1}`,
              createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
              ...entry,
            }));
            return { count: data.length };
          },
        },
        vendorInvoice: {
          update: async ({ where }) => {
            updateCalled += 1;
            return { id: where.id };
          },
        },
      };

      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceBase(),
          'actionPolicy.findMany': async () => allowPolicy('update_lines'),
          'vendorInvoiceLine.groupBy': async () => [],
          'vendorInvoiceLine.findMany': async () => currentLines,
          $transaction: async (callback) => {
            transactionCalled += 1;
            return callback(tx);
          },
          'auditLog.create': async () => ({ id: 'audit-line-001' }),
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
                    description: 'Service A',
                    quantity: 1,
                    unitPrice: 1000,
                    amount: 1000,
                    taxRate: 0.1,
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
}
