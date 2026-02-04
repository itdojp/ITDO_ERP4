import { prisma } from './db.js';
import { DocStatusValue, type FlowType } from '../types.js';
import { findPeriodLock, toPeriodKey } from './periodLock.js';
import { getEditableDays } from './worklogSetting.js';
import { isWithinEditableDays, parseDateParam } from '../utils/date.js';
import { isAllowedChatAckLinkTargetTable } from './chatAckLinkTargets.js';

export type ActionPolicyActor = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds?: string[];
};

export type ActionPolicyGuardFailure = {
  type: string;
  reason: string;
  details?: unknown;
};

export type EvaluateActionPolicyInput = {
  flowType: FlowType;
  actionKey: string;
  actor: ActionPolicyActor;
  state?: unknown;
  reasonText?: string;
  targetTable?: string;
  targetId?: string;
};

export type EvaluateActionPolicyResult =
  | {
      allowed: true;
      matchedPolicyId: string;
      requireReason: boolean;
      guardFailures?: ActionPolicyGuardFailure[];
      guardOverride?: boolean;
    }
  | {
      allowed: false;
      reason: string;
      matchedPolicyId?: string;
      requireReason?: boolean;
      guardFailures?: ActionPolicyGuardFailure[];
    };

export type EvaluateActionPolicyWithFallbackResult =
  | (EvaluateActionPolicyResult & { policyApplied: true })
  | { allowed: true; policyApplied: false };

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function matchesSubjects(subjects: unknown, actor: ActionPolicyActor): boolean {
  // OR semantics: if any of roles/groupIds/userIds matches, the policy matches.
  if (!subjects || typeof subjects !== 'object') return true;
  const obj = subjects as Record<string, unknown>;
  const roles = normalizeStringArray(obj.roles);
  const groupIds = normalizeStringArray(obj.groupIds);
  const userIds = normalizeStringArray(obj.userIds);
  const hasAny = roles.length || groupIds.length || userIds.length;
  if (!hasAny) return true;

  if (roles.length && roles.some((role) => actor.roles.includes(role)))
    return true;
  if (groupIds.length) {
    const actorGroupIds = normalizeStringArray(actor.groupIds);
    if (groupIds.some((groupId) => actorGroupIds.includes(groupId)))
      return true;
    const actorGroupAccountIds = normalizeStringArray(
      actor.groupAccountIds ?? [],
    );
    if (
      actorGroupAccountIds.length &&
      groupIds.some((groupId) => actorGroupAccountIds.includes(groupId))
    )
      return true;
  }
  if (userIds.length && actor.userId && userIds.includes(actor.userId))
    return true;
  return false;
}

function matchesStateConstraints(stateConstraints: unknown, state: unknown) {
  if (!stateConstraints || typeof stateConstraints !== 'object') return true;
  if (!state || typeof state !== 'object') return true;
  const constraints = stateConstraints as Record<string, unknown>;
  const current = state as Record<string, unknown>;
  const status = normalizeString(current.status);

  const statusIn = normalizeStringArray(constraints.statusIn);
  if (statusIn.length && !statusIn.includes(status)) return false;
  const statusNotIn = normalizeStringArray(constraints.statusNotIn);
  if (statusNotIn.length && statusNotIn.includes(status)) return false;
  return true;
}

type GuardEvalContext = {
  client: any;
  flowType: FlowType;
  state?: unknown;
  targetTable?: string;
  targetId?: string;
  now: Date;
};

