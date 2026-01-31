import { prisma } from './db.js';
import { DocStatusValue, type FlowType } from '../types.js';
import { findPeriodLock, toPeriodKey } from './periodLock.js';
import { getEditableDays } from './worklogSetting.js';
import { isWithinEditableDays, parseDateParam } from '../utils/date.js';

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
  return { ...res, policyApplied: true } as const;
}
