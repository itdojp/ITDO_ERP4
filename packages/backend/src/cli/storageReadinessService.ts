import {
  assessBackupReadiness,
  assessDriveReadiness,
  assessRestoreEvidence,
  buildStorageReadinessReport,
  type BackupReadinessObservation,
  type DriveReadinessObservation,
  type StorageReadinessComponent,
} from '../application/backup/storageReadiness.js';
import {
  inspectBackupObjectSource,
  type BackupObjectSource,
} from '../application/backup/backupManifestReadiness.js';
import {
  inspectGoogleDriveBackupReadiness,
  inventoryGoogleDriveBackups,
} from '../application/backup/googleDriveSecondaryBackup.js';
import {
  createLocalBackupObjectSource,
  resolveSakuraBackupObjectSource,
  BackupReadinessSourceConfigurationError,
} from '../infrastructure/backup/backupReadinessSources.js';
import {
  createGoogleDriveBackupObjectStore,
  GoogleDriveBackupConfigurationError,
  resolveGoogleDriveBackupConfig,
} from '../infrastructure/backup/googleDriveBackupConfig.js';
import {
  resolveStorageReadinessConfig,
  type StorageReadinessConfig,
} from '../infrastructure/backup/storageReadinessConfig.js';
import { inspectRestoreEvidence } from '../infrastructure/backup/restoreEvidenceReadiness.js';
import {
  GoogleDriveConfigurationError,
  resolveGoogleDriveCommonCredentials,
  resolveGoogleDriveCredentials,
  resolveGoogleDriveSharedDriveId,
  resolveGoogleDriveTuningConfig,
} from '../infrastructure/storage/googleDriveConfig.js';
import {
  createGoogleDriveApi,
  GoogleDriveObjectStoreError,
  normalizeGoogleDriveError,
  type GoogleDriveApi,
} from '../infrastructure/storage/googleDriveObjectStore.js';
import {
  readGoogleDriveQuota,
  runGoogleDriveCheck,
} from './googleDriveCheckService.js';

type DriveComponent = Extract<
  StorageReadinessComponent['component'],
  `app_gdrive_${string}`
>;

const DRIVE_CONTEXTS: Array<{
  component: DriveComponent;
  folderKey: string;
  legacyCredentials: boolean;
  nonDriveProviders: readonly string[];
  providerKey: string;
}> = [
  {
    component: 'app_gdrive_chat',
    folderKey: 'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID',
    legacyCredentials: true,
    nonDriveProviders: ['local'],
    providerKey: 'CHAT_ATTACHMENT_PROVIDER',
  },
  {
    component: 'app_gdrive_pdf',
    folderKey: 'PDF_GDRIVE_FOLDER_ID',
    legacyCredentials: false,
    nonDriveProviders: ['local', 'external'],
    providerKey: 'PDF_PROVIDER',
  },
  {
    component: 'app_gdrive_evidence',
    folderKey: 'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
    legacyCredentials: false,
    nonDriveProviders: ['local', 's3'],
    providerKey: 'EVIDENCE_ARCHIVE_PROVIDER',
  },
  {
    component: 'app_gdrive_report',
    folderKey: 'REPORT_GDRIVE_FOLDER_ID',
    legacyCredentials: false,
    nonDriveProviders: ['local'],
    providerKey: 'REPORT_PROVIDER',
  },
];

type StorageReadinessDependencies = {
  createDriveApi: typeof createGoogleDriveApi;
  createLocalSource: (options: {
    directory: string;
    prefix: string;
  }) => BackupObjectSource;
  inspectRestore: typeof inspectRestoreEvidence;
  now: () => Date;
  probeDriveSecondary: (
    env: NodeJS.ProcessEnv,
    now: Date,
    policy: StorageReadinessConfig['backup']['driveSecondary'],
  ) => Promise<BackupReadinessObservation>;
  resolveSakuraSource: typeof resolveSakuraBackupObjectSource;
};

const DEFAULT_DEPENDENCIES: StorageReadinessDependencies = {
  createDriveApi: createGoogleDriveApi,
  createLocalSource: createLocalBackupObjectSource,
  inspectRestore: inspectRestoreEvidence,
  now: () => new Date(),
  probeDriveSecondary,
  resolveSakuraSource: resolveSakuraBackupObjectSource,
};

function normalized(value: string | undefined) {
  return value?.trim() || undefined;
}

function isSafeToken(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value));
}

