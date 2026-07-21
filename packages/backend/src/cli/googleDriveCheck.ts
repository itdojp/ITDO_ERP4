import {
  GoogleDriveConfigurationError,
  resolveGoogleDriveCredentials,
  resolveGoogleDriveSharedDriveId,
  resolveGoogleDriveTuningConfig,
} from '../infrastructure/storage/googleDriveConfig.js';
import {
  createGoogleDriveApi,
  normalizeGoogleDriveError,
} from '../infrastructure/storage/googleDriveObjectStore.js';
import {
  type GoogleDriveCheckMode,
  runGoogleDriveCheck,
} from './googleDriveCheckService.js';

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleDriveConfigurationError([name]);
  return value;
}

function resolveMode(): GoogleDriveCheckMode {
  const raw = (process.env.GDRIVE_CHECK_MODE || 'read').trim().toLowerCase();
  if (raw !== 'read' && raw !== 'write') {
    throw new GoogleDriveConfigurationError(['GDRIVE_CHECK_MODE']);
  }
  return raw;
}

async function main() {
  const credentials = resolveGoogleDriveCredentials(process.env);
  await runGoogleDriveCheck({
    drive: createGoogleDriveApi(credentials),
    folderId: requireEnv('CHAT_ATTACHMENT_GDRIVE_FOLDER_ID'),
    mode: resolveMode(),
    sharedDriveId: resolveGoogleDriveSharedDriveId(process.env),
    tuning: resolveGoogleDriveTuningConfig(process.env),
  });
}

main().catch((error) => {
  if (error instanceof GoogleDriveConfigurationError) {
    console.error(
      '[gdrive] check failed: invalid configuration keys:',
      error.keys.join(', '),
    );
  } else {
    const normalized = normalizeGoogleDriveError(error, 'target_check');
    console.error('[gdrive] check failed:', normalized.message);
  }
  process.exitCode = 1;
});
