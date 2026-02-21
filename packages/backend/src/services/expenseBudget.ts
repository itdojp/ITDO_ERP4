import { DocStatus } from '@prisma/client';
import { prisma } from './db.js';
import { toNumber } from './utils.js';

const OPEN_APPROVAL_STATUSES = [DocStatus.pending_qa, DocStatus.pending_exec];

type ExpenseLike = {
  id: string;
  projectId: string;
  amount: unknown;
  currency: string | null;
  incurredOn: Date;
  status: string;
  budgetEscalationReason?: string | null;
  budgetEscalationImpact?: string | null;
  budgetEscalationAlternative?: string | null;
};

export type ExpenseBudgetSnapshot = {
  periodKey: string;
  includePending: boolean;
  evaluable: boolean;
  reason: string | null;
  budgetCost: number | null;
  budgetCurrency: string | null;
  expenseCurrency: string | null;
  approvedAmount: number;
  pendingAmount: number;
  currentAmount: number;
  projectedAmount: number;
  remainingAmount: number | null;
  overrunAmount: number;
};

export type EvaluateExpenseBudgetResult = {
  snapshot: ExpenseBudgetSnapshot;
  requiresEscalation: boolean;
};

function startOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthUtc(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
}

function toPeriodKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

export function hasExpenseBudgetEscalationFields(
  expense: ExpenseLike,
): boolean {
  const reason = expense.budgetEscalationReason?.trim() ?? '';
  const impact = expense.budgetEscalationImpact?.trim() ?? '';
  const alternative = expense.budgetEscalationAlternative?.trim() ?? '';
  return Boolean(reason && impact && alternative);
}

export function missingExpenseBudgetEscalationFields(
  expense: ExpenseLike,
): string[] {
  const missing: string[] = [];
  if (!(expense.budgetEscalationReason?.trim() ?? '')) {
    missing.push('budgetEscalationReason');
  }
  if (!(expense.budgetEscalationImpact?.trim() ?? '')) {
    missing.push('budgetEscalationImpact');
  }
  if (!(expense.budgetEscalationAlternative?.trim() ?? '')) {
    missing.push('budgetEscalationAlternative');
  }
  return missing;
}

export async function evaluateExpenseBudget(input: {
  client?: any;
  expense: ExpenseLike;
  includePending?: boolean;
}): Promise<EvaluateExpenseBudgetResult> {
  const tx = input.client ?? prisma;
  const includePending = input.includePending ?? true;
  const { expense } = input;
  const periodStart = startOfMonthUtc(expense.incurredOn);
  const periodEnd = endOfMonthUtc(expense.incurredOn);
  const periodKey = toPeriodKey(expense.incurredOn);
  const expenseCurrency = expense.currency ?? null;
  const currentAmount = roundAmount(toNumber(expense.amount));

  const project = await tx.project.findUnique({
    where: { id: expense.projectId },
    select: { budgetCost: true, currency: true },
  });

  if (!project) {
    return {
      snapshot: {
        periodKey,
        includePending,
        evaluable: false,
        reason: 'project_not_found',
        budgetCost: null,
        budgetCurrency: null,
        expenseCurrency,
        approvedAmount: 0,
        pendingAmount: 0,
        currentAmount,
        projectedAmount: currentAmount,
        remainingAmount: null,
        overrunAmount: 0,
      },
      requiresEscalation: false,
    };
  }

  const budgetCost = project.budgetCost
    ? roundAmount(toNumber(project.budgetCost))
    : 0;
  const budgetCurrency = project.currency ?? expenseCurrency;
  if (budgetCost <= 0) {
    return {
      snapshot: {
        periodKey,
        includePending,
        evaluable: false,
        reason: 'budget_unset',
        budgetCost: null,
        budgetCurrency,
        expenseCurrency,
        approvedAmount: 0,
        pendingAmount: 0,
        currentAmount,
        projectedAmount: currentAmount,
        remainingAmount: null,
        overrunAmount: 0,
      },
      requiresEscalation: false,
    };
  }

  if (budgetCurrency && expenseCurrency && budgetCurrency !== expenseCurrency) {
    return {
      snapshot: {
        periodKey,
        includePending,
        evaluable: false,
        reason: 'currency_mismatch',
        budgetCost,
        budgetCurrency,
        expenseCurrency,
        approvedAmount: 0,
        pendingAmount: 0,
        currentAmount,
        projectedAmount: currentAmount,
        remainingAmount: budgetCost,
        overrunAmount: 0,
      },
      requiresEscalation: false,
    };
  }

  const amountFilter = budgetCurrency ? { currency: budgetCurrency } : {};

  const baseWhere = {
    projectId: expense.projectId,
    deletedAt: null,
    incurredOn: { gte: periodStart, lte: periodEnd },
    ...amountFilter,
  };

  const [approved, pending] = await Promise.all([
    tx.expense.aggregate({
      where: {
        ...baseWhere,
        status: DocStatus.approved,
      },
      _sum: { amount: true },
    }),
    includePending
      ? tx.expense.aggregate({
          where: {
            ...baseWhere,
            status: { in: OPEN_APPROVAL_STATUSES },
          },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: 0 } }),
  ]);

  const approvedAmount = roundAmount(toNumber(approved._sum.amount));
  const pendingAmount = roundAmount(toNumber(pending._sum.amount));
  const currentAlreadyCounted =
    expense.status === DocStatus.approved ||
    expense.status === DocStatus.pending_qa ||
    expense.status === DocStatus.pending_exec;
  const projectedAmount = roundAmount(
    approvedAmount +
      pendingAmount +
      (currentAlreadyCounted ? 0 : currentAmount),
  );
  const overrunAmount = roundAmount(Math.max(0, projectedAmount - budgetCost));
  const remainingAmount = roundAmount(budgetCost - projectedAmount);

  return {
    snapshot: {
      periodKey,
      includePending,
      evaluable: true,
      reason: null,
      budgetCost,
      budgetCurrency,
      expenseCurrency,
      approvedAmount,
      pendingAmount,
      currentAmount,
      projectedAmount,
      remainingAmount,
      overrunAmount,
    },
    requiresEscalation: overrunAmount > 0,
  };
}
