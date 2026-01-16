import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchApprovalSteps,
  matchesRuleCondition,
  normalizeRuleSteps,
} from '../dist/services/approvalLogic.js';

test('matchApprovalSteps: default thresholds', () => {
  assert.deepEqual(
    matchApprovalSteps('invoice', { totalAmount: 10 }),
    [{ approverGroupId: 'mgmt', stepOrder: 1 }],
  );
  assert.deepEqual(
    matchApprovalSteps('invoice', { totalAmount: 49999 }),
    [{ approverGroupId: 'mgmt', stepOrder: 1 }],
  );
  assert.deepEqual(matchApprovalSteps('invoice', { totalAmount: 50000 }), [
    { approverGroupId: 'mgmt', stepOrder: 1 },
  ]);
  assert.deepEqual(matchApprovalSteps('invoice', { totalAmount: 100000 }), [
    { approverGroupId: 'mgmt', stepOrder: 1 },
    { approverGroupId: 'exec', stepOrder: 2 },
  ]);
});

test('matchApprovalSteps: recurring can skip exec under threshold', () => {
  assert.deepEqual(
    matchApprovalSteps('invoice', { totalAmount: 90000, recurring: true }),
    [{ approverGroupId: 'mgmt', stepOrder: 1 }],
  );
  assert.deepEqual(
    matchApprovalSteps('invoice', { totalAmount: 110000, recurring: true }),
    [
      { approverGroupId: 'mgmt', stepOrder: 1 },
      { approverGroupId: 'exec', stepOrder: 2 },
    ],
  );
});

test('normalizeRuleSteps: explicit order is preserved', () => {
  assert.deepEqual(
    normalizeRuleSteps([
      { approverGroupId: 'mgmt', stepOrder: 3 },
      { approverGroupId: 'exec' },
    ]),
    [
      { approverGroupId: 'mgmt', approverUserId: undefined, stepOrder: 3 },
      { approverGroupId: 'exec', approverUserId: undefined, stepOrder: 2 },
    ],
  );
});

test('normalizeRuleSteps: parallelKey groups steps into the same stepOrder', () => {
  assert.deepEqual(
    normalizeRuleSteps([
      { approverGroupId: 'mgmt', parallelKey: 'a' },
      { approverUserId: 'u1', parallelKey: 'a' },
      { approverGroupId: 'exec', parallelKey: 'b' },
    ]),
    [
      { approverGroupId: 'mgmt', approverUserId: undefined, stepOrder: 1 },
      { approverGroupId: undefined, approverUserId: 'u1', stepOrder: 1 },
      { approverGroupId: 'exec', approverUserId: undefined, stepOrder: 2 },
    ],
  );
});

test('matchesRuleCondition: amount range and flow flags', () => {
  assert.equal(
    matchesRuleCondition(
      'invoice',
      { totalAmount: 1000 },
      { amountMin: 500, amountMax: 2000 },
    ),
    true,
  );
  assert.equal(
    matchesRuleCondition(
      'invoice',
      { totalAmount: 1000 },
      { amountMin: 1500, amountMax: 2000 },
    ),
    false,
  );
  assert.equal(
    matchesRuleCondition(
      'invoice',
      { totalAmount: 1000 },
      { flowFlags: { invoice: true, estimate: false } },
    ),
    true,
  );
  assert.equal(
    matchesRuleCondition(
      'estimate',
      { totalAmount: 1000 },
      { flowFlags: { invoice: true } },
    ),
    false,
  );
});

