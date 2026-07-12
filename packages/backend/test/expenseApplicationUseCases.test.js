import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markExpensePaid,
  reassignExpenseProject,
} from '../dist/application/expenses/useCases.js';

function actor(overrides = {}) {
  return {
    userId: 'admin-user',
    roles: ['admin', 'mgmt'],
    groupIds: [],
    groupAccountIds: [],
    projectIds: [],
    ...overrides,
  };
}

function auditContext(overrides = {}) {
  return {
    userId: 'admin-user',
    requestId: 'req-expense-app',
    source: 'api',
    ...overrides,
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

test('markExpensePaid uses injected ports and preserves state transition, notification, and audit metadata', async () => {
  const paidAt = new Date('2026-02-20T03:04:05.000Z');
  const original = expenseDraft({ status: 'approved' });
  const calls = [];
  const db = {
    expense: {
      findUnique: async (args) => {
        calls.push(['findUnique', args]);
        return original;
      },
      update: async (args) => {
        calls.push(['update', args]);
        return {
          ...original,
          ...args.data,
          status: 'approved',
          settlementStatus: 'paid',
        };
      },
    },
  };

  const result = await markExpensePaid({
    id: 'exp-001',
    paidAt,
    reasonText: 'settlement completed',
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      db,
      evaluateActionPolicyWithFallback: async (input) => {
        calls.push(['policy', input]);
        assert.equal(input.flowType, 'expense');
        assert.equal(input.actionKey, 'mark_paid');
        assert.equal(input.actor.userId, 'admin-user');
        assert.equal(input.state.settlementStatus, 'unpaid');
        return {
          allowed: true,
          policyApplied: true,
          matchedPolicyId: 'policy-mark-paid',
          requireReason: false,
        };
      },
      logActionPolicyFallbackAllowed: async (params) => {
        calls.push(['policyFallbackAudit', params.auditContext.requestId]);
      },
      logActionPolicyOverride: async (params) => {
        calls.push(['policyOverrideAudit', params.auditContext.requestId]);
      },
      logExpenseStateTransition: async (entry) => {
        calls.push(['stateTransition', entry]);
      },
      createExpenseMarkPaidNotification: async (entry) => {
        calls.push(['notification', entry]);
      },
      logAudit: async (entry) => {
        calls.push(['audit', entry]);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.settlementStatus, 'paid');
  assert.equal(result.value.paidBy, 'admin-user');

  const update = calls.find(([name]) => name === 'update')?.[1];
  assert.equal(update.data.settlementStatus, 'paid');
  assert.equal(update.data.paidAt, paidAt);
  assert.equal(update.data.updatedBy, 'admin-user');

  const stateTransition = calls.find(
    ([name]) => name === 'stateTransition',
  )?.[1];
  assert.equal(stateTransition.from.status, 'approved');
  assert.equal(stateTransition.from.settlementStatus, 'unpaid');
  assert.equal(stateTransition.to.settlementStatus, 'paid');
  assert.equal(stateTransition.reasonText, 'settlement completed');
  assert.equal(stateTransition.metadata.trigger, 'mark_paid');

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.expenseId, 'exp-001');
  assert.equal(notification.userId, 'user-001');
  assert.equal(notification.projectId, 'proj-001');
  assert.equal(notification.actorUserId, 'admin-user');

  const audit = calls.find(([name]) => name === 'audit')?.[1];
  assert.equal(audit.action, 'expense_mark_paid');
  assert.equal(audit.targetTable, 'Expense');
  assert.equal(audit.reasonText, 'settlement completed');
  assert.equal(audit.requestId, 'req-expense-app');
  assert.equal(audit.metadata.previousStatus, 'approved');
});

test('reassignExpenseProject maps period lock guard failure before update or audit side effects', async () => {
  const calls = [];
  const db = {
    expense: {
      findUnique: async (args) => {
        calls.push(['findUnique', args]);
        return expenseDraft();
      },
      update: async () => {
        throw new Error(
          'expense.update should not be called when period lock guard fails',
        );
      },
    },
    project: {
      findUnique: async (args) => {
        calls.push(['projectFindUnique', args]);
        return { id: 'proj-002', deletedAt: null };
      },
    },
  };
  let guardCall = 0;

  const result = await reassignExpenseProject({
    id: 'exp-001',
    toProjectId: 'proj-002',
    reasonCode: 'project_misassignment',
    reasonText: 'move to correct project',
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      db,
      evaluateActionPolicyGuards: async (input) => {
        calls.push(['guard', input]);
        guardCall += 1;
        if (guardCall === 1) return [];
        return [{ type: 'period_lock', reason: 'period_locked' }];
      },
      logAudit: async () => {
        throw new Error('logAudit should not be called when guard fails');
      },
      logReassignment: async () => {
        throw new Error(
          'logReassignment should not be called when guard fails',
        );
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
  });
  assert.equal(guardCall, 2);
  assert.deepEqual(
    calls.filter(([name]) => name === 'guard').map(([, input]) => input.guards),
    [[{ type: 'approval_open' }], [{ type: 'period_lock' }]],
  );
});
