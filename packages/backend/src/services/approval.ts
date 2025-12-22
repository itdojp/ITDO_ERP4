import { DocStatusValue } from '../types.js';
import { prisma } from './db.js';
import { logAudit } from './audit.js';

type Step = { approverGroupId?: string; approverUserId?: string; stepOrder?: number };
type RuleStep = { approverGroupId?: string; approverUserId?: string; stepOrder?: number; parallelKey?: string };
type ActOptions = { reason?: string; actorGroupId?: string };
type SubmitApprovalOptions = {
  flowType: string;
  targetTable: string;
  targetId: string;
  update: (tx: any) => Promise<any>;
  payload?: Record<string, unknown>;
};

// 条件サンプル: amount閾値 / recurring判定 / 小額スキップ
export type ApprovalCondition = {
  amountMin?: number;
  amountMax?: number;
  skipUnder?: number;
  execThreshold?: number;
  isRecurring?: boolean;
  projectType?: string;
  customerId?: string;
  orgUnitId?: string;
  flowFlags?: Record<string, boolean> | string[]; // flowType フラグ
  // 旧キー互換
  minAmount?: number;
  maxAmount?: number;
  skipSmallUnder?: number;
  appliesTo?: string[];
};

function extractAmount(payload: Record<string, unknown>): number {
  const raw = payload.totalAmount ?? payload.amount ?? 0;
  const amount = typeof raw === 'string' ? Number(raw) : Number(raw || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeFlowFlags(flowFlags?: Record<string, boolean> | string[] | null): Set<string> | null {
  if (!flowFlags) return null;
  const set = Array.isArray(flowFlags)
    ? new Set(flowFlags)
    : new Set(Object.keys(flowFlags).filter((key) => flowFlags[key]));
  return set.size ? set : null;
}

function matchesRuleCondition(flowType: string, payload: Record<string, unknown>, conditions?: ApprovalCondition): boolean {
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
  if (conditions.projectType && payload.projectType !== conditions.projectType) return false;
  if (conditions.customerId && payload.customerId !== conditions.customerId) return false;
  if (conditions.orgUnitId && payload.orgUnitId !== conditions.orgUnitId) return false;
  const flowFlags = normalizeFlowFlags(conditions.flowFlags ?? conditions.appliesTo ?? null);
  if (flowFlags && !flowFlags.has(flowType)) return false;
  return true;
}

function normalizeRuleSteps(raw: unknown): Step[] | null {
  if (!Array.isArray(raw)) return null;
  const filtered = (raw as RuleStep[]).filter((s) => s && (s.approverGroupId || s.approverUserId));
  if (!filtered.length) return null;
  const hasExplicitOrder = filtered.some((s) => Number.isInteger(s.stepOrder));
  const hasParallelKey = filtered.some((s) => Boolean(s.parallelKey));
  if (hasExplicitOrder) {
    return filtered.map((s, idx) => ({
      approverGroupId: s.approverGroupId,
      approverUserId: s.approverUserId,
      stepOrder: Number.isFinite(Number(s.stepOrder)) ? Number(s.stepOrder) : idx + 1,
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

export function matchApprovalSteps(flowType: string, payload: Record<string, unknown>, conditions?: ApprovalCondition): Step[] {
  const amount = extractAmount(payload);
  const isRecurring = conditions?.isRecurring ?? Boolean(payload.recurring ?? payload.isRecurring);
  const execThreshold = conditions?.execThreshold ?? 100000;
  const smallUnder = conditions?.skipUnder ?? conditions?.skipSmallUnder ?? 50000;

  if (amount > 0 && amount < smallUnder) {
    return [{ approverGroupId: 'mgmt', stepOrder: 1 }];
  }
  if (isRecurring && amount < execThreshold) {
    return [{ approverGroupId: 'mgmt', stepOrder: 1 }];
  }
  return [
    { approverGroupId: 'mgmt', stepOrder: 1 },
    ...(amount >= execThreshold ? [{ approverGroupId: 'exec', stepOrder: 2 }] : []),
  ];
}

async function resolveRule(flowType: string, payload: Record<string, unknown>, client: any = prisma) {
  const rules = await client.approvalRule.findMany({ where: { flowType }, orderBy: { createdAt: 'desc' } });
  if (!rules.length) return null;
  const matched = rules.find((r: { conditions?: unknown }) => matchesRuleCondition(flowType, payload, r.conditions as ApprovalCondition));
  return matched || rules[0];
}

async function createApprovalWithClient(client: any, flowType: string, targetTable: string, targetId: string, steps: Step[], ruleId = 'manual') {
  const normalizedSteps = steps.map((s, idx) => ({ ...s, stepOrder: s.stepOrder ?? idx + 1 }));
  const currentStep = normalizedSteps.length
    ? Math.min(...normalizedSteps.map((s) => s.stepOrder || 1))
    : null;
  const instance = await client.approvalInstance.create({
    data: {
      flowType,
      targetTable,
      targetId,
      status: DocStatusValue.pending_qa,
      currentStep,
      ruleId,
      steps: {
        create: normalizedSteps.map((s: any) => ({
          stepOrder: s.stepOrder,
          approverGroupId: s.approverGroupId,
          approverUserId: s.approverUserId,
          status: DocStatusValue.pending_qa,
        })),
      },
    },
    include: { steps: true },
  });
  return instance;
}

export async function createApproval(flowType: string, targetTable: string, targetId: string, steps: Step[], ruleId = 'manual') {
  return prisma.$transaction(async (tx: any) => createApprovalWithClient(tx, flowType, targetTable, targetId, steps, ruleId));
}

export async function createApprovalFor(
  flowType: string,
  targetTable: string,
  targetId: string,
  payload: Record<string, unknown>,
  client: any = prisma,
) {
  const rule = await resolveRule(flowType, payload, client);
  const ruleSteps = normalizeRuleSteps(rule?.steps);
  const steps = ruleSteps || matchApprovalSteps(flowType, payload, (rule?.conditions as ApprovalCondition) || undefined);
  if (client === prisma) {
    return createApproval(flowType, targetTable, targetId, steps, rule?.id || 'auto');
  }
  return createApprovalWithClient(client, flowType, targetTable, targetId, steps, rule?.id || 'auto');
}

export async function submitApprovalWithUpdate(options: SubmitApprovalOptions) {
  return prisma.$transaction(async (tx: any) => {
    const updated = await options.update(tx);
    const approvalPayload = options.payload ?? (updated as Record<string, unknown>);
    const approval = await createApprovalFor(options.flowType, options.targetTable, options.targetId, approvalPayload, tx);
    return { updated, approval };
  });
}

async function updateTargetStatus(tx: any, targetTable: string, targetId: string, newStatus: string) {
  if (newStatus !== DocStatusValue.approved && newStatus !== DocStatusValue.rejected) return;
  if (targetTable === 'estimates') {
    await tx.estimate.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'invoices') {
    await tx.invoice.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'expenses') {
    await tx.expense.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'purchase_orders') {
    await tx.purchaseOrder.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'vendor_invoices') {
    await tx.vendorInvoice.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'vendor_quotes') {
    await tx.vendorQuote.update({ where: { id: targetId }, data: { status: newStatus } });
    return;
  }
  if (targetTable === 'time_entries') {
    const status = newStatus === DocStatusValue.approved ? 'approved' : 'rejected';
    await tx.timeEntry.update({ where: { id: targetId }, data: { status } });
    return;
  }
  if (targetTable === 'leave_requests') {
    const status = newStatus === DocStatusValue.approved ? 'approved' : 'rejected';
    await tx.leaveRequest.update({ where: { id: targetId }, data: { status } });
  }
}

export async function act(instanceId: string, userId: string, action: 'approve' | 'reject', options: ActOptions = {}) {
  return prisma.$transaction(async (tx: any) => {
    const instance = await tx.approvalInstance.findUnique({ where: { id: instanceId }, include: { steps: true } });
    if (!instance) throw new Error('Instance not found');
    if (instance.status === DocStatusValue.approved || instance.status === DocStatusValue.rejected) {
      throw new Error('Instance already closed');
    }
    if (!instance.currentStep) throw new Error('No current step');
    const currentSteps = instance.steps.filter((s: any) => s.stepOrder === instance.currentStep);
    const current = currentSteps.find((s: any) => s.approverUserId === userId && s.status === DocStatusValue.pending_qa)
      || currentSteps.find((s: any) => s.status === DocStatusValue.pending_qa)
      || currentSteps[0];
    if (!current) throw new Error('No current step');
    const nextStepStatus = action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected;
    await tx.approvalStep.update({
      where: { id: current.id },
      data: { status: nextStepStatus, actedBy: userId, actedAt: new Date() },
    });
    await logAudit({
      action: `approval_step_${action}`,
      userId,
      targetTable: 'approval_steps',
      targetId: current.id,
      metadata: {
        instanceId: instance.id,
        fromStatus: current.status,
        toStatus: nextStepStatus,
        step: current.stepOrder,
        reason: options.reason,
        actorGroupId: options.actorGroupId,
      },
    });
    let newStatus;
    let newCurrentStep = instance.currentStep;
    const nextStatus = action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected;
    if (action === 'reject') {
      newStatus = DocStatusValue.rejected;
      newCurrentStep = null;
    } else {
      const hasPending = currentSteps.some((s: any) => {
        const status = s.id === current.id ? nextStatus : s.status;
        return status === DocStatusValue.pending_qa;
      });
      if (hasPending) {
        newStatus = DocStatusValue.pending_qa;
        newCurrentStep = instance.currentStep;
      } else {
        const nextOrders = instance.steps
          .map((s: any) => s.stepOrder)
          .filter((order: number) => order > instance.currentStep);
        const nextStepOrder = nextOrders.length ? Math.min(...nextOrders) : null;
        if (nextStepOrder) {
          newCurrentStep = nextStepOrder;
          newStatus = DocStatusValue.pending_qa;
        } else {
          newCurrentStep = null;
          newStatus = DocStatusValue.approved;
        }
      }
    }
    await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: newStatus, currentStep: newCurrentStep } });
    await updateTargetStatus(tx, instance.targetTable, instance.targetId, newStatus);
    await logAudit({
      action: `approval_${action}`,
      userId,
      targetTable: 'approval_instances',
      targetId: instance.id,
      metadata: {
        fromStatus: instance.status,
        toStatus: newStatus,
        step: current.stepOrder,
        reason: options.reason,
        actorGroupId: options.actorGroupId,
      },
    });
    return { status: newStatus, currentStep: newCurrentStep };
  });
}
