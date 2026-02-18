export type DueDateRule = {
  type: 'periodEndPlusOffset';
  offsetDays: number;
};

const OFFSET_MIN_DAYS = 0;
const OFFSET_MAX_DAYS = 365;

export function parseDueDateRule(input: unknown): DueDateRule | null {
  if (input == null) return null;
  if (typeof input !== 'object') {
    throw new Error('invalid_due_date_rule');
  }
  const payload = input as { type?: unknown; offsetDays?: unknown };
  if (payload.type !== 'periodEndPlusOffset') {
    throw new Error('invalid_due_date_rule');
  }
  if (
    typeof payload.offsetDays === 'string' &&
    payload.offsetDays.trim().length === 0
  ) {
    throw new Error('invalid_due_date_rule');
  }
  const parsedOffset =
    typeof payload.offsetDays === 'number'
      ? payload.offsetDays
      : Number(payload.offsetDays);
  if (!Number.isFinite(parsedOffset) || !Number.isInteger(parsedOffset)) {
    throw new Error('invalid_due_date_rule');
  }
  if (parsedOffset < OFFSET_MIN_DAYS || parsedOffset > OFFSET_MAX_DAYS) {
    throw new Error('invalid_due_date_rule');
  }
  return { type: 'periodEndPlusOffset', offsetDays: parsedOffset };
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function computeDueDate(
  runAt: Date,
  rule: DueDateRule | null,
): Date | null {
  if (!rule) return null;
  const base = endOfMonth(runAt);
  const result = new Date(base);
  result.setDate(result.getDate() + rule.offsetDays);
  return result;
}
