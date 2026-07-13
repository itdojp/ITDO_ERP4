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
import { loadResolvedAnnotationReferenceState as defaultLoadResolvedAnnotationReferenceState } from '../../services/annotationReferences.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import { FlowTypeValue } from '../../types.js';

export type LeaveActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export type LeaveApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type LeaveApplicationResult<T> =
  { ok: true; value: T } | LeaveApplicationFailure;

export type LeavePolicyAuthorization = {
  policyApplied: boolean;
  matchedPolicyId: string | null;
  requireReason: boolean;
};

export type LeaveSubmitEvidenceState = {
  normalizedInternalRefs: Array<{ kind: string; refId: string }>;
  externalUrls: string[];
  hasAttachmentEvidence: boolean;
  hasConsultationEvidence: boolean;
};

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.leave;
  actionKey: 'submit';
  targetTable: 'leave_requests';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type LeaveApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: Omit<ActionPolicyAuditParams, 'reasonText'>,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  loadResolvedAnnotationReferenceState: typeof defaultLoadResolvedAnnotationReferenceState;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
};

export type LeaveApplicationPortOverrides = Partial<LeaveApplicationPorts>;

const defaultPorts: LeaveApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  loadResolvedAnnotationReferenceState:
    defaultLoadResolvedAnnotationReferenceState,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
};

function ports(
  overrides?: LeaveApplicationPortOverrides,
): LeaveApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): LeaveApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): LeaveApplicationFailure {
  return { ok: false, statusCode, body };
}

function normalizeReasonText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actionPolicyActor(actor: LeaveActorContext) {
  return {
    userId: actor.userId ?? null,
    roles: actor.roles,
    groupIds: actor.groupIds,
    groupAccountIds: actor.groupAccountIds,
  };
}

function policyDeniedResponse(
  result: EvaluateActionPolicyWithFallbackResult,
): LeaveApplicationFailure | null {
  if (!result.policyApplied || result.allowed) return null;
  if (result.reason === 'reason_required') {
    return fail(400, {
      error: {
        code: 'REASON_REQUIRED',
        message: 'reasonText is required for override',
        details: { matchedPolicyId: result.matchedPolicyId ?? null },
      },
    });
  }
  return fail(403, {
    error: {
      code: resolveActionPolicyDeniedCode(result),
      message: 'LeaveRequest cannot be submitted',
      details: {
        reason: result.reason,
        matchedPolicyId: result.matchedPolicyId ?? null,
        guardFailures: result.guardFailures ?? null,
      },
    },
  });
}

export async function authorizeLeaveSubmit(input: {
  id: string;
  status: string;
  reasonText?: string | null;
  actor: LeaveActorContext;
  auditContext: AuditContext;
  ports?: LeaveApplicationPortOverrides;
}): Promise<LeaveApplicationResult<LeavePolicyAuthorization>> {
  const p = ports(input.ports);
  const reasonText = normalizeReasonText(input.reasonText);
  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.leave,
    actionKey: 'submit',
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: { status: input.status },
    targetTable: 'leave_requests',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse(policyRes);
  if (policyDenied) return policyDenied;

  await p.logActionPolicyFallbackAllowed({
    auditContext: input.auditContext,
    flowType: FlowTypeValue.leave,
    actionKey: 'submit',
    targetTable: 'leave_requests',
    targetId: input.id,
    result: policyRes,
  });
  await p.logActionPolicyOverride({
    auditContext: input.auditContext,
    flowType: FlowTypeValue.leave,
    actionKey: 'submit',
    targetTable: 'leave_requests',
    targetId: input.id,
    reasonText,
    result: policyRes,
  });

  return ok({
    policyApplied: policyRes.policyApplied,
    matchedPolicyId: policyRes.policyApplied
      ? (policyRes.matchedPolicyId ?? null)
      : null,
    requireReason: policyRes.policyApplied
      ? (policyRes.requireReason ?? false)
      : false,
  });
}

export async function loadLeaveSubmitEvidence(input: {
  id: string;
  ports?: LeaveApplicationPortOverrides;
}): Promise<LeaveSubmitEvidenceState> {
  const p = ports(input.ports);
  const annotationState = await p.loadResolvedAnnotationReferenceState(
    p.db,
    'leave_request',
    input.id,
  );
  const normalizedInternalRefs = annotationState.internalRefs.map((ref) => ({
    kind: ref.kind,
    refId: ref.id,
  }));
  const externalUrls = annotationState.externalUrls;
  return {
    normalizedInternalRefs,
    externalUrls,
    hasAttachmentEvidence:
      externalUrls.length > 0 || normalizedInternalRefs.length > 0,
    hasConsultationEvidence: normalizedInternalRefs.some(
      (ref) => ref.kind === 'chat_message',
    ),
  };
}

export async function submitLeaveRequestForApproval(input: {
  id: string;
  leave: { hours: number | null };
  requestedLeaveMinutes: number;
  noConsultationUpdate: {
    noConsultationConfirmed: boolean | null;
    noConsultationReason: string | null;
  };
  actor: LeaveActorContext;
  ports?: LeaveApplicationPortOverrides;
}): Promise<Record<string, unknown>> {
  const p = ports(input.ports);
  const actorUserId = input.actor.userId || 'system';
  const { updated, approval } = await p.submitApprovalWithUpdate({
    flowType: FlowTypeValue.leave,
    targetTable: 'leave_requests',
    targetId: input.id,
    update: (tx) =>
      tx.leaveRequest.update({
        where: { id: input.id },
        data: { status: 'pending_manager', ...input.noConsultationUpdate },
      }),
    payload: {
      hours: input.leave.hours || 0,
      minutes: input.requestedLeaveMinutes,
    },
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
  return updated as Record<string, unknown>;
}
