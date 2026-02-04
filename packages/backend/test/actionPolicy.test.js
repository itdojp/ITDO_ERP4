import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateActionPolicy,
  evaluateActionPolicyWithFallback,
} from '../dist/services/actionPolicy.js';

test('evaluateActionPolicyWithFallback: allow when no policy exists', async () => {
  const res = await evaluateActionPolicyWithFallback(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
    },
    { client: { actionPolicy: { findMany: async () => [] } } },
  );
  assert.equal(res.allowed, true);
  assert.equal(res.policyApplied, false);
});

test('evaluateActionPolicyWithFallback: deny when policy exists', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: null,
      requireReason: true,
    },
  ];
  const res = await evaluateActionPolicyWithFallback(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      reasonText: '',
    },
    { client: { actionPolicy: { findMany: async () => policies } } },
  );
  assert.equal(res.policyApplied, true);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'reason_required');
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicy: deny by default when no policy exists', async () => {
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
    },
    { client: { actionPolicy: { findMany: async () => [] } } },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'no_matching_policy');
});

test('evaluateActionPolicy: requireReason is enforced (no fallback)', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: null,
      requireReason: true,
    },
    {
      id: 'p2',
      stateConstraints: null,
      subjects: null,
      guards: null,
      requireReason: false,
    },
  ];
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      reasonText: '',
    },
    { client: { actionPolicy: { findMany: async () => policies } } },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'reason_required');
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicy: approval_open guard can be bypassed by a lower policy (e.g. admin override)', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'approval_open' }],
      requireReason: false,
    },
    {
      id: 'p2',
      stateConstraints: null,
      subjects: null,
      guards: null,
      requireReason: false,
    },
  ];
  const calls = { approvalFindFirst: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    approvalInstance: {
      findFirst: async (args) => {
        calls.approvalFindFirst += 1;
        // Ensure the query includes flowType to use the existing partial unique index.
        assert.equal(args.where.flowType, 'invoice');
        assert.equal(args.where.targetTable, 'invoices');
        assert.equal(args.where.targetId, 'inv1');
        return { id: 'a1', status: 'pending_qa' };
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      targetTable: 'invoices',
      targetId: 'inv1',
    },
    { client: fakeClient },
  );
  assert.equal(calls.approvalFindFirst, 1);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPolicyId, 'p2');
});

test('evaluateActionPolicy: unknown guard type is fail-safe (guard_failed)', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'unknown_guard' }],
      requireReason: false,
    },
  ];
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
    },
    {
      client: {
        actionPolicy: { findMany: async () => policies },
        approvalInstance: { findFirst: async () => null },
      },
    },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.matchedPolicyId, 'p1');
  assert.ok(Array.isArray(res.guardFailures));
  assert.equal(res.guardFailures[0].reason, 'unknown_guard_type');
});

test('evaluateActionPolicy: project_closed guard rejects when project is closed', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'project_closed' }],
      requireReason: false,
    },
  ];
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    project: {
      findMany: async (args) => {
        assert.deepEqual(args.where, {
          id: { in: ['p1'] },
          status: 'closed',
        });
        return [{ id: 'p1' }];
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { projectId: 'p1' },
    },
    { client: fakeClient },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.matchedPolicyId, 'p1');
  assert.equal(res.guardFailures[0].type, 'project_closed');
  assert.equal(res.guardFailures[0].reason, 'project_is_closed');
});

test('evaluateActionPolicy: project_closed guard passes when project is not closed', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'project_closed' }],
      requireReason: false,
    },
  ];
  const calls = { projectFindMany: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    project: {
      findMany: async (args) => {
        calls.projectFindMany += 1;
        assert.deepEqual(args.where, {
          id: { in: ['p1'] },
          status: 'closed',
        });
        return [];
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { projectId: 'p1' },
    },
    { client: fakeClient },
  );
  assert.equal(calls.projectFindMany, 1);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicy: period_lock guard rejects when period is locked', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'period_lock' }],
      requireReason: false,
    },
  ];
  const calls = { findFirst: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    periodLock: {
      findFirst: async (args) => {
        calls.findFirst += 1;
        assert.equal(args.where.period, '2050-01');
        assert.deepEqual(args.where.OR, [
          { scope: 'global' },
          { scope: 'project', projectId: 'p1' },
        ]);
        return { id: 'lock1', scope: 'project', projectId: 'p1' };
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { projectId: 'p1', periodKey: '2050-01' },
    },
    { client: fakeClient },
  );
  assert.equal(calls.findFirst, 1);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.matchedPolicyId, 'p1');
  assert.equal(res.guardFailures[0].type, 'period_lock');
  assert.equal(res.guardFailures[0].reason, 'period_locked');
});

