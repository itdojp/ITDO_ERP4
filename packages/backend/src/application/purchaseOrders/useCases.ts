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

export type PurchaseOrderActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type PurchaseOrderApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type PurchaseOrderApplicationResult<T> =
  { ok: true; value: T } | PurchaseOrderApplicationFailure;

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.purchase_order;
  actionKey: string;
  targetTable: 'purchase_orders';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type PurchaseOrderApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
};

export type PurchaseOrderApplicationPortOverrides =
  Partial<PurchaseOrderApplicationPorts>;

const defaultPorts: PurchaseOrderApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
};

function ports(
  overrides?: PurchaseOrderApplicationPortOverrides,
): PurchaseOrderApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): PurchaseOrderApplicationResult<T> {
  return { ok: true, value };
}

function fail(
  statusCode: number,
  body: unknown,
): PurchaseOrderApplicationFailure {
  return { ok: false, statusCode, body };
}

function actionPolicyActor(actor: PurchaseOrderActorContext) {
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
}): PurchaseOrderApplicationFailure | null {
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
  ports: PurchaseOrderApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.purchase_order,
    actionKey: input.actionKey,
    targetTable: 'purchase_orders' as const,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

export async function submitPurchaseOrderForApproval(input: {
  id: string;
  body?: unknown;
  actor: PurchaseOrderActorContext;
  auditContext: AuditContext;
  ports?: PurchaseOrderApplicationPortOverrides;
}): Promise<PurchaseOrderApplicationResult<unknown>> {
  const p = ports(input.ports);
  const reasonText = reasonTextFromBody(input.body);
  const purchaseOrder = await p.db.purchaseOrder.findUnique({
    where: { id: input.id },
    select: { status: true, projectId: true },
  });
  if (purchaseOrder) {
    const policyRes = await p.evaluateActionPolicyWithFallback({
      flowType: FlowTypeValue.purchase_order,
      actionKey: 'submit',
      actor: actionPolicyActor(input.actor),
      reasonText,
      state: {
        status: purchaseOrder.status,
        projectId: purchaseOrder.projectId,
      },
      targetTable: 'purchase_orders',
      targetId: input.id,
    });
    const policyDenied = policyDeniedResponse({
      result: policyRes,
      reasonRequiredMessage: 'reasonText is required for override',
      deniedMessage: 'Purchase order cannot be submitted',
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
    flowType: FlowTypeValue.purchase_order,
    targetTable: 'purchase_orders',
    targetId: input.id,
    update: (tx) =>
      tx.purchaseOrder.update({
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
