import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markInvoicePaid,
  submitInvoiceForApproval,
} from '../dist/application/invoices/useCases.js';

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
    requestId: 'req-invoice-app',
    source: 'api',
    ...overrides,
  };
}

function invoice(overrides = {}) {
  return {
    id: 'inv-001',
    status: 'approved',
    projectId: 'proj-001',
    deletedAt: null,
    paidAt: null,
    paidBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function allowPolicy(overrides = {}) {
  return {
    allowed: true,
    policyApplied: true,
    matchedPolicyId: 'policy-invoice',
    requireReason: false,
    ...overrides,
  };
}

function defaultSubmitPorts(
  calls,
  existingInvoice = invoice({ status: 'draft' }),
) {
  return {
    db: {
      invoice: {
        findUnique: async (args) => {
          calls.push(['invoiceFindUnique', args]);
          return existingInvoice;
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
        invoice: {
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
          flowType: 'invoice',
          targetTable: 'invoices',
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

function defaultMarkPaidPorts(calls, existingInvoice = invoice()) {
  return {
    db: {
      invoice: {
        findUnique: async (args) => {
          calls.push(['invoiceFindUnique', args]);
          return existingInvoice;
        },
        update: async (args) => {
          calls.push(['invoiceUpdate', args]);
          return {
            ...existingInvoice,
            ...args.data,
            id: args.where.id,
            lines: [],
          };
        },
      },
    },
    evaluateActionPolicyWithFallback: async (input) => {
      calls.push(['policy', input]);
      return allowPolicy({ matchedPolicyId: 'policy-mark-paid' });
    },
    logActionPolicyFallbackAllowed: async (params) => {
      calls.push(['policyFallbackAudit', params]);
    },
    logActionPolicyOverride: async (params) => {
      calls.push(['policyOverrideAudit', params]);
    },
    logAudit: async (input) => {
      calls.push(['audit', input]);
    },
  };
}

test('submitInvoiceForApproval evaluates policy, updates in approval transaction, then notifies', async () => {
  const calls = [];
  const result = await submitInvoiceForApproval({
    id: 'inv-001',
    body: { reasonText: 'submit for approval' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending_qa');

  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.flowType, 'invoice');
  assert.equal(policy.actionKey, 'submit');
  assert.equal(policy.reasonText, 'submit for approval');
  assert.deepEqual(policy.state, { status: 'draft', projectId: 'proj-001' });

  const transactionUpdate = calls.find(
    ([name]) => name === 'transactionUpdate',
  )?.[1];
  assert.deepEqual(transactionUpdate, {
    where: { id: 'inv-001' },
    data: { status: 'pending_qa' },
  });

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.approvalInstanceId, 'approval-001');
  assert.equal(notification.requesterUserId, 'admin-user');
  assert.equal(notification.targetTable, 'invoices');
  assert.equal(notification.targetId, 'inv-001');
});

test('submitInvoiceForApproval preserves absent-invoice behavior by letting approval update path decide', async () => {
  const calls = [];
  const result = await submitInvoiceForApproval({
    id: 'inv-missing',
    body: {},
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls, null),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'inv-missing');
  assert.equal(
    calls.some(([name]) => name === 'policy'),
    false,
  );
  assert.equal(
    calls.filter(([name]) => name === 'submitApprovalWithUpdate').length,
    1,
  );
});

test('submitInvoiceForApproval maps ActionPolicy reason requirement without transaction or notification', async () => {
  const calls = [];
  const result = await submitInvoiceForApproval({
    id: 'inv-001',
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

test('submitInvoiceForApproval propagates notification failure after approval transaction', async () => {
  const calls = [];
  await assert.rejects(
    submitInvoiceForApproval({
      id: 'inv-001',
      body: {},
      actor: actor(),
      auditContext: auditContext(),
      ports: {
        ...defaultSubmitPorts(calls),
        createApprovalPendingNotifications: async () => {
          calls.push(['notification']);
          throw new Error('notification dispatch failed');
        },
      },
    }),
    /notification dispatch failed/,
  );

  const names = calls.map(([name]) => name);
  assert.ok(names.indexOf('transactionUpdate') >= 0);
  assert.ok(names.indexOf('notification') > names.indexOf('transactionUpdate'));
});

test('markInvoicePaid maps missing invoice before policy evaluation', async () => {
  const calls = [];
  const result = await markInvoicePaid({
    id: 'inv-missing',
    paidAt: new Date('2026-02-01T00:00:00.000Z'),
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultMarkPaidPorts(calls, null),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, {
    error: { code: 'NOT_FOUND', message: 'Invoice not found' },
  });
  assert.equal(
    calls.some(([name]) => name === 'policy'),
    false,
  );
});

test('markInvoicePaid maps ActionPolicy denial without update or audit', async () => {
  const calls = [];
  const result = await markInvoicePaid({
    id: 'inv-001',
    paidAt: new Date('2026-02-01T00:00:00.000Z'),
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultMarkPaidPorts(calls),
      evaluateActionPolicyWithFallback: async () => ({
        allowed: false,
        policyApplied: true,
        reason: 'guard_failed',
        matchedPolicyId: 'policy-deny',
        guardFailures: [{ type: 'status', reason: 'not_approved' }],
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'ACTION_POLICY_DENIED');
  assert.equal(result.body.error.message, 'Invoice cannot be marked as paid');
  assert.equal(result.body.error.details.matchedPolicyId, 'policy-deny');
  assert.equal(
    calls.some(([name]) => ['invoiceUpdate', 'audit'].includes(name)),
    false,
  );
});

test('markInvoicePaid preserves policy-before-invalid-status ordering', async () => {
  const calls = [];
  const result = await markInvoicePaid({
    id: 'inv-001',
    paidAt: new Date('2026-02-01T00:00:00.000Z'),
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultMarkPaidPorts(calls, invoice({ status: 'cancelled' })),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, 'INVALID_STATUS');
  const names = calls.map(([name]) => name);
  assert.ok(names.includes('policy'));
  assert.ok(names.includes('policyFallbackAudit'));
  assert.ok(names.includes('policyOverrideAudit'));
  assert.equal(names.includes('invoiceUpdate'), false);
  assert.equal(names.includes('audit'), false);
});

test('markInvoicePaid updates paid fields and writes invoice audit metadata', async () => {
  const calls = [];
  const paidAt = new Date('2026-02-01T00:00:00.000Z');
  const result = await markInvoicePaid({
    id: 'inv-001',
    paidAt,
    reasonText: '入金確認',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultMarkPaidPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'paid');
  assert.equal(result.value.paidBy, 'admin-user');

  const update = calls.find(([name]) => name === 'invoiceUpdate')?.[1];
  assert.equal(update.where.id, 'inv-001');
  assert.equal(update.data.status, 'paid');
  assert.equal(update.data.paidBy, 'admin-user');
  assert.equal(update.data.updatedBy, 'admin-user');
  assert.equal(update.data.paidAt.getTime(), paidAt.getTime());
  assert.deepEqual(update.include, { lines: true });

  const audit = calls.find(([name]) => name === 'audit')?.[1];
  assert.equal(audit.action, 'invoice_mark_paid');
  assert.equal(audit.targetTable, 'Invoice');
  assert.equal(audit.targetId, 'inv-001');
  assert.equal(audit.reasonText, '入金確認');
  assert.equal(audit.requestId, 'req-invoice-app');
  assert.deepEqual(audit.metadata, {
    previousStatus: 'approved',
    paidAt: paidAt.toISOString(),
    paidBy: 'admin-user',
  });
});
