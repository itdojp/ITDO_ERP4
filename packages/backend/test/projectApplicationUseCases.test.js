import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bulkAddProjectMembers,
  reassignProjectTask,
  updateProject,
} from '../dist/application/projects/useCases.js';

function adminActor() {
  return { userId: 'admin-user', roles: ['admin', 'mgmt'], projectIds: [] };
}

function auditContext() {
  return { actorUserId: 'admin-user', actorRoles: ['admin'] };
}

test('updateProject rejects circular parent before update', async () => {
  let updateCalled = false;
  const ports = {
    db: {
      project: {
        findUnique: async (args) => {
          if (args.where.id === 'proj-a' && !args.select) {
            return {
              id: 'proj-a',
              parentId: null,
              status: 'active',
              startDate: null,
              endDate: null,
            };
          }
          if (args.where.id === 'proj-b' && args.select?.deletedAt) {
            return { id: 'proj-b', deletedAt: null };
          }
          if (args.where.id === 'proj-b' && args.select?.parentId) {
            return { parentId: 'proj-a' };
          }
          throw new Error(`unexpected project lookup ${JSON.stringify(args)}`);
        },
        update: async () => {
          updateCalled = true;
          throw new Error('project update should not be called');
        },
      },
      customer: { findUnique: async () => null },
    },
    logAudit: async () => {
      throw new Error('audit should not be called');
    },
  };

  const result = await updateProject({
    projectId: 'proj-a',
    body: { parentId: 'proj-b', reasonText: 'move under child' },
    actor: adminActor(),
    auditContext: auditContext(),
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error?.code, 'VALIDATION_ERROR');
  assert.equal(updateCalled, false);
});

test('updateProject audits parent and status changes while notification failure remains fail-open', async () => {
  const auditActions = [];
  const warnings = [];
  const ports = {
    db: {
      project: {
        findUnique: async (args) => {
          if (args.where.id === 'proj-a' && !args.select) {
            return {
              id: 'proj-a',
              parentId: null,
              status: 'active',
              ownerUserId: 'owner-1',
              startDate: null,
              endDate: null,
            };
          }
          if (args.where.id === 'proj-parent' && args.select?.deletedAt) {
            return { id: 'proj-parent', deletedAt: null };
          }
          if (args.where.id === 'proj-parent' && args.select?.parentId) {
            return { parentId: null };
          }
          throw new Error(`unexpected project lookup ${JSON.stringify(args)}`);
        },
        update: async ({ data }) => ({
          id: 'proj-a',
          parentId: data.parentId,
          status: data.status,
          ownerUserId: 'owner-1',
        }),
      },
      customer: { findUnique: async () => null },
    },
    logAudit: async (entry) => {
      auditActions.push(entry);
    },
    createProjectStatusChangedNotifications: async () => {
      throw new Error('notification backend unavailable');
    },
  };

  const result = await updateProject({
    projectId: 'proj-a',
    body: {
      parentId: 'proj-parent',
      status: 'completed',
      reasonText: 'planned hierarchy change',
    },
    actor: adminActor(),
    auditContext: auditContext(),
    logger: { warn: (payload, message) => warnings.push({ payload, message }) },
    ports,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    auditActions.map((entry) => entry.action),
    ['project_parent_updated', 'project_status_updated'],
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'project status notification failed');
});

test('bulkAddProjectMembers keeps transaction failure all-or-nothing at response boundary', async () => {
  const auditActions = [];
  let createAttempts = 0;
  const ports = {
    db: {
      project: {
        findUnique: async () => ({ id: 'proj-1', deletedAt: null }),
      },
      projectMember: {
        findMany: async () => [],
      },
      $transaction: async (fn) =>
        fn({
          projectMember: {
            create: async () => {
              createAttempts += 1;
              if (createAttempts === 2) throw new Error('unique race');
              return {
                id: `member-${createAttempts}`,
                userId: `user-${createAttempts}`,
                role: 'member',
              };
            },
          },
        }),
    },
    logAudit: async (entry) => auditActions.push(entry),
    createProjectMemberAddedNotifications: async () => {
      throw new Error('notification should not run on failed transaction');
    },
  };

  const result = await bulkAddProjectMembers({
    projectId: 'proj-1',
    body: {
      items: [
        { userId: 'user-1', role: 'member' },
        { userId: 'user-2', role: 'member' },
      ],
    },
    actor: adminActor(),
    auditContext: auditContext(),
    ports,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.added, 0);
  assert.equal(result.value.failed, 2);
  assert.deepEqual(result.value.failures, [
    { userId: 'user-1', reason: 'create_failed' },
    { userId: 'user-2', reason: 'create_failed' },
  ]);
  assert.equal(auditActions.length, 0);
});

test('reassignProjectTask rejects period lock before task/time-entry updates', async () => {
  let transactionCalled = false;
  const ports = {
    db: {
      projectTask: {
        findUnique: async () => ({
          id: 'task-1',
          projectId: 'proj-from',
          deletedAt: null,
        }),
        count: async () => 0,
      },
      project: { findUnique: async () => ({ id: 'proj-to' }) },
      timeEntry: {
        count: async () => 1,
        findMany: async () => [
          {
            id: 'time-1',
            projectId: 'proj-from',
            taskId: 'task-1',
            workDate: new Date('2026-01-15T00:00:00.000Z'),
            status: 'draft',
            billedInvoiceId: null,
          },
        ],
      },
      projectTaskDependency: { count: async () => 0 },
      estimateLine: { count: async () => 0 },
      billingLine: { count: async () => 0 },
      purchaseOrderLine: { count: async () => 0 },
      approvalInstance: { findFirst: async () => null },
      $transaction: async () => {
        transactionCalled = true;
        throw new Error('transaction should not be called');
      },
    },
    findPeriodLock: async (_periodKey, projectId) =>
      projectId === 'proj-to' ? { id: 'lock-1' } : null,
    toPeriodKey: () => '2026-01',
    logAudit: async () => {
      throw new Error('audit should not be called');
    },
    logReassignment: async () => {
      throw new Error('reassignment log should not be called');
    },
  };

  const result = await reassignProjectTask({
    projectId: 'proj-from',
    taskId: 'task-1',
    body: {
      toProjectId: 'proj-to',
      moveTimeEntries: true,
      reasonCode: 'project_misassignment',
      reasonText: 'move to correct project',
    },
    actor: adminActor(),
    auditContext: auditContext(),
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error?.code, 'PERIOD_LOCKED');
  assert.equal(transactionCalled, false);
});
