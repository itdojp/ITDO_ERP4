import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasExpenseStateChanged,
  logExpenseStateTransition,
} from '../dist/services/expenseStateTransitionLog.js';

test('hasExpenseStateChanged: status change is detected', () => {
  const changed = hasExpenseStateChanged(
    { status: 'draft', settlementStatus: 'unpaid' },
    { status: 'pending_qa', settlementStatus: 'unpaid' },
  );
  assert.equal(changed, true);
});

test('hasExpenseStateChanged: settlement change is detected', () => {
  const changed = hasExpenseStateChanged(
    { status: 'approved', settlementStatus: 'unpaid' },
    { status: 'approved', settlementStatus: 'paid' },
  );
  assert.equal(changed, true);
});

test('logExpenseStateTransition: no-op when state did not change', async () => {
  let called = false;
  const client = {
    expenseStateTransitionLog: {
      create: async () => {
        called = true;
        return { id: 'unexpected' };
      },
    },
  };
  const result = await logExpenseStateTransition({
    client,
    expenseId: 'exp-1',
    from: { status: 'draft', settlementStatus: 'unpaid' },
    to: { status: 'draft', settlementStatus: 'unpaid' },
  });
  assert.equal(called, false);
  assert.equal(result, null);
});

test('logExpenseStateTransition: writes row when state changed', async () => {
  const writes = [];
  const client = {
    expenseStateTransitionLog: {
      create: async ({ data }) => {
        writes.push(data);
        return { id: 'log-1', ...data };
      },
    },
  };
  const result = await logExpenseStateTransition({
    client,
    expenseId: 'exp-1',
    from: { status: 'draft', settlementStatus: 'unpaid' },
    to: { status: 'pending_qa', settlementStatus: 'unpaid' },
    actorUserId: 'user-1',
    reasonText: 'submit',
    metadata: { trigger: 'submit' },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expenseId, 'exp-1');
  assert.equal(writes[0].fromStatus, 'draft');
  assert.equal(writes[0].toStatus, 'pending_qa');
  assert.equal(writes[0].fromSettlementStatus, 'unpaid');
  assert.equal(writes[0].toSettlementStatus, 'unpaid');
  assert.equal(result.id, 'log-1');
});

test('logExpenseStateTransition: throws when to.status is null', async () => {
  const client = {
    expenseStateTransitionLog: {
      create: async () => ({ id: 'unexpected' }),
    },
  };
  await assert.rejects(
    async () =>
      await logExpenseStateTransition({
        client,
        expenseId: 'exp-1',
        from: { status: 'draft', settlementStatus: 'unpaid' },
        to: { status: null, settlementStatus: 'unpaid' },
      }),
    { message: 'to.status and to.settlementStatus are required' },
  );
});
