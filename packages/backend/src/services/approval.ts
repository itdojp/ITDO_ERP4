import { DocStatusValue } from '../types.js';
import { prisma } from './db.js';
import { logAudit, type AuditContext } from './audit.js';
import {
  matchApprovalSteps as computeApprovalSteps,
  matchesRuleCondition,
  normalizeRuleSteps,
  resolvePendingStatus,
  type ApprovalCondition,
  type ApprovalStep as Step,
} from './approvalLogic.js';

export { matchApprovalSteps } from './approvalLogic.js';

type ActOptions = {
  reason?: string;
  actorGroupId?: string;
  actorGroupIds?: string[];
  auditContext?: AuditContext;
};
type CreateApprovalOptions = { client?: any; createdBy?: string };
/**
 * Options for submitApprovalWithUpdate.
 * update() runs in a transaction and should return the updated entity.
 * payload is optional when approval matching needs fields not in the update result.
 */
type SubmitApprovalOptions = {
  flowType: string;
  targetTable: string;
  targetId: string;
  update: (tx: any) => Promise<any>;
  payload?: Record<string, unknown>;
  createdBy?: string;
};

const OPEN_APPROVAL_STATUSES = [
  DocStatusValue.pending_qa,
  DocStatusValue.pending_exec,
] as const;

function isPrismaUniqueError(err: unknown) {
  return (
    Boolean(err) && typeof err === 'object' && (err as any).code === 'P2002'
  );
}

async function findOpenApprovalInstance(options: {
  client: any;
  flowType: string;
  targetTable: string;
  targetId: string;
}) {
  return options.client.approvalInstance.findFirst({
    where: {
      flowType: options.flowType,
      targetTable: options.targetTable,
      targetId: options.targetId,
      status: { in: OPEN_APPROVAL_STATUSES as unknown as string[] },
    },
    include: { steps: true },
  });
}

async function enrichProjectFields(
  payload: Record<string, unknown>,
  client: any,
): Promise<Record<string, unknown>> {
  const projectId =
    typeof payload.projectId === 'string' ? payload.projectId : undefined;
  if (!projectId) return payload;
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { projectType: true, customerId: true, orgUnitId: true },
  });
  if (!project) return payload;
  return {
    ...payload,
    projectType: payload.projectType ?? project.projectType ?? undefined,
    customerId: payload.customerId ?? project.customerId ?? undefined,
    orgUnitId: payload.orgUnitId ?? project.orgUnitId ?? undefined,
  };
}

async function resolveRule(
  flowType: string,
  payload: Record<string, unknown>,
  client: any = prisma,
) {
  const rules = await client.approvalRule.findMany({
    where: { flowType },
    orderBy: { createdAt: 'desc' },
  });
  if (!rules.length) return null;
  const matched = rules.find((r: { conditions?: unknown }) =>
    matchesRuleCondition(flowType, payload, r.conditions as ApprovalCondition),
  );
  return matched || rules[0];
}

