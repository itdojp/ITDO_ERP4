import { PassThrough, Readable } from 'stream';
import googleapis from 'googleapis';

import type {
  ObjectStore,
  ObjectStoreMetadata,
  ObjectStorePutInput,
} from './objectStore.js';
import type {
  GoogleDriveCredentialConfig,
  GoogleDriveTuningConfig,
} from './googleDriveConfig.js';

type DriveFileData = {
  id?: string | null;
  name?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  size?: string | null;
  md5Checksum?: string | null;
  sha1Checksum?: string | null;
  sha256Checksum?: string | null;
  appProperties?: Record<string, string> | null;
  trashed?: boolean | null;
  driveId?: string | null;
  parents?: string[] | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
};

type DriveResponse = { data: unknown };

type GoogleDriveResumableCreateInput = {
  fields: string;
  media: {
    body: Readable;
    mimeType?: string;
    sizeBytes: number;
  };
  requestBody: {
    appProperties: Record<string, string>;
    name: string;
    parents: string[];
  };
};

type GoogleDriveAuthorizedRequest = (
  options: Record<string, unknown>,
) => Promise<{ data: unknown; headers?: unknown }>;

export type GoogleDriveApi = {
  createResumable(
    input: GoogleDriveResumableCreateInput,
    options?: Record<string, unknown>,
  ): Promise<DriveResponse>;
  files: {
    create(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<DriveResponse>;
    get(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<DriveResponse>;
    list(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<DriveResponse>;
    update(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<DriveResponse>;
  };
  permissions: {
    list(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<DriveResponse>;
  };
};

export type GoogleDriveObjectStoreOptions = GoogleDriveTuningConfig & {
  folderId: string;
  sharedDriveId?: string;
};

export type GoogleDriveObjectStoreErrorCode =
  | 'auth_expired'
  | 'forbidden'
  | 'not_found'
  | 'quota'
  | 'retryable'
  | 'permanent'
  | 'timeout';

type GoogleDriveOperation =
  'download' | 'stat' | 'target_check' | 'trash' | 'upload';

export class GoogleDriveObjectStoreError extends Error {
  readonly code: GoogleDriveObjectStoreErrorCode;
  readonly operation: GoogleDriveOperation;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(options: {
    code: GoogleDriveObjectStoreErrorCode;
    operation: GoogleDriveOperation;
    retryable: boolean;
    status?: number;
  }) {
    super(`google_drive_${options.code}`);
    this.name = 'GoogleDriveObjectStoreError';
    this.code = options.code;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readHeader(headers: unknown, name: string) {
  const record = asRecord(headers);
  if (!record) return undefined;
  if (typeof record.get === 'function') {
    const value = record.get.call(headers, name);
    return typeof value === 'string' ? value : undefined;
  }
  const value = record[name] ?? record[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function validateResumableSessionUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.googleapis.com' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/upload/drive/v3/files'
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createGoogleDriveResumableCreate(
  request: GoogleDriveAuthorizedRequest,
) {
  return async (
    input: GoogleDriveResumableCreateInput,
    options: Record<string, unknown> = {},
  ): Promise<DriveResponse> => {
    const timeout = options.timeout;
    const initiated = await request({
      url: 'https://www.googleapis.com/upload/drive/v3/files',
      method: 'POST',
      params: {
        uploadType: 'resumable',
        supportsAllDrives: true,
        ignoreDefaultVisibility: true,
        fields: input.fields,
      },
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(input.media.sizeBytes),
        'X-Upload-Content-Type':
          input.media.mimeType ?? 'application/octet-stream',
      },
      data: input.requestBody,
      retry: false,
      timeout,
    });
    const sessionUrl = validateResumableSessionUrl(
      readHeader(initiated.headers, 'location'),
    );
    if (!sessionUrl) {
      throw new GoogleDriveObjectStoreError({
        code: 'permanent',
        operation: 'upload',
        retryable: false,
      });
    }

    const uploaded = await request({
      url: sessionUrl,
      method: 'PUT',
      headers: {
        'Content-Length': String(input.media.sizeBytes),
        'Content-Type': input.media.mimeType ?? 'application/octet-stream',
      },
      data: input.media.body,
      responseType: 'json',
      retry: false,
      timeout,
    });
    return { data: uploaded.data };
  };
}

function readStatus(error: unknown) {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const status = response?.status ?? record?.status ?? record?.code;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d{3}$/.test(status))
    return Number(status);
  return undefined;
}

function collectReasons(error: unknown) {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const data = asRecord(response?.data);
  const nestedError = asRecord(data?.error);
  const reasons: string[] = [];
  const addReason = (value: unknown) => {
    if (typeof value === 'string') reasons.push(value.toLowerCase());
  };
  addReason(record?.code);
  addReason(data?.error);
  addReason(nestedError?.status);
  const candidates = [record?.errors, data?.errors, nestedError?.errors];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) addReason(asRecord(item)?.reason);
  }
  return reasons;
}

export function normalizeGoogleDriveError(
  error: unknown,
  operation: GoogleDriveOperation,
) {
  if (error instanceof GoogleDriveObjectStoreError) return error;

  const status = readStatus(error);
  const reasons = collectReasons(error);
  const hasReason = (pattern: RegExp) =>
    reasons.some((reason) => pattern.test(reason));
  const timeout =
    status === 408 ||
    hasReason(/^(aborterror|econnaborted|etimedout|timeout)$/) ||
    asRecord(error)?.name === 'AbortError';

  if (timeout) {
    return new GoogleDriveObjectStoreError({
      code: 'timeout',
      operation,
      retryable: true,
      status,
    });
  }
  if (status === 401 || hasReason(/^(autherror|invalid_grant)$/)) {
    return new GoogleDriveObjectStoreError({
      code: 'auth_expired',
      operation,
      retryable: false,
      status,
    });
  }
  if (status === 404) {
    return new GoogleDriveObjectStoreError({
      code: 'not_found',
      operation,
      retryable: false,
      status,
    });
  }
  if (
    status === 403 &&
    hasReason(/(storagequota|dailylimit|quotaexceeded|teamdrivefilelimit)/)
  ) {
    return new GoogleDriveObjectStoreError({
      code: 'quota',
      operation,
      retryable: false,
      status,
    });
  }
  if (status === 429 || (status === 403 && hasReason(/ratelimit/))) {
    return new GoogleDriveObjectStoreError({
      code: 'quota',
      operation,
      retryable: true,
      status,
    });
  }
  if (
    (typeof status === 'number' && status >= 500 && status <= 599) ||
    hasReason(/^(econnreset|enetunreach|enotfound|eai_again|epipe)$/)
  ) {
    return new GoogleDriveObjectStoreError({
      code: 'retryable',
      operation,
      retryable: true,
      status,
    });
  }
  if (status === 403) {
    return new GoogleDriveObjectStoreError({
      code: 'forbidden',
      operation,
      retryable: false,
      status,
    });
  }
  return new GoogleDriveObjectStoreError({
    code: 'permanent',
    operation,
    retryable: false,
    status,
  });
}

function normalizeSize(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function mapMetadata(
  file: DriveFileData,
  operation: GoogleDriveOperation,
  fallback?: Pick<
    ObjectStorePutInput,
    'contentType' | 'originalName' | 'sha256' | 'sizeBytes'
  >,
): ObjectStoreMetadata {
  if (!file.id) {
    throw new GoogleDriveObjectStoreError({
      code: 'permanent',
      operation,
      retryable: false,
    });
  }
  return {
    key: file.id,
    checksum: {
      md5: file.md5Checksum ?? undefined,
      sha1: file.sha1Checksum ?? undefined,
      sha256:
        file.sha256Checksum ??
        file.appProperties?.erp4Sha256 ??
        fallback?.sha256,
    },
    contentType: file.mimeType ?? fallback?.contentType ?? null,
    createdAt: file.createdTime ?? null,
    modifiedAt: file.modifiedTime ?? null,
    originalName:
      file.appProperties?.erp4OriginalName ??
      file.originalFilename ??
      file.name ??
      fallback?.originalName ??
      'object',
    sizeBytes: normalizeSize(file.size) ?? fallback?.sizeBytes ?? null,
    trashed: file.trashed ?? false,
  };
}

function toReadable(body: ObjectStorePutInput['body']) {
  return Buffer.isBuffer(body) ? Readable.from(body) : body();
}

export class GoogleDriveObjectStore implements ObjectStore {
  private targetCheck: Promise<void> | null = null;

  constructor(
    private readonly drive: GoogleDriveApi,
    private readonly options: GoogleDriveObjectStoreOptions,
    private readonly dependencies: {
      sleep?: (milliseconds: number) => Promise<void>;
      random?: () => number;
    } = {},
  ) {}

  private async execute<T>(
    operation: GoogleDriveOperation,
    request: () => Promise<T>,
    retry = true,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request();
      } catch (error) {
        const normalized = normalizeGoogleDriveError(error, operation);
        if (
          !retry ||
          !normalized.retryable ||
          attempt >= this.options.maxRetries
        ) {
          throw normalized;
        }
        const baseDelay = this.options.retryBaseDelayMs * 2 ** attempt;
        const jitter = Math.floor(
          (this.dependencies.random?.() ?? Math.random()) *
            this.options.retryBaseDelayMs,
        );
        const delay = Math.min(baseDelay + jitter, 64_000);
        await (
          this.dependencies.sleep ??
          ((milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)))
        )(delay);
      }
    }
  }

  private assertScopedFile(
    file: DriveFileData,
    operation: GoogleDriveOperation,
  ) {
    const expectedDriveId = this.options.sharedDriveId ?? null;
    const actualDriveId = file.driveId ?? null;
    if (
      actualDriveId !== expectedDriveId ||
      !file.parents?.includes(this.options.folderId)
    ) {
      throw new GoogleDriveObjectStoreError({
        code: 'permanent',
        operation,
        retryable: false,
      });
    }
  }

  private async getScopedFile(key: string, operation: GoogleDriveOperation) {
    const response = await this.drive.files.get(
      {
        fileId: key,
        supportsAllDrives: true,
        fields:
          'id,name,originalFilename,mimeType,size,md5Checksum,sha1Checksum,sha256Checksum,appProperties,trashed,driveId,parents,createdTime,modifiedTime',
      },
      { retry: false, timeout: this.options.timeoutMs },
    );
    const file = response.data as DriveFileData;
    this.assertScopedFile(file, operation);
    return file;
  }

  private async ensureStorageTarget() {
    if (!this.targetCheck) {
      this.targetCheck = this.execute('target_check', async () => {
        const response = await this.drive.files.get(
          {
            fileId: this.options.folderId,
            fields: 'id,driveId,mimeType,trashed',
            supportsAllDrives: true,
          },
          { retry: false, timeout: this.options.timeoutMs },
        );
        const folder = response.data as DriveFileData;
        if (
          (folder.driveId ?? null) !== (this.options.sharedDriveId ?? null) ||
          folder.mimeType !== 'application/vnd.google-apps.folder' ||
          folder.trashed === true
        ) {
          throw new GoogleDriveObjectStoreError({
            code: 'permanent',
            operation: 'target_check',
            retryable: false,
          });
        }
      }).catch((error) => {
        this.targetCheck = null;
        throw error;
      });
    }
    await this.targetCheck;
  }

  async put(input: ObjectStorePutInput) {
    await this.ensureStorageTarget();
    // A fresh files.create retry can duplicate an object when the first request's
    // outcome is ambiguous. Large payloads use one resumable session, but this
    // adapter deliberately never starts a second create/session request.
    return this.execute(
      'upload',
      async () => {
        const request = {
          requestBody: {
            name: input.originalName,
            parents: [this.options.folderId],
            appProperties: {
              erp4Sha256: input.sha256,
            },
          },
          media: {
            mimeType: input.contentType || undefined,
            body: toReadable(input.body),
            sizeBytes: input.sizeBytes,
          },
          fields:
            'id,name,originalFilename,mimeType,size,md5Checksum,sha1Checksum,sha256Checksum,appProperties,trashed,createdTime,modifiedTime',
        };
        const response =
          input.sizeBytes >= this.options.resumableUploadThresholdBytes
            ? await this.drive.createResumable(request, {
                retry: false,
                timeout: this.options.timeoutMs,
              })
            : await this.drive.files.create(
                {
                  supportsAllDrives: true,
                  ignoreDefaultVisibility: true,
                  requestBody: request.requestBody,
                  media: request.media,
                  fields: request.fields,
                },
                { retry: false, timeout: this.options.timeoutMs },
              );
        return mapMetadata(response.data as DriveFileData, 'upload', input);
      },
      false,
    );
  }

  async get(key: string) {
    return this.execute('download', async () => {
      await this.getScopedFile(key, 'download');
      const response = await this.drive.files.get(
        { fileId: key, alt: 'media', supportsAllDrives: true },
        {
          responseType: 'stream',
          retry: false,
          timeout: this.options.timeoutMs,
        },
      );
      const source = response.data;
      if (!(source instanceof Readable)) {
        throw new GoogleDriveObjectStoreError({
          code: 'permanent',
          operation: 'download',
          retryable: false,
        });
      }
      const stream = new PassThrough();
      source.once('error', (error) => {
        stream.destroy(normalizeGoogleDriveError(error, 'download'));
      });
      stream.once('close', () => {
        if (!source.destroyed) source.destroy();
      });
      source.pipe(stream);
      return { stream };
    });
  }

  async stat(key: string) {
    return this.execute('stat', async () => {
      const file = await this.getScopedFile(key, 'stat');
      return mapMetadata(file, 'stat');
    });
  }

  async trash(key: string) {
    await this.execute('trash', async () => {
      await this.getScopedFile(key, 'trash');
      await this.drive.files.update(
        {
          fileId: key,
          supportsAllDrives: true,
          requestBody: { trashed: true },
          fields: 'id,trashed',
        },
        { retry: false, timeout: this.options.timeoutMs },
      );
    });
  }
}

export function createGoogleDriveApi(credentials: GoogleDriveCredentialConfig) {
  const { google } = googleapis as unknown as {
    google: typeof import('googleapis').google;
  };
  const oauth2Client = new google.auth.OAuth2({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const drive = google.drive({
    version: 'v3',
    auth: oauth2Client,
  });
  const createResumable = createGoogleDriveResumableCreate((options) =>
    oauth2Client.request(options),
  );
  return {
    createResumable,
    files: drive.files,
    permissions: drive.permissions,
  } as unknown as GoogleDriveApi;
}
