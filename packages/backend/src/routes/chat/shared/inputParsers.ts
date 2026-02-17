export function parseLimit(value?: string, fallback = 50) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 200);
}

export function parseLimitNumber(value: unknown, fallback = 100) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;
  return Math.min(normalized, 200);
}

export function parseNonNegativeInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function normalizeStringArray(
  value: unknown,
  options?: { dedupe?: boolean; max?: number },
) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  const deduped = options?.dedupe ? Array.from(new Set(items)) : items;
  return typeof options?.max === 'number'
    ? deduped.slice(0, options.max)
    : deduped;
}
