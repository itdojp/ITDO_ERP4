import { DocStatusValue } from '../types.js';
import { prisma } from './db.js';
import { logAudit, type AuditContext } from './audit.js';
import { createEvidenceSnapshotForApproval } from './evidenceSnapshot.js';
import { logExpenseStateTransition } from './expenseStateTransitionLog.js';
import { isExpenseQaChecklistComplete } from './expenseQaChecklist.js';
import {
  hasQaStageBeforeExec,
  matchApprovalSteps as computeApprovalSteps,
  matchesRuleCondition,
  normalizeRuleStepsWithPolicy,
  resolvePendingStatus,
  type ApprovalCondition,
  type ApprovalStagePolicy,
  type ApprovalStep as Step,
} from './approvalLogic.js';

export { matchApprovalSteps } from './approvalLogic.js';

export class ExpenseQaStageRequiredError extends Error {
  constructor() {
    super('expense_requires_qa_before_exec');
    this.name = 'ExpenseQaStageRequiredError';
  }
}

export class ExpenseQaChecklistIncompleteError extends Error {
  constructor() {
    super('expense_qa_checklist_incomplete');
    this.name = 'ExpenseQaChecklistIncompleteError';
  }
}

type ActOptions = {
  reason?: string;
  actorGroupId?: string;
  actorGroupIds?: string[];
  actorGroupAccountIds?: string[];
  auditContext?: AuditContext;
};
type CreateApprovalOptions = { client?: any; createdBy?: string; now?: Date };
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

function isPendingStatus(status: string) {
  return (
    status === DocStatusValue.pending_qa ||
    status === DocStatusValue.pending_exec
  );
}

function resolveStagePolicy(
  stagePolicy: unknown,
  stepOrder: number,
): { mode: 'all' | 'any' | 'quorum'; quorum?: number } {
  if (!stagePolicy || typeof stagePolicy !== 'object') return { mode: 'all' };
  const raw = (stagePolicy as any)[String(stepOrder)];
  if (!raw || typeof raw !== 'object') return { mode: 'all' };
  const mode = (raw as any).mode;
  if (mode === 'any') return { mode: 'any' };
  if (mode === 'quorum') {
    const quorum = Number((raw as any).quorum);
    if (Number.isInteger(quorum) && quorum >= 1)
      return { mode: 'quorum', quorum };
    // Invalid quorum -> fall back to safest semantics (all).
    return { mode: 'all' };
  }
  return { mode: 'all' };
}

function isStageCompleted(
  policy: { mode: 'all' | 'any' | 'quorum'; quorum?: number },
  steps: Array<{ status: string }>,
): boolean {
  if (policy.mode === 'all') {
    return !steps.some((s) => isPendingStatus(s.status));
  }
  const approvedCount = steps.filter(
    (s) => s.status === DocStatusValue.approved,
  ).length;
  if (policy.mode === 'any') return approvedCount >= 1;
  const quorum = Number(policy.quorum);
  if (!Number.isInteger(quorum) || quorum < 1) return false;
  return approvedCount >= quorum;
}

function isPrismaUniqueError(err: unknown) {
  return (
    Boolean(err) && typeof err === 'object' && (err as any).code === 'P2002'
  );
}