async function createApprovalWithClient(
  client: any,
  flowType: string,
  targetTable: string,
  targetId: string,
  steps: Step[],
  ruleId = 'manual',
  createdBy?: string,
  projectId?: string,
) {
  const existing = await findOpenApprovalInstance({
    client,
    flowType,
    targetTable,
    targetId,
  });
  if (existing) return existing;

  const normalizedSteps = steps.map((s, idx) => ({
    ...s,
    stepOrder: s.stepOrder ?? idx + 1,
  }));
  const currentStep = normalizedSteps.length
    ? Math.min(...normalizedSteps.map((s) => s.stepOrder || 1))
    : null;
  try {
    const instance = await client.approvalInstance.create({
      data: {
        flowType,
        targetTable,
        targetId,
        projectId,
        status: resolvePendingStatus(normalizedSteps, currentStep),
        currentStep,
        ruleId,
        createdBy,
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
  } catch (err) {
    if (!isPrismaUniqueError(err)) {
      throw err;
    }
    const fallback = await findOpenApprovalInstance({
      client,
      flowType,
      targetTable,
      targetId,
    });
    if (fallback) return fallback;
    throw err;
  }
}

export async function createApproval(
  flowType: string,
  targetTable: string,
  targetId: string,
  steps: Step[],
  ruleId = 'manual',
  createdBy?: string,
  projectId?: string,
) {
  return prisma.$transaction(async (tx: any) =>
    createApprovalWithClient(
      tx,
      flowType,
      targetTable,
      targetId,
      steps,
      ruleId,
      createdBy,
      projectId,
    ),
  );
}

export async function createApprovalFor(
  flowType: string,
  targetTable: string,
  targetId: string,
  payload: Record<string, unknown>,
  options: CreateApprovalOptions = {},
) {
  const client = options.client ?? prisma;
  const enrichedPayload = await enrichProjectFields(payload, client);
  const rule = await resolveRule(flowType, enrichedPayload, client);
  const ruleSteps = normalizeRuleSteps(rule?.steps);
  const steps =
    ruleSteps ||
    computeApprovalSteps(
      flowType,
      enrichedPayload,
      (rule?.conditions as ApprovalCondition) || undefined,
    );
  const projectId =
    typeof enrichedPayload.projectId === 'string'
      ? enrichedPayload.projectId
      : undefined;
  if (client === prisma) {
    return createApproval(
      flowType,
      targetTable,
      targetId,
      steps,
      rule?.id || 'auto',
      options.createdBy,
      projectId,
    );
  }
  return createApprovalWithClient(
    client,
    flowType,
    targetTable,
    targetId,
    steps,
    rule?.id || 'auto',
    options.createdBy,
    projectId,
  );
}

/**
 * Atomically update a target and create an approval instance in one transaction.
 */
export async function submitApprovalWithUpdate(options: SubmitApprovalOptions) {
  return prisma.$transaction(async (tx: any) => {
    const updated = await options.update(tx);
    const approvalPayload =
      options.payload ?? (updated as Record<string, unknown>);
    const approval = await createApprovalFor(
      options.flowType,
      options.targetTable,
      options.targetId,
      approvalPayload,
      {
        client: tx,
        createdBy: options.createdBy,
      },
    );
    return { updated, approval };
  });
}

async function updateTargetStatus(
  tx: any,
  targetTable: string,
  targetId: string,
  newStatus: string,
) {
  if (
    newStatus !== DocStatusValue.approved &&
    newStatus !== DocStatusValue.rejected
  )
    return;
  if (targetTable === 'estimates') {
    await tx.estimate.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'invoices') {
    await tx.invoice.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'expenses') {
    await tx.expense.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'purchase_orders') {
    await tx.purchaseOrder.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'vendor_invoices') {
    await tx.vendorInvoice.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'vendor_quotes') {
    await tx.vendorQuote.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    return;
  }
  if (targetTable === 'time_entries') {
    const status =
      newStatus === DocStatusValue.approved ? 'approved' : 'rejected';
    await tx.timeEntry.update({ where: { id: targetId }, data: { status } });
    return;
  }
  if (targetTable === 'leave_requests') {
    const status =
      newStatus === DocStatusValue.approved ? 'approved' : 'rejected';
    await tx.leaveRequest.update({ where: { id: targetId }, data: { status } });
  }
}

export async function act(
  instanceId: string,
  userId: string,
  action: 'approve' | 'reject',
  options: ActOptions = {},
) {
  return prisma.$transaction(async (tx: any) => {
    const instance = await tx.approvalInstance.findUnique({
      where: { id: instanceId },
      include: { steps: true },
    });
    if (!instance) throw new Error('Instance not found');
    if (
      instance.status === DocStatusValue.approved ||
      instance.status === DocStatusValue.rejected
    ) {
      throw new Error('Instance already closed');
    }
    if (!instance.currentStep) throw new Error('No current step');
    const currentSteps = instance.steps.filter(
      (s: any) => s.stepOrder === instance.currentStep,
    );
    const actorGroupIds = new Set(
      options.actorGroupIds ??
        (options.actorGroupId ? [options.actorGroupId] : []),
    );
    const isEligibleStep = (step: any) => {
      if (step.approverUserId) {
        return step.approverUserId === userId;
      }
      if (step.approverGroupId) {
        return actorGroupIds.has(step.approverGroupId);
      }
      return true;
    };
    const alreadyActed = currentSteps.some(
      (s: any) =>
        s.actedBy === userId && s.status !== DocStatusValue.pending_qa,
    );
    if (alreadyActed) {
      throw new Error(
        'User has already acted on another step in this parallel approval stage',
      );
    }
    const eligibleSteps = currentSteps.filter(
      (s: any) => s.status === DocStatusValue.pending_qa && isEligibleStep(s),
    );
    if (!eligibleSteps.length) {
      throw new Error('No actionable step for user');
    }
    const current =
      eligibleSteps.find((s: any) => s.approverUserId === userId) ||
      eligibleSteps.find((s: any) =>
        s.approverGroupId ? actorGroupIds.has(s.approverGroupId) : false,
      ) ||
      eligibleSteps[0];
    if (!current) throw new Error('No current step');
    const nextStepStatus =
      action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected;
    await tx.approvalStep.update({
      where: { id: current.id },
      data: { status: nextStepStatus, actedBy: userId, actedAt: new Date() },
    });
    const auditBase = {
      ...(options.auditContext ?? {}),
      userId: options.auditContext?.userId ?? userId,
      actorGroupId: options.auditContext?.actorGroupId ?? options.actorGroupId,
    };
    await logAudit({
      action: `approval_step_${action}`,
      targetTable: 'approval_steps',
      targetId: current.id,
      ...auditBase,
      reasonText: options.reason,
      metadata: {
        instanceId: instance.id,
        fromStatus: current.status,
        toStatus: nextStepStatus,
        step: current.stepOrder,
      },
    });
    let newStatus;
    let newCurrentStep = instance.currentStep;
    const nextStatus =
      action === 'approve' ? DocStatusValue.approved : DocStatusValue.rejected;
    if (action === 'reject') {
      newStatus = DocStatusValue.rejected;
      newCurrentStep = null;
    } else {
      const hasPending = currentSteps.some((s: any) => {
        const status = s.id === current.id ? nextStatus : s.status;
        return status === DocStatusValue.pending_qa;
      });
      if (hasPending) {
        newStatus = resolvePendingStatus(instance.steps, instance.currentStep);
        newCurrentStep = instance.currentStep;
      } else {
        const nextOrders = instance.steps
          .map((s: any) => s.stepOrder)
          .filter((order: number) => order > instance.currentStep);
        const nextStepOrder = nextOrders.length
          ? Math.min(...nextOrders)
          : null;
        if (nextStepOrder) {
          newCurrentStep = nextStepOrder;
          newStatus = resolvePendingStatus(instance.steps, nextStepOrder);
        } else {
          newCurrentStep = null;
          newStatus = DocStatusValue.approved;
        }
      }
    }
    await tx.approvalInstance.update({
      where: { id: instance.id },
      data: { status: newStatus, currentStep: newCurrentStep },
    });
    await updateTargetStatus(
      tx,
      instance.targetTable,
      instance.targetId,
      newStatus,
    );
    await logAudit({
      action: `approval_${action}`,
      targetTable: 'approval_instances',
      targetId: instance.id,
      ...auditBase,
      reasonText: options.reason,
      metadata: {
        fromStatus: instance.status,
        toStatus: newStatus,
        step: current.stepOrder,
      },
    });
    return { status: newStatus, currentStep: newCurrentStep };
  });
}
