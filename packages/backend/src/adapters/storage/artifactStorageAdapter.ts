import { createHash, randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import type { PrismaClient, StorageArtifact } from '@prisma/client';

import type {
  ArtifactStoragePort,
  StorageArtifactContext,
  StorageArtifactProvider,
  StoreArtifactInput,
  StoredArtifact,
} from '../../application/storage/artifactStoragePort.js';
import {
  GoogleDriveConfigurationError,
  resolveGoogleDriveCommonCredentials,
  resolveGoogleDriveSharedDriveId,
  resolveGoogleDriveTuningConfig,
} from '../../infrastructure/storage/googleDriveConfig.js';
import {
  createGoogleDriveApi,
  GoogleDriveObjectStore,
  GoogleDriveObjectStoreError,
} from '../../infrastructure/storage/googleDriveObjectStore.js';
import {
  assertSafeLocalFileHandle,
  openLocalArtifactDirectory,
} from '../../infrastructure/storage/localArtifactDirectory.js';
import type { ObjectStore } from '../../infrastructure/storage/objectStore.js';
import { prisma } from '../../services/db.js';

type ArtifactDb = Pick<PrismaClient, 'storageArtifact'>;

type ArtifactStorageAdapterOptions = {
  context: StorageArtifactContext;
  db?: ArtifactDb;
  env?: NodeJS.ProcessEnv;
  folderEnvKey: string;
  localDir: string;
  objectStoreFactory?: (options: {
    credentials: ReturnType<typeof resolveGoogleDriveCommonCredentials>;
    folderId: string;
    sharedDriveId?: string;
    tuning: ReturnType<typeof resolveGoogleDriveTuningConfig>;
  }) => ObjectStore;
  provider: StorageArtifactProvider;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_STORAGE_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,180}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateStoreInput(input: StoreArtifactInput) {
  if (!SHA256_PATTERN.test(input.sha256)) {
    throw new Error('artifact_sha256_invalid');
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error('artifact_size_invalid');
  }
  if (!input.originalName.trim() || input.originalName.length > 255) {
    throw new Error('artifact_original_name_invalid');
  }
  if (
    input.idempotencyKey !== undefined &&
    (!input.idempotencyKey.trim() || input.idempotencyKey.length > 512)
  ) {
    throw new Error('artifact_idempotency_key_invalid');
  }
  if (input.storageName && !SAFE_STORAGE_NAME_PATTERN.test(input.storageName)) {
    throw new Error('artifact_storage_name_invalid');
  }
}

function toSafeResult(row: {
  id: string;
  contentType: string | null;
  createdAt: Date;
  originalName: string;
  provider: string;
  sha256: string;
  sizeBytes: bigint;
}): StoredArtifact {
  const sizeBytes = Number(row.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes)) {
    throw new Error('artifact_size_invalid');
  }
  if (row.provider !== 'local' && row.provider !== 'gdrive') {
    throw new Error('artifact_provider_invalid');
  }
  return {
    artifactId: row.id,
    contentType: row.contentType,
    createdAt: row.createdAt.toISOString(),
    originalName: row.originalName,
    provider: row.provider,
    sha256: row.sha256,
    sizeBytes,
  };
}

function assertMatchingArtifact(
  row: {
    contentType: string | null;
    originalName: string;
    sha256: string;
    sizeBytes: bigint;
  },
  input: StoreArtifactInput,
) {
  if (
    row.contentType !== input.contentType ||
    row.originalName !== input.originalName ||
    row.sha256 !== input.sha256 ||
    row.sizeBytes !== BigInt(input.sizeBytes)
  ) {
    throw new Error('artifact_idempotency_conflict');
  }
}

async function verifyLocalHandle(
  handle: FileHandle,
  input: Pick<StoreArtifactInput, 'sha256' | 'sizeBytes'>,
) {
  const info = await assertSafeLocalFileHandle(handle);
  const hash = createHash('sha256');
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    start: 0,
  })) {
    hash.update(chunk);
  }
  if (info.size !== input.sizeBytes || hash.digest('hex') !== input.sha256) {
    throw new Error('artifact_local_verification_failed');
  }
}

async function verifyObjectContent(
  store: ObjectStore,
  providerKey: string,
  input: Pick<StoreArtifactInput, 'sha256' | 'sizeBytes'>,
) {
  const { stream } = await store.get(providerKey);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    sizeBytes += buffer.length;
    hash.update(buffer);
  }
  if (sizeBytes !== input.sizeBytes || hash.digest('hex') !== input.sha256) {
    throw new Error('artifact_remote_verification_failed');
  }
}

