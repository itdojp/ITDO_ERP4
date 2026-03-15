import assert from 'node:assert/strict';
import test from 'node:test';

import { act, submitApprovalWithUpdate } from '../dist/services/approval.js';
import { prisma } from '../dist/services/db.js';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

test('approval act writes approval_step_approve/approval_approve audit with reason and metadata', async () => {
  const auditEntries = [];
  const tx = {
    $queryRaw: async () => [],
    approvalInstance: {
      findUnique: async () => ({
        id: 'approval-001',
        status: 'pending_qa',
        currentStep: 1,
        targetTable: 'invoices',
        targetId: 'inv-001',
        stagePolicy: null,
        steps: [
          {
            id: 'step-001',
            stepOrder: 1,
            status: 'pending_qa',
            approverUserId: 'approver-001',
            approverGroupId: null,
            actedBy: null,
          },
        ],
      }),
      update: async ({ data }) => ({
        id: 'approval-001',
        status: data.status,
        currentStep: data.currentStep,
      }),
    },
    approvalStep: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [],
    },
    invoice: {
      update: async ({ data }) => ({ id: 'inv-001', status: data.status }),
      findUnique: async () => ({
        id: 'inv-001',
        projectId: 'proj-001',
        invoiceNo: 'INV-001',
        totalAmount: '10000',
        currency: 'JPY',
      }),
    },
    project: {
      findUnique: async () => ({
        code: 'PRJ-001',
        customer: { code: 'CUST-001' },
      }),
    },
    accountingEvent: {
      upsert: async () => ({ id: 'acctevt-001' }),
    },
    accountingJournalStaging: {
      upsert: async () => ({ id: 'acctstg-001' }),
    },
  };

  await withPrismaStubs(
    {
      $transaction: async (callback) => callback(tx),
      'auditLog.create': async ({ data }) => {
        auditEntries.push(data);
        return { id: `audit-${auditEntries.length}` };
      },
    },
    async () => {
      const result = await act('approval-001', 'approver-001', 'approve', {
        reason: 'e2e approval reason',
        auditContext: {
          requestId: 'req-approval-001',
          source: 'api',
          principalUserId: 'approver-001',
          actorUserId: 'approver-001',
          authScopes: ['approval:act'],
        },
      });
      assert.equal(result.status, 'approved');
      assert.equal(result.currentStep, null);
    },
  );

  const stepAudit = auditEntries.find(
    (entry) => entry.action === 'approval_step_approve',
  );
  assert.ok(stepAudit);
  assert.equal(stepAudit.reasonText, 'e2e approval reason');
  assert.equal(stepAudit.targetTable, 'approval_steps');
  assert.equal(stepAudit.targetId, 'step-001');
  assert.equal(stepAudit.metadata.instanceId, 'approval-001');
  assert.equal(stepAudit.metadata.fromStatus, 'pending_qa');
  assert.equal(stepAudit.metadata.toStatus, 'approved');
  assert.equal(stepAudit.metadata.step, 1);
  assert.deepEqual(stepAudit.metadata._request, {
    id: 'req-approval-001',
    source: 'api',
  });
  assert.deepEqual(stepAudit.metadata._auth, {
    principalUserId: 'approver-001',
    actorUserId: 'approver-001',
    scopes: ['approval:act'],
  });

  const approvalAudit = auditEntries.find(
    (entry) => entry.action === 'approval_approve',
  );
  assert.ok(approvalAudit);
  assert.equal(approvalAudit.reasonText, 'e2e approval reason');
  assert.equal(approvalAudit.targetTable, 'approval_instances');
  assert.equal(approvalAudit.targetId, 'approval-001');
  assert.equal(approvalAudit.metadata.fromStatus, 'pending_qa');
  assert.equal(approvalAudit.metadata.toStatus, 'approved');
  assert.equal(approvalAudit.metadata.step, 1);
  assert.deepEqual(approvalAudit.metadata._request, {
    id: 'req-approval-001',
    source: 'api',
  });
});

test('submitApprovalWithUpdate writes evidence_snapshot_created audit with approval/evidence linkage metadata', async () => {
  const auditEntries = [];
  const tx = {
    project: {
      findUnique: async () => null,
    },
    approvalRule: {
      findMany: async () => [
        {
          id: 'rule-002',
          flowType: 'invoice',
          ruleKey: 'invoice-default',
          version: 1,
          isActive: true,
          conditions: null,
          steps: [{ approverGroupId: 'mgmt', stepOrder: 1 }],
        },
      ],
    },
    approvalInstance: {
      findFirst: async () => null,
      create: async ({ data }) => ({
        id: 'approval-002',
        flowType: data.flowType,
        targetTable: data.targetTable,
        targetId: data.targetId,
        projectId: data.projectId,
        status: data.status,
        currentStep: data.currentStep,
        ruleId: data.ruleId,
        createdBy: data.createdBy,
        stagePolicy: data.stagePolicy ?? null,
        steps: (data.steps?.create ?? []).map((step, index) => ({
          id: `step-${index + 1}`,
          ...step,
        })),
      }),
    },
    evidenceSnapshot: {
      findFirst: async () => null,
      create: async ({ data }) => ({
        id: 'snapshot-002',
        approvalInstanceId: data.approvalInstanceId,
        targetTable: data.targetTable,
        targetId: data.targetId,
        version: data.version,
        sourceAnnotationUpdatedAt: data.sourceAnnotationUpdatedAt ?? null,
      }),
    },
    annotation: {
      findUnique: async () => null,
    },
    referenceLink: {
      findMany: async () => [],
    },
    chatMessage: {
      findMany: async () => [],
    },
  };

  await withPrismaStubs(
    {
      $transaction: async (callback) => callback(tx),
      'auditLog.create': async ({ data }) => {
        auditEntries.push(data);
        return { id: `audit-${auditEntries.length}` };
      },
    },
    async () => {
      const result = await submitApprovalWithUpdate({
        flowType: 'invoice',
        targetTable: 'invoices',
        targetId: 'inv-002',
        createdBy: 'submitter-001',
        update: async () => ({
          id: 'inv-002',
          projectId: 'proj-002',
          totalAmount: 120000,
          currency: 'JPY',
        }),
      });
      assert.equal(result.approval.id, 'approval-002');
      assert.equal(result.approval.targetTable, 'invoices');
      assert.equal(result.approval.targetId, 'inv-002');
    },
  );

  const evidenceAudit = auditEntries.find(
    (entry) => entry.action === 'evidence_snapshot_created',
  );
  assert.ok(evidenceAudit);
  assert.equal(evidenceAudit.targetTable, 'evidence_snapshots');
  assert.equal(evidenceAudit.targetId, 'snapshot-002');
  assert.equal(evidenceAudit.userId, 'submitter-001');
  assert.equal(evidenceAudit.source, 'system');
  assert.equal(evidenceAudit.reasonText, undefined);
  assert.equal(evidenceAudit.metadata.approvalInstanceId, 'approval-002');
  assert.equal(evidenceAudit.metadata.targetTable, 'invoices');
  assert.equal(evidenceAudit.metadata.targetId, 'inv-002');
  assert.equal(evidenceAudit.metadata.version, 1);
  assert.equal(evidenceAudit.metadata.trigger, 'submit_auto');
});
