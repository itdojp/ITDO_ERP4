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

function withExpensePolicyEnv(fn) {
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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function submitExpenseDraft() {
  return {
    id: 'exp-001',
    userId: 'admin-user',
    projectId: 'proj-001',
    status: 'draft',
    settlementStatus: 'unpaid',
    receiptUrl: 'https://example.com/receipt.pdf',
    amount: 12000,
    currency: 'JPY',
    incurredOn: new Date('2026-01-15T00:00:00.000Z'),
    deletedAt: null,
    budgetEscalationReason: null,
    budgetEscalationImpact: null,
    budgetEscalationAlternative: null,
  };
}

function approvedExpense() {
  return {
    id: 'exp-002',
    userId: 'expense-owner',
    projectId: 'proj-001',
    status: 'approved',
    settlementStatus: 'unpaid',
    amount: 4800,
    currency: 'JPY',
    paidAt: null,
    paidBy: null,
    deletedAt: null,
  };
}

function unpaidExpense() {
  return {
    id: 'exp-003',
    userId: 'expense-owner',
    projectId: 'proj-001',
    status: 'approved',
    settlementStatus: 'unpaid',
    amount: 4800,
    currency: 'JPY',
    paidAt: null,
    paidBy: null,
    deletedAt: null,
  };
}

test('POST /expenses/:id/submit: phase2_core preset denies when policy is missing', async () => {
  await withExpensePolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'expense.findUnique': async () => submitExpenseDraft(),
        'expenseAttachment.count': async () => 0,
        'project.findUnique': async () => ({
          budgetCost: null,
          currency: 'JPY',
        }),
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

test('POST /expenses/:id/submit: policy allow reaches downstream submit path (not ACTION_POLICY_DENIED)', async () => {
  await withExpensePolicyEnv(async () => {
    let transactionCalled = 0;
    let updateCalled = 0;
    let transitionLogCalled = 0;
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
          id: 'approval-expense-001',
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
          id: 'snapshot-expense-001',
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
        'expense.findUnique': async () => submitExpenseDraft(),
        'expenseAttachment.count': async () => 0,
        'project.findUnique': async () => ({
          budgetCost: null,
          currency: 'JPY',
        }),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-expense-submit-allow',
            flowType: 'expense',
            actionKey: 'submit',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        'expenseStateTransitionLog.create': async () => {
          transitionLogCalled += 1;
          return { id: 'transition-expense-001' };
        },
        'auditLog.create': async () => ({ id: 'audit-expense-001' }),
        $transaction: async (callback) => {
          transactionCalled += 1;
          return callback(tx);
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
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'exp-001');
          assert.equal(payload?.status, 'pending_qa');
          assert.equal(updateCalled, 1);
          assert.equal(transactionCalled, 1);
          assert.equal(transitionLogCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /expenses/:id/mark-paid: phase2_core preset denies when policy is missing', async () => {
  await withExpensePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'expense.findUnique': async () => approvedExpense(),
        'actionPolicy.findMany': async () => [],
        'expense.update': async () => {
          updateCalled += 1;
          return null;
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/expenses/exp-002/mark-paid',
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

test('POST /expenses/:id/mark-paid: policy allow reaches downstream validation (not ACTION_POLICY_DENIED)', async () => {
  await withExpensePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'expense.findUnique': async () => ({
          ...approvedExpense(),
          status: 'draft',
        }),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-expense-mark-paid-allow',
            flowType: 'expense',
            actionKey: 'mark_paid',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        'expense.update': async () => {
          updateCalled += 1;
          return null;
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/expenses/exp-002/mark-paid',
            headers: adminHeaders(),
            payload: {},
          });
          assert.equal(res.statusCode, 409, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'INVALID_STATUS');
          assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(updateCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /expenses/:id/unmark-paid: phase2_core preset denies when policy is missing', async () => {
  await withExpensePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'expense.findUnique': async () => ({
          ...unpaidExpense(),
          settlementStatus: 'paid',
          paidAt: new Date('2026-02-01T00:00:00.000Z'),
          paidBy: 'admin-user',
        }),
        'actionPolicy.findMany': async () => [],
        'expense.update': async () => {
          updateCalled += 1;
          return null;
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/expenses/exp-003/unmark-paid',
            headers: adminHeaders(),
            payload: { reasonText: 'reopen' },
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

test('POST /expenses/:id/unmark-paid: policy allow reaches downstream validation (not ACTION_POLICY_DENIED)', async () => {
  await withExpensePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'expense.findUnique': async () => unpaidExpense(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-expense-unmark-paid-allow',
            flowType: 'expense',
            actionKey: 'unmark_paid',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            requireReason: false,
            guards: null,
          },
        ],
        'expense.update': async () => {
          updateCalled += 1;
          return null;
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/expenses/exp-003/unmark-paid',
            headers: adminHeaders(),
            payload: { reasonText: 'reopen' },
          });
          assert.equal(res.statusCode, 409, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'INVALID_STATUS');
          assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(updateCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});
