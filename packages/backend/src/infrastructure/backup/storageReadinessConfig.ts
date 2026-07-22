import type { BackupReadinessPolicy } from '../../application/backup/storageReadiness.js';

export type StorageReadinessConfig = {
  backup: {
    driveSecondary: BackupReadinessPolicy;
    local: BackupReadinessPolicy;
    sakura: BackupReadinessPolicy;
  };
  drive: { criticalPercent: number; warningPercent: number };
  restoreMaxAgeMs: number;
};

export class StorageReadinessConfigurationError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super('storage_readiness_configuration_invalid');
    this.name = 'StorageReadinessConfigurationError';
    this.keys = [...new Set(keys)].sort();
  }
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw))
    throw new StorageReadinessConfigurationError([key]);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new StorageReadinessConfigurationError([key]);
  }
  return parsed;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function resolveStorageReadinessConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageReadinessConfig {
  const warningPercent = parseInteger(
    env,
    'STORAGE_READINESS_DRIVE_WARNING_PERCENT',
    70,
    1,
    99,
  );
  const criticalPercent = parseInteger(
    env,
    'STORAGE_READINESS_DRIVE_CRITICAL_PERCENT',
    80,
    2,
    100,
  );
  if (warningPercent >= criticalPercent) {
    throw new StorageReadinessConfigurationError([
      'STORAGE_READINESS_DRIVE_WARNING_PERCENT',
      'STORAGE_READINESS_DRIVE_CRITICAL_PERCENT',
    ]);
  }
  const minimums = {
    hourly: parseInteger(env, 'STORAGE_READINESS_MIN_HOURLY', 48, 1, 10_000),
    daily: parseInteger(env, 'STORAGE_READINESS_MIN_DAILY', 30, 1, 10_000),
    weekly: parseInteger(env, 'STORAGE_READINESS_MIN_WEEKLY', 12, 1, 10_000),
    monthly: parseInteger(env, 'STORAGE_READINESS_MIN_MONTHLY', 13, 1, 10_000),
  };
  return {
    drive: { warningPercent, criticalPercent },
    backup: {
      local: {
        freshnessClass: 'hourly',
        maxAgeMs:
          parseInteger(
            env,
            'STORAGE_READINESS_LOCAL_MAX_AGE_HOURS',
            2,
            1,
            720,
          ) * HOUR_MS,
        minimums,
      },
      sakura: {
        freshnessClass: 'hourly',
        maxAgeMs:
          parseInteger(
            env,
            'STORAGE_READINESS_SAKURA_MAX_AGE_HOURS',
            2,
            1,
            720,
          ) * HOUR_MS,
        minimums,
      },
      driveSecondary: {
        freshnessClass: 'daily',
        maxAgeMs:
          parseInteger(
            env,
            'STORAGE_READINESS_GDRIVE_MAX_AGE_HOURS',
            30,
            1,
            720,
          ) * HOUR_MS,
        minimums: {
          daily: minimums.daily,
          weekly: minimums.weekly,
          monthly: minimums.monthly,
        },
      },
    },
    restoreMaxAgeMs:
      parseInteger(env, 'STORAGE_READINESS_RESTORE_MAX_AGE_DAYS', 30, 1, 3650) *
      DAY_MS,
  };
}
