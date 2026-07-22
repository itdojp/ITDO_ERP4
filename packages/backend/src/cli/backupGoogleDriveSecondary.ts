import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import {
  applyBackupTrash,
  downloadBackupGeneration,
  inventoryGoogleDriveBackups,
  planBackupRetention,
  summarizeBackupGeneration,
  summarizeBackupInventory,
  trashBackupGeneration,
  uploadBackupBundle,
} from '../application/backup/googleDriveSecondaryBackup.js';
import {
  createGoogleDriveBackupObjectStore,
  GoogleDriveBackupConfigurationError,
  resolveGoogleDriveBackupConfig,
} from '../infrastructure/backup/googleDriveBackupConfig.js';

type Command =
  | 'check-config'
  | 'download'
  | 'freshness'
  | 'list'
  | 'prune'
  | 'stat'
  | 'trash'
  | 'upload';

export type BackupGoogleDriveCliOptions = {
  apply: boolean;
  backupDigest?: string;
  command: Command;
  destinationDir?: string;
  handoffFile?: string;
  requestFile?: string;
};

type OptionName =
  'apply' | 'backupDigest' | 'destinationDir' | 'handoffFile' | 'requestFile';

const COMMANDS = new Set<Command>([
  'check-config',
  'download',
  'freshness',
  'list',
  'prune',
  'stat',
  'trash',
  'upload',
]);

const COMMAND_OPTIONS: Record<Command, ReadonlySet<OptionName>> = {
  'check-config': new Set(),
  download: new Set(['backupDigest', 'destinationDir', 'handoffFile']),
  freshness: new Set(),
  list: new Set(),
  prune: new Set(['apply']),
  stat: new Set(['backupDigest']),
  trash: new Set(['backupDigest']),
  upload: new Set(['requestFile']),
};

const REQUIRED_COMMAND_OPTIONS: Partial<
  Record<Command, ReadonlySet<OptionName>>
> = {
  download: new Set(['backupDigest', 'destinationDir', 'handoffFile']),
  stat: new Set(['backupDigest']),
  trash: new Set(['backupDigest']),
  upload: new Set(['requestFile']),
};

function presentOptions(options: BackupGoogleDriveCliOptions) {
  const present = new Set<OptionName>();
  if (options.apply) present.add('apply');
  if (options.backupDigest) present.add('backupDigest');
  if (options.destinationDir) present.add('destinationDir');
  if (options.handoffFile) present.add('handoffFile');
  if (options.requestFile) present.add('requestFile');
  return present;
}

function validateCommandOptions(options: BackupGoogleDriveCliOptions) {
  const present = presentOptions(options);
  const allowed = COMMAND_OPTIONS[options.command];
  const required = REQUIRED_COMMAND_OPTIONS[options.command] ?? new Set();
  if (
    [...present].some((option) => !allowed.has(option)) ||
    [...required].some((option) => !present.has(option))
  ) {
    throw new Error('backup_google_drive_arguments_invalid');
  }
}

export function parseBackupGoogleDriveArgs(
  argv: string[],
): BackupGoogleDriveCliOptions {
  const command = argv[0] as Command;
  if (!COMMANDS.has(command))
    throw new Error('backup_google_drive_command_invalid');
  const result: BackupGoogleDriveCliOptions = { command, apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      if (result.apply)
        throw new Error('backup_google_drive_arguments_invalid');
      result.apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('backup_google_drive_arguments_invalid');
    }
    if (argument === '--backup-digest' && !result.backupDigest) {
      result.backupDigest = value;
    } else if (argument === '--destination-dir' && !result.destinationDir) {
      result.destinationDir = path.resolve(value);
    } else if (argument === '--handoff-file' && !result.handoffFile) {
      result.handoffFile = path.resolve(value);
    } else if (argument === '--request-file' && !result.requestFile) {
      result.requestFile = path.resolve(value);
    } else {
      throw new Error('backup_google_drive_arguments_invalid');
    }
    index += 1;
  }
  validateCommandOptions(result);
  return result;
}

