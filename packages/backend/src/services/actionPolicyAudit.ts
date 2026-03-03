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

type ActionPolicyFallbackAllowedAuditParams = {
  req: FastifyRequest;
  flowType: FlowType;
  actionKey: string;
  targetTable: string;
  targetId: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

// Avoid high-volume audit logs: record once per process per action/targetTable combination.
const loggedFallbackAllowedKeys = new Set<string>();

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

// Transitional audit event when legacy "allow when no policy exists" path is taken.
// This is used to detect coverage gaps while migrating routes to strict ActionPolicy enforcement.
export async function logActionPolicyFallbackAllowedIfNeeded(
  params: ActionPolicyFallbackAllowedAuditParams,
) {
  if (params.result.policyApplied) return;
  if (!params.result.allowed) return;

  const key = `${params.flowType}:${params.actionKey}:${params.targetTable}`;
  if (loggedFallbackAllowedKeys.has(key)) return;
  loggedFallbackAllowedKeys.add(key);

  await logAudit({
    action: 'action_policy_fallback_allowed',
    targetTable: params.targetTable,
    targetId: params.targetId,
    metadata: {
      flowType: params.flowType,
      actionKey: params.actionKey,
    } as Prisma.InputJsonValue,
    ...auditContextFromRequest(params.req),
  });
}
