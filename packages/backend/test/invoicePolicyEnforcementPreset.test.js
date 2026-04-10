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

function invoiceDraft() {
  return {
    id: 'inv-001',
    status: 'draft',
    projectId: 'proj-001',
  };
}

function approvedInvoice() {
  return {
    id: 'inv-002',
    status: 'approved',
    projectId: 'proj-001',
    deletedAt: null,
  };
}

function withInvoicePolicyEnv(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

test('POST /invoices/:id/submit: phase2_core required action denies when policy is missing', async () => {
  await withInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'invoice.findUnique': async () => invoiceDraft(),
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
            method: 'POST',
            url: '/invoices/inv-001/submit',
            headers: adminHeaders(),
            payload: {},
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

test('POST /invoices/:id/submit: policy allow reaches downstream submit path (not ACTION_POLICY_DENIED)', async () => {
  await withInvoicePolicyEnv(async () => {
    let transactionCalled = 0;
    let updateCalled = 0;
    const tx = {
      invoice: {
        update: async ({ where, data }) => {
          updateCalled += 1;
          return {
            id: where.id,
            status: data.status,
            projectId: 'proj-001',
          };
        },
      },
      project: {
        findUnique: async () => null,
      },
      approvalRule: {
        findMany: async () => [
          {
            id: 'rule-invoice-submit',
            flowType: 'invoice',
            ruleKey: 'invoice-default',
            version: 1,
            isActive: true,
            conditions: {},
            steps: [{ approverUserId: 'admin-user', stepOrder: 1 }],
          },
        ],
      },
      approvalInstance: {
        findFirst: async () => null,
        create: async ({ data }) => ({
          id: 'approval-001',
          flowType: data.flowType,
          targetTable: data.targetTable,
          targetId: data.targetId,
          projectId: data.projectId,
          status: data.status,
          currentStep: data.currentStep,
          ruleId: data.ruleId,
          createdBy: data.createdBy,
          stagePolicy: data.stagePolicy ?? null,
          steps: (data.steps?.create ?? []).map((step, index) => ({
            id: `step-${index + 1}`,
            ...step,
          })),
        }),
      },
      evidenceSnapshot: {
        findFirst: async () => null,
        create: async ({ data }) => ({
          id: 'snapshot-001',
          approvalInstanceId: data.approvalInstanceId,
          targetTable: data.targetTable,
          targetId: data.targetId,
          version: data.version,
        }),
      },
      annotation: {
        findUnique: async () => null,
      },
      chatMessage: {
        findMany: async () => [],
      },
    };

    await withPrismaStubs(
      {
        'invoice.findUnique': async () => invoiceDraft(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-invoice-submit-allow',
            flowType: 'invoice',
            actionKey: 'submit',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        $transaction: async (callback) => {
          transactionCalled += 1;
          return callback(tx);
        },
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/invoices/inv-001/submit',
            headers: adminHeaders(),
            payload: {},
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'inv-001');
          assert.equal(payload?.status, 'pending_qa');
          assert.equal(updateCalled, 1);
          assert.equal(transactionCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /invoices/:id/mark-paid: phase2_core preset denies when policy is missing', async () => {
  await withInvoicePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'invoice.findUnique': async () => approvedInvoice(),
        'actionPolicy.findMany': async () => [],
        'invoice.update': async () => {
          updateCalled += 1;
          return null;
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/invoices/inv-002/mark-paid',
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

test('POST /invoices/:id/mark-paid: policy allow reaches downstream mark-paid path (not ACTION_POLICY_DENIED)', async () => {
  await withInvoicePolicyEnv(async () => {
    let updateCalled = 0;
    let auditCalled = 0;
    await withPrismaStubs(
      {
        'invoice.findUnique': async () => approvedInvoice(),
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
        'auditLog.create': async () => {
          auditCalled += 1;
          return { id: 'audit-002' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/invoices/inv-002/mark-paid',
            headers: adminHeaders(),
            payload: { paidAt: '2026-02-01' },
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'inv-002');
          assert.equal(payload?.status, 'paid');
          assert.equal(payload?.paidBy, 'admin-user');
          assert.equal(updateCalled, 1);
          assert.equal(auditCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});
