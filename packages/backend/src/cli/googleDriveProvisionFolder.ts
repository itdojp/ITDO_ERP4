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
  provisionGoogleDriveFolder,
  reconcileGoogleDriveProvision,
} from './googleDriveProvisionService.js';

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleDriveConfigurationError([name]);
  return value;
}

async function main() {
  const outputFile = requireEnv('GDRIVE_FOLDER_ID_OUTPUT_FILE');
  const sharedDriveId = resolveGoogleDriveSharedDriveId(process.env);
  const tuning = resolveGoogleDriveTuningConfig(process.env);
  const credentials = resolveGoogleDriveCredentials(process.env);
  const drive = createGoogleDriveApi(credentials);
  const mode = (process.env.GDRIVE_PROVISION_MODE ?? 'provision')
    .trim()
    .toLowerCase();
  if (mode === 'reconcile') {
    await reconcileGoogleDriveProvision({
      drive,
      outputFile,
      sharedDriveId,
      tuning,
    });
    return;
  }
  if (mode !== 'provision') {
    throw new GoogleDriveConfigurationError(['GDRIVE_PROVISION_MODE']);
  }
  await provisionGoogleDriveFolder({
    drive,
    outputFile,
    folderName:
      process.env.CHAT_ATTACHMENT_GDRIVE_FOLDER_NAME?.trim() ||
      'ERP4 Chat Attachments',
    sharedDriveId,
    tuning,
  });
}

main().catch((error) => {
  if (error instanceof GoogleDriveConfigurationError) {
    console.error(
      '[gdrive] provision failed: invalid configuration keys:',
      error.keys.join(', '),
    );
  } else if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
    console.error('[gdrive] provision failed: output file already exists');
  } else {
    const normalized = normalizeGoogleDriveError(error, 'upload');
    console.error('[gdrive] provision failed:', normalized.message);
  }
  process.exitCode = 1;
});
