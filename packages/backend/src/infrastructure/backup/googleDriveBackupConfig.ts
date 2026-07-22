import path from 'node:path';

import {
  GOOGLE_DRIVE_TUNING_DEFAULTS,
  type GoogleDriveCredentialConfig,
  type GoogleDriveTuningConfig,
} from '../storage/googleDriveConfig.js';
import {
  createGoogleDriveApi,
  GoogleDriveObjectStore,
} from '../storage/googleDriveObjectStore.js';

export type BackupSecondaryProvider = 'gdrive' | 'none';

export type GoogleDriveBackupConfig = {
  credentials: GoogleDriveCredentialConfig;
  folderId: string;
  provider: 'gdrive';
  sharedDriveId: string;
  stateDir: string;
  tuning: GoogleDriveTuningConfig;
  verifyDownload: boolean;
};

export type BackupSecondaryConfig =
  GoogleDriveBackupConfig | { provider: 'none' };

export class GoogleDriveBackupConfigurationError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super('backup_google_drive_configuration_invalid');
    this.name = 'GoogleDriveBackupConfigurationError';
    this.keys = [...new Set(keys)].sort();
  }
}

function normalized(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = normalized(env[key]);
  if (!value) return fallback;
  if (!/^[0-9]+$/.test(value)) {
    throw new GoogleDriveBackupConfigurationError([key]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GoogleDriveBackupConfigurationError([key]);
  }
  return parsed;
}

function parseBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = normalized(env[key]);
  if (!value) return fallback;
  if (value === '0') return false;
  if (value === '1') return true;
  throw new GoogleDriveBackupConfigurationError([key]);
}

export function resolveGoogleDriveBackupConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackupSecondaryConfig {
  const provider = normalized(env.BACKUP_SECONDARY_PROVIDER) ?? 'none';
  if (provider === 'none') return { provider };
  if (provider !== 'gdrive') {
    throw new GoogleDriveBackupConfigurationError([
      'BACKUP_SECONDARY_PROVIDER',
    ]);
  }

  const required = {
    clientId: normalized(env.BACKUP_GDRIVE_CLIENT_ID),
    clientSecret: normalized(env.BACKUP_GDRIVE_CLIENT_SECRET),
    refreshToken: normalized(env.BACKUP_GDRIVE_REFRESH_TOKEN),
    sharedDriveId: normalized(env.BACKUP_GDRIVE_SHARED_DRIVE_ID),
    folderId: normalized(env.BACKUP_GDRIVE_FOLDER_ID),
  };
  const keyByProperty = {
    clientId: 'BACKUP_GDRIVE_CLIENT_ID',
    clientSecret: 'BACKUP_GDRIVE_CLIENT_SECRET',
    refreshToken: 'BACKUP_GDRIVE_REFRESH_TOKEN',
    sharedDriveId: 'BACKUP_GDRIVE_SHARED_DRIVE_ID',
    folderId: 'BACKUP_GDRIVE_FOLDER_ID',
  } as const;
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([property]) => keyByProperty[property as keyof typeof required]);
  if (missing.length > 0) {
    throw new GoogleDriveBackupConfigurationError(missing);
  }

  const timeoutSec = parseInteger(
    env,
    'BACKUP_GDRIVE_UPLOAD_TIMEOUT_SEC',
    300,
    1,
    3600,
  );
  const maxRetries = parseInteger(
    env,
    'BACKUP_GDRIVE_RETRY_MAX',
    GOOGLE_DRIVE_TUNING_DEFAULTS.maxRetries,
    0,
    10,
  );
  const backupDir = normalized(env.BACKUP_DIR) ?? '.codex-local/secure';
  const stateDir = path.resolve(
    normalized(env.BACKUP_GDRIVE_STATE_DIR) ??
      path.join(backupDir, '.gdrive-state'),
  );

  return {
    provider: 'gdrive',
    credentials: {
      clientId: required.clientId as string,
      clientSecret: required.clientSecret as string,
      refreshToken: required.refreshToken as string,
      deprecatedAliasesPresent: [],
    },
    sharedDriveId: required.sharedDriveId as string,
    folderId: required.folderId as string,
    stateDir,
    tuning: {
      timeoutMs: timeoutSec * 1000,
      maxRetries,
      retryBaseDelayMs: GOOGLE_DRIVE_TUNING_DEFAULTS.retryBaseDelayMs,
      resumableUploadThresholdBytes:
        GOOGLE_DRIVE_TUNING_DEFAULTS.resumableUploadThresholdBytes,
    },
    verifyDownload: parseBoolean(env, 'BACKUP_GDRIVE_VERIFY_DOWNLOAD', false),
  };
}

export function createGoogleDriveBackupObjectStore(
  config: GoogleDriveBackupConfig,
) {
  return new GoogleDriveObjectStore(createGoogleDriveApi(config.credentials), {
    ...config.tuning,
    folderId: config.folderId,
    sharedDriveId: config.sharedDriveId,
  });
}
