import type { AuditContext } from '../../services/audit.js';
import { submitApprovalWithUpdate as defaultSubmitApprovalWithUpdate } from '../../services/approval.js';
import { createApprovalPendingNotifications as defaultCreateApprovalPendingNotifications } from '../../services/appNotifications.js';
import {
  evaluateActionPolicyWithFallback as defaultEvaluateActionPolicyWithFallback,
  type EvaluateActionPolicyWithFallbackResult,
} from '../../services/actionPolicy.js';
import {
  logActionPolicyFallbackAllowedForContextIfNeeded as defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverrideForContextIfNeeded as defaultLogActionPolicyOverride,
} from '../../services/actionPolicyAudit.js';
import { resolveActionPolicyDeniedCode } from '../../services/actionPolicyErrors.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import { DocStatusValue, FlowTypeValue } from '../../types.js';

export type EstimateActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type EstimateApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type EstimateApplicationResult<T> =
  { ok: true; value: T } | EstimateApplicationFailure;

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.estimate;
  actionKey: string;
  targetTable: 'estimates';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type EstimateApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
};

export type EstimateApplicationPortOverrides =
  Partial<EstimateApplicationPorts>;

const defaultPorts: EstimateApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
};

function ports(
  overrides?: EstimateApplicationPortOverrides,
): EstimateApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): EstimateApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): EstimateApplicationFailure {
  return { ok: false, statusCode, body };
}

function actionPolicyActor(actor: EstimateActorContext) {
  return {
    userId: actor.userId ?? null,
    roles: actor.roles,
    groupIds: actor.groupIds,
    groupAccountIds: actor.groupAccountIds,
  };
}

function normalizeReasonText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function reasonTextFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  return normalizeReasonText((body as { reasonText?: unknown }).reasonText);
}

function policyDeniedResponse(input: {
  result: EvaluateActionPolicyWithFallbackResult;
  reasonRequiredMessage: string;
  deniedMessage: string;
}): EstimateApplicationFailure | null {
  const { result } = input;
  if (!result.policyApplied || result.allowed) return null;
  if (result.reason === 'reason_required') {
    return fail(400, {
      error: {
        code: 'REASON_REQUIRED',
        message: input.reasonRequiredMessage,
        details: { matchedPolicyId: result.matchedPolicyId ?? null },
      },
    });
  }
  return fail(403, {
    error: {
      code: resolveActionPolicyDeniedCode(result),
      message: input.deniedMessage,
      details: {
        reason: result.reason,
        matchedPolicyId: result.matchedPolicyId ?? null,
        guardFailures: result.guardFailures ?? null,
      },
    },
  });
}

async function auditPolicyResult(input: {
  actionKey: string;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
  auditContext: AuditContext;
  ports: EstimateApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.estimate,
    actionKey: input.actionKey,
    targetTable: 'estimates' as const,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

export async function submitEstimateForApproval(input: {
  id: string;
  body?: unknown;
  actor: EstimateActorContext;
  auditContext: AuditContext;
  ports?: EstimateApplicationPortOverrides;
}): Promise<EstimateApplicationResult<unknown>> {
  const p = ports(input.ports);
  const reasonText = reasonTextFromBody(input.body);
  const estimate = await p.db.estimate.findUnique({
    where: { id: input.id },
    select: { status: true, projectId: true },
  });
  if (estimate) {
    const policyRes = await p.evaluateActionPolicyWithFallback({
      flowType: FlowTypeValue.estimate,
      actionKey: 'submit',
      actor: actionPolicyActor(input.actor),
      reasonText,
      state: { status: estimate.status, projectId: estimate.projectId },
      targetTable: 'estimates',
      targetId: input.id,
    });
    const policyDenied = policyDeniedResponse({
      result: policyRes,
      reasonRequiredMessage: 'reasonText is required for override',
      deniedMessage: 'Estimate cannot be submitted',
    });
    if (policyDenied) return policyDenied;
    await auditPolicyResult({
      actionKey: 'submit',
      targetId: input.id,
      reasonText,
      result: policyRes,
      auditContext: input.auditContext,
      ports: p,
    });
  }

  const actorUserId = input.actor.userId || 'system';
  const { updated, approval } = await p.submitApprovalWithUpdate({
    flowType: FlowTypeValue.estimate,
    targetTable: 'estimates',
    targetId: input.id,
    update: (tx) =>
      tx.estimate.update({
        where: { id: input.id },
        data: { status: DocStatusValue.pending_qa },
      }),
    createdBy: input.actor.userId ?? undefined,
  });
  await p.createApprovalPendingNotifications({
    approvalInstanceId: approval.id,
    projectId: approval.projectId,
    requesterUserId: actorUserId,
    actorUserId,
    flowType: approval.flowType,
    targetTable: approval.targetTable,
    targetId: approval.targetId,
    currentStep: approval.currentStep,
    steps: approval.steps,
  });
  return ok(updated);
}