async function evaluateChatAckCompletedGuard(ctx: GuardEvalContext) {
  const targetTable = normalizeString(ctx.targetTable);
  const targetId = normalizeString(ctx.targetId);
  if (!targetTable || !targetId) {
    return {
      ok: false,
      failure: {
        type: 'chat_ack_completed',
        reason: 'target_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }
  if (!isAllowedChatAckLinkTargetTable(targetTable)) {
    return {
      ok: false,
      failure: {
        type: 'chat_ack_completed',
        reason: 'unsupported_target',
        details: { targetTable },
      } satisfies ActionPolicyGuardFailure,
    };
  }

  const links = await ctx.client.chatAckLink.findMany({
    where: { targetTable, targetId },
    select: { ackRequestId: true },
  });
  if (!links.length) {
    return {
      ok: false,
      failure: {
        type: 'chat_ack_completed',
        reason: 'missing_link',
        details: { targetTable, targetId },
      } satisfies ActionPolicyGuardFailure,
    };
  }

  const ackRequestIds = Array.from(
    new Set(
      links
        .map((link: { ackRequestId?: unknown }) =>
          normalizeString(link.ackRequestId),
        )
        .filter(Boolean),
    ),
  );
  if (!ackRequestIds.length) {
    return {
      ok: false,
      failure: {
        type: 'chat_ack_completed',
        reason: 'missing_link',
        details: { targetTable, targetId },
      } satisfies ActionPolicyGuardFailure,
    };
  }

  const requests = await ctx.client.chatAckRequest.findMany({
    where: { id: { in: ackRequestIds } },
    select: {
      id: true,
      requiredUserIds: true,
      dueAt: true,
      canceledAt: true,
      message: { select: { deletedAt: true } },
      acks: { select: { userId: true } },
    },
  });
  const requestMap = new Map(
    requests.map((request: { id: string }) => [request.id, request]),
  );
  const missingRequestIds = ackRequestIds.filter((id) => !requestMap.has(id));

  const failures: Array<Record<string, unknown>> = [];
  for (const request of requests) {
    if (!request.message) {
      failures.push({ id: request.id, reason: 'message_missing' });
      continue;
    }
    if (request.message?.deletedAt) {
      failures.push({ id: request.id, reason: 'message_deleted' });
      continue;
    }
    if (request.canceledAt) {
      failures.push({ id: request.id, reason: 'canceled' });
      continue;
    }
    const requiredUserIds = normalizeStringArray(request.requiredUserIds);
    if (!requiredUserIds.length) {
      failures.push({ id: request.id, reason: 'required_users_empty' });
      continue;
    }
    const ackedUserIds = new Set(
      (request.acks ?? [])
        .map((ack: { userId?: unknown }) => normalizeString(ack.userId))
        .filter(Boolean),
    );
    const incompleteUserIds = requiredUserIds.filter(
      (userId) => !ackedUserIds.has(userId),
    );
    if (!incompleteUserIds.length) continue;
    const expired =
      request.dueAt && request.dueAt.getTime() < ctx.now.getTime();
    failures.push({
      id: request.id,
      reason: expired ? 'expired' : 'incomplete',
      dueAt: request.dueAt ? request.dueAt.toISOString() : null,
      requiredCount: requiredUserIds.length,
      ackedCount: requiredUserIds.length - incompleteUserIds.length,
      incompleteUserIds: incompleteUserIds.slice(0, 20),
      incompleteTruncated: incompleteUserIds.length > 20,
    });
  }

  if (missingRequestIds.length || failures.length) {
    return {
      ok: false,
      failure: {
        type: 'chat_ack_completed',
        reason: 'incomplete',
        details: {
          targetTable,
          targetId,
          missingAckRequestIds: missingRequestIds,
          requests: failures,
        },
      } satisfies ActionPolicyGuardFailure,
    };
  }

  return { ok: true } as const;
}

async function evaluateApprovalOpenGuard(ctx: GuardEvalContext) {
  const targetTable = normalizeString(ctx.targetTable);
  const targetId = normalizeString(ctx.targetId);
  if (!targetTable || !targetId) {
    return {
      ok: false,
      failure: {
        type: 'approval_open',
        reason: 'target_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }
  const open = await ctx.client.approvalInstance.findFirst({
    where: {
      flowType: ctx.flowType,
      targetTable,
      targetId,
      status: { in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec] },
    },
    select: { id: true, status: true },
  });
  if (open) {
    return {
      ok: false,
      failure: {
        type: 'approval_open',
        reason: 'approval_in_progress',
        details: { approvalInstanceId: open.id, status: open.status },
      } satisfies ActionPolicyGuardFailure,
    };
  }
  return { ok: true } as const;
}

function extractProjectIds(state: unknown): string[] {
  if (!state || typeof state !== 'object') return [];
  const obj = state as Record<string, unknown>;
  const ids = new Set<string>();
  const projectId = normalizeString(obj.projectId);
  if (projectId) ids.add(projectId);
  for (const id of normalizeStringArray(obj.projectIds)) ids.add(id);
  return Array.from(ids);
}

function extractWorkDates(state: unknown): Date[] {
  if (!state || typeof state !== 'object') return [];
  const obj = state as Record<string, unknown>;
  const dates: Date[] = [];

  const workDateRaw = normalizeString(obj.workDate);
  const parsed = parseDateParam(workDateRaw);
  if (parsed) dates.push(parsed);

  const workDatesRaw = Array.isArray(obj.workDates) ? obj.workDates : [];
  for (const item of workDatesRaw) {
    const raw = normalizeString(item);
    const parsedItem = parseDateParam(raw);
    if (parsedItem) dates.push(parsedItem);
  }

  return dates;
}

function extractPeriodKeys(state: unknown): string[] {
  if (!state || typeof state !== 'object') return [];
  const obj = state as Record<string, unknown>;
  const keys = new Set<string>();
  const periodKey = normalizeString(obj.periodKey);
  if (periodKey) keys.add(periodKey);
  for (const key of normalizeStringArray(obj.periodKeys)) keys.add(key);
  return Array.from(keys);
}

async function evaluateProjectClosedGuard(ctx: GuardEvalContext) {
  const projectIds = extractProjectIds(ctx.state);
  if (!projectIds.length) {
    return {
      ok: false,
      failure: {
        type: 'project_closed',
        reason: 'project_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }

  const closedProjects = await ctx.client.project.findMany({
    where: { id: { in: projectIds }, status: 'closed' },
    select: { id: true },
  });
  if (closedProjects.length) {
    return {
      ok: false,
      failure: {
        type: 'project_closed',
        reason: 'project_is_closed',
        details: {
          projectIds,
          closedProjectIds: closedProjects.map((p: { id: string }) => p.id),
        },
      } satisfies ActionPolicyGuardFailure,
    };
  }

  return { ok: true } as const;
}

async function evaluatePeriodLockGuard(ctx: GuardEvalContext) {
  const projectIds = extractProjectIds(ctx.state);
  if (!projectIds.length) {
    return {
      ok: false,
      failure: {
        type: 'period_lock',
        reason: 'project_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }

  const periodKeys = new Set<string>();
  for (const key of extractPeriodKeys(ctx.state)) periodKeys.add(key);
  for (const date of extractWorkDates(ctx.state))
    periodKeys.add(toPeriodKey(date));

  if (!periodKeys.size) {
    return {
      ok: false,
      failure: {
        type: 'period_lock',
        reason: 'period_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }

  // For multiple periodKeys/projectIds we avoid periodKeys x projectIds DB queries by batching.
  const periodKeyList = Array.from(periodKeys);
  if (periodKeyList.length === 1 && projectIds.length === 1) {
    const periodKey = periodKeyList[0];
    const projectId = projectIds[0];
    const lock = await findPeriodLock(periodKey, projectId, ctx.client);
    if (lock) {
      return {
        ok: false,
        failure: {
          type: 'period_lock',
          reason: 'period_locked',
          details: { periodKey, projectId, lock },
        } satisfies ActionPolicyGuardFailure,
      };
    }
    return { ok: true } as const;
  }

  const locks = await ctx.client.periodLock.findMany({
    where: {
      period: { in: periodKeyList },
      OR: [
        { scope: 'global' },
        { scope: 'project', projectId: { in: projectIds } },
      ],
    },
    select: { id: true, scope: true, projectId: true, period: true },
  });

  const globalLockByPeriod = new Map<string, any>();
  const projectLockByKey = new Map<string, any>();
  for (const lock of locks) {
    if (lock.scope === 'global') {
      globalLockByPeriod.set(lock.period, lock);
      continue;
    }
    if (lock.scope === 'project' && typeof lock.projectId === 'string') {
      projectLockByKey.set(`${lock.period}|${lock.projectId}`, lock);
    }
  }

  for (const periodKey of periodKeyList) {
    const globalLock = globalLockByPeriod.get(periodKey);
    if (globalLock) {
      const projectId = projectIds[0];
      return {
        ok: false,
        failure: {
          type: 'period_lock',
          reason: 'period_locked',
          details: { periodKey, projectId, lock: globalLock },
        } satisfies ActionPolicyGuardFailure,
      };
    }
    for (const projectId of projectIds) {
      const lock = projectLockByKey.get(`${periodKey}|${projectId}`);
      if (lock) {
        return {
          ok: false,
          failure: {
            type: 'period_lock',
            reason: 'period_locked',
            details: { periodKey, projectId, lock },
          } satisfies ActionPolicyGuardFailure,
        };
      }
    }
  }

  return { ok: true } as const;
}

async function evaluateEditableDaysGuard(ctx: GuardEvalContext) {
  const workDates = extractWorkDates(ctx.state);
  if (!workDates.length) {
    return {
      ok: false,
      failure: {
        type: 'editable_days',
        reason: 'workDate_required',
      } satisfies ActionPolicyGuardFailure,
    };
  }
  const editableDays = await getEditableDays(ctx.client);
  const violations = workDates
    .filter((date) => !isWithinEditableDays(date, editableDays, ctx.now))
    .map((date) => date.toISOString());
  if (violations.length) {
    return {
      ok: false,
      failure: {
        type: 'editable_days',
        reason: 'edit_window_expired',
        details: { editableDays, violations },
      } satisfies ActionPolicyGuardFailure,
    };
  }
  return { ok: true } as const;
}

async function evaluateGuards(guards: unknown, ctx: GuardEvalContext) {
  if (guards == null) return { ok: true } as const;
  if (!Array.isArray(guards)) {
    return {
      ok: false,
      failures: [
        {
          type: 'guards',
          reason: 'invalid_schema',
        } satisfies ActionPolicyGuardFailure,
      ],
    };
  }

  const failures: ActionPolicyGuardFailure[] = [];
  for (const item of guards) {
    if (!item || typeof item !== 'object') {
      failures.push({ type: 'guard', reason: 'invalid_item' });
      continue;
    }
    const guard = item as Record<string, unknown>;
    const type = normalizeString(guard.type);
    if (!type) {
      failures.push({ type: 'guard', reason: 'type_required' });
      continue;
    }
    if (type === 'approval_open') {
      const res = await evaluateApprovalOpenGuard(ctx);
      if (!res.ok) failures.push(res.failure);
      continue;
    }
    if (type === 'project_closed') {
      const res = await evaluateProjectClosedGuard(ctx);
      if (!res.ok) failures.push(res.failure);
      continue;
    }
    if (type === 'period_lock') {
      const res = await evaluatePeriodLockGuard(ctx);
      if (!res.ok) failures.push(res.failure);
      continue;
    }
    if (type === 'editable_days') {
      const res = await evaluateEditableDaysGuard(ctx);
      if (!res.ok) failures.push(res.failure);
      continue;
    }
    if (type === 'chat_ack_completed') {
      const res = await evaluateChatAckCompletedGuard(ctx);
      if (!res.ok) failures.push(res.failure);
      continue;
    }
    failures.push({ type, reason: 'unknown_guard_type' });
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true } as const;
}

export async function evaluateActionPolicy(
  input: EvaluateActionPolicyInput,
  options?: { client?: any },
): Promise<EvaluateActionPolicyResult> {
  const actionKey = normalizeString(input.actionKey);
  const reasonText = normalizeString(input.reasonText);
  const client = options?.client ?? prisma;

  const policies = await client.actionPolicy.findMany({
    where: { flowType: input.flowType, actionKey, isEnabled: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  const now = new Date();

  let firstMatchedPolicyId: string | undefined;
  let firstMatchedGuardFailures: ActionPolicyGuardFailure[] | undefined;

  for (const policy of policies) {
    if (!matchesStateConstraints(policy.stateConstraints, input.state))
      continue;
    if (!matchesSubjects(policy.subjects, input.actor)) continue;

    const guardRes = await evaluateGuards(policy.guards, {
      client,
      flowType: input.flowType,
      state: input.state,
      targetTable: input.targetTable,
      targetId: input.targetId,
      now,
    });
    if (!guardRes.ok) {
      if (!firstMatchedPolicyId) {
        firstMatchedPolicyId = policy.id;
        firstMatchedGuardFailures = guardRes.failures;
      }
      continue;
    }

    // requireReason is treated as a hard requirement (no fallback to lower policies).
    if (policy.requireReason && !reasonText) {
      return {
        allowed: false,
        reason: 'reason_required',
        matchedPolicyId: policy.id,
        requireReason: true,
      };
    }

    return {
      allowed: true,
      matchedPolicyId: policy.id,
      requireReason: policy.requireReason,
    };
  }

  if (firstMatchedPolicyId) {
    return {
      allowed: false,
      reason: 'guard_failed',
      matchedPolicyId: firstMatchedPolicyId,
      guardFailures: firstMatchedGuardFailures,
    };
  }

  return { allowed: false, reason: 'no_matching_policy' };
}

/**
 * Transitional helper for Phase 3 route migration:
 * - If no ActionPolicy exists, keep legacy behavior by allowing the action.
 * - If an ActionPolicy exists, enforce its decision.
 */
export async function evaluateActionPolicyWithFallback(
  input: EvaluateActionPolicyInput,
  options?: { client?: any },
): Promise<EvaluateActionPolicyWithFallbackResult> {
  const res = await evaluateActionPolicy(input, options);
  if (res.allowed) return { ...res, policyApplied: true } as const;
  if (res.reason === 'no_matching_policy') {
    return { allowed: true, policyApplied: false } as const;
  }
  const guardFailures = res.guardFailures ?? [];
  const isPrivileged = input.actor.roles.some(
    (role) => role === 'admin' || role === 'mgmt',
  );
  const reasonText = normalizeString(input.reasonText);
  const isAckGuardOnly =
    guardFailures.length > 0 &&
    guardFailures.every((failure) => failure.type === 'chat_ack_completed');
  if (res.reason === 'guard_failed' && isPrivileged && isAckGuardOnly) {
    if (!reasonText) {
      return {
        allowed: false,
        reason: 'reason_required',
        matchedPolicyId: res.matchedPolicyId,
        requireReason: true,
        guardFailures,
        policyApplied: true,
      } as const;
    }
    return {
      allowed: true,
      matchedPolicyId: res.matchedPolicyId ?? '',
      requireReason: true,
      guardFailures,
      guardOverride: true,
      policyApplied: true,
    } as const;
  }
  return { ...res, policyApplied: true } as const;
}
