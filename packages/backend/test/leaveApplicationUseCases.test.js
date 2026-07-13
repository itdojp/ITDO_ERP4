import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeLeaveSubmit,
  loadLeaveSubmitEvidence,
  submitLeaveRequestForApproval,
} from '../dist/application/leave/useCases.js';

function actor(overrides = {}) {
  return {
    userId: 'employee-001',
    roles: ['user'],
    groupIds: ['group-001'],
    groupAccountIds: ['group-account-001'],
    ...overrides,
  };
}

function auditContext(overrides = {}) {
  return {
    userId: 'employee-001',
    requestId: 'req-leave-app',
    source: 'api',
    ...overrides,
  };
}

function allowPolicy(overrides = {}) {
  return {
    allowed: true,
    policyApplied: true,
    matchedPolicyId: 'policy-leave-submit',
    requireReason: false,
    ...overrides,
  };
}

function defaultPolicyPorts(calls, policy = allowPolicy()) {
  return {
    evaluateActionPolicyWithFallback: async (input) => {
      calls.push(['policy', input]);
      return policy;
    },
    logActionPolicyFallbackAllowed: async (params) => {
      calls.push(['policyFallbackAudit', params]);
    },
    logActionPolicyOverride: async (params) => {
      calls.push(['policyOverrideAudit', params]);
    },
  };
}

function defaultSubmitPorts(calls) {
  return {
    submitApprovalWithUpdate: async (options) => {
      calls.push(['submitApprovalWithUpdate', options]);
      const updated = await options.update({
        leaveRequest: {
          update: async (args) => {
            calls.push(['transactionUpdate', args]);
            return {
              id: args.where.id,
              status: args.data.status,
              noConsultationConfirmed: args.data.noConsultationConfirmed,
              noConsultationReason: args.data.noConsultationReason,
            };
          },
        },
      });
      return {
        updated,
        approval: {
          id: 'approval-leave-001',
          projectId: null,
          flowType: 'leave',
          targetTable: 'leave_requests',
          targetId: updated.id,
          currentStep: 1,
          steps: [{ stepOrder: 1, status: 'pending_manager' }],
        },
      };
    },
    createApprovalPendingNotifications: async (input) => {
      calls.push(['notification', input]);
    },
  };
}

test('authorizeLeaveSubmit evaluates policy and records context audit', async () => {
  const calls = [];
  const result = await authorizeLeaveSubmit({
    id: 'leave-001',
    status: 'draft',
    reasonText: ' submit override ',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPolicyPorts(
      calls,
      allowPolicy({ matchedPolicyId: 'policy-submit', requireReason: true }),
    ),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    policyApplied: true,
    matchedPolicyId: 'policy-submit',
    requireReason: true,
  });
  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.flowType, 'leave');
  assert.equal(policy.actionKey, 'submit');
  assert.equal(policy.reasonText, 'submit override');
  assert.deepEqual(policy.state, { status: 'draft' });
  assert.deepEqual(policy.actor, {
    userId: 'employee-001',
    roles: ['user'],
    groupIds: ['group-001'],
    groupAccountIds: ['group-account-001'],
  });
  const overrideAudit = calls.find(
    ([name]) => name === 'policyOverrideAudit',
  )?.[1];
  assert.equal(overrideAudit.targetTable, 'leave_requests');
  assert.deepEqual(overrideAudit.auditContext, auditContext());
});

test('authorizeLeaveSubmit maps ActionPolicy reason requirement', async () => {
  const calls = [];
  const result = await authorizeLeaveSubmit({
    id: 'leave-001',
    status: 'draft',
    reasonText: '',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPolicyPorts(calls, {
      allowed: false,
      policyApplied: true,
      reason: 'reason_required',
      matchedPolicyId: 'policy-reason-required',
      requireReason: true,
    }),
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
      ['policyFallbackAudit', 'policyOverrideAudit'].includes(name),
    ),
    false,
  );
});

