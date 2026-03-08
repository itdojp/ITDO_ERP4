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

function expenseDraft(overrides = {}) {
  return {
    id: 'exp-001',
    userId: 'user-001',
    projectId: 'proj-001',
    amount: 12000,
    currency: 'JPY',
    incurredOn: new Date('2026-01-15T00:00:00.000Z'),
    status: 'draft',
    settlementStatus: 'unpaid',
    receiptUrl: 'https://example.com/receipt.pdf',
    deletedAt: null,
    paidAt: null,
    paidBy: null,
    updatedBy: 'seed-user',
    ...overrides,
  };
}

function withExpensePolicyEnv(preset, fn) {
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
      id: `policy-expense-${actionKey}-allow`,
      flowType: 'expense',
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
  test(`POST /expenses/:id/submit: ${preset} required action denies when policy is missing`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      await withPrismaStubs(
        {
          'expense.findUnique': async () => expenseDraft(),
          'project.findUnique': async () => ({
            budgetCost: 100000,
            currency: 'JPY',
          }),
          'expense.aggregate': async () => ({ _sum: { amount: 0 } }),
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
              url: '/expenses/exp-001/submit',
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

  test(`POST /expenses/:id/submit: ${preset} policy allow reaches downstream submit path (not ACTION_POLICY_DENIED)`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      let updateCalled = 0;
      const tx = {
        expense: {
          update: async ({ where, data }) => {
            updateCalled += 1;
            return {
              id: where.id,
              status: data.status,
              settlementStatus: 'unpaid',
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
              id: 'rule-expense-submit',
              flowType: 'expense',
              ruleKey: 'expense-default',
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
        referenceLink: {
          findMany: async () => [],
        },
        chatMessage: {
          findMany: async () => [],
        },
      };

      await withPrismaStubs(
        {
          'expense.findUnique': async () => expenseDraft(),
          'project.findUnique': async () => ({
            budgetCost: 100000,
            currency: 'JPY',
          }),
          'expense.aggregate': async () => ({ _sum: { amount: 0 } }),
          'expenseStateTransitionLog.create': async () => ({
            id: 'transition-001',
          }),
          'userNotificationPreference.findMany': async () => [],
          'appNotification.findMany': async () => [],
          'appNotification.createMany': async () => ({ count: 0 }),
          'actionPolicy.findMany': async () => allowPolicy('submit'),
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
              url: '/expenses/exp-001/submit',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.id, 'exp-001');
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

  test(`POST /expenses/:id/mark-paid: ${preset} required action denies when policy is missing`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'expense.findUnique': async () =>
            expenseDraft({ status: 'approved', settlementStatus: 'unpaid' }),
          'actionPolicy.findMany': async () => [],
          'expense.update': async () => {
            updateCalled += 1;
            return { id: 'exp-001' };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/expenses/exp-001/mark-paid',
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

  test(`POST /expenses/:id/mark-paid: ${preset} policy allow reaches downstream update path (not ACTION_POLICY_DENIED)`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'expense.findUnique': async () =>
            expenseDraft({ status: 'approved', settlementStatus: 'unpaid' }),
          'actionPolicy.findMany': async () => allowPolicy('mark_paid'),
          'expense.update': async ({ where, data }) => {
            updateCalled += 1;
            return {
              id: where.id,
              status: 'approved',
              settlementStatus: data.settlementStatus,
              paidAt: data.paidAt,
              paidBy: data.paidBy,
            };
          },
          'expenseStateTransitionLog.create': async () => ({
            id: 'transition-002',
          }),
          'userNotificationPreference.findMany': async () => [],
          'appNotification.findFirst': async () => ({ id: 'notif-existing' }),
          'auditLog.create': async () => ({ id: 'audit-002' }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/expenses/exp-001/mark-paid',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.id, 'exp-001');
            assert.equal(payload?.settlementStatus, 'paid');
            assert.equal(updateCalled, 1);
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`POST /expenses/:id/unmark-paid: ${preset} required action denies when policy is missing`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'expense.findUnique': async () =>
            expenseDraft({
              status: 'approved',
              settlementStatus: 'paid',
              paidAt: new Date('2026-01-20T00:00:00.000Z'),
              paidBy: 'admin-user',
            }),
          'actionPolicy.findMany': async () => [],
          'expense.update': async () => {
            updateCalled += 1;
            return { id: 'exp-001' };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/expenses/exp-001/unmark-paid',
              headers: adminHeaders(),
              payload: { reasonText: 'fix settlement' },
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

  test(`POST /expenses/:id/unmark-paid: ${preset} policy allow reaches downstream update path (not ACTION_POLICY_DENIED)`, async () => {
    await withExpensePolicyEnv(preset, async () => {
      let updateCalled = 0;
      await withPrismaStubs(
        {
          'expense.findUnique': async () =>
            expenseDraft({
              status: 'approved',
              settlementStatus: 'paid',
              paidAt: new Date('2026-01-20T00:00:00.000Z'),
              paidBy: 'admin-user',
            }),
          'actionPolicy.findMany': async () => allowPolicy('unmark_paid'),
          'expense.update': async ({ where, data }) => {
            updateCalled += 1;
            return {
              id: where.id,
              status: 'approved',
              settlementStatus: data.settlementStatus,
              paidAt: data.paidAt,
              paidBy: data.paidBy,
            };
          },
          'expenseStateTransitionLog.create': async () => ({
            id: 'transition-003',
          }),
          'auditLog.create': async () => ({ id: 'audit-003' }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/expenses/exp-001/unmark-paid',
              headers: adminHeaders(),
              payload: { reasonText: 'fix settlement' },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.id, 'exp-001');
            assert.equal(payload?.settlementStatus, 'unpaid');
            assert.equal(updateCalled, 1);
          } finally {
            await server.close();
          }
        },
      );
    });
  });
}
