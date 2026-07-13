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
import {
  findPeriodLock as defaultFindPeriodLock,
  toPeriodKey as defaultToPeriodKey,
} from '../../services/periodLock.js';
import { logReassignment as defaultLogReassignment } from '../../services/reassignmentLog.js';
import { getEditableDays as defaultGetEditableDays } from '../../services/worklogSetting.js';
import { DocStatusValue, FlowTypeValue, TimeStatusValue } from '../../types.js';
import { isWithinEditableDays, parseDateParam } from '../../utils/date.js';

export type TimeEntryActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type TimeEntryApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type TimeEntryApplicationResult<T> =
  { ok: true; value: T } | TimeEntryApplicationFailure;

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.time;
  actionKey: string;
  targetTable: 'time_entries';
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type TimeEntryApplicationPorts = {
  db: any;
  getEditableDays: typeof defaultGetEditableDays;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
  findPeriodLock: typeof defaultFindPeriodLock;
  toPeriodKey: typeof defaultToPeriodKey;
  logAudit: typeof defaultLogAudit;
  logReassignment: typeof defaultLogReassignment;
  now: () => Date;
};

export type TimeEntryApplicationPortOverrides =
  Partial<TimeEntryApplicationPorts>;

const defaultPorts: TimeEntryApplicationPorts = {
  db: defaultPrisma,
  getEditableDays: defaultGetEditableDays,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
  findPeriodLock: defaultFindPeriodLock,
  toPeriodKey: defaultToPeriodKey,
  logAudit: defaultLogAudit,
  logReassignment: defaultLogReassignment,
  now: () => new Date(),
};

function ports(
  overrides?: TimeEntryApplicationPortOverrides,
): TimeEntryApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): TimeEntryApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): TimeEntryApplicationFailure {
  return { ok: false, statusCode, body };
}

function isPrivileged(actor: TimeEntryActorContext): boolean {
  return actor.roles.includes('admin') || actor.roles.includes('mgmt');
}

