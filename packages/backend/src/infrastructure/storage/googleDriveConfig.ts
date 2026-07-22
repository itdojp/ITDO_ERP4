export type GoogleDriveCredentialConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  deprecatedAliasesPresent: string[];
};

export type GoogleDriveTuningConfig = {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  resumableUploadThresholdBytes: number;
};

export const GOOGLE_DRIVE_TUNING_DEFAULTS: GoogleDriveTuningConfig = {
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 250,
  resumableUploadThresholdBytes: 5 * 1024 * 1024,
};

const CREDENTIAL_KEYS = [
  {
    common: 'ERP4_GDRIVE_CLIENT_ID',
    legacy: 'CHAT_ATTACHMENT_GDRIVE_CLIENT_ID',
    property: 'clientId',
  },
  {
    common: 'ERP4_GDRIVE_CLIENT_SECRET',
    legacy: 'CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET',
    property: 'clientSecret',
  },
  {
    common: 'ERP4_GDRIVE_REFRESH_TOKEN',
    legacy: 'CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN',
    property: 'refreshToken',
  },
] as const;

type CredentialProperty = (typeof CREDENTIAL_KEYS)[number]['property'];

function normalized(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

export class GoogleDriveConfigurationError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super('google_drive_configuration_invalid');
    this.name = 'GoogleDriveConfigurationError';
    this.keys = [...keys];
  }
}

export function resolveGoogleDriveCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GoogleDriveCredentialConfig {
  const commonValues: Partial<Record<CredentialProperty, string>> = {};
  const legacyValues: Partial<Record<CredentialProperty, string>> = {};
  const deprecatedAliasesPresent: string[] = [];
  let commonPresent = 0;

  for (const key of CREDENTIAL_KEYS) {
    const commonValue = normalized(env[key.common]);
    const legacyValue = normalized(env[key.legacy]);
    if (commonValue) {
      commonValues[key.property] = commonValue;
      commonPresent += 1;
    }
    if (legacyValue) {
      legacyValues[key.property] = legacyValue;
      deprecatedAliasesPresent.push(key.legacy);
    }
  }

  const useCommon = commonPresent > 0;
  const values = useCommon ? commonValues : legacyValues;
  const missing = CREDENTIAL_KEYS.filter((key) => !values[key.property]).map(
    (key) => key.common,
  );
  if (missing.length > 0) {
    throw new GoogleDriveConfigurationError(missing);
  }

  return {
    clientId: values.clientId as string,
    clientSecret: values.clientSecret as string,
    refreshToken: values.refreshToken as string,
    deprecatedAliasesPresent,
  };
}

export function resolveGoogleDriveCommonCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GoogleDriveCredentialConfig {
  const values: Partial<Record<CredentialProperty, string>> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = normalized(env[key.common]);
    if (value) values[key.property] = value;
  }
  const missing = CREDENTIAL_KEYS.filter((key) => !values[key.property]).map(
    (key) => key.common,
  );
  if (missing.length > 0) {
    throw new GoogleDriveConfigurationError(missing);
  }
  return {
    clientId: values.clientId as string,
    clientSecret: values.clientSecret as string,
    refreshToken: values.refreshToken as string,
    deprecatedAliasesPresent: [],
  };
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const value = normalized(env[key]);
  if (!value) return fallback;
  if (!/^[0-9]+$/.test(value)) {
    throw new GoogleDriveConfigurationError([key]);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GoogleDriveConfigurationError([key]);
  }
  return parsed;
}

export function resolveGoogleDriveTuningConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleDriveTuningConfig {
  return {
    timeoutMs: parseInteger(
      env,
      'ERP4_GDRIVE_TIMEOUT_MS',
      GOOGLE_DRIVE_TUNING_DEFAULTS.timeoutMs,
      1,
      300_000,
    ),
    maxRetries: parseInteger(
      env,
      'ERP4_GDRIVE_MAX_RETRIES',
      GOOGLE_DRIVE_TUNING_DEFAULTS.maxRetries,
      0,
      10,
    ),
    retryBaseDelayMs: parseInteger(
      env,
      'ERP4_GDRIVE_RETRY_BASE_DELAY_MS',
      GOOGLE_DRIVE_TUNING_DEFAULTS.retryBaseDelayMs,
      1,
      60_000,
    ),
    resumableUploadThresholdBytes: parseInteger(
      env,
      'ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES',
      GOOGLE_DRIVE_TUNING_DEFAULTS.resumableUploadThresholdBytes,
      1,
    ),
  };
}

export function resolveGoogleDriveSharedDriveId(
  env: NodeJS.ProcessEnv = process.env,
) {
  return normalized(env.ERP4_GDRIVE_SHARED_DRIVE_ID);
}

export function formatGoogleDriveLegacyEnvWarning(aliases: string[]) {
  const uniqueAliases = Array.from(new Set(aliases)).sort();
  if (uniqueAliases.length === 0) return null;
  return (
    '[storage:gdrive] deprecated credential aliases are configured: ' +
    `${uniqueAliases.join(', ')}; migrate to ERP4_GDRIVE_*`
  );
}
