import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectBaseline,
  deleteProjectTask,
  updateProjectTask,
  updateProjectTaskDependencies,
} from '../dist/application/projects/taskUseCases.js';

function adminActor() {
  return { userId: 'admin-user', roles: ['admin', 'mgmt'], projectIds: [] };
}

function leaderActor() {
  return { userId: 'leader-user', roles: ['user'], projectIds: ['proj-1'] };
}

function auditContext() {
  return { actorUserId: 'admin-user', actorRoles: ['admin'] };
}

test('updateProjectTask rejects ancestor parent cycle before update or audit', async () => {
  let updateCalled = false;
  const ports = {
    db: {
      projectTask: {
        findUnique: async (args) => {
          if (args.where.id === 'task-root' && !args.select) {
            return {
              id: 'task-root',
              projectId: 'proj-1',
              parentTaskId: null,
              planStart: null,
              planEnd: null,
              actualStart: null,
              actualEnd: null,
              deletedAt: null,
            };
          }
          if (args.where.id === 'task-child' && args.select?.projectId) {
            return { projectId: 'proj-1', deletedAt: null };
          }
          throw new Error(`unexpected task lookup ${JSON.stringify(args)}`);
        },
        findMany: async () => [
          { id: 'task-root', parentTaskId: null },
          { id: 'task-child', parentTaskId: 'task-root' },
        ],
        update: async () => {
          updateCalled = true;
          throw new Error('task update should not be called');
        },
      },
    },
    logAudit: async () => {
      throw new Error('audit should not be called');
    },
  };

  const result = await updateProjectTask({
    projectId: 'proj-1',
    taskId: 'task-root',
    body: { parentTaskId: 'task-child', reasonText: 'move under child' },
    auditContext: auditContext(),
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error?.code, 'VALIDATION_ERROR');
  assert.equal(result.body?.error?.message, 'Parent task creates circular reference');
  assert.equal(updateCalled, false);
});

test('updateProjectTask audits parent change and keeps date range validation in service', async () => {
  const audits = [];
  const ports = {
    db: {
      projectTask: {
        findUnique: async (args) => {
          if (args.where.id === 'task-1' && !args.select) {
            return {
              id: 'task-1',
              projectId: 'proj-1',
              parentTaskId: null,
              planStart: new Date('2026-01-01T00:00:00.000Z'),
              planEnd: new Date('2026-01-31T00:00:00.000Z'),
              actualStart: null,
              actualEnd: null,
              deletedAt: null,
            };
          }
          if (args.where.id === 'parent-1' && args.select?.projectId) {
            return { projectId: 'proj-1', deletedAt: null };
          }
          throw new Error(`unexpected task lookup ${JSON.stringify(args)}`);
        },
        findMany: async () => [
          { id: 'task-1', parentTaskId: null },
          { id: 'parent-1', parentTaskId: null },
        ],
        update: async ({ data }) => ({
          id: 'task-1',
          projectId: 'proj-1',
          parentTaskId: data.parentTaskId,
          planStart: data.planStart,
          planEnd: data.planEnd,
        }),
      },
    },
    logAudit: async (entry) => audits.push(entry),
  };

  const result = await updateProjectTask({
    projectId: 'proj-1',
    taskId: 'task-1',
    body: {
      parentTaskId: 'parent-1',
      planStart: '2026-01-05T00:00:00.000Z',
      reasonText: 'planned WBS change',
    },
    auditContext: auditContext(),
    ports,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.parentTaskId, 'parent-1');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'project_task_parent_updated');
  assert.deepEqual(audits[0].metadata, {
    projectId: 'proj-1',
    fromParentTaskId: null,
    toParentTaskId: 'parent-1',
  });
});

test('updateProjectTaskDependencies normalizes predecessors and updates dependencies in one transaction', async () => {
  const transactionOps = [];
  const predecessorQueries = [];
  const ports = {
    db: {
      projectTask: {
        findUnique: async () => ({ id: 'task-1', projectId: 'proj-1', deletedAt: null }),
        findMany: async (args) => {
          predecessorQueries.push(args.where.id.in);
          return [{ id: 'pred-b' }, { id: 'pred-c' }];
        },
      },
      projectTaskDependency: {
        findMany: async (args) => {
          if (args.where.toTaskId === 'task-1' && !args.where.fromTask) {
            return [{ fromTaskId: 'pred-a' }];
          }
          return [{ fromTaskId: 'pred-a', toTaskId: 'task-1' }];
        },
      },
      $transaction: async (fn) =>
        fn({
          projectTaskDependency: {
            deleteMany: async (args) => transactionOps.push(['delete', args]),
            createMany: async (args) => transactionOps.push(['create', args]),
          },
        }),
    },
  };

  const result = await updateProjectTaskDependencies({
    projectId: 'proj-1',
    taskId: 'task-1',
    body: { predecessorIds: [' pred-b ', 'pred-b', '', 'pred-c'] },
    actor: adminActor(),
    ports,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    predecessorIds: ['pred-b', 'pred-c'],
    added: 2,
    removed: 1,
  });
  assert.deepEqual(predecessorQueries, [['pred-b', 'pred-c']]);
  assert.equal(transactionOps.length, 2);
  assert.equal(transactionOps[0][0], 'delete');
  assert.deepEqual(transactionOps[0][1].where.fromTaskId.in, ['pred-a']);
  assert.equal(transactionOps[1][0], 'create');
  assert.deepEqual(
    transactionOps[1][1].data.map((item) => item.fromTaskId),
    ['pred-b', 'pred-c'],
  );
  assert.equal(transactionOps[1][1].data[0].createdBy, 'admin-user');
  assert.equal(transactionOps[1][1].skipDuplicates, true);
});

test('updateProjectTaskDependencies rejects dependency cycle before transaction', async () => {
  let transactionCalled = false;
  const ports = {
    db: {
      projectTask: {
        findUnique: async () => ({ id: 'task-1', projectId: 'proj-1', deletedAt: null }),
        findMany: async () => [{ id: 'pred-cycle' }],
      },
      projectTaskDependency: {
        findMany: async (args) => {
          if (args.where.toTaskId === 'task-1' && !args.where.fromTask) return [];
          return [{ fromTaskId: 'task-1', toTaskId: 'pred-cycle' }];
        },
      },
      $transaction: async () => {
        transactionCalled = true;
        throw new Error('transaction should not be called');
      },
    },
  };

  const result = await updateProjectTaskDependencies({
    projectId: 'proj-1',
    taskId: 'task-1',
    body: { predecessorIds: ['pred-cycle'] },
    actor: adminActor(),
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error?.code, 'VALIDATION_ERROR');
  assert.equal(result.body?.error?.message, 'Task dependency creates circular reference');
  assert.equal(transactionCalled, false);
});

test('deleteProjectTask rejects linked child records before soft delete transaction', async () => {
  let transactionCalled = false;
  const ports = {
    db: {
      projectTask: {
        findUnique: async () => ({ id: 'task-1', projectId: 'proj-1', deletedAt: null }),
        count: async () => 1,
      },
      timeEntry: { count: async () => 0 },
      estimateLine: { count: async () => 0 },
      billingLine: { count: async () => 0 },
      purchaseOrderLine: { count: async () => 0 },
      $transaction: async () => {
        transactionCalled = true;
        throw new Error('transaction should not be called');
      },
    },
  };

  const result = await deleteProjectTask({
    projectId: 'proj-1',
    taskId: 'task-1',
    body: { reason: 'obsolete' },
    ports,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body?.error?.message, 'Task has linked records and cannot be deleted');
  assert.equal(transactionCalled, false);
});

test('createProjectBaseline lets project leaders snapshot current task fields transactionally', async () => {
  const createdTasks = [];
  const ports = {
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    db: {
      projectMember: {
        findFirst: async () => ({ id: 'member-leader' }),
      },
      project: {
        findUnique: async () => ({
          id: 'proj-1',
          deletedAt: null,
          currency: 'JPY',
          planHours: 120,
          budgetCost: 500000,
        }),
      },
      projectTask: {
        findMany: async () => [
          {
            id: 'task-1',
            name: 'Design',
            status: 'todo',
            planStart: new Date('2026-07-01T00:00:00.000Z'),
            planEnd: new Date('2026-07-10T00:00:00.000Z'),
            progressPercent: 25,
          },
          {
            id: 'task-2',
            name: 'Build',
            status: 'doing',
            planStart: null,
            planEnd: null,
            progressPercent: null,
          },
        ],
      },
      $transaction: async (fn) =>
        fn({
          projectBaseline: {
            create: async ({ data }) => ({ id: 'baseline-1', ...data }),
          },
          projectBaselineTask: {
            createMany: async ({ data, skipDuplicates }) => {
              createdTasks.push(...data);
              assert.equal(skipDuplicates, true);
            },
          },
        }),
    },
  };

  const result = await createProjectBaseline({
    projectId: 'proj-1',
    body: { name: '   ' },
    actor: leaderActor(),
    ports,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'baseline-2026-07-13T00:00:00.000Z');
  assert.equal(result.value.createdBy, 'leader-user');
  assert.equal(result.value.taskCount, 2);
  assert.deepEqual(
    createdTasks.map((task) => ({
      baselineId: task.baselineId,
      taskId: task.taskId,
      name: task.name,
      status: task.status,
      progressPercent: task.progressPercent,
      createdBy: task.createdBy,
    })),
    [
      {
        baselineId: 'baseline-1',
        taskId: 'task-1',
        name: 'Design',
        status: 'todo',
        progressPercent: 25,
        createdBy: 'leader-user',
      },
      {
        baselineId: 'baseline-1',
        taskId: 'task-2',
        name: 'Build',
        status: 'doing',
        progressPercent: null,
        createdBy: 'leader-user',
      },
    ],
  );
});
