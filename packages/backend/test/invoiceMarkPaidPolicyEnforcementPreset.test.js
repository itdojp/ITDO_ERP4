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

function invoiceApproved() {
  return {
    id: 'inv-001',
    status: 'approved',
    projectId: 'proj-001',
    deletedAt: null,
  };
}

function withInvoicePolicyEnv(preset, fn) {
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

for (const preset of ['phase2_core', 'phase3_strict']) {
  test(`POST /invoices/:id/mark-paid: ${preset} required action denies when policy is missing`, async () => {
    await withInvoicePolicyEnv(preset, async () => {
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceApproved(),
          'actionPolicy.findMany': async () => [],
          'invoice.update': async () => {
            updateCalled += 1;
            return { id: 'inv-001' };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/invoices/inv-001/mark-paid',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(updateCalled, 0);
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`POST /invoices/:id/mark-paid: ${preset} policy allow reaches downstream update path`, async () => {
    await withInvoicePolicyEnv(preset, async () => {
      const paidAt = new Date('2026-02-01T00:00:00.000Z');
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceApproved(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-invoice-mark-paid-allow',
              flowType: 'invoice',
              actionKey: 'mark_paid',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
          'invoice.update': async ({ where, data }) => {
            updateCalled += 1;
            return {
              id: where.id,
              status: data.status,
              paidAt: data.paidAt,
              paidBy: data.paidBy,
              updatedBy: data.updatedBy,
              lines: [],
            };
          },
          'auditLog.create': async () => ({ id: 'audit-001' }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/invoices/inv-001/mark-paid',
              headers: adminHeaders(),
              payload: { paidAt: paidAt.toISOString() },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.id, 'inv-001');
            assert.equal(payload?.status, 'paid');
            assert.equal(payload?.paidBy, 'admin-user');
            assert.equal(updateCalled, 1);
          } finally {
            await server.close();
          }
        },
      );
    });
  });
}
