import assert from 'node:assert/strict';
import test from 'node:test';

import { logActionPolicyFallbackAllowedIfNeeded } from '../dist/services/actionPolicyAudit.js';
import { prisma } from '../dist/services/db.js';

test('logActionPolicyFallbackAllowedIfNeeded: writes audit once per key', async () => {
  const originalCreate = prisma.auditLog.create;
  const calls = [];
  prisma.auditLog.create = async (args) => {
    calls.push(args);
    return { id: `audit-${calls.length}` };
  };
  try {
    const req = {
      id: 'req-1',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'node-test' },
      user: {
        userId: 'user-1',
        roles: ['user'],
        groupIds: ['group-1'],
        projectIds: [],
        auth: {},
      },
    };

    await logActionPolicyFallbackAllowedIfNeeded({
      req,
      flowType: 'invoice',
      actionKey: 'edit',
      targetTable: 'invoices',
      targetId: 'inv-0',
      result: { allowed: true, policyApplied: true },
    });
    assert.equal(calls.length, 0);

    await logActionPolicyFallbackAllowedIfNeeded({
      req,
      flowType: 'invoice',
      actionKey: 'edit',
      targetTable: 'invoices',
      targetId: 'inv-0b',
      result: { allowed: false, policyApplied: false },
    });
    assert.equal(calls.length, 0);

    const result = { allowed: true, policyApplied: false };

    await logActionPolicyFallbackAllowedIfNeeded({
      req,
      flowType: 'invoice',
      actionKey: 'edit',
      targetTable: 'invoices',
      targetId: 'inv-1',
      result,
    });
    await logActionPolicyFallbackAllowedIfNeeded({
      req,
      flowType: 'invoice',
      actionKey: 'edit',
      targetTable: 'invoices',
      targetId: 'inv-2',
      result,
    });
  } finally {
    prisma.auditLog.create = originalCreate;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.data?.action, 'action_policy_fallback_allowed');
  assert.equal(calls[0]?.data?.targetTable, 'invoices');
  assert.equal(calls[0]?.data?.targetId, 'inv-1');
  assert.equal(calls[0]?.data?.metadata?.flowType, 'invoice');
  assert.equal(calls[0]?.data?.metadata?.actionKey, 'edit');
});
