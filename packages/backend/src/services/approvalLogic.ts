import { DocStatusValue } from '../types.js';

export type ApprovalStep = {
  approverGroupId?: string;
  approverUserId?: string;
  stepOrder?: number;
};

export type ApprovalRuleStep = ApprovalStep & {
  parallelKey?: string;
};

export type ApprovalCondition = {
  amountMin?: number;
  amountMax?: number;
  skipUnder?: number;
  execThreshold?: number;
  isRecurring?: boolean;
  projectType?: string;
  customerId?: string;
  orgUnitId?: string;
  flowFlags?: Record<string, boolean> | string[];
  minAmount?: number;
  maxAmount?: number;
  skipSmallUnder?: number;
  appliesTo?: string[];
};

export function resolvePendingStatus(
  steps: Array<{ stepOrder?: number; approverGroupId?: string }>,
  stepOrder: number | null,
) {
  if (!stepOrder) return DocStatusValue.pending_qa;
  const isExec = steps.some(
    (step) => step.stepOrder === stepOrder && step.approverGroupId === 'exec',
  );
  return isExec ? DocStatusValue.pending_exec : DocStatusValue.pending_qa;
}

export function extractAmount(payload: Record<string, unknown>): number {
  const raw = payload.totalAmount ?? payload.amount ?? 0;
  const amount = typeof raw === 'string' ? Number(raw) : Number(raw || 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function normalizeFlowFlags(
  flowFlags?: Record<string, boolean> | string[] | null,
): Set<string> | null {
  if (!flowFlags) return null;
  const set = Array.isArray(flowFlags)
    ? new Set(flowFlags)
    : new Set(Object.keys(flowFlags).filter((key) => flowFlags[key]));
  return set.size ? set : null;
}

export function matchesRuleCondition(
  flowType: string,
  payload: Record<string, unknown>,
  conditions?: ApprovalCondition,
): boolean {
  if (!conditions) return true;
  const amount = extractAmount(payload);
  const amountMin = conditions.amountMin ?? conditions.minAmount;
  const amountMax = conditions.amountMax ?? conditions.maxAmount;
  if (amountMin !== undefined && amount < amountMin) return false;
  if (amountMax !== undefined && amount > amountMax) return false;
  if (conditions.isRecurring !== undefined) {
    const recurring = Boolean(payload.recurring ?? payload.isRecurring);
    if (recurring !== conditions.isRecurring) return false;
  }
  if (conditions.projectType && payload.projectType !== conditions.projectType)
    return false;
  if (conditions.customerId && payload.customerId !== conditions.customerId)
    return false;
  if (conditions.orgUnitId && payload.orgUnitId !== conditions.orgUnitId)
    return false;
  const flowFlags = normalizeFlowFlags(
    conditions.flowFlags ?? conditions.appliesTo ?? null,
  );
  if (flowFlags && !flowFlags.has(flowType)) return false;
  return true;
}

export function normalizeRuleSteps(raw: unknown): ApprovalStep[] | null {
  if (!Array.isArray(raw)) return null;
  const filtered = (raw as ApprovalRuleStep[]).filter(
    (s) => s && (s.approverGroupId || s.approverUserId),
  );
  if (!filtered.length) return null;
  const hasExplicitOrder = filtered.some((s) => Number.isInteger(s.stepOrder));
  const hasParallelKey = filtered.some((s) => Boolean(s.parallelKey));
  if (hasExplicitOrder) {
    return filtered.map((s, idx) => ({
      approverGroupId: s.approverGroupId,
      approverUserId: s.approverUserId,
      stepOrder: Number.isFinite(Number(s.stepOrder))
        ? Number(s.stepOrder)
        : idx + 1,
    }));
  }
  if (hasParallelKey) {
    const orderMap = new Map<string, number>();
    let order = 1;
    return filtered.map((s, idx) => {
      const key = s.parallelKey || `__seq_${idx}`;
      if (!orderMap.has(key)) orderMap.set(key, order++);
      return {
        approverGroupId: s.approverGroupId,
        approverUserId: s.approverUserId,
        stepOrder: orderMap.get(key),
      };
    });
  }
  return filtered.map((s, idx) => ({
    approverGroupId: s.approverGroupId,
    approverUserId: s.approverUserId,
    stepOrder: idx + 1,
  }));
}

export function matchApprovalSteps(
  flowType: string,
  payload: Record<string, unknown>,
  conditions?: ApprovalCondition,
): ApprovalStep[] {
  const amount = extractAmount(payload);
  const isRecurring =
    conditions?.isRecurring ??
    Boolean(payload.recurring ?? payload.isRecurring);
  const execThreshold = conditions?.execThreshold ?? 100000;
  const smallUnder =
    conditions?.skipUnder ?? conditions?.skipSmallUnder ?? 50000;

  if (amount > 0 && amount < smallUnder) {
    return [{ approverGroupId: 'mgmt', stepOrder: 1 }];
  }
  if (isRecurring && amount < execThreshold) {
    return [{ approverGroupId: 'mgmt', stepOrder: 1 }];
  }
  return [
    { approverGroupId: 'mgmt', stepOrder: 1 },
    ...(amount >= execThreshold
      ? [{ approverGroupId: 'exec', stepOrder: 2 }]
      : []),
  ];
}
