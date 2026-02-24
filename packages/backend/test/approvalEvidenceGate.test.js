import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureApprovalEvidenceReady,
  isApprovalEvidenceGateEnabled,
} from '../dist/services/approvalEvidenceGate.js';

test('isApprovalEvidenceGateEnabled: supports exact and wildcard rules', () => {
  assert.equal(
    isApprovalEvidenceGateEnabled('invoice', 'send', 'invoice:send'),
    true,
  );
  assert.equal(
    isApprovalEvidenceGateEnabled('invoice', 'mark_paid', 'invoice:send'),
    false,
  );
  assert.equal(
    isApprovalEvidenceGateEnabled('invoice', 'send', '*:send'),
    true,
  );
  assert.equal(
    isApprovalEvidenceGateEnabled('purchase_order', 'send', 'invoice:*'),
    false,
  );
});

test('ensureApprovalEvidenceReady: bypasses when rule is not enabled', async () => {
  let approvalCalls = 0;
  let snapshotCalls = 0;
  const client = {
    approvalInstance: {
      findFirst: async () => {
        approvalCalls += 1;
        return null;
      },
    },
    evidenceSnapshot: {
      findFirst: async () => {
        snapshotCalls += 1;
        return null;
      },
    },
  };
  const res = await ensureApprovalEvidenceReady(
    client,
    {
      flowType: 'invoice',
      actionKey: 'send',
      targetTable: 'invoices',
      targetId: 'inv-1',
    },
    '',
  );
  assert.deepEqual(res, { required: false, allowed: true });
  assert.equal(approvalCalls, 0);
  assert.equal(snapshotCalls, 0);
});

test('ensureApprovalEvidenceReady: denies when approved instance is missing', async () => {
  const client = {
    approvalInstance: {
      findFirst: async (args) => {
        assert.equal(args.where.flowType, 'invoice');
        assert.equal(args.where.targetTable, 'invoices');
        assert.equal(args.where.targetId, 'inv-1');
        return null;
      },
    },
    evidenceSnapshot: {
      findFirst: async () => {
        throw new Error('should not be called');
      },
    },
  };
  const res = await ensureApprovalEvidenceReady(
    client,
    {
      flowType: 'invoice',
      actionKey: 'send',
      targetTable: 'invoices',
      targetId: 'inv-1',
    },
    'invoice:send',
  );
  assert.equal(res.required, true);
  assert.equal(res.allowed, false);
  assert.equal(res.code, 'APPROVAL_REQUIRED');
});

test('ensureApprovalEvidenceReady: denies when evidence snapshot is missing', async () => {
  const client = {
    approvalInstance: {
      findFirst: async () => ({ id: 'approval-1' }),
    },
    evidenceSnapshot: {
      findFirst: async (args) => {
        assert.equal(args.where.approvalInstanceId, 'approval-1');
        return null;
      },
    },
  };
  const res = await ensureApprovalEvidenceReady(
    client,
    {
      flowType: 'invoice',
      actionKey: 'send',
      targetTable: 'invoices',
      targetId: 'inv-1',
    },
    'invoice:send',
  );
  assert.equal(res.required, true);
  assert.equal(res.allowed, false);
  assert.equal(res.code, 'EVIDENCE_REQUIRED');
  assert.equal(res.approvalInstanceId, 'approval-1');
});

test('ensureApprovalEvidenceReady: allows when approved instance and snapshot exist', async () => {
  const client = {
    approvalInstance: {
      findFirst: async () => ({ id: 'approval-1' }),
    },
    evidenceSnapshot: {
      findFirst: async () => ({ id: 'snapshot-1' }),
    },
  };
  const res = await ensureApprovalEvidenceReady(
    client,
    {
      flowType: 'invoice',
      actionKey: 'send',
      targetTable: 'invoices',
      targetId: 'inv-1',
    },
    'invoice:send',
  );
  assert.deepEqual(res, {
    required: true,
    allowed: true,
    approvalInstanceId: 'approval-1',
    snapshotId: 'snapshot-1',
  });
});