async function writeLocalArtifact(
  localDir: string,
  providerKey: string,
  input: StoreArtifactInput,
) {
  const directory = await openLocalArtifactDirectory(localDir, {
    create: true,
  });
  if (!directory) throw new Error('artifact_local_directory_unsafe');
  let created = false;
  try {
    let output: FileHandle | undefined;
    try {
      output = await directory.openWriteExclusive(providerKey);
      created = true;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code !== 'EEXIST') throw error;
    }
    if (output) {
      try {
        if (Buffer.isBuffer(input.body)) {
          await output.writeFile(input.body);
        } else {
          await pipeline(
            input.body(),
            output.createWriteStream({ autoClose: false }),
          );
        }
        await output.sync();
      } finally {
        await output.close();
      }
    }
    const handle = await directory.openRead(providerKey);
    try {
      await verifyLocalHandle(handle, input);
    } finally {
      await handle.close();
    }
    await directory.assertBound();
  } catch (error) {
    if (created) await directory.unlink(providerKey).catch(() => undefined);
    if (error instanceof Error && /^artifact_[a-z0-9_]+$/.test(error.message)) {
      throw error;
    }
    throw new Error('artifact_local_io_failed');
  } finally {
    await directory.close().catch(() => undefined);
  }
  return providerKey;
}

async function findCompletedLocalArtifact(
  localDir: string,
  providerKey: string,
  input: Pick<StoreArtifactInput, 'sha256' | 'sizeBytes'>,
) {
  const directory = await openLocalArtifactDirectory(localDir, {
    create: false,
  });
  if (!directory) return null;
  let handle: FileHandle;
  try {
    handle = await directory.openRead(providerKey);
  } catch (error) {
    await directory.close().catch(() => undefined);
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === 'ENOENT') return null;
    throw new Error('artifact_local_file_unsafe');
  }
  try {
    await verifyLocalHandle(handle, input);
    await directory.assertBound();
    return providerKey;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'artifact_local_verification_failed'
    ) {
      return null;
    }
    throw error;
  } finally {
    await handle.close();
    await directory.close();
  }
}

