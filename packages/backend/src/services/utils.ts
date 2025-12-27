export function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object') {
    const maybeDecimal = value as {
      toNumber?: () => number;
      toString?: () => string;
    };
    if (typeof maybeDecimal.toNumber === 'function')
      return maybeDecimal.toNumber();
    if (typeof maybeDecimal.toString === 'function') {
      const parsed = Number(maybeDecimal.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
