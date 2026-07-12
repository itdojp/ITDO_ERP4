import type { AuditContext } from '../../services/audit.js';
import { logAudit as defaultLogAudit } from '../../services/audit.js';
import {
  ExpenseQaStageRequiredError,
  submitApprovalWithUpdate as defaultSubmitApprovalWithUpdate,
} from '../../services/approval.js';
import {
  createApprovalPendingNotifications as defaultCreateApprovalPendingNotifications,
  createExpenseMarkPaidNotification as defaultCreateExpenseMarkPaidNotification,
} from '../../services/appNotifications.js';
import {
  evaluateActionPolicyGuards as defaultEvaluateActionPolicyGuards,
  evaluateActionPolicyWithFallback as defaultEvaluateActionPolicyWithFallback,
  type ActionPolicyGuardFailure,
  type EvaluateActionPolicyWithFallbackResult,
} from '../../services/actionPolicy.js';
import {
  logActionPolicyFallbackAllowedForContextIfNeeded as defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverrideForContextIfNeeded as defaultLogActionPolicyOverride,
} from '../../services/actionPolicyAudit.js';
import { resolveActionPolicyDeniedCode } from '../../services/actionPolicyErrors.js';
import { prisma as defaultPrisma } from '../../services/db.js';
import {
  evaluateExpenseBudget as defaultEvaluateExpenseBudget,
  hasExpenseBudgetEscalationFields,
  missingExpenseBudgetEscalationFields,
} from '../../services/expenseBudget.js';
import { logExpenseStateTransition as defaultLogExpenseStateTransition } from '../../services/expenseStateTransitionLog.js';
import { toPeriodKey } from '../../services/periodLock.js';
import { logReassignment as defaultLogReassignment } from '../../services/reassignmentLog.js';
import { DocStatusValue, FlowTypeValue } from '../../types.js';

export type ExpenseActorContext = {
  userId: string | null;
  roles: string[];
  groupIds: string[];
  groupAccountIds: string[];
  projectIds: string[];
};

export type ExpenseApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

export type ExpenseApplicationResult<T> =
  { ok: true; value: T } | ExpenseApplicationFailure;

export type ExpenseBudgetEscalationInput = {
  budgetEscalationReason?: string | null;
  budgetEscalationImpact?: string | null;
  budgetEscalationAlternative?: string | null;
};

type ActionPolicyAuditParams = {
  auditContext: AuditContext;
  flowType: typeof FlowTypeValue.expense;
  actionKey: string;
  targetTable: string;
  targetId: string;
  reasonText: string;
  result: EvaluateActionPolicyWithFallbackResult;
};

type ExpenseApplicationPorts = {
  db: any;
  evaluateActionPolicyWithFallback: typeof defaultEvaluateActionPolicyWithFallback;
  evaluateActionPolicyGuards: typeof defaultEvaluateActionPolicyGuards;
  submitApprovalWithUpdate: typeof defaultSubmitApprovalWithUpdate;
  evaluateExpenseBudget: typeof defaultEvaluateExpenseBudget;
  logActionPolicyFallbackAllowed: (
    params: ActionPolicyAuditParams,
  ) => Promise<void>;
  logActionPolicyOverride: (params: ActionPolicyAuditParams) => Promise<void>;
  logExpenseStateTransition: typeof defaultLogExpenseStateTransition;
  createApprovalPendingNotifications: typeof defaultCreateApprovalPendingNotifications;
  createExpenseMarkPaidNotification: typeof defaultCreateExpenseMarkPaidNotification;
  logAudit: typeof defaultLogAudit;
  logReassignment: typeof defaultLogReassignment;
  now: () => Date;
};

export type ExpenseApplicationPortOverrides = Partial<ExpenseApplicationPorts>;

const defaultPorts: ExpenseApplicationPorts = {
  db: defaultPrisma,
  evaluateActionPolicyWithFallback: defaultEvaluateActionPolicyWithFallback,
  evaluateActionPolicyGuards: defaultEvaluateActionPolicyGuards,
  submitApprovalWithUpdate: defaultSubmitApprovalWithUpdate,
  evaluateExpenseBudget: defaultEvaluateExpenseBudget,
  logActionPolicyFallbackAllowed: defaultLogActionPolicyFallbackAllowed,
  logActionPolicyOverride: defaultLogActionPolicyOverride,
  logExpenseStateTransition: defaultLogExpenseStateTransition,
  createApprovalPendingNotifications: defaultCreateApprovalPendingNotifications,
  createExpenseMarkPaidNotification: defaultCreateExpenseMarkPaidNotification,
  logAudit: defaultLogAudit,
  logReassignment: defaultLogReassignment,
  now: () => new Date(),
};

