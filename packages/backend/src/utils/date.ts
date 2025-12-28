export function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function endOfDay(value: Date) {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
}