async function readUploadRequest(requestFile: string) {
  const handle = await open(
    requestFile,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!handle) throw new Error('backup_google_drive_request_file_unsafe');
  try {
    const before = await handle.stat({ bigint: false });
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.size <= 0 ||
      before.size > 1024 * 1024
    ) {
      throw new Error('backup_google_drive_request_file_unsafe');
    }
    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile('utf8'));
    } catch {
      throw new Error('backup_google_drive_request_invalid');
    }
    const after = await handle.stat({ bigint: false });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('backup_google_drive_request_file_unsafe');
    }
    const artifacts =
      value && typeof value === 'object' && 'artifacts' in value
        ? (value as { artifacts?: unknown }).artifacts
        : undefined;
    if (
      !Array.isArray(artifacts) ||
      artifacts.some((item) => typeof item !== 'string' || !item)
    ) {
      throw new Error('backup_google_drive_request_invalid');
    }
    return artifacts as string[];
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function requireValue(value: string | undefined) {
  if (!value) throw new Error('backup_google_drive_arguments_invalid');
  return value;
}

export async function runBackupGoogleDriveCli(
  options: BackupGoogleDriveCliOptions,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = resolveGoogleDriveBackupConfig(env);
  if (options.command === 'check-config') {
    return { provider: config.provider, status: 'valid' as const };
  }
  if (config.provider !== 'gdrive') {
    throw new Error('backup_google_drive_disabled');
  }
  const store = createGoogleDriveBackupObjectStore(config);
  if (options.command === 'upload') {
    const artifactPaths = await readUploadRequest(
      requireValue(options.requestFile),
    );
    return uploadBackupBundle({
      artifactPaths,
      stateDir: config.stateDir,
      store,
      verifyDownload: config.verifyDownload,
    });
  }

  const inventory = await inventoryGoogleDriveBackups(store);
  if (options.command === 'list' || options.command === 'freshness') {
    return summarizeBackupInventory(inventory);
  }
  if (options.command === 'stat') {
    return summarizeBackupGeneration(
      inventory,
      requireValue(options.backupDigest),
    );
  }
  if (options.command === 'download') {
    return downloadBackupGeneration({
      backupDigest: requireValue(options.backupDigest),
      destinationDir: requireValue(options.destinationDir),
      handoffFile: requireValue(options.handoffFile),
      inventory,
      store,
    });
  }
  if (options.command === 'trash') {
    if (env.BACKUP_GDRIVE_TRASH_CONFIRM !== '1') {
      throw new Error('backup_google_drive_trash_confirmation_required');
    }
    return trashBackupGeneration(
      store,
      inventory,
      requireValue(options.backupDigest),
    );
  }
  const plan = planBackupRetention(inventory);
  if (!options.apply) {
    const { keys: _keys, ...safePlan } = plan;
    return safePlan;
  }
  if (env.BACKUP_GDRIVE_PRUNE_CONFIRM !== '1' || !plan.applyAllowed) {
    throw new Error('backup_google_drive_prune_confirmation_required');
  }
  return applyBackupTrash(store, plan.keys);
}

function safeError(error: unknown) {
  if (error instanceof GoogleDriveBackupConfigurationError) {
    return `${error.message}:${error.keys.join(',')}`;
  }
  if (
    error instanceof Error &&
    /^backup_google_drive_[a-z0-9_]+$/.test(error.message)
  ) {
    return error.message;
  }
  if (
    error instanceof Error &&
    /^google_drive_[a-z0-9_]+$/.test(error.message)
  ) {
    return error.message;
  }
  return 'backup_google_drive_failed';
}

if (process.argv[1]?.endsWith('backupGoogleDriveSecondary.js')) {
  try {
    const options = parseBackupGoogleDriveArgs(process.argv.slice(2));
    const result = await runBackupGoogleDriveCli(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  }
}