function ports(
  overrides?: ExpenseApplicationPortOverrides,
): ExpenseApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): ExpenseApplicationResult<T> {
  return { ok: true, value };
}

function fail(statusCode: number, body: unknown): ExpenseApplicationFailure {
  return { ok: false, statusCode, body };
}

function isPrivileged(actor: ExpenseActorContext): boolean {
  return actor.roles.includes('admin') || actor.roles.includes('mgmt');
}

function hasProjectAccess(
  actor: ExpenseActorContext,
  projectId: string,
): boolean {
  if (isPrivileged(actor)) return true;
  return actor.projectIds.includes(projectId);
}

function actionPolicyActor(actor: ExpenseActorContext) {
  return {
    userId: actor.userId ?? null,
    roles: actor.roles,
    groupIds: actor.groupIds,
    groupAccountIds: actor.groupAccountIds,
  };
}

function normalizeOptionalTrimmedValue(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function hasExpenseSubmitEvidence(input: {
  receiptUrl: string | null;
  attachmentCount: number;
}): boolean {
  const hasReceiptUrl =
    typeof input.receiptUrl === 'string' && input.receiptUrl.trim().length > 0;
  if (hasReceiptUrl) return true;
  return Number.isFinite(input.attachmentCount) && input.attachmentCount > 0;
}

function resolveExpenseReassignGuardReply(
  failures: ActionPolicyGuardFailure[],
): ExpenseApplicationFailure | null {
  for (const failure of failures) {
    if (
      failure.type === 'approval_open' &&
      failure.reason === 'approval_in_progress'
    ) {
      return fail(400, {
        error: {
          code: 'PENDING_APPROVAL',
          message: 'Approval in progress',
        },
      });
    }
    if (failure.type === 'period_lock' && failure.reason === 'period_locked') {
      return fail(400, {
        error: {
          code: 'PERIOD_LOCKED',
          message: 'Period is locked',
        },
      });
    }
  }
  return null;
}

function policyDeniedResponse(input: {
  result: EvaluateActionPolicyWithFallbackResult;
  reasonRequiredMessage: string;
  deniedMessage: string;
}) {
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
  ports: ExpenseApplicationPorts;
}) {
  const params = {
    auditContext: input.auditContext,
    flowType: FlowTypeValue.expense,
    actionKey: input.actionKey,
    targetTable: 'expenses',
    targetId: input.targetId,
    reasonText: input.reasonText,
    result: input.result,
  };
  await input.ports.logActionPolicyFallbackAllowed(params);
  await input.ports.logActionPolicyOverride(params);
}

