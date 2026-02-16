import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchApprovalSteps,
  matchesRuleCondition,
  normalizeRuleSteps,
  normalizeRuleStepsWithPolicy,
} from '../dist/services/approvalLogic.js';

test('matchApprovalSteps: default thresholds', () => {
  assert.deepEqual(matchApprovalSteps('invoice', { totalAmount: 10 }), [
    { approverGroupId: 'mgmt', stepOrder: 1 },
  ]);
  assert.deepEqual(matchApprovalSteps('invoice', { totalAmount: 49999 }), [
    { approverGroupId: 'mgmt', stepOrder: 1 },
  ]);
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

test('normalizeRuleSteps: sequential input without explicit order is normalized', () => {
  assert.deepEqual(
    normalizeRuleSteps([
      { approverGroupId: 'mgmt' },
      { approverUserId: 'u1' },
      { approverGroupId: 'exec' },
    ]),
    [
      { approverGroupId: 'mgmt', approverUserId: undefined, stepOrder: 1 },
      { approverGroupId: undefined, approverUserId: 'u1', stepOrder: 2 },
      { approverGroupId: 'exec', approverUserId: undefined, stepOrder: 3 },
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
  assert.equal(
    matchesRuleCondition(
      'invoice',
      {
        totalAmount: 1000,
        projectType: 'supply',
        customerId: 'customer-a',
        orgUnitId: 'org-x',
      },
      {
        projectType: 'supply',
        customerId: 'customer-a',
        orgUnitId: 'org-x',
      },
    ),
    true,
  );
  assert.equal(
    matchesRuleCondition(
      'invoice',
      {
        totalAmount: 1000,
        projectType: 'services',
        customerId: 'customer-a',
        orgUnitId: 'org-x',
      },
      {
        projectType: 'supply',
        customerId: 'customer-a',
        orgUnitId: 'org-x',
      },
    ),
    false,
  );
  assert.equal(
    matchesRuleCondition(
      'invoice',
      { totalAmount: 1000 },
      { appliesTo: ['invoice', 'estimate'] },
    ),
    true,
  );
  assert.equal(
    matchesRuleCondition(
      'leave',
      { totalAmount: 1000 },
      { appliesTo: ['invoice', 'estimate'] },
    ),
    false,
  );
});

test('normalizeRuleStepsWithPolicy: stages format returns steps and stagePolicy', () => {
  const result = normalizeRuleStepsWithPolicy({
    stages: [
      {
        order: 1,
        completion: { mode: 'all' },
        approvers: [
          { type: 'group', id: 'mgmt' },
          { type: 'user', id: 'u1' },
        ],
      },
      {
        order: 2,
        completion: { mode: 'any' },
        approvers: [{ type: 'group', id: 'exec' }],
      },
      {
        order: 3,
        completion: { mode: 'quorum', quorum: 2 },
        approvers: [
          { type: 'user', id: 'u2' },
          { type: 'user', id: 'u3' },
        ],
      },
    ],
  });
  assert.ok(result);
  assert.deepEqual(result.steps, [
    { stepOrder: 1, approverGroupId: 'mgmt' },
    { stepOrder: 1, approverUserId: 'u1' },
    { stepOrder: 2, approverGroupId: 'exec' },
    { stepOrder: 3, approverUserId: 'u2' },
    { stepOrder: 3, approverUserId: 'u3' },
  ]);
  assert.deepEqual(result.stagePolicy, {
    1: { mode: 'all' },
    2: { mode: 'any' },
    3: { mode: 'quorum', quorum: 2 },
  });
});

test('normalizeRuleStepsWithPolicy: rejects duplicate stage order', () => {
  assert.equal(
    normalizeRuleStepsWithPolicy({
      stages: [
        { order: 1, approvers: [{ type: 'group', id: 'mgmt' }] },
        { order: 1, approvers: [{ type: 'group', id: 'exec' }] },
      ],
    }),
    null,
  );
});

test('normalizeRuleStepsWithPolicy: rejects invalid quorum', () => {
  assert.equal(
    normalizeRuleStepsWithPolicy({
      stages: [
        {
          order: 1,
          completion: { mode: 'quorum', quorum: 2 },
          approvers: [{ type: 'group', id: 'mgmt' }],
        },
      ],
    }),
    null,
  );
});
