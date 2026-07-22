import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink, type FileHandle } from 'node:fs/promises';

import {
  GoogleDriveConfigurationError,
  type GoogleDriveTuningConfig,
} from '../infrastructure/storage/googleDriveConfig.js';
import {
  GoogleDriveObjectStoreError,
  type GoogleDriveApi,
  normalizeGoogleDriveError,
} from '../infrastructure/storage/googleDriveObjectStore.js';

async function writeState(output: FileHandle, content: string) {
  const data = Buffer.from(content, 'utf8');
  await output.truncate(0);
  await output.write(data, 0, data.length, 0);
  await output.chmod(0o600);
  await output.sync();
}

export const GOOGLE_DRIVE_FOLDER_ENV_KEYS = [
  'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID',
  'PDF_GDRIVE_FOLDER_ID',
  'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
  'REPORT_GDRIVE_FOLDER_ID',
] as const;

export type GoogleDriveFolderEnvKey =
  (typeof GOOGLE_DRIVE_FOLDER_ENV_KEYS)[number];

function resolveOutputKey(value?: string): GoogleDriveFolderEnvKey {
  const key = value ?? 'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID';
  if (!GOOGLE_DRIVE_FOLDER_ENV_KEYS.includes(key as GoogleDriveFolderEnvKey)) {
    throw new GoogleDriveConfigurationError(['GDRIVE_FOLDER_ID_OUTPUT_KEY']);
  }
  return key as GoogleDriveFolderEnvKey;
}

export async function reconcileGoogleDriveProvision(options: {
  drive: GoogleDriveApi;
  outputFile: string;
  outputKey?: GoogleDriveFolderEnvKey;
  sharedDriveId?: string;
  tuning: GoogleDriveTuningConfig;
  log?: (message: string) => void;
}) {
  const log = options.log ?? console.log;
  const outputStat = await lstat(options.outputFile);
  if (
    outputStat.isSymbolicLink() ||
    !outputStat.isFile() ||
    (outputStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' &&
      outputStat.uid !== process.getuid())
  ) {
    throw new GoogleDriveConfigurationError(['GDRIVE_FOLDER_ID_OUTPUT_FILE']);
  }
  const output = await open(
    options.outputFile,
    constants.O_RDWR | constants.O_NOFOLLOW,
  );
  try {
    const state = await output.readFile('utf8');
    const marker = state.match(
      /^ERP4_GDRIVE_PROVISION_MARKER=([0-9a-f-]{36})$/m,
    )?.[1];
    if (!marker) {
      throw new GoogleDriveConfigurationError(['ERP4_GDRIVE_PROVISION_MARKER']);
    }
    const persistedOutputKey = state.match(
      /^ERP4_GDRIVE_PROVISION_OUTPUT_KEY=([A-Z0-9_]+)$/m,
    )?.[1];
    const outputKey = resolveOutputKey(options.outputKey ?? persistedOutputKey);
    if (
      options.outputKey &&
      persistedOutputKey &&
      options.outputKey !== persistedOutputKey
    ) {
      throw new GoogleDriveConfigurationError(['GDRIVE_FOLDER_ID_OUTPUT_KEY']);
    }
    const params: Record<string, unknown> = {
      q: `appProperties has { key='erp4ProvisionMarker' and value='${marker}' } and trashed=false`,
      pageSize: 2,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id)',
    };
    if (options.sharedDriveId) {
      params.corpora = 'drive';
      params.driveId = options.sharedDriveId;
    }
    const response = await options.drive.files.list(params, {
      retry: false,
      timeout: options.tuning.timeoutMs,
    });
    const files = (response.data as { files?: Array<{ id?: string | null }> })
      .files;
    const ids = (files ?? [])
      .map((file) => file.id)
      .filter((id): id is string => Boolean(id));
    log(`[gdrive] provision reconciliation matches: ${ids.length}`);
    if (ids.length !== 1) {
      throw new GoogleDriveObjectStoreError({
        code: ids.length === 0 ? 'not_found' : 'permanent',
        operation: 'target_check',
        retryable: false,
      });
    }
    await writeState(
      output,
      `${outputKey}=${ids[0]}\n` +
        `ERP4_GDRIVE_PROVISION_OUTPUT_KEY=${outputKey}\n` +
        `ERP4_GDRIVE_PROVISION_MARKER=${marker}\n` +
        'ERP4_GDRIVE_PROVISION_STATE=COMPLETE\n',
    );
    log('[gdrive] protected folder ID output reconciled: true');
  } finally {
    await output.close();
  }
}

export async function provisionGoogleDriveFolder(options: {
  drive: GoogleDriveApi;
  folderName: string;
  outputFile: string;
  outputKey?: GoogleDriveFolderEnvKey;
  sharedDriveId?: string;
  tuning: GoogleDriveTuningConfig;
  marker?: string;
  log?: (message: string) => void;
}) {
  const log = options.log ?? console.log;
  const provisionMarker = options.marker ?? randomUUID();
  const outputKey = resolveOutputKey(options.outputKey);
  const output = await open(options.outputFile, 'wx', 0o600);
  let outputClosed = false;
  let remoteCreateStarted = false;
  let remoteResponseReceived = false;
  let remoteFolderId: string | undefined;
  try {
    await writeState(
      output,
      `ERP4_GDRIVE_PROVISION_OUTPUT_KEY=${outputKey}\n` +
        `ERP4_GDRIVE_PROVISION_MARKER=${provisionMarker}\n` +
        'ERP4_GDRIVE_PROVISION_STATE=CREATE_STARTED\n',
    );

    remoteCreateStarted = true;
    const created = await options.drive.files.create(
      {
        supportsAllDrives: true,
        ignoreDefaultVisibility: true,
        requestBody: {
          name: options.folderName,
          mimeType: 'application/vnd.google-apps.folder',
          ...(options.sharedDriveId
            ? { parents: [options.sharedDriveId] }
            : {}),
          appProperties: { erp4ProvisionMarker: provisionMarker },
        },
        fields: 'id',
      },
      { retry: false, timeout: options.tuning.timeoutMs },
    );
    remoteResponseReceived = true;

    remoteFolderId = (created.data as { id?: string | null }).id ?? undefined;
    if (!remoteFolderId) {
      throw new GoogleDriveObjectStoreError({
        code: 'permanent',
        operation: 'upload',
        retryable: false,
      });
    }

    await writeState(
      output,
      `${outputKey}=${remoteFolderId}\n` +
        `ERP4_GDRIVE_PROVISION_OUTPUT_KEY=${outputKey}\n` +
        `ERP4_GDRIVE_PROVISION_MARKER=${provisionMarker}\n` +
        'ERP4_GDRIVE_PROVISION_STATE=COMPLETE\n',
    );
    await output.close();
    outputClosed = true;
    log('[gdrive] folder provisioned: true');
    log('[gdrive] protected folder ID output written: true');
  } catch (error) {
    if (!remoteCreateStarted) {
      await output.close();
      outputClosed = true;
      await unlink(options.outputFile);
    } else if (!remoteFolderId && !remoteResponseReceived) {
      const normalized = normalizeGoogleDriveError(error, 'upload');
      if (!normalized.retryable) {
        await output.close();
        outputClosed = true;
        await unlink(options.outputFile);
      }
    }
    throw error;
  } finally {
    if (!outputClosed) await output.close();
  }
}