export async function submitExpenseForApproval(input: {
  id: string;
  body: ExpenseBudgetEscalationInput & { reasonText?: string | null };
  actor: ExpenseActorContext;
  auditContext: AuditContext;
  ports?: ExpenseApplicationPortOverrides;
}): Promise<ExpenseApplicationResult<unknown>> {
  const p = ports(input.ports);
  const reasonText =
    typeof input.body?.reasonText === 'string'
      ? input.body.reasonText.trim()
      : '';
  const expense = await p.db.expense.findUnique({ where: { id: input.id } });
  if (!expense || expense.deletedAt) {
    return fail(404, { error: 'not_found' });
  }
  if (!isPrivileged(input.actor) && expense.userId !== input.actor.userId) {
    return fail(403, { error: 'forbidden' });
  }
  if (!hasProjectAccess(input.actor, expense.projectId)) {
    return fail(403, { error: 'forbidden_project' });
  }

  const hasReceiptEvidence = hasExpenseSubmitEvidence({
    receiptUrl: expense.receiptUrl,
    attachmentCount: 0,
  });
  if (!hasReceiptEvidence) {
    const attachmentCount = await p.db.expenseAttachment.count({
      where: { expenseId: input.id },
    });
    if (
      !hasExpenseSubmitEvidence({
        receiptUrl: expense.receiptUrl,
        attachmentCount,
      })
    ) {
      return fail(400, {
        error: {
          code: 'RECEIPT_REQUIRED',
          message: 'At least one expense receipt is required',
        },
      });
    }
  }

  const budgetEscalationReason = normalizeOptionalTrimmedValue(
    input.body?.budgetEscalationReason,
  );
  const budgetEscalationImpact = normalizeOptionalTrimmedValue(
    input.body?.budgetEscalationImpact,
  );
  const budgetEscalationAlternative = normalizeOptionalTrimmedValue(
    input.body?.budgetEscalationAlternative,
  );
  const effectiveExpense = {
    ...expense,
    ...(budgetEscalationReason !== undefined ? { budgetEscalationReason } : {}),
    ...(budgetEscalationImpact !== undefined ? { budgetEscalationImpact } : {}),
    ...(budgetEscalationAlternative !== undefined
      ? { budgetEscalationAlternative }
      : {}),
  };
  const budgetEvaluation = await p.evaluateExpenseBudget({
    client: p.db,
    expense: effectiveExpense,
  });
  if (
    budgetEvaluation.requiresEscalation &&
    !hasExpenseBudgetEscalationFields(effectiveExpense)
  ) {
    return fail(400, {
      error: {
        code: 'BUDGET_ESCALATION_REQUIRED',
        message:
          'budget escalation details are required when projected expense exceeds budget',
        details: {
          overrunAmount: budgetEvaluation.snapshot.overrunAmount,
          budgetCost: budgetEvaluation.snapshot.budgetCost,
          projectedAmount: budgetEvaluation.snapshot.projectedAmount,
          periodKey: budgetEvaluation.snapshot.periodKey,
          missingFields: missingExpenseBudgetEscalationFields(effectiveExpense),
        },
      },
    });
  }

  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.expense,
    actionKey: 'submit',
    actor: actionPolicyActor(input.actor),
    reasonText,
    state: { status: expense.status, projectId: expense.projectId },
    targetTable: 'expenses',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: 'Expense cannot be submitted',
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

  const submitUpdateData: Record<string, unknown> = {
    status: DocStatusValue.pending_qa,
    budgetSnapshot: budgetEvaluation.snapshot as unknown as object,
    budgetOverrunAmount: budgetEvaluation.requiresEscalation
      ? budgetEvaluation.snapshot.overrunAmount
      : null,
  };
  if (budgetEscalationReason !== undefined) {
    submitUpdateData.budgetEscalationReason = budgetEscalationReason;
  }
  if (budgetEscalationImpact !== undefined) {
    submitUpdateData.budgetEscalationImpact = budgetEscalationImpact;
  }
  if (budgetEscalationAlternative !== undefined) {
    submitUpdateData.budgetEscalationAlternative = budgetEscalationAlternative;
  }
  if (
    budgetEscalationReason !== undefined ||
    budgetEscalationImpact !== undefined ||
    budgetEscalationAlternative !== undefined
  ) {
    submitUpdateData.budgetEscalationUpdatedAt = p.now();
  }

  const actorUserId = input.actor.userId || 'system';
  let submitResult: Awaited<ReturnType<typeof defaultSubmitApprovalWithUpdate>>;
  try {
    submitResult = await p.submitApprovalWithUpdate({
      flowType: FlowTypeValue.expense,
      targetTable: 'expenses',
      targetId: input.id,
      update: (tx) =>
        tx.expense.update({
          where: { id: input.id },
          data: submitUpdateData as any,
        }),
      createdBy: input.actor.userId ?? undefined,
    });
  } catch (error) {
    if (error instanceof ExpenseQaStageRequiredError) {
      return fail(409, {
        error: {
          code: 'EXPENSE_QA_STAGE_REQUIRED',
          message:
            'expense approval rule must include a non-exec stage before exec stage',
        },
      });
    }
    throw error;
  }

  const { updated, approval } = submitResult;
  await p.logExpenseStateTransition({
    client: p.db,
    expenseId: input.id,
    from: {
      status: expense.status,
      settlementStatus: expense.settlementStatus,
    },
    to: {
      status: updated.status,
      settlementStatus: updated.settlementStatus,
    },
    actorUserId,
    reasonText: reasonText || null,
    metadata: {
      trigger: 'submit',
      approvalInstanceId: approval.id,
    },
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
  return ok(updated);
}

export async function markExpensePaid(input: {
  id: string;
  paidAt: Date;
  reasonText: string;
  actor: ExpenseActorContext;
  auditContext: AuditContext;
  ports?: ExpenseApplicationPortOverrides;
}): Promise<ExpenseApplicationResult<unknown>> {
  const p = ports(input.ports);
  const expense = await p.db.expense.findUnique({ where: { id: input.id } });
  if (!expense || expense.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Expense not found' },
    });
  }

  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.expense,
    actionKey: 'mark_paid',
    actor: actionPolicyActor(input.actor),
    reasonText: input.reasonText,
    state: {
      status: expense.status,
      projectId: expense.projectId,
      settlementStatus: expense.settlementStatus,
    },
    targetTable: 'expenses',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: 'Expense cannot be marked as paid',
  });
  if (policyDenied) return policyDenied;
  await auditPolicyResult({
    actionKey: 'mark_paid',
    targetId: input.id,
    reasonText: input.reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });

  if (expense.status !== DocStatusValue.approved) {
    return fail(409, {
      error: {
        code: 'INVALID_STATUS',
        message: 'Expense must be approved to mark as paid',
      },
    });
  }
  if (expense.settlementStatus === 'paid') {
    return fail(409, {
      error: {
        code: 'ALREADY_PAID',
        message: 'Expense is already marked as paid',
      },
    });
  }

  const actorId = input.actor.userId || 'system';
  const updated = await p.db.expense.update({
    where: { id: input.id },
    data: {
      settlementStatus: 'paid',
      paidAt: input.paidAt,
      paidBy: actorId,
      updatedBy: actorId,
    },
  });
  await p.logExpenseStateTransition({
    client: p.db,
    expenseId: input.id,
    from: {
      status: expense.status,
      settlementStatus: expense.settlementStatus,
    },
    to: {
      status: updated.status,
      settlementStatus: updated.settlementStatus,
    },
    actorUserId: actorId,
    reasonText: input.reasonText || null,
    metadata: {
      trigger: 'mark_paid',
      paidAt: updated.paidAt?.toISOString() ?? null,
    },
  });

  await p.createExpenseMarkPaidNotification({
    expenseId: input.id,
    userId: expense.userId,
    projectId: expense.projectId,
    amount: expense.amount?.toString(),
    currency: expense.currency,
    paidAt: updated.paidAt ?? input.paidAt,
    actorUserId: actorId,
  });

  await p.logAudit({
    ...input.auditContext,
    action: 'expense_mark_paid',
    targetTable: 'Expense',
    targetId: input.id,
    reasonText: input.reasonText || undefined,
    metadata: {
      previousStatus: expense.status,
      paidAt: updated.paidAt?.toISOString() ?? null,
      paidBy: updated.paidBy ?? null,
      amount: expense.amount?.toString(),
      currency: expense.currency,
    },
  });

  return ok(updated);
}

