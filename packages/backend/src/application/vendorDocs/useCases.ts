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

export type VendorInvoiceActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type VendorInvoiceActionKey =
  'submit' | 'update_allocations' | 'update_lines' | 'link_po' | 'unlink_po';

export type VendorInvoiceApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type VendorInvoiceApplicationResult<T> =
  { ok: true; value: T } | VendorInvoiceApplicationFailure;

export type VendorInvoicePolicyAuditMetadata = {
  matchedPolicyId: string | null;
  requireReason: boolean;
};

export type VendorInvoicePolicyAuthorization = {
  policyApplied: boolean;
  requiresLegacyReason: boolean;
  auditMetadata: VendorInvoicePolicyAuditMetadata;
};

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.vendor_invoice;
  actionKey: VendorInvoiceActionKey;
  targetTable: 'vendor_invoices';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type VendorInvoiceApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
};

export type VendorInvoiceApplicationPortOverrides =
  Partial<VendorInvoiceApplicationPorts>;

const defaultPorts: VendorInvoiceApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
};

function ports(
  overrides?: VendorInvoiceApplicationPortOverrides,
): VendorInvoiceApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): VendorInvoiceApplicationResult<T> {
  return { ok: true, value };
}

function fail(
  statusCode: number,
  body: unknown,
): VendorInvoiceApplicationFailure {
  return { ok: false, statusCode, body };
}

function actionPolicyActor(actor: VendorInvoiceActorContext) {
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

function isVendorInvoicePreSubmitStatus(status: string) {
  // VendorInvoice is created in `received` status. Some legacy flows may still use `draft`.
  // When rejected, the invoice is typically returned for correction (treated as editable in normal operations).
  return (
    status === DocStatusValue.received ||
    status === DocStatusValue.draft ||
    status === DocStatusValue.rejected
  );
}

function policyDeniedResponse(input: {
  result: EvaluateActionPolicyWithFallbackResult;
  reasonRequiredMessage: string;
  deniedMessage: string;
}): VendorInvoiceApplicationFailure | null {
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

function policyAuditMetadata(
  result: EvaluateActionPolicyWithFallbackResult,
): VendorInvoicePolicyAuditMetadata {
  return result.policyApplied
    ? {
        matchedPolicyId: result.matchedPolicyId ?? null,
        requireReason: result.requireReason ?? false,
      }
    : { matchedPolicyId: null, requireReason: false };
}

async function auditPolicyResult(input: {
  actionKey: VendorInvoiceActionKey;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
  auditContext: AuditContext;
  ports: VendorInvoiceApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.vendor_invoice,
    actionKey: input.actionKey,
    targetTable: 'vendor_invoices' as const,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

export async function authorizeVendorInvoiceAction(input: {
  id: string;
  actionKey: VendorInvoiceActionKey;
  status: string;
  projectId: string;
  reasonText?: string | null;
  actor: VendorInvoiceActorContext;
  auditContext: AuditContext;
  deniedMessage: string;
  ports?: VendorInvoiceApplicationPortOverrides;
}): Promise<VendorInvoiceApplicationResult<VendorInvoicePolicyAuthorization>> {
  const p = ports(input.ports);
  const reasonText = normalizeReasonText(input.reasonText);
  // action-policy-static-callsites: vendor_invoice:submit,vendor_invoice:update_allocations,vendor_invoice:update_lines,vendor_invoice:link_po,vendor_invoice:unlink_po
  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.vendor_invoice,
    actionKey: input.actionKey,
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: { status: input.status, projectId: input.projectId },
    targetTable: 'vendor_invoices',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: input.deniedMessage,
  });
  if (policyDenied) return policyDenied;
  await auditPolicyResult({
    actionKey: input.actionKey,
    targetId: input.id,
    reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });
  return ok({
    policyApplied: policyRes.policyApplied,
    requiresLegacyReason:
      !policyRes.policyApplied && !isVendorInvoicePreSubmitStatus(input.status),
    auditMetadata: policyAuditMetadata(policyRes),
  });
}

export async function submitVendorInvoiceForApproval(input: {
  id: string;
  body?: unknown;
  actor: VendorInvoiceActorContext;
  auditContext: AuditContext;
  ports?: VendorInvoiceApplicationPortOverrides;
}): Promise<VendorInvoiceApplicationResult<unknown>> {
  const p = ports(input.ports);
  const reasonText = reasonTextFromBody(input.body);
  const vendorInvoice = await p.db.vendorInvoice.findUnique({
    where: { id: input.id },
    select: { status: true, projectId: true },
  });
  if (vendorInvoice) {
    const authorization = await authorizeVendorInvoiceAction({
      id: input.id,
      actionKey: 'submit',
      status: vendorInvoice.status,
      projectId: vendorInvoice.projectId,
      reasonText,
      actor: input.actor,
      auditContext: input.auditContext,
      deniedMessage: 'VendorInvoice cannot be submitted',
      ports: p,
    });
    if (!authorization.ok) return authorization;
  }

  const actorUserId = input.actor.userId || 'system';
  const { updated, approval } = await p.submitApprovalWithUpdate({
    flowType: FlowTypeValue.vendor_invoice,
    targetTable: 'vendor_invoices',
    targetId: input.id,
    update: (tx) =>
      tx.vendorInvoice.update({
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