function actionPolicyActor(actor: TimeEntryActorContext) {
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
}): TimeEntryApplicationFailure | null {
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
  ports: TimeEntryApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.time,
    actionKey: input.actionKey,
    targetTable: 'time_entries' as const,
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

async function resolveTaskIdForProject(
  taskId: unknown,
  projectId: unknown,
  p: TimeEntryApplicationPorts,
): Promise<TimeEntryApplicationResult<string>> {
  if (taskId == null) {
    return fail(400, {
      error: { code: 'INVALID_TASK', message: 'Task id is missing' },
    });
  }
  const trimmed = String(taskId).trim();
  if (!trimmed) {
    return fail(400, {
      error: { code: 'INVALID_TASK', message: 'Task id is empty' },
    });
  }
  const task = await p.db.projectTask.findUnique({
    where: { id: trimmed },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    return fail(400, {
      error: { code: 'INVALID_TASK', message: 'Task not found' },
    });
  }
  if (projectId && task.projectId !== projectId) {
    return fail(400, {
      error: {
        code: 'TASK_PROJECT_MISMATCH',
        message: 'Task does not belong to project',
      },
    });
  }
  return ok(trimmed);
}

async function resolveReassignTaskId(
  value: unknown,
  projectId: string,
  p: TimeEntryApplicationPorts,
): Promise<TimeEntryApplicationResult<string | null | undefined>> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  const trimmed = String(value).trim();
  if (!trimmed) return ok(null);
  const task = await p.db.projectTask.findUnique({
    where: { id: trimmed },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    return fail(400, {
      error: { code: 'INVALID_TASK', message: 'Task not found' },
    });
  }
  if (task.projectId !== projectId) {
    return fail(400, {
      error: {
        code: 'TASK_PROJECT_MISMATCH',
        message: 'Task does not belong to project',
      },
    });
  }
  return ok(trimmed);
}

export async function patchTimeEntry(input: {
  id: string;
  body: Record<string, unknown>;
  actor: TimeEntryActorContext;
  auditContext: AuditContext;
  ports?: TimeEntryApplicationPortOverrides;
}): Promise<TimeEntryApplicationResult<unknown>> {
  const p = ports(input.ports);
  const body = input.body ?? {};
  const reasonText = normalizeReasonText(body.reasonText);
  const { reasonText: _omitReason, ...rest } = body;
  const privileged = isPrivileged(input.actor);
  const userId = input.actor.userId;
  const where = privileged
    ? { id: input.id }
    : { id: input.id, userId: userId || 'unknown' };
  const before = await p.db.timeEntry.findFirst({ where });
  if (!before) {
    return fail(404, { error: 'not_found' });
  }
  if (!privileged) {
    const projectIds = input.actor.projectIds || [];
    if (!projectIds.length || !projectIds.includes(before.projectId)) {
      return fail(403, { error: 'forbidden_project' });
    }
  }
  if (before.billedInvoiceId) {
    const immutableFields = [
      'projectId',
      'taskId',
      'workDate',
      'minutes',
      'workType',
      'userId',
    ] as const;
    const hasImmutableUpdate = immutableFields.some(
      (field) => body[field] !== undefined,
    );
    if (hasImmutableUpdate) {
      return fail(400, {
        error: {
          code: 'BILLED',
          message: 'Time entry already billed and cannot be modified',
        },
      });
    }
  }

  const changed = ['minutes', 'workDate', 'taskId', 'projectId'].some(
    (key) => rest[key] !== undefined && rest[key] !== before[key],
  );
  const data = { ...rest } as Record<string, unknown>;
  if (!privileged) {
    data.userId = userId;
  }
  if (body.taskId !== undefined) {
    const resolved = await resolveTaskIdForProject(
      body.taskId,
      body.projectId ?? before.projectId,
      p,
    );
    if (!resolved.ok) return resolved;
    data.taskId = resolved.value;
  }
  if (rest.workDate !== undefined) {
    const parsed = parseDateParam(String(rest.workDate));
    if (!parsed) {
      return fail(400, {
        error: { code: 'INVALID_DATE', message: 'Invalid workDate' },
      });
    }
    data.workDate = parsed;
  }

  const editableDays = await p.getEditableDays();
  const now = p.now();
  const workDatesToCheck = [before.workDate, data.workDate ?? undefined].filter(
    (value): value is Date => value instanceof Date,
  );
  const isEditableByDate = workDatesToCheck.every((date) =>
    isWithinEditableDays(date, editableDays, now),
  );
  const projectIdsToCheck = Array.from(
    new Set(
      [before.projectId, data.projectId]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const closedProjects = projectIdsToCheck.length
    ? await p.db.project.findMany({
        where: { id: { in: projectIdsToCheck }, status: 'closed' },
        select: { id: true },
      })
    : [];
  const hasClosedProject = closedProjects.length > 0;

  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.time,
    actionKey: 'edit',
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: {
      status: before.status,
      projectIds: projectIdsToCheck,
      workDates: workDatesToCheck.map((date) => date.toISOString()),
    },
    targetTable: 'time_entries',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: 'Time entry cannot be modified',
  });
  if (policyDenied) return policyDenied;
  await auditPolicyResult({
    actionKey: 'edit',
    targetId: input.id,
    reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });

  if (!isEditableByDate || hasClosedProject) {
    if (!policyRes.policyApplied && !privileged) {
      return fail(403, {
        error: {
          code: 'WORKLOG_LOCKED',
          message: 'Time entry is locked for modification',
          details: {
            editableDays,
            editWindowExpired: !isEditableByDate,
            projectClosed: hasClosedProject,
          },
        },
      });
    }
    if (!policyRes.policyApplied && !reasonText) {
      return fail(400, {
        error: {
          code: 'REASON_REQUIRED',
          message: 'reasonText is required for override',
        },
      });
    }
    await p.logAudit({
      ...input.auditContext,
      action: 'time_entry_override',
      targetTable: 'time_entries',
      targetId: input.id,
      metadata: {
        editableDays,
        editWindowExpired: !isEditableByDate,
        projectClosed: hasClosedProject,
        actionPolicy: policyRes.policyApplied
          ? {
              matchedPolicyId: policyRes.matchedPolicyId,
              requireReason: policyRes.requireReason,
            }
          : { matchedPolicyId: null, requireReason: false },
      },
      reasonText: reasonText || undefined,
    });
  }

  if (changed) {
    data.status = TimeStatusValue.submitted;
    const actorUserId = userId || 'system';
    const { updated, approval } = await p.submitApprovalWithUpdate({
      flowType: FlowTypeValue.time,
      targetTable: 'time_entries',
      targetId: input.id,
      update: (tx) => tx.timeEntry.update({ where: { id: input.id }, data }),
      createdBy: userId ?? undefined,
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
    await p.logAudit({
      ...input.auditContext,
      action: 'time_entry_modified',
      targetTable: 'time_entries',
      targetId: input.id,
      metadata: { changedFields: Object.keys(rest) },
    });
    return ok(updated);
  }

  const entry = await p.db.timeEntry.update({
    where: { id: input.id },
    data,
  });
  return ok(entry);
}

export async function submitTimeEntry(input: {
  id: string;
  body?: Record<string, unknown> | null;
  actor: TimeEntryActorContext;
  auditContext: AuditContext;
  ports?: TimeEntryApplicationPortOverrides;
}): Promise<TimeEntryApplicationResult<unknown>> {
  const p = ports(input.ports);
  const body = input.body ?? {};
  const reasonText = normalizeReasonText(body.reasonText);
  const before = await p.db.timeEntry.findUnique({
    where: { id: input.id },
    select: { status: true, projectId: true, workDate: true },
  });
  if (before) {
    const policyRes = await p.evaluateActionPolicyWithFallback({
      flowType: FlowTypeValue.time,
      actionKey: 'submit',
      actor: actionPolicyActor(input.actor),
      reasonText,
      state: {
        status: before.status,
        projectId: before.projectId,
        workDate: before.workDate.toISOString(),
      },
      targetTable: 'time_entries',
      targetId: input.id,
    });
    const policyDenied = policyDeniedResponse({
      result: policyRes,
      reasonRequiredMessage: 'reasonText is required for override',
      deniedMessage: 'Time entry cannot be submitted',
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
  const entry = await p.db.timeEntry.update({
    where: { id: input.id },
    data: { status: TimeStatusValue.submitted },
  });
  return ok(entry);
}

export async function reassignTimeEntry(input: {
  id: string;
  body: Record<string, unknown>;
  actor: TimeEntryActorContext;
  auditContext: AuditContext;
  ports?: TimeEntryApplicationPortOverrides;
}): Promise<TimeEntryApplicationResult<unknown>> {
  const p = ports(input.ports);
  const body = input.body ?? {};
  const reasonText = normalizeReasonText(body.reasonText);
  if (!reasonText) {
    return fail(400, {
      error: { code: 'INVALID_REASON', message: 'reasonText is required' },
    });
  }
  const entry = await p.db.timeEntry.findUnique({ where: { id: input.id } });
  if (!entry) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Time entry not found' },
    });
  }
  if (entry.deletedAt) {
    return fail(400, {
      error: { code: 'ALREADY_DELETED', message: 'Time entry deleted' },
    });
  }
  if (entry.status === TimeStatusValue.approved) {
    return fail(400, {
      error: { code: 'INVALID_STATUS', message: 'Time entry approved' },
    });
  }
  if (entry.billedInvoiceId) {
    return fail(400, {
      error: {
        code: 'BILLED',
        message: 'Time entry already billed and cannot be reassigned',
      },
    });
  }

  const editableDays = await p.getEditableDays();
  const isEditableByDate = isWithinEditableDays(
    entry.workDate,
    editableDays,
    p.now(),
  );
  const toProjectId = String(body.toProjectId ?? '');
  const projectIdsToCheck = Array.from(
    new Set([entry.projectId, toProjectId].filter(Boolean)),
  );
  const closedProjects = projectIdsToCheck.length
    ? await p.db.project.findMany({
        where: { id: { in: projectIdsToCheck }, status: 'closed' },
        select: { id: true },
      })
    : [];
  const hasClosedProject = closedProjects.length > 0;
  const pendingApproval = await p.db.approvalInstance.findFirst({
    where: {
      targetTable: 'time_entries',
      targetId: input.id,
      status: {
        in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
      },
    },
    select: { id: true },
  });
  if (pendingApproval) {
    return fail(400, {
      error: { code: 'PENDING_APPROVAL', message: 'Approval in progress' },
    });
  }
  const targetProject = await p.db.project.findUnique({
    where: { id: toProjectId },
    select: { id: true, deletedAt: true },
  });
  if (!targetProject || targetProject.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project not found' },
    });
  }
  const periodKey = p.toPeriodKey(entry.workDate);
  const fromLock = await p.findPeriodLock(periodKey, entry.projectId, p.db);
  if (fromLock) {
    return fail(400, {
      error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
    });
  }
  if (toProjectId !== entry.projectId) {
    const toLock = await p.findPeriodLock(periodKey, toProjectId, p.db);
    if (toLock) {
      return fail(400, {
        error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
      });
    }
  }
  const resolvedTaskId = await resolveReassignTaskId(
    body.toTaskId,
    toProjectId,
    p,
  );
  if (!resolvedTaskId.ok) return resolvedTaskId;
  let nextTaskId = entry.taskId;
  if (resolvedTaskId.value !== undefined) {
    nextTaskId = resolvedTaskId.value;
  } else if (toProjectId !== entry.projectId) {
    nextTaskId = null;
  }
  const updated = await p.db.timeEntry.update({
    where: { id: input.id },
    data: { projectId: toProjectId, taskId: nextTaskId },
  });
  await p.logAudit({
    ...input.auditContext,
    action: 'reassignment',
    targetTable: 'time_entries',
    targetId: input.id,
    reasonCode: String(body.reasonCode ?? ''),
    reasonText,
    metadata: {
      fromProjectId: entry.projectId,
      toProjectId,
      fromTaskId: entry.taskId,
      toTaskId: nextTaskId,
      editableDays,
      editWindowExpired: !isEditableByDate,
      projectClosed: hasClosedProject,
    },
  });
  await p.logReassignment({
    targetTable: 'time_entries',
    targetId: input.id,
    fromProjectId: entry.projectId,
    toProjectId,
    fromTaskId: entry.taskId,
    toTaskId: nextTaskId,
    reasonCode: String(body.reasonCode ?? ''),
    reasonText,
    createdBy: input.actor.userId ?? undefined,
  });
  return ok(updated);
}
