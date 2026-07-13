import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeVendorInvoiceAction,
  submitVendorInvoiceForApproval,
} from '../dist/application/vendorDocs/useCases.js';

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
    requestId: 'req-vendor-doc-app',
    source: 'api',
    ...overrides,
  };
}

function vendorInvoice(overrides = {}) {
  return {
    id: 'vi-001',
    status: 'received',
    projectId: 'proj-001',
    ...overrides,
  };
}

function allowPolicy(overrides = {}) {
  return {
    allowed: true,
    policyApplied: true,
    matchedPolicyId: 'policy-vendor-invoice',
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

function defaultSubmitPorts(
  calls,
  existingVendorInvoice = vendorInvoice({ status: 'received' }),
) {
  return {
    db: {
      vendorInvoice: {
        findUnique: async (args) => {
          calls.push(['vendorInvoiceFindUnique', args]);
          return existingVendorInvoice;
        },
      },
    },
    ...defaultPolicyPorts(
      calls,
      allowPolicy({ matchedPolicyId: 'policy-submit' }),
    ),
    submitApprovalWithUpdate: async (options) => {
      calls.push(['submitApprovalWithUpdate', options]);
      const updated = await options.update({
        vendorInvoice: {
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
          flowType: 'vendor_invoice',
          targetTable: 'vendor_invoices',
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

test('authorizeVendorInvoiceAction evaluates policy and returns audit metadata', async () => {
  const calls = [];
  const result = await authorizeVendorInvoiceAction({
    id: 'vi-001',
    actionKey: 'update_lines',
    status: 'received',
    projectId: 'proj-001',
    reasonText: ' update lines ',
    actor: actor(),
    auditContext: auditContext(),
    deniedMessage: 'Vendor invoice lines cannot be updated',
    ports: defaultPolicyPorts(
      calls,
      allowPolicy({ matchedPolicyId: 'policy-lines', requireReason: true }),
    ),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    policyApplied: true,
    requiresLegacyReason: false,
    auditMetadata: { matchedPolicyId: 'policy-lines', requireReason: true },
  });
  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.flowType, 'vendor_invoice');
  assert.equal(policy.actionKey, 'update_lines');
  assert.equal(policy.reasonText, 'update lines');
  assert.deepEqual(policy.state, { status: 'received', projectId: 'proj-001' });
  assert.deepEqual(policy.actor, {
    userId: 'admin-user',
    roles: ['admin', 'mgmt'],
    groupIds: [],
    groupAccountIds: [],
  });
  const fallbackAudit = calls.find(
    ([name]) => name === 'policyFallbackAudit',
  )?.[1];
  assert.equal(fallbackAudit.targetTable, 'vendor_invoices');
  assert.deepEqual(fallbackAudit.auditContext, auditContext());
});

test('authorizeVendorInvoiceAction flags legacy fallback reason after submit status', async () => {
  const calls = [];
  const result = await authorizeVendorInvoiceAction({
    id: 'vi-001',
    actionKey: 'link_po',
    status: 'approved',
    projectId: 'proj-001',
    reasonText: '',
    actor: actor(),
    auditContext: auditContext(),
    deniedMessage: 'VendorInvoice purchase order cannot be linked',
    ports: defaultPolicyPorts(calls, {
      allowed: true,
      policyApplied: false,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.policyApplied, false);
  assert.equal(result.value.requiresLegacyReason, true);
  assert.deepEqual(result.value.auditMetadata, {
    matchedPolicyId: null,
    requireReason: false,
  });
});

test('authorizeVendorInvoiceAction maps ActionPolicy reason requirement', async () => {
  const calls = [];
  const result = await authorizeVendorInvoiceAction({
    id: 'vi-001',
    actionKey: 'unlink_po',
    status: 'approved',
    projectId: 'proj-001',
    reasonText: '',
    actor: actor(),
    auditContext: auditContext(),
    deniedMessage: 'VendorInvoice purchase order cannot be unlinked',
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

test('submitVendorInvoiceForApproval evaluates policy, updates in approval transaction, then notifies', async () => {
  const calls = [];
  const result = await submitVendorInvoiceForApproval({
    id: 'vi-001',
    body: { reasonText: ' submit vendor invoice ' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending_qa');

  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.actionKey, 'submit');
  assert.equal(policy.reasonText, 'submit vendor invoice');
  assert.deepEqual(policy.state, { status: 'received', projectId: 'proj-001' });

  const transactionUpdate = calls.find(
    ([name]) => name === 'transactionUpdate',
  )?.[1];
  assert.deepEqual(transactionUpdate, {
    where: { id: 'vi-001' },
    data: { status: 'pending_qa' },
  });

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.approvalInstanceId, 'approval-001');
  assert.equal(notification.requesterUserId, 'admin-user');
  assert.equal(notification.flowType, 'vendor_invoice');
  assert.equal(notification.targetTable, 'vendor_invoices');
  assert.equal(notification.targetId, 'vi-001');
});

test('submitVendorInvoiceForApproval treats non-object body as empty record', async () => {
  const calls = [];
  const result = await submitVendorInvoiceForApproval({
    id: 'vi-001',
    body: 'reason as string body',
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultSubmitPorts(calls),
  });

  assert.equal(result.ok, true);
  const policy = calls.find(([name]) => name === 'policy')?.[1];
  assert.equal(policy.reasonText, '');
});

test('submitVendorInvoiceForApproval skips policy for absent invoices and lets approval update path fail', async () => {
  const calls = [];
  const ports = {
    ...defaultSubmitPorts(calls, null),
    submitApprovalWithUpdate: async (options) => {
      calls.push(['submitApprovalWithUpdate', options]);
      return options.update({
        vendorInvoice: {
          update: async (args) => {
            calls.push(['transactionUpdate', args]);
            throw new Error('vendor invoice update failed');
          },
        },
      });
    },
  };

  await assert.rejects(
    submitVendorInvoiceForApproval({
      id: 'vi-missing',
      body: {},
      actor: actor(),
      auditContext: auditContext(),
      ports,
    }),
    /vendor invoice update failed/,
  );
  assert.equal(
    calls.some(([name]) => name === 'policy'),
    false,
  );
  assert.equal(
    calls.filter(([name]) => name === 'submitApprovalWithUpdate').length,
    1,
  );
});

test('submitVendorInvoiceForApproval propagates notification failure after approval transaction', async () => {
  const calls = [];
  await assert.rejects(
    submitVendorInvoiceForApproval({
      id: 'vi-001',
      body: {},
      actor: actor(),
      auditContext: auditContext(),
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
  assert.equal(
    calls.some(([name]) => name === 'notification'),
    true,
  );
});