test('evaluateActionPolicy: period_lock guard passes when period is not locked', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'period_lock' }],
      requireReason: false,
    },
  ];
  const calls = { findFirst: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    periodLock: {
      findFirst: async (args) => {
        calls.findFirst += 1;
        assert.equal(args.where.period, '2050-01');
        assert.deepEqual(args.where.OR, [
          { scope: 'global' },
          { scope: 'project', projectId: 'p1' },
        ]);
        return null;
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { projectId: 'p1', periodKey: '2050-01' },
    },
    { client: fakeClient },
  );
  assert.equal(calls.findFirst, 1);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicy: period_lock guard batches queries for multiple period/project pairs', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'period_lock' }],
      requireReason: false,
    },
  ];
  const calls = { findMany: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    periodLock: {
      findFirst: async () => {
        throw new Error('unexpected findFirst call');
      },
      findMany: async (args) => {
        calls.findMany += 1;
        assert.deepEqual(args.where.period.in.slice().sort(), [
          '2050-01',
          '2050-02',
        ]);
        assert.deepEqual(args.where.OR, [
          { scope: 'global' },
          { scope: 'project', projectId: { in: ['p1', 'p2'] } },
        ]);
        return [
          { id: 'lock1', scope: 'global', projectId: null, period: '2050-02' },
        ];
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { projectIds: ['p1', 'p2'], periodKeys: ['2050-01', '2050-02'] },
    },
    { client: fakeClient },
  );
  assert.equal(calls.findMany, 1);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.matchedPolicyId, 'p1');
  assert.equal(res.guardFailures[0].type, 'period_lock');
  assert.equal(res.guardFailures[0].reason, 'period_locked');
});

test('evaluateActionPolicy: editable_days guard rejects when outside editable window', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'editable_days' }],
      requireReason: false,
    },
  ];
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    worklogSetting: {
      findUnique: async () => ({ editableDays: 14 }),
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { workDate: '2050-01-01T00:00:00.000Z' },
    },
    { client: fakeClient },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.matchedPolicyId, 'p1');
  assert.equal(res.guardFailures[0].type, 'editable_days');
  assert.equal(res.guardFailures[0].reason, 'edit_window_expired');
});

test('evaluateActionPolicy: editable_days guard passes when within editable window', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'editable_days' }],
      requireReason: false,
    },
  ];
  const calls = { findUnique: 0 };
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    worklogSetting: {
      findUnique: async (args) => {
        calls.findUnique += 1;
        assert.deepEqual(args.where, { id: 'default' });
        return { editableDays: 14 };
      },
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'edit',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      state: { workDate: new Date().toISOString() },
    },
    { client: fakeClient },
  );
  assert.equal(calls.findUnique, 1);
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicy: chat_ack_completed guard rejects when link missing', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'chat_ack_completed' }],
      requireReason: false,
    },
  ];
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    chatAckLink: { findMany: async () => [] },
    chatAckRequest: { findMany: async () => [] },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'approve',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      targetTable: 'approval_instances',
      targetId: 'a1',
    },
    { client: fakeClient },
  );
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'guard_failed');
  assert.equal(res.guardFailures?.[0]?.type, 'chat_ack_completed');
  assert.equal(res.guardFailures?.[0]?.reason, 'missing_link');
});

test('evaluateActionPolicy: chat_ack_completed guard passes when all acked', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'chat_ack_completed' }],
      requireReason: false,
    },
  ];
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    chatAckLink: { findMany: async () => [{ ackRequestId: 'r1' }] },
    chatAckRequest: {
      findMany: async () => [
        {
          id: 'r1',
          requiredUserIds: ['u1', 'u2'],
          dueAt: null,
          canceledAt: null,
          message: { deletedAt: null },
          acks: [{ userId: 'u1' }, { userId: 'u2' }],
        },
      ],
    },
  };
  const res = await evaluateActionPolicy(
    {
      flowType: 'invoice',
      actionKey: 'approve',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      targetTable: 'approval_instances',
      targetId: 'a1',
    },
    { client: fakeClient },
  );
  assert.equal(res.allowed, true);
  assert.equal(res.matchedPolicyId, 'p1');
});

test('evaluateActionPolicyWithFallback: chat_ack_completed guard can be overridden by admin with reason', async () => {
  const policies = [
    {
      id: 'p1',
      stateConstraints: null,
      subjects: null,
      guards: [{ type: 'chat_ack_completed' }],
      requireReason: false,
    },
  ];
  const fakeClient = {
    actionPolicy: { findMany: async () => policies },
    chatAckLink: { findMany: async () => [] },
    chatAckRequest: { findMany: async () => [] },
  };
  const res = await evaluateActionPolicyWithFallback(
    {
      flowType: 'invoice',
      actionKey: 'approve',
      actor: { userId: 'u1', roles: ['admin'], groupIds: [] },
      reasonText: 'override',
      targetTable: 'approval_instances',
      targetId: 'a1',
    },
    { client: fakeClient },
  );
  assert.equal(res.policyApplied, true);
  assert.equal(res.allowed, true);
  assert.equal(res.requireReason, true);
  assert.equal(res.guardOverride, true);
  assert.ok(Array.isArray(res.guardFailures));
});