function failureCode(error: unknown) {
  if (error instanceof GoogleDriveObjectStoreError) {
    return `gdrive_${error.code}`;
  }
  if (error instanceof GoogleDriveConfigurationError) {
    return 'gdrive_configuration_invalid';
  }
  if (error instanceof Error && /^artifact_[a-z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return 'artifact_store_failed';
}

export function createArtifactStorageAdapter(
  options: ArtifactStorageAdapterOptions,
): ArtifactStoragePort {
  const db = options.db ?? prisma;
  const env = options.env ?? process.env;
  let objectStore: ObjectStore | null = null;

  const getObjectStore = () => {
    if (objectStore) return objectStore;
    const folderId = env[options.folderEnvKey]?.trim();
    if (!folderId) {
      throw new GoogleDriveConfigurationError([options.folderEnvKey]);
    }
    const credentials = resolveGoogleDriveCommonCredentials(env);
    const tuning = resolveGoogleDriveTuningConfig(env);
    const sharedDriveId = resolveGoogleDriveSharedDriveId(env);
    objectStore = options.objectStoreFactory
      ? options.objectStoreFactory({
          credentials,
          folderId,
          sharedDriveId,
          tuning,
        })
      : new GoogleDriveObjectStore(createGoogleDriveApi(credentials), {
          folderId,
          sharedDriveId,
          ...tuning,
        });
    return objectStore;
  };

  const findIdempotentRow = (input: StoreArtifactInput) => {
    if (!input.idempotencyKey) return Promise.resolve(null);
    return db.storageArtifact.findUnique({
      where: {
        context_provider_idempotencyKey: {
          context: options.context,
          provider: options.provider,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
  };

  const markReady = async (
    row: StorageArtifact,
    input: StoreArtifactInput,
    providerKey: string,
  ) => {
    const completed = await db.storageArtifact.updateMany({
      where: { id: row.id, status: 'pending' },
      data: {
        providerKey,
        status: 'ready',
        failureCode: null,
      },
    });
    if (completed.count === 1) {
      return toSafeResult(row);
    }
    const current = await findIdempotentRow(input);
    if (current) {
      assertMatchingArtifact(current, input);
      if (current.status === 'ready' && current.providerKey === providerKey) {
        return toSafeResult(current);
      }
    }
    throw new Error('artifact_store_in_progress');
  };

  const recoverPending = async (
    row: StorageArtifact,
    input: StoreArtifactInput,
  ) => {
    if (!input.idempotencyKey) return null;
    let providerKey: string | null;
    if (options.provider === 'local') {
      providerKey = await findCompletedLocalArtifact(
        options.localDir,
        row.id,
        input,
      );
    } else {
      const store = getObjectStore();
      const existing = await store.findByIdempotencyKey({
        idempotencyKey: input.idempotencyKey,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      });
      if (
        existing &&
        (existing.trashed ||
          existing.checksum.sha256 !== input.sha256 ||
          existing.sizeBytes !== input.sizeBytes)
      ) {
        throw new Error('artifact_remote_verification_failed');
      }
      providerKey = existing?.key ?? null;
      if (providerKey) {
        await verifyObjectContent(store, providerKey, input);
      }
    }
    if (!providerKey) return null;
    return markReady(row, input, providerKey);
  };

  return {
    async store(input) {
      validateStoreInput(input);
      const where = input.idempotencyKey
        ? {
            context_provider_idempotencyKey: {
              context: options.context,
              provider: options.provider,
              idempotencyKey: input.idempotencyKey,
            },
          }
        : undefined;
      let row = where ? await db.storageArtifact.findUnique({ where }) : null;
      if (row) {
        assertMatchingArtifact(row, input);
        if (row.status === 'ready' && row.providerKey) {
          return toSafeResult(row);
        }
        if (row.status === 'pending') {
          const recovered = await recoverPending(row, input);
          if (recovered) return recovered;
          throw new Error('artifact_store_in_progress');
        }
        const claimed = await db.storageArtifact.updateMany({
          where: { id: row.id, status: 'failed' },
          data: { status: 'pending', failureCode: null },
        });
        if (claimed.count !== 1) {
          throw new Error('artifact_store_in_progress');
        }
      } else {
        try {
          row = await db.storageArtifact.create({
            data: {
              id: randomUUID(),
              context: options.context,
              provider: options.provider,
              status: 'pending',
              idempotencyKey: input.idempotencyKey,
              originalName: input.originalName,
              contentType: input.contentType,
              sizeBytes: BigInt(input.sizeBytes),
              sha256: input.sha256,
              ownerType: input.ownerType ?? null,
              ownerId: input.ownerId ?? null,
              createdBy: input.createdBy ?? null,
            },
          });
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : '';
          if (!where || code !== 'P2002') throw error;
          const raced = await db.storageArtifact.findUnique({ where });
          if (!raced) throw error;
          assertMatchingArtifact(raced, input);
          if (raced.status === 'ready' && raced.providerKey) {
            return toSafeResult(raced);
          }
          if (raced.status === 'pending') {
            const recovered = await recoverPending(raced, input);
            if (recovered) return recovered;
          }
          throw new Error('artifact_store_in_progress');
        }
      }

      try {
        let providerKey: string;
        if (options.provider === 'local') {
          providerKey = await writeLocalArtifact(
            options.localDir,
            row.id,
            input,
          );
        } else {
          const store = getObjectStore();
          const stored = await store.put({
            body: input.body,
            contentType: input.contentType,
            idempotencyKey: input.idempotencyKey,
            originalName: input.storageName ?? row.id,
            sha256: input.sha256,
            sizeBytes: input.sizeBytes,
          });
          if (
            stored.checksum.sha256 !== input.sha256 ||
            stored.sizeBytes !== input.sizeBytes
          ) {
            throw new Error('artifact_remote_verification_failed');
          }
          providerKey = stored.key;
          await verifyObjectContent(store, providerKey, input);
        }
        return markReady(row, input, providerKey);
      } catch (error) {
        await db.storageArtifact
          .updateMany({
            where: { id: row.id, status: 'pending' },
            data: { status: 'failed', failureCode: failureCode(error) },
          })
          .catch(() => undefined);
        throw error;
      }
    },

    async open(artifactId) {
      const row = await db.storageArtifact.findFirst({
        where: {
          id: artifactId,
          context: options.context,
          status: 'ready',
          deletedAt: null,
        },
      });
      if (!row?.providerKey) throw new Error('artifact_not_found');
      if (row.provider !== 'local' && row.provider !== 'gdrive') {
        throw new Error('artifact_provider_invalid');
      }
      if (row.provider === 'gdrive') {
        const metadata = await getObjectStore().stat(row.providerKey);
        if (
          metadata.trashed ||
          metadata.sizeBytes !== Number(row.sizeBytes) ||
          metadata.checksum.sha256 !== row.sha256
        ) {
          throw new Error('artifact_remote_verification_failed');
        }
        const opened = await getObjectStore().get(row.providerKey);
        return { artifact: toSafeResult(row), stream: opened.stream };
      }
      if (!UUID_PATTERN.test(row.providerKey)) {
        throw new Error('artifact_provider_key_invalid');
      }
      const directory = await openLocalArtifactDirectory(options.localDir, {
        create: false,
      });
      if (!directory) throw new Error('artifact_local_directory_unsafe');
      let handle: FileHandle;
      try {
        handle = await directory.openRead(row.providerKey);
      } catch {
        await directory.close().catch(() => undefined);
        throw new Error('artifact_not_found');
      }
      try {
        await verifyLocalHandle(handle, {
          sha256: row.sha256,
          sizeBytes: Number(row.sizeBytes),
        });
        await directory.assertBound();
        await directory.close();
        const stream = handle.createReadStream({ start: 0 });
        return {
          artifact: toSafeResult(row),
          stream,
        };
      } catch (error) {
        await directory.close().catch(() => undefined);
        await handle.close();
        if (
          error instanceof Error &&
          /^artifact_[a-z0-9_]+$/.test(error.message)
        ) {
          throw error;
        }
        throw new Error('artifact_local_io_failed');
      }
    },
  };
}
