import { prisma } from './db.js';
import { DocStatusValue, type FlowType } from '../types.js';

export type ActionPolicyActor = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
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
  if (
    groupIds.length &&
    groupIds.some((groupId) => actor.groupIds.includes(groupId))
  )
    return true;
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
  targetTable?: string;
  targetId?: string;
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

  let firstMatchedPolicyId: string | undefined;
  let firstMatchedGuardFailures: ActionPolicyGuardFailure[] | undefined;

  for (const policy of policies) {
    if (!matchesStateConstraints(policy.stateConstraints, input.state))
      continue;
    if (!matchesSubjects(policy.subjects, input.actor)) continue;

    const guardRes = await evaluateGuards(policy.guards, {
      client,
      flowType: input.flowType,
      targetTable: input.targetTable,
      targetId: input.targetId,
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