export async function unmarkExpensePaid(input: {
  id: string;
  reasonText: string;
  actor: ExpenseActorContext;
  auditContext: AuditContext;
  ports?: ExpenseApplicationPortOverrides;
}): Promise<ExpenseApplicationResult<unknown>> {
  const p = ports(input.ports);
  if (!input.reasonText) {
    return fail(400, {
      error: { code: 'INVALID_REASON', message: 'reasonText is required' },
    });
  }

  const expense = await p.db.expense.findUnique({ where: { id: input.id } });
  if (!expense || expense.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Expense not found' },
    });
  }

  const policyRes = await p.evaluateActionPolicyWithFallback({
    flowType: FlowTypeValue.expense,
    actionKey: 'unmark_paid',
    actor: actionPolicyActor(input.actor),
    reasonText: input.reasonText,
    state: {
      status: expense.status,
      projectId: expense.projectId,
      settlementStatus: expense.settlementStatus,
    },
    targetTable: 'expenses',
    targetId: input.id,
  });
  const policyDenied = policyDeniedResponse({
    result: policyRes,
    reasonRequiredMessage: 'reasonText is required for override',
    deniedMessage: 'Expense cannot be unmarked as paid',
  });
  if (policyDenied) return policyDenied;
  await auditPolicyResult({
    actionKey: 'unmark_paid',
    targetId: input.id,
    reasonText: input.reasonText,
    result: policyRes,
    auditContext: input.auditContext,
    ports: p,
  });

  if (expense.settlementStatus !== 'paid') {
    return fail(409, {
      error: {
        code: 'INVALID_STATUS',
        message: 'Expense is not marked as paid',
      },
    });
  }

  const actorId = input.actor.userId || 'system';
  const updated = await p.db.expense.update({
    where: { id: input.id },
    data: {
      settlementStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      updatedBy: actorId,
    },
  });
  await p.logExpenseStateTransition({
    client: p.db,
    expenseId: input.id,
    from: {
      status: expense.status,
      settlementStatus: expense.settlementStatus,
    },
    to: {
      status: updated.status,
      settlementStatus: updated.settlementStatus,
    },
    actorUserId: actorId,
    reasonText: input.reasonText,
    metadata: { trigger: 'unmark_paid' },
  });

  await p.logAudit({
    ...input.auditContext,
    action: 'expense_unmark_paid',
    targetTable: 'Expense',
    targetId: input.id,
    reasonText: input.reasonText,
    metadata: {
      previousPaidAt: expense.paidAt?.toISOString() ?? null,
      previousPaidBy: expense.paidBy ?? null,
      amount: expense.amount?.toString(),
      currency: expense.currency,
    },
  });

  return ok(updated);
}

