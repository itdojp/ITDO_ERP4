import assert from 'node:assert/strict';
import test from 'node:test';

import {
  patchTimeEntry,
  reassignTimeEntry,
  submitTimeEntry,
} from '../dist/application/timeEntries/useCases.js';

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
    requestId: 'req-time-entry-app',
    source: 'api',
    ...overrides,
  };
}

function timeEntry(overrides = {}) {
  return {
    id: 'time-001',
    userId: 'user-001',
    projectId: 'proj-001',
    taskId: 'task-001',
    status: 'submitted',
    minutes: 60,
    workType: 'implementation',
    workDate: new Date('2026-01-15T00:00:00.000Z'),
    billedInvoiceId: null,
    deletedAt: null,
    ...overrides,
  };
}

function defaultPatchPorts(calls, original = timeEntry()) {
  return {
    db: {
      timeEntry: {
        findFirst: async (args) => {
          calls.push(['findFirst', args]);
          return original;
        },
        update: async (args) => {
          calls.push(['directUpdate', args]);
          return { ...original, ...args.data };
        },
      },
      project: {
        findMany: async (args) => {
          calls.push(['projectFindMany', args]);
          return [];
        },
      },
      projectTask: {
        findUnique: async (args) => {
          calls.push(['projectTaskFindUnique', args]);
          return { projectId: 'proj-001', deletedAt: null };
        },
      },
    },
    getEditableDays: async () => {
      calls.push(['getEditableDays']);
      return 30;
    },
    now: () => new Date('2026-01-16T00:00:00.000Z'),
    evaluateActionPolicyWithFallback: async (input) => {
      calls.push(['policy', input]);
      return {
        allowed: true,
        policyApplied: true,
        matchedPolicyId: 'policy-time-edit',
        requireReason: false,
      };
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
        timeEntry: {
          update: async (args) => {
            calls.push(['transactionUpdate', args]);
            return { ...original, ...args.data };
          },
        },
      });
      return {
        updated,
        approval: {
          id: 'approval-001',
          projectId: updated.projectId,
          flowType: 'time',
          targetTable: 'time_entries',
          targetId: updated.id,
          currentStep: 1,
          steps: [{ stepOrder: 1, status: 'pending_qa' }],
        },
      };
    },
    createApprovalPendingNotifications: async (input) => {
      calls.push(['notification', input]);
    },
    logAudit: async (input) => {
      calls.push(['audit', input]);
    },
  };
}

