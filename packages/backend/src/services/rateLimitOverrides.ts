type RouteRateLimitOptions = {
  max: number;
  timeWindow: string;
};

function normalizeString(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseTimeWindow(value: string | undefined, fallback: string) {
  return normalizeString(value) || fallback;
}

export function getRouteRateLimitOptions(
  prefix: string,
  defaults: RouteRateLimitOptions,
) {
  return {
    max: parsePositiveInt(process.env[`${prefix}_MAX`], defaults.max),
    timeWindow: parseTimeWindow(
      process.env[`${prefix}_WINDOW`],
      defaults.timeWindow,
    ),
  };
}
