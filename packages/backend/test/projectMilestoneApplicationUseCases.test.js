import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectMilestoneCreateData,
  createProjectMilestone,
  deleteProjectMilestone,
  listProjectMilestones,
  updateProjectMilestone,
} from '../dist/application/projects/milestoneUseCases.js';

test('buildProjectMilestoneCreateData keeps existing defaults and date mapping', () => {
  const data = buildProjectMilestoneCreateData({
    projectId: 'proj-1',
    body: {
      name: 'Acceptance',
      amount: 1000,
      dueDate: '2026-07-31',
      taxRate: 0.1,
    },
  });

  assert.equal(data.projectId, 'proj-1');
  assert.equal(data.name, 'Acceptance');
  assert.equal(data.amount, 1000);
  assert.equal(data.billUpon, 'date');
  assert.equal(data.dueDate.toISOString(), '2026-07-31T00:00:00.000Z');
  assert.equal(data.taxRate, 0.1);
});

test('create/listProjectMilestones delegate persistence with existing filters', async () => {
  const calls = [];
  const ports = {
    db: {
      projectMilestone: {
        create: async (args) => {
          calls.push(['create', args]);
          return { id: 'milestone-1', ...args.data };
        },
        findMany: async (args) => {
          calls.push(['findMany', args]);
          return [{ id: 'milestone-1' }];
        },
      },
    },
  };

  const created = await createProjectMilestone({
    projectId: 'proj-1',
    body: { name: 'Kickoff', amount: 500, billUpon: 'time' },
    ports,
  });
  const listed = await listProjectMilestones({ projectId: 'proj-1', ports });

  assert.equal(created.ok, true);
  assert.equal(created.value.billUpon, 'time');
  assert.equal(created.value.dueDate, null);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value.items, [{ id: 'milestone-1' }]);
  assert.deepEqual(calls[1][1], {
    where: { projectId: 'proj-1', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
});

test('updateProjectMilestone synchronizes only simple unmodified draft invoices', async () => {
  const transactionOps = [];
  const warnings = [];
  const ports = {
    logger: {
      warn: (payload, message) => warnings.push({ payload, message }),
      error: () => {
        throw new Error('invoice sync should not fail');
      },
    },
    db: {
      projectMilestone: {
        findUnique: async () => ({
          id: 'milestone-1',
          projectId: 'proj-1',
          deletedAt: null,
        }),
        update: async ({ data }) => ({
          id: 'milestone-1',
          projectId: 'proj-1',
          ...data,
        }),
      },
      invoice: {
        findFirst: async () => null,
        findMany: async () => [
          {
            id: 'inv-ok',
            totalAmount: 1000,
            lines: [{ id: 'line-ok', quantity: 1, unitPrice: 1000 }],
          },
          {
            id: 'inv-manual',
            totalAmount: 1100,
            lines: [{ id: 'line-manual', quantity: 1, unitPrice: 1000 }],
          },
          {
            id: 'inv-multi',
            totalAmount: 2000,
            lines: [
              { id: 'line-multi-a', quantity: 1, unitPrice: 1000 },
              { id: 'line-multi-b', quantity: 1, unitPrice: 1000 },
            ],
          },
          {
            id: 'inv-quantity',
            totalAmount: 2000,
            lines: [{ id: 'line-quantity', quantity: 2, unitPrice: 1000 }],
          },
        ],
        update: (args) => ({ op: 'invoice.update', args }),
      },
      billingLine: {
        update: (args) => ({ op: 'billingLine.update', args }),
      },
      $transaction: async (ops) => {
        transactionOps.push(...ops);
        return ops;
      },
    },
  };

  const result = await updateProjectMilestone({
    projectId: 'proj-1',
    milestoneId: 'milestone-1',
    body: { amount: 2000 },
    ports,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.amount, 2000);
  assert.deepEqual(
    transactionOps.map((op) => [op.op, op.args.where]),
    [
      ['billingLine.update', { id: 'line-ok' }],
      ['invoice.update', { id: 'inv-ok' }],
    ],
  );
  assert.deepEqual(transactionOps[0].args.data, { unitPrice: 2000 });
  assert.deepEqual(transactionOps[1].args.data, { totalAmount: 2000 });
  assert.deepEqual(warnings.map((entry) => entry.payload.reason).sort(), [
    'line_count',
    'manual_adjustment',
    'quantity',
  ]);
});

test('updateProjectMilestone rejects submitted linked invoices before update', async () => {
  let updateCalled = false;
  const ports = {
    db: {
      projectMilestone: {
        findUnique: async () => ({
          id: 'milestone-1',
          projectId: 'proj-1',
          deletedAt: null,
        }),
        update: async () => {
          updateCalled = true;
          throw new Error('update should not be called');
        },
      },
      invoice: {
        findFirst: async () => ({ id: 'invoice-submitted' }),
      },
    },
  };

  const result = await updateProjectMilestone({
    projectId: 'proj-1',
    milestoneId: 'milestone-1',
    body: { amount: 2000 },
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  assert.equal(updateCalled, false);
});

test('deleteProjectMilestone rejects linked invoices and otherwise soft deletes', async () => {
  let updateCalled = false;
  const now = new Date('2026-07-13T00:00:00.000Z');
  const basePorts = {
    now: () => now,
    db: {
      projectMilestone: {
        findUnique: async () => ({
          id: 'milestone-1',
          projectId: 'proj-1',
          deletedAt: null,
        }),
        update: async ({ data }) => {
          updateCalled = true;
          return { id: 'milestone-1', ...data };
        },
      },
      invoice: {
        findFirst: async () => null,
      },
    },
  };

  const deleted = await deleteProjectMilestone({
    projectId: 'proj-1',
    milestoneId: 'milestone-1',
    body: { reason: 'obsolete' },
    ports: basePorts,
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.value.deletedAt, now);
  assert.equal(deleted.value.deletedReason, 'obsolete');
  assert.equal(updateCalled, true);

  const rejected = await deleteProjectMilestone({
    projectId: 'proj-1',
    milestoneId: 'milestone-1',
    body: { reason: 'obsolete' },
    ports: {
      ...basePorts,
      db: {
        ...basePorts.db,
        invoice: { findFirst: async () => ({ id: 'invoice-1' }) },
      },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.statusCode, 400);
  assert.equal(
    rejected.body.error.message,
    'Milestone has linked invoices and cannot be deleted',
  );
});