function driveErrorObservation(error: unknown): DriveReadinessObservation {
  if (error instanceof GoogleDriveConfigurationError) {
    return { configured: true, errorCode: 'configuration_invalid' };
  }
  const normalizedError = normalizeGoogleDriveError(error, 'target_check');
  return { configured: true, errorCode: normalizedError.code };
}

async function probeDriveContext(options: {
  context: (typeof DRIVE_CONTEXTS)[number];
  dependencies: StorageReadinessDependencies;
  env: NodeJS.ProcessEnv;
  writeProbe: boolean;
}): Promise<DriveReadinessObservation> {
  const provider = (
    normalized(options.env[options.context.providerKey]) ?? 'local'
  ).toLowerCase();
  if (options.context.nonDriveProviders.includes(provider)) {
    return { configured: false };
  }
  if (provider !== 'gdrive') {
    return { configured: true, errorCode: 'configuration_invalid' };
  }
  try {
    const folderId = normalized(options.env[options.context.folderKey]);
    if (!folderId)
      throw new GoogleDriveConfigurationError([options.context.folderKey]);
    const credentials = options.context.legacyCredentials
      ? resolveGoogleDriveCredentials(options.env)
      : resolveGoogleDriveCommonCredentials(options.env);
    const tuning = resolveGoogleDriveTuningConfig(options.env);
    const drive = options.dependencies.createDriveApi(credentials);
    const checked = await runGoogleDriveCheck({
      drive,
      folderId,
      mode: options.writeProbe ? 'write' : 'read',
      sharedDriveId: resolveGoogleDriveSharedDriveId(options.env),
      tuning,
      log: () => undefined,
    });
    let quota: DriveReadinessObservation['quota'];
    try {
      quota = await readGoogleDriveQuota({ drive, tuning });
    } catch {
      quota = { state: 'unknown' };
    }
    return {
      configured: true,
      folderAccessible: true,
      permissionEntries: checked.permissionEntries,
      quota,
      writeProbe: checked.writeProbe,
    };
  } catch (error) {
    return driveErrorObservation(error);
  }
}

function backupFailure(error: unknown): BackupReadinessObservation {
  if (
    error instanceof BackupReadinessSourceConfigurationError ||
    error instanceof GoogleDriveBackupConfigurationError
  ) {
    return {
      anomalyCounts: {},
      classCounts: {},
      classTimestamps: {},
      configured: true,
      errorCode: 'configuration_invalid',
      latestGeneratedAt: null,
      retentionCandidates: 0,
    };
  }
  if (error instanceof GoogleDriveObjectStoreError) {
    return {
      anomalyCounts: {},
      classCounts: {},
      classTimestamps: {},
      configured: true,
      errorCode: error.code,
      latestGeneratedAt: null,
      retentionCandidates: 0,
    };
  }
  const status =
    error && typeof error === 'object' && '$metadata' in error
      ? Number(
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode,
        )
      : undefined;
  const providerCode =
    error && typeof error === 'object'
      ? String(
          (error as { code?: unknown; name?: unknown }).code ??
            (error as { name?: unknown }).name ??
            '',
        )
      : '';
  const errorCode =
    status === 401
      ? 'auth_expired'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 429
            ? 'quota'
            : status && status >= 500
              ? 'retryable'
              : status && status >= 400
                ? 'permanent'
                : /Timeout|Abort|ETIMEDOUT/i.test(providerCode)
                  ? 'timeout'
                  : /CredentialsProvider|ExpiredToken|InvalidAccessKey/i.test(
                        providerCode,
                      )
                    ? 'auth_expired'
                    : /AccessDenied|SignatureDoesNotMatch/i.test(providerCode)
                      ? 'forbidden'
                      : /NoSuchBucket|NoSuchKey|NotFound/i.test(providerCode)
                        ? 'not_found'
                        : /SlowDown|Throttl|TooManyRequests/i.test(providerCode)
                          ? 'quota'
                          : /InvalidArgument|InvalidRequest|InvalidBucketName|PermanentRedirect/i.test(
                                providerCode,
                              )
                            ? 'permanent'
                            : /Networking|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(
                                  providerCode,
                                )
                              ? 'retryable'
                              : 'inventory_unavailable';
  return {
    anomalyCounts: {},
    classCounts: {},
    classTimestamps: {},
    configured: true,
    errorCode,
    latestGeneratedAt: null,
    retentionCandidates: 0,
  };
}

