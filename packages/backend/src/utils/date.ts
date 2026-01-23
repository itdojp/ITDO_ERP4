export function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function toDateOnly(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function diffInDays(from: Date, to: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = toDateOnly(from).getTime();
  const end = toDateOnly(to).getTime();
  return Math.floor((end - start) / msPerDay);
}

export function isWithinEditableDays(
  targetDate: Date,
  editableDays: number,
  now = new Date(),
) {
  return diffInDays(now, targetDate) <= editableDays;
}

export function endOfDay(value: Date) {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
}
