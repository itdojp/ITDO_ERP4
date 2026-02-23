import type { EvaluateActionPolicyWithFallbackResult } from './actionPolicy.js';

export function resolveActionPolicyDeniedCode(
  result: EvaluateActionPolicyWithFallbackResult,
) {
  if (!result.policyApplied || result.allowed) {
    return 'ACTION_POLICY_DENIED';
  }
  if (result.reason !== 'guard_failed') {
    return 'ACTION_POLICY_DENIED';
  }
  const hasApprovalOpenGuardFailure = (result.guardFailures ?? []).some(
    (failure) => failure.type === 'approval_open',
  );
  if (hasApprovalOpenGuardFailure) {
    return 'APPROVAL_REQUIRED';
  }
  return 'ACTION_POLICY_DENIED';
}
