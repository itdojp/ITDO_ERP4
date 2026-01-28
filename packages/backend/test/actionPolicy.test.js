import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateActionPolicy } from '../dist/services/actionPolicy.js';

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
