import assert from 'node:assert/strict';
import test from 'node:test';

import { submitEstimateForApproval } from '../dist/application/estimates/useCases.js';

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
    requestId: 'req-estimate-app',
    source: 'api',
    ...overrides,
  };
}

function estimate(overrides = {}) {
  return {
    id: 'est-001',
    status: 'draft',
    projectId: 'proj-001',
    ...overrides,
  };
}

function allowPolicy(overrides = {}) {
  return {
    allowed: true,
    policyApplied: true,
    matchedPolicyId: 'policy-estimate',
    requireReason: false,
    ...overrides,
  };
}

function defaultSubmitPorts(
  calls,
  existingEstimate = estimate({ status: 'draft' }),
) {
  return {
    db: {
      estimate: {
        findUnique: async (args) => {
          calls.push(['estimateFindUnique', args]);
          return existingEstimate;
        },
      },
    },
    evaluateActionPolicyWithFallback: async (input) => {
      calls.push(['policy', input]);
      return allowPolicy({ matchedPolicyId: 'policy-submit' });
    },
    logActionPolicyFallbackAllowed: async (params) => {
      calls.push(['policyFallbackAudit', params]);
    },
    logActionPolicyOverride: async (params) => {
      calls.push(['policyOverrideAudit', params]);
    },
    submitApprovalWithUpdate: async (options) => {
      calls.push(['submitApprovalWithUpdate', options]);
      const updated = await options.update({
        estimate: {
          update: async (args) => {
            calls.push(['transactionUpdate', args]);
            return {
              id: args.where.id,
              status: args.data.status,
              projectId: 'proj-001',
            };
          },
        },
      });
      return {
        updated,
        approval: {
          id: 'approval-001',
          projectId: updated.projectId,
          flowType: 'estimate',
          targetTable: 'estimates',
          targetId: updated.id,
          currentStep: 1,
          steps: [{ stepOrder: 1, status: 'pending_qa' }],
        },
      };
    },
    createApprovalPendingNotifications: async (input) => {
      calls.push(['notification', input]);
    },
  };
}

test('submitEstimateForApproval evaluates policy, updates in approval transaction, then notifies', async () => {
  const calls = [];
  const result = await submitEstimateForApproval({
    id: 'est-001',
    body: { reasonText: ' submit for approval ' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending_qa');

  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.flowType, 'estimate');
  assert.equal(policy.actionKey, 'submit');
  assert.equal(policy.reasonText, 'submit for approval');
  assert.deepEqual(policy.state, { status: 'draft', projectId: 'proj-001' });
  assert.deepEqual(policy.actor, {
    userId: 'admin-user',
    roles: ['admin', 'mgmt'],
    groupIds: [],
    groupAccountIds: [],
  });

  const fallbackAudit = calls.find(
    ([name]) => name === 'policyFallbackAudit',
  )?.[1];
  assert.equal(fallbackAudit.flowType, 'estimate');
  assert.equal(fallbackAudit.targetTable, 'estimates');
  assert.deepEqual(fallbackAudit.auditContext, auditContext());

  const transactionUpdate = calls.find(
    ([name]) => name === 'transactionUpdate',
  )?.[1];
  assert.deepEqual(transactionUpdate, {
    where: { id: 'est-001' },
    data: { status: 'pending_qa' },
  });

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.approvalInstanceId, 'approval-001');
  assert.equal(notification.requesterUserId, 'admin-user');
  assert.equal(notification.targetTable, 'estimates');
  assert.equal(notification.targetId, 'est-001');
});

test('submitEstimateForApproval tolerates non-object bodies', async () => {
  const calls = [];
  const result = await submitEstimateForApproval({
    id: 'est-001',
    body: 'reason as string body',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls),
  });

  assert.equal(result.ok, true);
  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.reasonText, '');
});

test('submitEstimateForApproval preserves absent-estimate behavior by letting approval update path decide', async () => {
  const calls = [];
  const result = await submitEstimateForApproval({
    id: 'est-missing',
    body: {},
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls, null),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'est-missing');
  assert.equal(
    calls.some(([name]) => name === 'policy'),
    false,
  );
  assert.equal(
    calls.filter(([name]) => name === 'submitApprovalWithUpdate').length,
    1,
  );
});

test('submitEstimateForApproval maps ActionPolicy reason requirement without transaction or notification', async () => {
  const calls = [];
  const result = await submitEstimateForApproval({
    id: 'est-001',
    body: {},
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultSubmitPorts(calls),
      evaluateActionPolicyWithFallback: async () => ({
        allowed: false,
        policyApplied: true,
        reason: 'reason_required',
        matchedPolicyId: 'policy-reason-required',
        requireReason: true,
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: {
      code: 'REASON_REQUIRED',
      message: 'reasonText is required for override',
      details: { matchedPolicyId: 'policy-reason-required' },
    },
  });
  assert.equal(
    calls.some(([name]) =>
      [
        'submitApprovalWithUpdate',
        'transactionUpdate',
        'notification',
      ].includes(name),
    ),
    false,
  );
});

test('submitEstimateForApproval maps ActionPolicy approval-open denial without transaction or notification', async () => {
  const calls = [];
  const result = await submitEstimateForApproval({
    id: 'est-001',
    body: { reasonText: 'duplicate submit' },
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultSubmitPorts(calls),
      evaluateActionPolicyWithFallback: async () => ({
        allowed: false,
        policyApplied: true,
        reason: 'guard_failed',
        matchedPolicyId: 'policy-approval-open',
        requireReason: false,
        guardFailures: [{ type: 'approval_open', message: 'approval open' }],
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, {
    error: {
      code: 'APPROVAL_REQUIRED',
      message: 'Estimate cannot be submitted',
      details: {
        reason: 'guard_failed',
        matchedPolicyId: 'policy-approval-open',
        guardFailures: [{ type: 'approval_open', message: 'approval open' }],
      },
    },
  });
  assert.equal(
    calls.some(([name]) =>
      [
        'submitApprovalWithUpdate',
        'transactionUpdate',
        'notification',
      ].includes(name),
    ),
    false,
  );
});

test('submitEstimateForApproval propagates notification failure after approval transaction', async () => {
  const calls = [];
  await assert.rejects(
    submitEstimateForApproval({
      id: 'est-001',
      body: {},
      actor: actor({ userId: null }),
      auditContext: auditContext({ userId: null }),
      ports: {
        ...defaultSubmitPorts(calls),
        createApprovalPendingNotifications: async (input) => {
          calls.push(['notification', input]);
          throw new Error('notification dispatch failed');
        },
      },
    }),
    /notification dispatch failed/,
  );

  const names = calls.map(([name]) => name);
  assert.ok(names.indexOf('transactionUpdate') >= 0);
  assert.ok(names.indexOf('notification') > names.indexOf('transactionUpdate'));

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.requesterUserId, 'system');
  assert.equal(notification.actorUserId, 'system');
});