function assertExpenseQaGate(flowType: string, steps: Step[]) {
  if (flowType !== 'expense') return;
  if (hasQaStageBeforeExec(steps)) return;
  throw new ExpenseQaStageRequiredError();
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
  now: Date = new Date(),
) {
  const rules = await client.approvalRule.findMany({
    where: { flowType, isActive: true, effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
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
  stagePolicy?: ApprovalStagePolicy,
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
  assertExpenseQaGate(flowType, normalizedSteps);
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
        stagePolicy:
          stagePolicy && Object.keys(stagePolicy).length
            ? stagePolicy
            : undefined,
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
  stagePolicy?: ApprovalStagePolicy,
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
      stagePolicy,
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
  const rule = await resolveRule(
    flowType,
    enrichedPayload,
    client,
    options.now,
  );
  const normalized = normalizeRuleStepsWithPolicy(rule?.steps);
  const steps =
    normalized?.steps ||
    computeApprovalSteps(
      flowType,
      enrichedPayload,
      (rule?.conditions as ApprovalCondition) || undefined,
    );
  const stagePolicy = normalized?.stagePolicy;
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
      stagePolicy,
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
    stagePolicy,
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
    const snapshotResult = await createEvidenceSnapshotForApproval(tx, {
      approvalInstanceId: approval.id,
      targetTable: approval.targetTable,
      targetId: approval.targetId,
      capturedBy: options.createdBy ?? null,
      forceRegenerate: false,
    });
    if (snapshotResult.created) {
      const snapshot = snapshotResult.snapshot;
      await logAudit({
        action: 'evidence_snapshot_created',
        targetTable: 'evidence_snapshots',
        targetId: snapshot.id,
        userId: options.createdBy,
        source: 'system',
        metadata: {
          approvalInstanceId: snapshot.approvalInstanceId,
          targetTable: snapshot.targetTable,
          targetId: snapshot.targetId,
          version: snapshot.version,
          sourceAnnotationUpdatedAt:
            snapshot.sourceAnnotationUpdatedAt?.toISOString() ?? null,
          trigger: 'submit_auto',
        },
      });
    }
    return { updated, approval };
  });
}

async function updateTargetStatus(
  tx: any,
  targetTable: string,
  targetId: string,
  newStatus: string,
  actorUserId?: string,
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
    const current = await tx.expense.findUnique({
      where: { id: targetId },
      select: { status: true, settlementStatus: true },
    });
    await tx.expense.update({
      where: { id: targetId },
      data: { status: newStatus },
    });
    if (current) {
      const nextStatus = newStatus as
        | typeof DocStatusValue.approved
        | typeof DocStatusValue.rejected;
      await logExpenseStateTransition({
        client: tx,
        expenseId: targetId,
        from: {
          status: current.status,
          settlementStatus: current.settlementStatus,
        },
        to: {
          status: nextStatus,
          settlementStatus: current.settlementStatus,
        },
        actorUserId: actorUserId || null,
        metadata: { trigger: 'approval_act' },
      });
    }
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
    const now = new Date();
    // Serialize actions per instance to avoid lost updates when multiple approvers act concurrently.
    await tx.$queryRaw`SELECT id FROM "ApprovalInstance" WHERE id = ${instanceId} FOR UPDATE`;
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
    if (
      action === 'approve' &&
      instance.targetTable === 'expenses' &&
      instance.status === DocStatusValue.pending_qa
    ) {
      const checklist = await tx.expenseQaChecklist.findUnique({
        where: { expenseId: instance.targetId },
        select: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
        },
      });
      if (!isExpenseQaChecklistComplete(checklist)) {
        throw new ExpenseQaChecklistIncompleteError();
      }
    }
    if (!instance.currentStep) throw new Error('No current step');
    const currentSteps = instance.steps.filter(
      (s: any) => s.stepOrder === instance.currentStep,
    );
    const actorGroupIds = new Set(
      [
        ...(options.actorGroupIds ??
          (options.actorGroupId ? [options.actorGroupId] : [])),
        ...(options.actorGroupAccountIds ?? []),
      ].filter((value) => typeof value === 'string' && value.trim() !== ''),
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
      (s: any) => s.actedBy === userId && !isPendingStatus(String(s.status)),
    );
    if (alreadyActed) {
      throw new Error(
        'User has already acted on another step in this parallel approval stage',
      );
    }
    const eligibleSteps = currentSteps.filter(
      (s: any) => isPendingStatus(String(s.status)) && isEligibleStep(s),
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
    // Guard against races (e.g. stage auto-cancel) by updating only if still pending.
    const stepUpdated = await tx.approvalStep.updateMany({
      where: {
        id: current.id,
        status: {
          in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
        },
      },
      data: { status: nextStepStatus, actedBy: userId, actedAt: now },
    });
    if (stepUpdated.count !== 1) {
      throw new Error('Step already processed');
    }
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
      const stagePolicy = resolveStagePolicy(
        instance.stagePolicy,
        instance.currentStep,
      );
      const currentStepsAfter = currentSteps.map((s: any) =>
        s.id === current.id
          ? { ...s, status: nextStatus, actedBy: userId, actedAt: now }
          : s,
      );

      const stageCompleted = isStageCompleted(stagePolicy, currentStepsAfter);
      if (!stageCompleted) {
        newStatus = resolvePendingStatus(instance.steps, instance.currentStep);
        newCurrentStep = instance.currentStep;
      } else {
        // For any/quorum stages, cancel remaining pending steps to keep UI/queries consistent.
        if (stagePolicy.mode !== 'all') {
          const pendingIds = currentStepsAfter
            .filter((s: any) => isPendingStatus(String(s.status)))
            .map((s: any) => s.id);
          if (pendingIds.length) {
            const updateResult = await tx.approvalStep.updateMany({
              where: {
                id: { in: pendingIds },
                status: {
                  in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
                },
              },
              data: {
                status: DocStatusValue.cancelled,
                actedBy: 'system',
                actedAt: now,
              },
            });
            if (updateResult.count > 0) {
              const cancelledSteps = await tx.approvalStep.findMany({
                where: {
                  id: { in: pendingIds },
                  status: DocStatusValue.cancelled,
                  actedBy: 'system',
                },
                select: { id: true },
              });
              const cancelledStepIds = cancelledSteps.map((s: any) => s.id);
              if (cancelledStepIds.length > 0) {
                await logAudit({
                  action: 'approval_stage_auto_cancel',
                  targetTable: 'approval_instances',
                  targetId: instance.id,
                  ...auditBase,
                  metadata: {
                    step: instance.currentStep,
                    mode: stagePolicy.mode,
                    quorum:
                      stagePolicy.mode === 'quorum' ? stagePolicy.quorum : null,
                    cancelledStepIds,
                  },
                });
              }
            }
          }
        }

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
      userId,
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
