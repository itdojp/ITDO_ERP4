import assert from 'node:assert/strict';
import test from 'node:test';

import { createApprovalFor } from '../dist/services/approval.js';

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

