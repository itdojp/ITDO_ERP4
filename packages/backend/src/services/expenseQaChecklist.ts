export type ExpenseQaChecklistLike = {
  amountVerified: boolean;
  receiptVerified: boolean;
  journalPrepared: boolean;
  projectLinked: boolean;
  budgetChecked: boolean;
};

export const EXPENSE_QA_CHECKLIST_FIELDS: Array<keyof ExpenseQaChecklistLike> =
  [
    'amountVerified',
    'receiptVerified',
    'journalPrepared',
    'projectLinked',
    'budgetChecked',
  ];

export function isExpenseQaChecklistComplete(
  checklist: ExpenseQaChecklistLike | null | undefined,
): boolean {
  if (!checklist) return false;
  return EXPENSE_QA_CHECKLIST_FIELDS.every((field) => checklist[field]);
}

export function normalizeExpenseQaChecklist(
  checklist: Partial<ExpenseQaChecklistLike> | null | undefined,
): ExpenseQaChecklistLike {
  return {
    amountVerified: Boolean(checklist?.amountVerified),
    receiptVerified: Boolean(checklist?.receiptVerified),
    journalPrepared: Boolean(checklist?.journalPrepared),
    projectLinked: Boolean(checklist?.projectLinked),
    budgetChecked: Boolean(checklist?.budgetChecked),
  };
}
