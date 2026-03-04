import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createApprovalFor,
  ExpenseQaStageRequiredError,
} from '../dist/services/approval.js';

test('createApprovalFor: rule query filters isActive and effectiveFrom<=now', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  let findManyArgs;
  const fakeClient = {
    approvalRule: {
      findMany: async (args) => {
        findManyArgs = args;
        return [
          {
            id: 'r1',
            flowType: 'invoice',
            conditions: {},
            steps: [{ approverGroupId: 'g1' }],
          },
        ];
      },
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => ({
        id: 'a1',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv1',
    { amount: 100 },
    { client: fakeClient, createdBy: 'u1', now },
  );

  assert.ok(findManyArgs);
  assert.equal(findManyArgs.where.flowType, 'invoice');
  assert.equal(findManyArgs.where.isActive, true);
  assert.equal(
    findManyArgs.where.effectiveFrom.lte.toISOString(),
    now.toISOString(),
  );
  assert.deepEqual(findManyArgs.where.OR, [
    { effectiveTo: null },
    { effectiveTo: { gt: now } },
  ]);
  assert.deepEqual(findManyArgs.orderBy, [
    { effectiveFrom: 'desc' },
    { createdAt: 'desc' },
  ]);
});

test('createApprovalFor: selects the first matching rule from ordered candidates', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  let createdArgs;
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r1',
          flowType: 'invoice',
          conditions: { amountMin: 1000 },
          steps: [{ approverGroupId: 'g1' }],
        },
        {
          id: 'r2',
          flowType: 'invoice',
          conditions: {},
          steps: [{ approverGroupId: 'g2' }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async (args) => {
        createdArgs = args;
        return {
          id: 'a1',
          status: 'pending_qa',
          currentStep: 1,
          steps: [],
        };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv1',
    { amount: 100 },
    { client: fakeClient, createdBy: 'u1', now },
  );

  assert.ok(createdArgs);
  assert.equal(createdArgs.data.ruleId, 'r2');
});

test('createApprovalFor: prioritizes the top-most matching rule when multiple rules match', async () => {
  let createdArgs;
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-new',
          flowType: 'invoice',
          conditions: { amountMin: 1000 },
          steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
        },
        {
          id: 'r-old',
          flowType: 'invoice',
          conditions: { amountMin: 500 },
          steps: [{ approverGroupId: 'exec', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async (args) => {
        createdArgs = args;
        return {
          id: 'a-priority',
          status: 'pending_qa',
          currentStep: 1,
          steps: [],
        };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-priority',
    { amount: 2000 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.ok(createdArgs);
  assert.equal(createdArgs.data.ruleId, 'r-new');
});

test('createApprovalFor: amount boundary (+/-1) switches matched rules', async () => {
  const createdRuleIds = [];
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-boundary',
          flowType: 'invoice',
          conditions: { amountMax: 100000 },
          steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
        },
        {
          id: 'r-fallback',
          flowType: 'invoice',
          conditions: {},
          steps: [{ approverGroupId: 'exec', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async (args) => {
        createdRuleIds.push(String(args?.data?.ruleId ?? ''));
        return {
          id: `a-boundary-${createdRuleIds.length}`,
          status: 'pending_qa',
          currentStep: 1,
          steps: [],
        };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-amount-on-boundary',
    { amount: 100000 },
    { client: fakeClient, createdBy: 'u1' },
  );
  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-amount-over-boundary',
    { amount: 100001 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.deepEqual(createdRuleIds, ['r-boundary', 'r-fallback']);
});

test('createApprovalFor: logs fallback reasons when no active rule is found', async () => {
  const auditLogs = [];
  const fakeClient = {
    approvalRule: {
      findMany: async () => [],
    },
    project: { findUnique: async () => null },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => ({
        id: 'a-fallback-no-rule',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: 'audit-1' };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-no-rule',
    { amount: 120000 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'approval_rule_fallback_used');
  assert.equal(auditLogs[0].reasonCode, 'rule_not_found');
  assert.deepEqual(auditLogs[0].metadata.fallbackReasons, [
    'rule_not_found',
    'rule_id_auto_used',
  ]);
});

test('createApprovalFor: writes normalized fallback metadata in tx path', async () => {
  const auditLogs = [];
  const fakeClient = {
    approvalRule: {
      findMany: async () => [],
    },
    project: { findUnique: async () => null },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => ({
        id: 'a-fallback-normalized',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: 'audit-normalized' };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-normalized',
    {
      amount: BigInt(10),
      totalAmount: Number.POSITIVE_INFINITY,
      projectType: new Date('2026-01-01T00:00:00.000Z'),
    },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].metadata._request.source, 'system');
  assert.equal(auditLogs[0].metadata.payloadHints.amount, '10');
  assert.equal(auditLogs[0].metadata.payloadHints.totalAmount, 'Infinity');
  assert.equal(
    auditLogs[0].metadata.payloadHints.projectType,
    '2026-01-01T00:00:00.000Z',
  );
});

test('createApprovalFor: logs fallback reason when first rule is used without condition match', async () => {
  const auditLogs = [];
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-unmatched',
          flowType: 'invoice',
          conditions: { amountMin: 999999 },
          steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => ({
        id: 'a-fallback-unmatched',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: 'audit-2' };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-unmatched',
    { amount: 10 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.equal(auditLogs.length, 1);
  assert.deepEqual(auditLogs[0].metadata.fallbackReasons, [
    'rule_condition_unmatched_first_rule',
  ]);
  assert.equal(auditLogs[0].metadata.selectedRuleId, 'r-unmatched');
});

test('createApprovalFor: logs fallback reason when selected rule has invalid steps', async () => {
  const auditLogs = [];
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-invalid-steps',
          flowType: 'invoice',
          conditions: {},
          steps: { invalid: true },
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => ({
        id: 'a-fallback-invalid-steps',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: 'audit-3' };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-invalid-steps',
    { amount: 60000 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.equal(auditLogs.length, 1);
  assert.deepEqual(auditLogs[0].metadata.fallbackReasons, [
    'rule_invalid_steps',
  ]);
});

test('createApprovalFor: does not log fallback when open approval already exists', async () => {
  const auditLogs = [];
  let createCalled = false;
  const fakeClient = {
    approvalRule: {
      findMany: async () => [],
    },
    approvalInstance: {
      findFirst: async () => ({
        id: 'a-existing',
        flowType: 'invoice',
        targetTable: 'invoices',
        targetId: 'inv-existing',
        status: 'pending_qa',
        currentStep: 1,
        steps: [],
      }),
      create: async () => {
        createCalled = true;
        return {
          id: 'a-created',
          status: 'pending_qa',
          currentStep: 1,
          steps: [],
        };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: 'audit-duplicate' };
      },
    },
  };

  const approval = await createApprovalFor(
    'invoice',
    'invoices',
    'inv-existing',
    { amount: 50 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.equal(createCalled, false);
  assert.equal(approval.id, 'a-existing');
  assert.equal(auditLogs.length, 0);
});

test('createApprovalFor: stage order derives currentStep/status from the smallest stepOrder', async () => {
  let createdArgs;
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-stage-order',
          flowType: 'invoice',
          conditions: {},
          steps: {
            stages: [
              {
                order: 3,
                completion: { mode: 'any' },
                approvers: [{ type: 'group', id: 'exec' }],
              },
              {
                order: 2,
                approvers: [{ type: 'group', id: 'mgmt' }],
              },
            ],
          },
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async (args) => {
        createdArgs = args;
        return {
          id: 'a-stage-order',
          status: String(args?.data?.status ?? ''),
          currentStep: Number(args?.data?.currentStep ?? 0),
          steps: [],
        };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-stage-order',
    { amount: 90000 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.ok(createdArgs);
  assert.equal(createdArgs.data.currentStep, 2);
  assert.equal(createdArgs.data.status, 'pending_qa');
  assert.deepEqual(createdArgs.data.stagePolicy, {
    2: { mode: 'all' },
    3: { mode: 'any' },
  });
});

test('createApprovalFor: stores selected rule version and snapshot on the instance', async () => {
  let createdArgs;
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
  const effectiveTo = new Date('2026-12-31T23:59:59.000Z');
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-versioned',
          flowType: 'invoice',
          ruleKey: 'invoice-default',
          version: 3,
          isActive: true,
          effectiveFrom,
          effectiveTo,
          supersedesRuleId: 'r-versioned-v2',
          conditions: { amountMin: 0 },
          steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async (args) => {
        createdArgs = args;
        return {
          id: 'a-versioned',
          status: 'pending_qa',
          currentStep: 1,
          steps: [],
        };
      },
    },
  };

  await createApprovalFor(
    'invoice',
    'invoices',
    'inv-versioned',
    { amount: 10000 },
    { client: fakeClient, createdBy: 'u1' },
  );

  assert.ok(createdArgs);
  assert.equal(createdArgs.data.ruleId, 'r-versioned');
  assert.equal(createdArgs.data.ruleVersion, 3);
  assert.deepEqual(createdArgs.data.ruleSnapshot, {
    id: 'r-versioned',
    flowType: 'invoice',
    ruleKey: 'invoice-default',
    version: 3,
    isActive: true,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo.toISOString(),
    supersedesRuleId: 'r-versioned-v2',
    conditions: { amountMin: 0 },
    steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
  });
});

test('createApprovalFor: blocks expense rules that skip qa stage before exec', async () => {
  let createCalled = false;
  const fakeClient = {
    approvalRule: {
      findMany: async () => [
        {
          id: 'r-expense',
          flowType: 'expense',
          conditions: {},
          steps: [{ approverGroupId: 'exec', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async () => {
        createCalled = true;
        return { id: 'a1', status: 'pending_exec', currentStep: 1, steps: [] };
      },
    },
  };

  await assert.rejects(
    () =>
      createApprovalFor(
        'expense',
        'expenses',
        'exp1',
        { amount: 120000 },
        { client: fakeClient, createdBy: 'u1' },
      ),
    (error) => error instanceof ExpenseQaStageRequiredError,
  );
  assert.equal(createCalled, false);
});