test('patchTimeEntry triggers approval, notification, and audit only when important fields change', async () => {
  const calls = [];
  const result = await patchTimeEntry({
    id: 'time-001',
    body: { minutes: 75, reasonText: 'corrected worklog' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPatchPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.minutes, 75);
  assert.equal(result.value.status, 'submitted');

  const transactionUpdate = calls.find(
    ([name]) => name === 'transactionUpdate',
  )?.[1];
  assert.equal(transactionUpdate.where.id, 'time-001');
  assert.equal(transactionUpdate.data.minutes, 75);
  assert.equal(transactionUpdate.data.status, 'submitted');

  const notification = calls.find(([name]) => name === 'notification')?.[1];
  assert.equal(notification.approvalInstanceId, 'approval-001');
  assert.equal(notification.requesterUserId, 'admin-user');
  assert.equal(notification.targetTable, 'time_entries');

  const audit = calls.find(([name, input]) => {
    return name === 'audit' && input.action === 'time_entry_modified';
  })?.[1];
  assert.equal(audit.targetId, 'time-001');
  assert.equal(audit.requestId, 'req-time-entry-app');
  assert.deepEqual(audit.metadata.changedFields, ['minutes']);

  const directUpdates = calls.filter(([name]) => name === 'directUpdate');
  assert.equal(directUpdates.length, 0);
});

test('patchTimeEntry skips approval and notification when no important field changes', async () => {
  const calls = [];
  const result = await patchTimeEntry({
    id: 'time-001',
    body: { workType: 'review' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultPatchPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.workType, 'review');
  assert.equal(
    calls.some(([name]) => name === 'submitApprovalWithUpdate'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'notification'),
    false,
  );
  assert.equal(calls.filter(([name]) => name === 'directUpdate').length, 1);
});

test('patchTimeEntry maps ActionPolicy reason requirement without updating', async () => {
  const calls = [];
  const result = await patchTimeEntry({
    id: 'time-001',
    body: { minutes: 75 },
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultPatchPorts(calls),
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
      ['directUpdate', 'submitApprovalWithUpdate', 'notification'].includes(
        name,
      ),
    ),
    false,
  );
});

test('patchTimeEntry rejects policy-less locked self edit with WORKLOG_LOCKED', async () => {
  const calls = [];
  const result = await patchTimeEntry({
    id: 'time-001',
    body: { minutes: 75 },
    actor: actor({
      userId: 'user-001',
      roles: ['user'],
      projectIds: ['proj-001'],
    }),
    auditContext: auditContext({ userId: 'user-001' }),
    ports: {
      ...defaultPatchPorts(
        calls,
        timeEntry({ workDate: new Date('2026-02-02T00:00:00.000Z') }),
      ),
      getEditableDays: async () => 0,
      now: () => new Date('2026-01-31T00:00:00.000Z'),
      evaluateActionPolicyWithFallback: async () => ({
        allowed: true,
        policyApplied: false,
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'WORKLOG_LOCKED');
  assert.equal(result.body.error.details.editWindowExpired, true);
  assert.equal(
    calls.some(([name]) =>
      ['directUpdate', 'submitApprovalWithUpdate', 'notification'].includes(
        name,
      ),
    ),
    false,
  );
});

test('patchTimeEntry propagates notification failure after approval transaction is committed', async () => {
  const calls = [];
  await assert.rejects(
    patchTimeEntry({
      id: 'time-001',
      body: { minutes: 75 },
      actor: actor(),
      auditContext: auditContext(),
      ports: {
        ...defaultPatchPorts(calls),
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
  assert.equal(
    calls.some(
      ([name, input]) =>
        name === 'audit' && input.action === 'time_entry_modified',
    ),
    false,
  );
});

test('patchTimeEntry propagates approval transaction failure before notification or audit side effects', async () => {
  const calls = [];
  await assert.rejects(
    patchTimeEntry({
      id: 'time-001',
      body: { minutes: 75 },
      actor: actor(),
      auditContext: auditContext(),
      ports: {
        ...defaultPatchPorts(calls),
        submitApprovalWithUpdate: async () => {
          calls.push(['submitApprovalWithUpdate']);
          throw new Error('approval transaction failed');
        },
      },
    }),
    /approval transaction failed/,
  );

  assert.equal(
    calls.some(([name]) => name === 'notification'),
    false,
  );
  assert.equal(
    calls.some(
      ([name, input]) =>
        name === 'audit' && input.action === 'time_entry_modified',
    ),
    false,
  );
});

function defaultReassignPorts(calls, original = timeEntry()) {
  return {
    db: {
      timeEntry: {
        findUnique: async (args) => {
          calls.push(['findUnique', args]);
          return original;
        },
        update: async (args) => {
          calls.push(['update', args]);
          return {
            ...original,
            projectId: args.data.projectId,
            taskId: args.data.taskId,
          };
        },
      },
      project: {
        findMany: async (args) => {
          calls.push(['projectFindMany', args]);
          return [];
        },
        findUnique: async (args) => {
          calls.push(['projectFindUnique', args]);
          return { id: args.where.id, deletedAt: null };
        },
      },
      approvalInstance: {
        findFirst: async (args) => {
          calls.push(['approvalFindFirst', args]);
          return null;
        },
      },
      projectTask: {
        findUnique: async (args) => {
          calls.push(['projectTaskFindUnique', args]);
          return { projectId: 'proj-002', deletedAt: null };
        },
      },
    },
    getEditableDays: async () => {
      calls.push(['getEditableDays']);
      return 30;
    },
    now: () => new Date('2026-01-16T00:00:00.000Z'),
    toPeriodKey: (date) => {
      calls.push(['toPeriodKey', date]);
      return '2026-01';
    },
    findPeriodLock: async (periodKey, projectId) => {
      calls.push(['findPeriodLock', { periodKey, projectId }]);
      return null;
    },
    logAudit: async (input) => {
      calls.push(['audit', input]);
    },
    logReassignment: async (input) => {
      calls.push(['reassignmentLog', input]);
    },
  };
}

test('reassignTimeEntry requires reason before database side effects', async () => {
  const calls = [];
  const result = await reassignTimeEntry({
    id: 'time-001',
    body: { toProjectId: 'proj-002', reasonText: '  ' },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultReassignPorts(calls),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: { code: 'INVALID_REASON', message: 'reasonText is required' },
  });
  assert.deepEqual(calls, []);
});

test('reassignTimeEntry rejects pending approval before project, period lock, update, or audit', async () => {
  const calls = [];
  const result = await reassignTimeEntry({
    id: 'time-001',
    body: {
      toProjectId: 'proj-002',
      reasonCode: 'project_misassignment',
      reasonText: 'move to correct project',
    },
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultReassignPorts(calls),
      db: {
        ...defaultReassignPorts(calls).db,
        approvalInstance: {
          findFirst: async (args) => {
            calls.push(['approvalFindFirst', args]);
            return { id: 'approval-open' };
          },
        },
        project: {
          findMany: async (args) => {
            calls.push(['projectFindMany', args]);
            return [];
          },
          findUnique: async () => {
            throw new Error(
              'project lookup should not run after pending approval',
            );
          },
        },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: { code: 'PENDING_APPROVAL', message: 'Approval in progress' },
  });
  assert.equal(
    calls.some(([name]) => name === 'findPeriodLock'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'update'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'audit'),
    false,
  );
});

test('reassignTimeEntry rejects period lock before task resolution, update, audit, or reassignment log', async () => {
  const calls = [];
  const result = await reassignTimeEntry({
    id: 'time-001',
    body: {
      toProjectId: 'proj-002',
      toTaskId: 'task-002',
      reasonCode: 'project_misassignment',
      reasonText: 'move to correct project',
    },
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      ...defaultReassignPorts(calls),
      findPeriodLock: async (periodKey, projectId) => {
        calls.push(['findPeriodLock', { periodKey, projectId }]);
        return projectId === 'proj-001' ? { id: 'period-lock-001' } : null;
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
  });
  assert.equal(
    calls.some(([name]) => name === 'projectTaskFindUnique'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'update'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'audit'),
    false,
  );
  assert.equal(
    calls.some(([name]) => name === 'reassignmentLog'),
    false,
  );
});

test('reassignTimeEntry updates project and task, then logs audit and reassignment metadata', async () => {
  const calls = [];
  const result = await reassignTimeEntry({
    id: 'time-001',
    body: {
      toProjectId: 'proj-002',
      toTaskId: 'task-002',
      reasonCode: 'project_misassignment',
      reasonText: 'move to correct project',
    },
    actor: actor(),
    auditContext: auditContext(),
    ports: defaultReassignPorts(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.projectId, 'proj-002');
  assert.equal(result.value.taskId, 'task-002');

  const update = calls.find(([name]) => name === 'update')?.[1];
  assert.deepEqual(update.data, { projectId: 'proj-002', taskId: 'task-002' });

  const audit = calls.find(([name]) => name === 'audit')?.[1];
  assert.equal(audit.action, 'reassignment');
  assert.equal(audit.targetTable, 'time_entries');
  assert.equal(audit.reasonCode, 'project_misassignment');
  assert.equal(audit.reasonText, 'move to correct project');
  assert.equal(audit.metadata.fromProjectId, 'proj-001');
  assert.equal(audit.metadata.toProjectId, 'proj-002');
  assert.equal(audit.metadata.fromTaskId, 'task-001');
  assert.equal(audit.metadata.toTaskId, 'task-002');

  const reassignment = calls.find(([name]) => name === 'reassignmentLog')?.[1];
  assert.equal(reassignment.targetTable, 'time_entries');
  assert.equal(reassignment.fromProjectId, 'proj-001');
  assert.equal(reassignment.toProjectId, 'proj-002');
  assert.equal(reassignment.createdBy, 'admin-user');
});

test('submitTimeEntry maps policy denial before downstream update', async () => {
  const calls = [];
  const result = await submitTimeEntry({
    id: 'time-001',
    body: {},
    actor: actor(),
    auditContext: auditContext(),
    ports: {
      db: {
        timeEntry: {
          findUnique: async () => timeEntry(),
          update: async () => {
            calls.push(['update']);
            throw new Error('update should not run when policy denies');
          },
        },
      },
      evaluateActionPolicyWithFallback: async () => ({
        allowed: false,
        policyApplied: true,
        reason: 'required_policy_missing',
      }),
      logActionPolicyFallbackAllowed: async () => {
        calls.push(['policyFallbackAudit']);
      },
      logActionPolicyOverride: async () => {
        calls.push(['policyOverrideAudit']);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'ACTION_POLICY_DENIED');
  assert.equal(calls.length, 0);
});