export async function reassignExpenseProject(input: {
  id: string;
  toProjectId: string;
  reasonCode: string;
  reasonText: string;
  actor: ExpenseActorContext;
  auditContext: AuditContext;
  ports?: ExpenseApplicationPortOverrides;
}): Promise<ExpenseApplicationResult<unknown>> {
  const p = ports(input.ports);
  if (!input.reasonText) {
    return fail(400, {
      error: { code: 'INVALID_REASON', message: 'reasonText is required' },
    });
  }
  const expense = await p.db.expense.findUnique({ where: { id: input.id } });
  if (!expense) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Expense not found' },
    });
  }
  if (expense.deletedAt) {
    return fail(400, {
      error: { code: 'ALREADY_DELETED', message: 'Expense deleted' },
    });
  }
  if (
    expense.status !== DocStatusValue.draft &&
    expense.status !== DocStatusValue.rejected
  ) {
    return fail(400, {
      error: { code: 'INVALID_STATUS', message: 'Expense not editable' },
    });
  }

  const approvalGuardReply = resolveExpenseReassignGuardReply(
    await p.evaluateActionPolicyGuards(
      {
        guards: [{ type: 'approval_open' }],
        flowType: FlowTypeValue.expense,
        targetTable: 'expenses',
        targetId: input.id,
      },
      { client: p.db },
    ),
  );
  if (approvalGuardReply) return approvalGuardReply;

  const targetProject = await p.db.project.findUnique({
    where: { id: input.toProjectId },
    select: { id: true, deletedAt: true },
  });
  if (!targetProject || targetProject.deletedAt) {
    return fail(404, {
      error: { code: 'NOT_FOUND', message: 'Project not found' },
    });
  }

  const projectIds = [expense.projectId];
  if (input.toProjectId !== expense.projectId) {
    projectIds.push(input.toProjectId);
  }
  const periodGuardReply = resolveExpenseReassignGuardReply(
    await p.evaluateActionPolicyGuards(
      {
        guards: [{ type: 'period_lock' }],
        flowType: FlowTypeValue.expense,
        state: {
          projectIds,
          periodKey: toPeriodKey(expense.incurredOn),
        },
      },
      { client: p.db },
    ),
  );
  if (periodGuardReply) return periodGuardReply;

  const updated = await p.db.expense.update({
    where: { id: input.id },
    data: { projectId: input.toProjectId },
  });
  await p.logAudit({
    ...input.auditContext,
    action: 'reassignment',
    targetTable: 'expenses',
    targetId: input.id,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    metadata: {
      fromProjectId: expense.projectId,
      toProjectId: input.toProjectId,
    },
  });
  await p.logReassignment({
    targetTable: 'expenses',
    targetId: input.id,
    fromProjectId: expense.projectId,
    toProjectId: input.toProjectId,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    createdBy: input.actor.userId ?? undefined,
  });
  return ok(updated);
}
