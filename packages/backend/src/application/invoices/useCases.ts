import type { AuditContext } from '../../services/audit.js';
import { logAudit as defaultLogAudit } from '../../services/audit.js';
import { submitApprovalWithUpdate as defaultSubmitApprovalWithUpdate } from '../workflow/submitApproval.js';
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

export type InvoiceActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type InvoiceApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type InvoiceApplicationResult<T> =
  { ok: true; value: T } | InvoiceApplicationFailure;

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.invoice;
  actionKey: string;
  targetTable: 'invoices';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type InvoiceApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
  logAudit: typeof defaultLogAudit;
};

export type InvoiceApplicationPortOverrides = Partial<InvoiceApplicationPorts>;

const defaultPorts: InvoiceApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
  logAudit: defaultLogAudit,
};

function ports(
  overrides?: InvoiceApplicationPortOverrides,
): InvoiceApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): InvoiceApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): InvoiceApplicationFailure {
  return { ok: false, statusCode, body };
}

function actionPolicyActor(actor: InvoiceActorContext) {
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

function policyDeniedResponse(input: {
  result: EvaluateActionPolicyWithFallbackResult;
  reasonRequiredMessage: string;
  deniedMessage: string;
}): InvoiceApplicationFailure | null {
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
  ports: InvoiceApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.invoice,
    actionKey: input.actionKey,
    targetTable: 'invoices' as const,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

export async function submitInvoiceForApproval(input: {
  id: string;
  body?: Record<string, unknown> | null;
  actor: InvoiceActorContext;
  auditContext: AuditContext;
  ports?: InvoiceApplicationPortOverrides;
}): Promise<InvoiceApplicationResult<unknown>> {
  const p = ports(input.ports);
  const body = input.body ?? {};
  const reasonText = normalizeReasonText(body.reasonText);
  const invoice = await p.db.invoice.findUnique({
    where: { id: input.id },
    select: { status: true, projectId: true },
  });
  if (invoice) {
    const policyRes = await p.evaluateActionPolicyWithFallback({
      flowType: FlowTypeValue.invoice,
      actionKey: 'submit',
      actor: actionPolicyActor(input.actor),
      reasonText,
      state: { status: invoice.status, projectId: invoice.projectId },
      targetTable: 'invoices',
      targetId: input.id,
    });
    const policyDenied = policyDeniedResponse({
      result: policyRes,
      reasonRequiredMessage: 'reasonText is required for override',
      deniedMessage: 'Invoice cannot be submitted',
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
    flowType: FlowTypeValue.invoice,
    targetTable: 'invoices',
    targetId: input.id,
    update: (tx) =>
      tx.invoice.update({
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

export async function markInvoicePaid(input: {
  id: string;
  paidAt: Date;
  reasonText?: string | null;
  actor: InvoiceActorContext;
  auditContext: AuditContext;
  ports?: InvoiceApplicationPortOverrides;
}): Promise<InvoiceApplicationResult<unknown>> {
  const p = ports(input.ports);
  const reasonText = normalizeReasonText(input.reasonText);
  const invoice = await p.db.invoice.findUnique({ where: { id: input.id } });
  if (!invoice || invoice.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Invoice not found' },
    });
  }

  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.invoice,
    actionKey: 'mark_paid',
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: { status: invoice.status, projectId: invoice.projectId },
    targetTable: 'invoices',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: 'Invoice cannot be marked as paid',
  });
  if (policyDenied) return policyDenied;
  await auditPolicyResult({
    actionKey: 'mark_paid',
    targetId: input.id,
    reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });

  if (
    invoice.status === DocStatusValue.cancelled ||
    invoice.status === DocStatusValue.rejected
  ) {
    return fail(409, {
      error: {
        code: 'INVALID_STATUS',
        message: 'Invoice cannot be marked as paid',
      },
    });
  }
  const actorId = input.actor.userId || 'system';
  const updated = await p.db.invoice.update({
    where: { id: input.id },
    data: {
      status: DocStatusValue.paid,
      paidAt: input.paidAt,
      paidBy: actorId,
      updatedBy: actorId,
    },
    include: { lines: true },
  });
  await p.logAudit({
    ...input.auditContext,
    action: 'invoice_mark_paid',
    targetTable: 'Invoice',
    targetId: input.id,
    reasonText: reasonText || undefined,
    metadata: {
      previousStatus: invoice.status,
      paidAt: updated.paidAt?.toISOString(),
      paidBy: updated.paidBy ?? null,
    },
  });
  return ok(updated);
}
