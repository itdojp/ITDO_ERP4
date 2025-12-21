import { DocStatusValue } from '../types.js';
import { prisma } from './db.js';
import { logAudit } from './audit.js';

type Step = { approverGroupId?: string; approverUserId?: string };
type ActOptions = { reason?: string; actorGroupId?: string };

// 条件サンプル: amount閾値 / recurring判定 / 小額スキップ
export type ApprovalCondition = {
  minAmount?: number;
  execThreshold?: number;
  skipSmallUnder?: number;
  isRecurring?: boolean;
  projectType?: string;
  customerId?: string;
  orgUnitId?: string;
  appliesTo?: string[]; // flowType フラグ
};

export function matchApprovalSteps(flowType: string, payload: Record<string, unknown>, conditions?: ApprovalCondition): Step[] {
  const amount = Number(payload.totalAmount || payload.amount || 0);
  const isRecurring = Boolean(payload.recurring || conditions?.isRecurring);
  const execThreshold = conditions?.execThreshold ?? 100000;
  const smallUnder = conditions?.skipSmallUnder ?? 50000;

  if (amount > 0 && amount < smallUnder) {
    return [{ approverGroupId: 'mgmt' }];
  }
  if (isRecurring && amount < execThreshold) {
    return [{ approverGroupId: 'mgmt' }];
  }
  return [
    { approverGroupId: 'mgmt' },
    ...(amount >= execThreshold ? [{ approverGroupId: 'exec' }] : []),
  ];
}

async function resolveRule(flowType: string) {
  return prisma.approvalRule.findFirst({ where: { flowType }, orderBy: { createdAt: 'desc' } });
}

export async function createApproval(flowType: string, targetTable: string, targetId: string, steps: Step[], ruleId = 'manual') {
  return prisma.$transaction(async (tx: any) => {
    const instance = await tx.approvalInstance.create({
      data: {
        flowType,
        targetTable,
        targetId,
        status: DocStatusValue.pending_qa,
        currentStep: steps.length ? 1 : null,
        ruleId,
        steps: {
          create: steps.map((s: any, idx: number) => ({
            stepOrder: idx + 1,
            approverGroupId: s.approverGroupId,
            approverUserId: s.approverUserId,
            status: DocStatusValue.pending_qa,
          })),
        },
      },
      include: { steps: true },
    });
    return instance;
  });
}

export async function createApprovalFor(flowType: string, targetTable: string, targetId: string, payload: Record<string, unknown>) {
  const rule = await resolveRule(flowType);
  const steps = matchApprovalSteps(flowType, payload, (rule?.conditions as ApprovalCondition) || undefined);
  return createApproval(flowType, targetTable, targetId, steps, rule?.id || 'auto');
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
    const current = instance.steps.find((s: any) => s.stepOrder === instance.currentStep);
    if (!current) throw new Error('No current step');
    await tx.approvalStep.update({
      where: { id: current.id },
      data: { status: action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected, actedBy: userId, actedAt: new Date() },
    });
    let newStatus;
    let newCurrentStep = instance.currentStep;
    if (action === 'reject') {
      newStatus = DocStatusValue.rejected;
    } else {
      const nextStep = instance.currentStep
        ? instance.steps.find((s: any) => s.stepOrder === instance.currentStep + 1)
        : null;
      if (nextStep) {
        newCurrentStep = nextStep.stepOrder;
        newStatus = DocStatusValue.pending_qa;
      } else {
        newCurrentStep = null;
        newStatus = DocStatusValue.approved;
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
