import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActionPolicyDeniedCode } from '../dist/services/actionPolicyErrors.js';

test('resolveActionPolicyDeniedCode: approval_open guard maps to APPROVAL_REQUIRED', () => {
  const code = resolveActionPolicyDeniedCode({
    allowed: false,
    policyApplied: true,
    reason: 'guard_failed',
    matchedPolicyId: 'policy-1',
    guardFailures: [{ type: 'approval_open', reason: 'open_exists' }],
  });
  assert.equal(code, 'APPROVAL_REQUIRED');
});

test('resolveActionPolicyDeniedCode: non-approval guard keeps ACTION_POLICY_DENIED', () => {
  const code = resolveActionPolicyDeniedCode({
    allowed: false,
    policyApplied: true,
    reason: 'guard_failed',
    matchedPolicyId: 'policy-1',
    guardFailures: [{ type: 'project_closed', reason: 'project_closed' }],
  });
  assert.equal(code, 'ACTION_POLICY_DENIED');
});

test('resolveActionPolicyDeniedCode: reason_required keeps ACTION_POLICY_DENIED', () => {
  const code = resolveActionPolicyDeniedCode({
    allowed: false,
    policyApplied: true,
    reason: 'reason_required',
    matchedPolicyId: 'policy-1',
    requireReason: true,
  });
  assert.equal(code, 'ACTION_POLICY_DENIED');
});

test('resolveActionPolicyDeniedCode: fallback-allowed result keeps ACTION_POLICY_DENIED', () => {
  const code = resolveActionPolicyDeniedCode({
    allowed: true,
    policyApplied: false,
  });
  assert.equal(code, 'ACTION_POLICY_DENIED');
});
