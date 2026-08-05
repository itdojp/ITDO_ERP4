import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { createKnowledgeArtifactStorageAdapter as createSharedStorage } from '../storage/contextArtifactStorageAdapters.js';
import type {
  KnowledgeArtifact,
  KnowledgeArtifactPort,
} from '../../application/knowledge/knowledgeArtifactPort.js';
import {
  KnowledgeArtifactOpenError,
  KnowledgeArtifactStoreError,
} from '../../application/knowledge/knowledgeArtifactPort.js';
import { knowledgeSnapshotLimits } from '../../application/knowledge/knowledgeSnapshotPorts.js';
import type {
  ArtifactStoragePort,
  StorageArtifactProvider,
} from '../../application/storage/artifactStoragePort.js';
import { GoogleDriveConfigurationError } from '../../infrastructure/storage/googleDriveConfig.js';
type KnowledgeArtifactStorageAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  provider: StorageArtifactProvider;
  shared?: ArtifactStoragePort;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KNOWLEDGE_OWNER_TYPE = 'knowledge_snapshot';

function idempotencyKey(namespace: string) {
  if (!HASH_PATTERN.test(namespace)) {
    throw new Error('knowledge_artifact_idempotency_invalid');
  }
  return `knowledge:v1:${namespace}`;
}