async function probeLocalBackup(options: {
  config: StorageReadinessConfig;
  dependencies: StorageReadinessDependencies;
  env: NodeJS.ProcessEnv;
  now: Date;
}) {
  const directory = normalized(options.env.BACKUP_DIR);
  if (!directory) {
    return {
      anomalyCounts: {},
      classCounts: {},
      classTimestamps: {},
      configured: false,
      latestGeneratedAt: null,
      retentionCandidates: 0,
    } satisfies BackupReadinessObservation;
  }
  const environment = normalized(options.env.ENVIRONMENT);
  const prefix = normalized(options.env.BACKUP_PREFIX) ?? 'erp4';
  if (!isSafeToken(environment))
    return backupFailure(new BackupReadinessSourceConfigurationError());
  try {
    return await inspectBackupObjectSource({
      configured: true,
      expectedEnvironment: environment,
      now: options.now,
      policy: options.config.backup.local,
      requireOpenPgp: true,
      source: options.dependencies.createLocalSource({ directory, prefix }),
    });
  } catch (error) {
    return backupFailure(error);
  }
}

async function probeSakuraBackup(options: {
  config: StorageReadinessConfig;
  dependencies: StorageReadinessDependencies;
  env: NodeJS.ProcessEnv;
  now: Date;
}) {
  try {
    const resolved = options.dependencies.resolveSakuraSource(options.env);
    if (!resolved.configured) {
      return {
        anomalyCounts: {},
        classCounts: {},
        classTimestamps: {},
        configured: false,
        latestGeneratedAt: null,
        retentionCandidates: 0,
      } satisfies BackupReadinessObservation;
    }
    const environment = normalized(options.env.ENVIRONMENT);
    if (!isSafeToken(environment)) {
      throw new BackupReadinessSourceConfigurationError();
    }
    return await inspectBackupObjectSource({
      configured: true,
      expectedEnvironment: environment,
      now: options.now,
      policy: options.config.backup.sakura,
      requireOpenPgp: true,
      source: resolved.source,
    });
  } catch (error) {
    return backupFailure(error);
  }
}

async function probeDriveSecondary(
  env: NodeJS.ProcessEnv,
  now: Date,
  policy: StorageReadinessConfig['backup']['driveSecondary'],
) {
  try {
    const config = resolveGoogleDriveBackupConfig(env);
    if (config.provider === 'none') {
      return {
        anomalyCounts: {},
        classCounts: {},
        classTimestamps: {},
        configured: false,
        latestGeneratedAt: null,
        retentionCandidates: 0,
      } satisfies BackupReadinessObservation;
    }
    const store = createGoogleDriveBackupObjectStore(config);
    return inspectGoogleDriveBackupReadiness(
      await inventoryGoogleDriveBackups(store),
      now,
      policy,
    );
  } catch (error) {
    return backupFailure(error);
  }
}

export async function runStorageReadiness(options: {
  dependencies?: Partial<StorageReadinessDependencies>;
  env?: NodeJS.ProcessEnv;
  writeProbe?: boolean;
}) {
  const env = options.env ?? process.env;
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const config = resolveStorageReadinessConfig(env);
  const now = dependencies.now();
  const driveObservations = await Promise.all(
    DRIVE_CONTEXTS.map(async (context) => ({
      context,
      observation: await probeDriveContext({
        context,
        dependencies,
        env,
        writeProbe: options.writeProbe === true,
      }),
    })),
  );
  const [local, sakura, driveSecondary, restore] = await Promise.all([
    probeLocalBackup({ config, dependencies, env, now }),
    probeSakuraBackup({ config, dependencies, env, now }),
    dependencies.probeDriveSecondary(env, now, config.backup.driveSecondary),
    dependencies.inspectRestore({
      evidenceFile: normalized(env.STORAGE_READINESS_RESTORE_EVIDENCE_FILE),
      expectedBackupId: normalized(
        env.STORAGE_READINESS_RESTORE_EXPECTED_BACKUP_ID,
      ),
      expectedEnvironment: normalized(env.ENVIRONMENT),
    }),
  ]);
  const components: StorageReadinessComponent[] = driveObservations.map(
    ({ context, observation }) =>
      assessDriveReadiness(context.component, observation, config.drive),
  );
  components.push(
    assessBackupReadiness('backup_local', local, config.backup.local, now),
    assessBackupReadiness(
      'backup_sakura_primary',
      sakura,
      config.backup.sakura,
      now,
    ),
    assessBackupReadiness(
      'backup_gdrive_secondary',
      driveSecondary,
      config.backup.driveSecondary,
      now,
    ),
    assessRestoreEvidence(restore, config.restoreMaxAgeMs, now),
  );
  return buildStorageReadinessReport({
    components,
    generatedAt: now,
    mode: options.writeProbe ? 'write_probe' : 'read',
  });
}
