import { DocStatusValue } from '../types.js';

export type ApprovalStep = {
  approverGroupId?: string;
  approverUserId?: string;
  stepOrder?: number;
};

export type ApprovalRuleStep = ApprovalStep & {
  parallelKey?: string;
};

export type ApprovalStageCompletion =
  | { mode: 'all' }
  | { mode: 'any' }
  | { mode: 'quorum'; quorum: number };

export type ApprovalStagePolicy = Record<
  number,
  { mode: 'all' | 'any' | 'quorum'; quorum?: number }
>;

type ApprovalStageApprover =
  | { type: 'group'; id: string }
  | { type: 'user'; id: string };

type ApprovalStageDefinition = {
  order: number;
  label?: string;
  completion?: ApprovalStageCompletion;
  approvers: ApprovalStageApprover[];
};

type ApprovalStagesDefinition = {
  stages: ApprovalStageDefinition[];
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

function buildDefaultStagePolicy(steps: ApprovalStep[]): ApprovalStagePolicy {
  const orders = Array.from(
    new Set(
      steps
        .map((s) => Number(s.stepOrder))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  const policy: ApprovalStagePolicy = {};
  for (const order of orders) {
    policy[order] = { mode: 'all' };
  }
  return policy;
}

function normalizeStagesDefinition(raw: unknown): {
  steps: ApprovalStep[];
  stagePolicy: ApprovalStagePolicy;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ApprovalStagesDefinition>;
  if (!Array.isArray(obj.stages) || obj.stages.length === 0) return null;

  const steps: ApprovalStep[] = [];
  const stagePolicy: ApprovalStagePolicy = {};
  for (const stage of obj.stages as ApprovalStageDefinition[]) {
    if (!stage || typeof stage !== 'object') return null;
    const order = Number((stage as any).order);
    if (!Number.isInteger(order) || order < 1) return null;
    if (Object.prototype.hasOwnProperty.call(stagePolicy, order)) return null;
    if (!Array.isArray((stage as any).approvers) || stage.approvers.length < 1)
      return null;

    const completion = (stage as any).completion as ApprovalStageCompletion;
    if (!completion || completion.mode === 'all') {
      stagePolicy[order] = { mode: 'all' };
    } else if (completion.mode === 'any') {
      stagePolicy[order] = { mode: 'any' };
    } else if (completion.mode === 'quorum') {
      const quorum = Number((completion as any).quorum);
      if (
        !Number.isInteger(quorum) ||
        quorum < 1 ||
        quorum > stage.approvers.length
      )
        return null;
      stagePolicy[order] = { mode: 'quorum', quorum };
    } else {
      return null;
    }

    for (const approver of stage.approvers) {
      if (!approver || typeof approver !== 'object') return null;
      const type = (approver as any).type;
      const id = (approver as any).id;
      if (type !== 'group' && type !== 'user') return null;
      if (typeof id !== 'string' || !id.trim()) return null;
      steps.push({
        stepOrder: order,
        ...(type === 'group' ? { approverGroupId: id } : {}),
        ...(type === 'user' ? { approverUserId: id } : {}),
      });
    }
  }

  if (!steps.length) return null;
  return { steps, stagePolicy };
}

export function normalizeRuleStepsWithPolicy(raw: unknown): {
  steps: ApprovalStep[];
  stagePolicy: ApprovalStagePolicy;
} | null {
  // New format: { stages: [...] }
  const stages = normalizeStagesDefinition(raw);
  if (stages) return stages;

  // Legacy format: [{ approverGroupId/approverUserId, stepOrder?, parallelKey? }, ...]
  const steps = normalizeRuleSteps(raw);
  if (!steps) return null;
  return { steps, stagePolicy: buildDefaultStagePolicy(steps) };
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