function extension(contentType: string) {
  switch (contentType) {
    case 'text/plain':
      return 'txt';
    case 'text/html':
      return 'html';
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

function assertOpenedMetadata(
  opened: Awaited<ReturnType<ArtifactStoragePort['open']>>,
) {
  if (
    !Number.isSafeInteger(opened.artifact.sizeBytes) ||
    opened.artifact.sizeBytes < 0 ||
    opened.artifact.sizeBytes > knowledgeSnapshotLimits.maxBytes ||
    !HASH_PATTERN.test(opened.artifact.sha256)
  ) {
    throw new KnowledgeArtifactOpenError('storage_failure');
  }
}

function verifiedStream(
  opened: Awaited<ReturnType<ArtifactStoragePort['open']>>,
) {
  try {
    assertOpenedMetadata(opened);
  } catch (error) {
    opened.stream.destroy();
    throw error;
  }
  const expectedSize = opened.artifact.sizeBytes;
  const expectedHash = opened.artifact.sha256;
  return Readable.from(
    (async function* () {
      const hash = createHash('sha256');
      let sizeBytes = 0;
      try {
        for await (const chunk of opened.stream) {
          const buffer = Buffer.from(chunk);
          sizeBytes += buffer.length;
          if (
            sizeBytes > expectedSize ||
            sizeBytes > knowledgeSnapshotLimits.maxBytes
          ) {
            throw new KnowledgeArtifactOpenError('storage_failure');
          }
          hash.update(buffer);
          yield buffer;
        }
        if (sizeBytes !== expectedSize || hash.digest('hex') !== expectedHash) {
          throw new KnowledgeArtifactOpenError('storage_failure');
        }
      } catch (error) {
        if (error instanceof KnowledgeArtifactOpenError) throw error;
        throw new KnowledgeArtifactOpenError('storage_failure');
      } finally {
        opened.stream.destroy();
      }
    })(),
    { objectMode: false },
  );
}

async function consumeVerified(
  opened: Awaited<ReturnType<ArtifactStoragePort['open']>>,
) {
  for await (const _chunk of verifiedStream(opened)) {
    // Verification is incremental; no artifact body is retained in memory.
  }
}

const deterministicStoreFailures = new Set([
  'artifact_idempotency_conflict',
  'artifact_idempotency_key_invalid',
  'artifact_local_directory_unsafe',
  'artifact_original_name_invalid',
  'artifact_sha256_invalid',
  'artifact_size_invalid',
  'artifact_storage_name_invalid',
  'knowledge_artifact_idempotency_invalid',
]);

function storeOutcome(error: unknown): 'failed' | 'unknown' {
  if (error instanceof GoogleDriveConfigurationError) return 'failed';
  return error instanceof Error && deterministicStoreFailures.has(error.message)
    ? 'failed'
    : 'unknown';
}

function openError(error: unknown) {
  if (error instanceof KnowledgeArtifactOpenError) return error;
  return new KnowledgeArtifactOpenError(
    error instanceof Error && error.message === 'artifact_not_found'
      ? 'not_found'
      : 'storage_failure',
  );
}

function safeArtifact(
  artifact: Awaited<ReturnType<ArtifactStoragePort['store']>>,
): KnowledgeArtifact {
  return artifact;
}

export function createKnowledgeArtifactPort(
  options: KnowledgeArtifactStorageAdapterOptions,
): KnowledgeArtifactPort {
  const shared =
    options.shared ??
    createSharedStorage({
      env: options.env,
      provider: options.provider,
    });

  const openOwned = (artifactId: string, snapshotId: string) =>
    shared.open(artifactId, {
      ownerId: snapshotId,
      ownerType: KNOWLEDGE_OWNER_TYPE,
    });

  return {
    async store(input) {
      if (
        input.body.length !== input.sizeBytes ||
        input.sizeBytes > knowledgeSnapshotLimits.maxBytes ||
        !HASH_PATTERN.test(input.sha256) ||
        createHash('sha256').update(input.body).digest('hex') !== input.sha256
      ) {
        throw new KnowledgeArtifactStoreError('failed');
      }
      let stored: Awaited<ReturnType<ArtifactStoragePort['store']>>;
      try {
        stored = await shared.store({
          body: input.body,
          contentType: input.contentType,
          createdBy: input.createdBy,
          idempotencyKey: idempotencyKey(input.idempotencyNamespace),
          originalName: input.originalName,
          ownerId: input.snapshotId,
          ownerType: KNOWLEDGE_OWNER_TYPE,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          storageName: `${input.sha256}.${extension(input.contentType)}`,
        });
      } catch (error) {
        throw new KnowledgeArtifactStoreError(storeOutcome(error));
      }
      if (
        stored.sha256 !== input.sha256 ||
        stored.sizeBytes !== input.sizeBytes
      ) {
        throw new KnowledgeArtifactStoreError('unknown');
      }
      let opened: Awaited<ReturnType<ArtifactStoragePort['open']>>;
      try {
        opened = await openOwned(stored.artifactId, input.snapshotId);
        await consumeVerified(opened);
      } catch {
        throw new KnowledgeArtifactStoreError('unknown');
      }
      if (
        opened.artifact.artifactId !== stored.artifactId ||
        opened.artifact.contentType !== input.contentType ||
        opened.artifact.sha256 !== input.sha256 ||
        opened.artifact.sizeBytes !== input.sizeBytes
      ) {
        throw new KnowledgeArtifactStoreError('unknown');
      }
      return safeArtifact(stored);
    },

    async open(input) {
      try {
        const opened = await openOwned(input.artifactId, input.snapshotId);
        return {
          artifact: safeArtifact(opened.artifact),
          stream: verifiedStream(opened),
        };
      } catch (error) {
        throw openError(error);
      }
    },

    async reconcile(input) {
      try {
        const recovered = await shared.recover({
          contentType: input.contentType,
          idempotencyKey: idempotencyKey(input.idempotencyNamespace),
          originalName: input.originalName,
          ownerType: KNOWLEDGE_OWNER_TYPE,
          ownerId: input.snapshotId,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          storageName: `${input.sha256}.${extension(input.contentType)}`,
        });
        if (!recovered) return null;
        if (
          recovered.contentType !== input.contentType ||
          recovered.sha256 !== input.sha256 ||
          recovered.sizeBytes !== input.sizeBytes
        ) {
          throw new KnowledgeArtifactOpenError('storage_failure');
        }
        const opened = await openOwned(recovered.artifactId, input.snapshotId);
        await consumeVerified(opened);
        if (
          opened.artifact.artifactId !== recovered.artifactId ||
          opened.artifact.contentType !== input.contentType ||
          opened.artifact.sha256 !== input.sha256 ||
          opened.artifact.sizeBytes !== input.sizeBytes
        ) {
          throw new KnowledgeArtifactOpenError('storage_failure');
        }
        return safeArtifact(opened.artifact);
      } catch (error) {
        throw openError(error);
      }
    },
  };
}

export function resolveKnowledgeSnapshotProvider(
  env: NodeJS.ProcessEnv = process.env,
): StorageArtifactProvider {
  const value =
    env.KNOWLEDGE_SNAPSHOT_PROVIDER?.trim().toLowerCase() || 'local';
  if (value !== 'local' && value !== 'gdrive') {
    throw new Error('knowledge_snapshot_provider_invalid');
  }
  return value;
}
