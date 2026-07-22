import {
  GoogleDriveConfigurationError,
  resolveGoogleDriveCommonCredentials,
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
  GOOGLE_DRIVE_FOLDER_ENV_KEYS,
  type GoogleDriveFolderEnvKey,
} from './googleDriveProvisionService.js';

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleDriveConfigurationError([name]);
  return value;
}

async function main() {
  const outputFile = requireEnv('GDRIVE_FOLDER_ID_OUTPUT_FILE');
  const outputKey = (process.env.GDRIVE_FOLDER_ID_OUTPUT_KEY?.trim() ||
    'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID') as GoogleDriveFolderEnvKey;
  if (!GOOGLE_DRIVE_FOLDER_ENV_KEYS.includes(outputKey)) {
    throw new GoogleDriveConfigurationError(['GDRIVE_FOLDER_ID_OUTPUT_KEY']);
  }
  const sharedDriveId = resolveGoogleDriveSharedDriveId(process.env);
  const tuning = resolveGoogleDriveTuningConfig(process.env);
  const credentials =
    outputKey === 'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID'
      ? resolveGoogleDriveCredentials(process.env)
      : resolveGoogleDriveCommonCredentials(process.env);
  const drive = createGoogleDriveApi(credentials);
  const mode = (process.env.GDRIVE_PROVISION_MODE ?? 'provision')
    .trim()
    .toLowerCase();
  if (mode === 'reconcile') {
    await reconcileGoogleDriveProvision({
      drive,
      outputFile,
      outputKey,
      sharedDriveId,
      tuning,
    });
    return;
  }
  if (mode !== 'provision') {
    throw new GoogleDriveConfigurationError(['GDRIVE_PROVISION_MODE']);
  }
  const defaultFolderNames: Record<GoogleDriveFolderEnvKey, string> = {
    CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'ERP4 Chat Attachments',
    PDF_GDRIVE_FOLDER_ID: 'ERP4 PDF Artifacts',
    EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID: 'ERP4 Evidence Archives',
    REPORT_GDRIVE_FOLDER_ID: 'ERP4 Report Outputs',
  };
  await provisionGoogleDriveFolder({
    drive,
    outputFile,
    outputKey,
    folderName:
      process.env.ERP4_GDRIVE_TARGET_FOLDER_NAME?.trim() ||
      (outputKey === 'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID'
        ? process.env.CHAT_ATTACHMENT_GDRIVE_FOLDER_NAME?.trim()
        : undefined) ||
      defaultFolderNames[outputKey],
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