test('authorizeLeaveSubmit maps ActionPolicy guard failure to 403 without audit side effects', async () => {
  const calls = [];
  const result = await authorizeLeaveSubmit({
    id: 'leave-002',
    status: 'draft',
    reasonText: '',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPolicyPorts(calls, {
      allowed: false,
      policyApplied: true,
      reason: 'guard_failed',
      matchedPolicyId: 'policy-guard',
      guardFailures: [{ type: 'approval_open' }],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, {
    error: {
      code: 'APPROVAL_REQUIRED',
      message: 'LeaveRequest cannot be submitted',
      details: {
        reason: 'guard_failed',
        matchedPolicyId: 'policy-guard',
        guardFailures: [{ type: 'approval_open' }],
      },
    },
  });
  assert.equal(
    calls.some(([name]) =>
      ['policyFallbackAudit', 'policyOverrideAudit'].includes(name),
    ),
    false,
  );
});

test('authorizeLeaveSubmit with no matching policy records fallback audit and returns ok', async () => {
  const calls = [];
  const result = await authorizeLeaveSubmit({
    id: 'leave-003',
    status: 'draft',
    reasonText: null,
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPolicyPorts(calls, {
      allowed: true,
      policyApplied: false,
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    policyApplied: false,
    matchedPolicyId: null,
    requireReason: false,
  });
  const fallbackAudit = calls.find(
    ([name]) => name === 'policyFallbackAudit',
  )?.[1];
  assert.equal(fallbackAudit.flowType, 'leave');
  assert.equal(fallbackAudit.actionKey, 'submit');
  assert.equal(fallbackAudit.targetTable, 'leave_requests');
  assert.equal(fallbackAudit.targetId, 'leave-003');
  assert.deepEqual(fallbackAudit.auditContext, auditContext());
});

test('loadLeaveSubmitEvidence normalizes references without exposing payload content', async () => {
  const result = await loadLeaveSubmitEvidence({
    id: 'leave-001',
    ports: {
      db: { marker: 'db' },
      loadResolvedAnnotationReferenceState: async (db, kind, id) => {
        assert.deepEqual(db, { marker: 'db' });
        assert.equal(kind, 'leave_request');
        assert.equal(id, 'leave-001');
        return {
          internalRefs: [
            { kind: 'chat_message', id: 'chat-001', text: 'do-not-copy' },
            { kind: 'document', id: 'doc-001', title: 'do-not-copy' },
          ],
          externalUrls: ['https://example.test/evidence'],
        };
      },
    },
  });

  assert.deepEqual(result, {
    normalizedInternalRefs: [
      { kind: 'chat_message', refId: 'chat-001' },
      { kind: 'document', refId: 'doc-001' },
    ],
    externalUrls: ['https://example.test/evidence'],
    hasAttachmentEvidence: true,
    hasConsultationEvidence: true,
  });
});

test('submitLeaveRequestForApproval updates in approval transaction and then notifies', async () => {
  const calls = [];
  const result = await submitLeaveRequestForApproval({
    id: 'leave-001',
    leave: { hours: 0 },
    requestedLeaveMinutes: 480,
    noConsultationUpdate: {
      noConsultationConfirmed: true,
      noConsultationReason: 'manager was unavailable',
    },
    actor: actor(),
    ports: defaultSubmitPorts(calls),
  });

  assert.deepEqual(result, {
    id: 'leave-001',
    status: 'pending_manager',
    noConsultationConfirmed: true,
    noConsultationReason: 'manager was unavailable',
  });
  const submit = calls.find(
    ([name]) => name === 'submitApprovalWithUpdate',
  )?.[1];
  assert.equal(submit.flowType, 'leave');
  assert.equal(submit.targetTable, 'leave_requests');
  assert.deepEqual(submit.payload, { hours: 0, minutes: 480 });
  assert.equal(submit.createdBy, 'employee-001');
  const transactionUpdate = calls.find(
    ([name]) => name === 'transactionUpdate',
  )?.[1];
  assert.deepEqual(transactionUpdate, {
    where: { id: 'leave-001' },
    data: {
      status: 'pending_manager',
      noConsultationConfirmed: true,
      noConsultationReason: 'manager was unavailable',
    },
  });
  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.approvalInstanceId, 'approval-leave-001');
  assert.equal(notification.requesterUserId, 'employee-001');
  assert.equal(notification.actorUserId, 'employee-001');
  assert.equal(notification.flowType, 'leave');
  assert.equal(notification.targetTable, 'leave_requests');
  assert.equal(notification.targetId, 'leave-001');
});

test('submitLeaveRequestForApproval propagates notification failure after transaction', async () => {
  const calls = [];
  await assert.rejects(
    submitLeaveRequestForApproval({
      id: 'leave-001',
      leave: { hours: null },
      requestedLeaveMinutes: 240,
      noConsultationUpdate: {
        noConsultationConfirmed: null,
        noConsultationReason: null,
      },
      actor: actor({ userId: null }),
      ports: {
        ...defaultSubmitPorts(calls),
        createApprovalPendingNotifications: async (input) => {
          calls.push(['notification', input]);
          throw new Error('notification failed');
        },
      },
    }),
    /notification failed/,
  );
  assert.equal(
    calls.some(([name]) => name === 'transactionUpdate'),
    true,
  );
  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.requesterUserId, 'system');
  assert.equal(notification.actorUserId, 'system');
});
