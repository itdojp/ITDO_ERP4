import { Readable } from 'node:stream';

import type { GoogleDriveTuningConfig } from '../infrastructure/storage/googleDriveConfig.js';
import {
  GoogleDriveObjectStoreError,
  type GoogleDriveApi,
} from '../infrastructure/storage/googleDriveObjectStore.js';

export type GoogleDriveCheckMode = 'read' | 'write';

export type GoogleDriveQuotaResult =
  { state: 'available'; usagePercent: number } | { state: 'unknown' };

type PermissionData = {
  deleted?: boolean | null;
  permissionDetails?: Array<{
    inherited?: boolean | null;
  }> | null;
  type?: string | null;
};

function escapeDriveQueryLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function assertPrivateFolderPermissions(
  drive: GoogleDriveApi,
  folderId: string,
  sharedDriveId: string | undefined,
  tuning: GoogleDriveTuningConfig,
) {
  const permissions: PermissionData[] = [];
  let pageToken: string | undefined;
  const seenPageTokens = new Set<string>();
  do {
    const response = await drive.permissions.list(
      {
        fileId: folderId,
        supportsAllDrives: true,
        pageSize: 100,
        pageToken,
        fields:
          'nextPageToken,permissions(id,type,role,deleted,permissionDetails(inherited))',
      },
      { retry: false, timeout: tuning.timeoutMs },
    );
    const data = response.data as {
      nextPageToken?: string | null;
      permissions?: PermissionData[];
    };
    permissions.push(...(data.permissions ?? []));
    pageToken = data.nextPageToken ?? undefined;
    if (pageToken) {
      if (seenPageTokens.has(pageToken) || seenPageTokens.size >= 100) {
        throw new GoogleDriveObjectStoreError({
          code: 'permanent',
          operation: 'target_check',
          retryable: false,
        });
      }
      seenPageTokens.add(pageToken);
    }
  } while (pageToken);

  const active = permissions.filter((permission) => !permission.deleted);
  const invalid = sharedDriveId
    ? active.some(
        (permission) =>
          permission.type === 'anyone' ||
          permission.type === 'domain' ||
          !permission.permissionDetails?.length ||
          permission.permissionDetails.some(
            (detail) => detail.inherited !== true,
          ),
      )
    : active.length !== 1 ||
      active.some((permission) => permission.type !== 'user');
  if (invalid) {
    throw new GoogleDriveObjectStoreError({
      code: 'forbidden',
      operation: 'target_check',
      retryable: false,
    });
  }
  return active.length;
}

export async function runGoogleDriveCheck(options: {
  drive: GoogleDriveApi;
  folderId: string;
  mode: GoogleDriveCheckMode;
  sharedDriveId?: string;
  tuning: GoogleDriveTuningConfig;
  log?: (message: string) => void;
  now?: () => Date;
}) {
  const { drive, folderId, mode, sharedDriveId, tuning } = options;
  const log = options.log ?? console.log;
  const requestOptions = { retry: false, timeout: tuning.timeoutMs };

  log(`[gdrive] mode: ${mode}`);
  log(`[gdrive] shared-drive configured: ${Boolean(sharedDriveId)}`);

  const folder = await drive.files.get(
    {
      fileId: folderId,
      supportsAllDrives: true,
      fields: 'id,mimeType,driveId,trashed',
    },
    requestOptions,
  );
  const folderData = folder.data as {
    driveId?: string | null;
    mimeType?: string | null;
    trashed?: boolean | null;
  };
  if (
    folderData.mimeType !== 'application/vnd.google-apps.folder' ||
    folderData.trashed === true ||
    (folderData.driveId ?? undefined) !== sharedDriveId
  ) {
    throw new GoogleDriveObjectStoreError({
      code: 'permanent',
      operation: 'target_check',
      retryable: false,
    });
  }
  log('[gdrive] folder accessible: true');

  const permissionCount = await assertPrivateFolderPermissions(
    drive,
    folderId,
    sharedDriveId,
    tuning,
  );
  log(`[gdrive] permission entries inspected: ${permissionCount}`);

  const listParams: Record<string, unknown> = {
    q: `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed=false`,
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'files(id),nextPageToken',
  };
  if (sharedDriveId) {
    listParams.driveId = sharedDriveId;
    listParams.corpora = 'drive';
  }
  const list = await drive.files.list(listParams, requestOptions);
  const listedFiles = (list.data as { files?: unknown[] }).files;
  log(`[gdrive] listed object count: ${listedFiles?.length ?? 0}`);

  if (mode !== 'write') {
    return {
      permissionEntries: permissionCount,
      listedObjects: listedFiles?.length ?? 0,
      writeProbe: 'not_requested' as const,
    };
  }

  const created = await drive.files.create(
    {
      supportsAllDrives: true,
      ignoreDefaultVisibility: true,
      requestBody: {
        name: `erp4-storage-check-${(options.now?.() ?? new Date()).toISOString()}.txt`,
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: Readable.from(Buffer.from('erp4 gdrive check')),
      },
      fields: 'id',
    },
    requestOptions,
  );
  const createdId = (created.data as { id?: string | null }).id;
  if (!createdId) {
    throw new GoogleDriveObjectStoreError({
      code: 'permanent',
      operation: 'upload',
      retryable: false,
    });
  }
  log('[gdrive] write probe created: true');

  await drive.files.update(
    {
      fileId: createdId,
      supportsAllDrives: true,
      requestBody: { trashed: true },
      fields: 'id,trashed',
    },
    requestOptions,
  );
  log('[gdrive] write probe trashed: true');
  return {
    permissionEntries: permissionCount,
    listedObjects: listedFiles?.length ?? 0,
    writeProbe: 'trashed' as const,
  };
}

function parseQuotaInteger(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function readGoogleDriveQuota(options: {
  drive: GoogleDriveApi;
  tuning: GoogleDriveTuningConfig;
}): Promise<GoogleDriveQuotaResult> {
  const response = await options.drive.about.get(
    { fields: 'storageQuota(limit,usage)' },
    { retry: false, timeout: options.tuning.timeoutMs },
  );
  const storageQuota = (response.data as { storageQuota?: unknown })
    .storageQuota as { limit?: unknown; usage?: unknown } | undefined;
  const limit = parseQuotaInteger(storageQuota?.limit);
  const usage = parseQuotaInteger(storageQuota?.usage);
  if (limit === null || usage === null || limit <= 0n) {
    return { state: 'unknown' };
  }
  const basisPoints = (usage * 10_000n) / limit;
  const safeBasisPoints =
    basisPoints > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(basisPoints);
  return {
    state: 'available',
    usagePercent: safeBasisPoints / 100,
  };
}
