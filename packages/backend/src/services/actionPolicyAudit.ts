import type { FastifyRequest } from 'fastify';
import type { FlowType } from '../types.js';
import { Prisma } from '@prisma/client';
import type { EvaluateActionPolicyWithFallbackResult } from './actionPolicy.js';
import { auditContextFromRequest, logAudit } from './audit.js';

type ActionPolicyOverrideAuditParams = {
  req: FastifyRequest;
  flowType: FlowType;
  actionKey: string;
  targetTable: string;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

// Unified audit event for "admin override" (or other configured overrides) when ActionPolicy requires a reason.
// This keeps the decision trail discoverable even when domain routes do not have their own audit log.
export async function logActionPolicyOverrideIfNeeded(
  params: ActionPolicyOverrideAuditParams,
) {
  if (!params.result.policyApplied) return;
  if (!params.result.allowed) return;
  if (!params.result.requireReason) return;

  await logAudit({
    action: 'action_policy_override',
    targetTable: params.targetTable,
    targetId: params.targetId,
    reasonText: params.reasonText || undefined,
    metadata: {
      flowType: params.flowType,
      actionKey: params.actionKey,
      matchedPolicyId: params.result.matchedPolicyId,
      guardFailures: (params.result.guardFailures ??
        null) as Prisma.InputJsonValue,
      guardOverride: params.result.guardOverride ?? false,
    },
    ...auditContextFromRequest(params.req),
  });
}
