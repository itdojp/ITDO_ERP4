import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createEvidenceArtifactStorageAdapter } from '../adapters/storage/contextArtifactStorageAdapters.js';
import type { EvidenceArchiveStoragePort } from '../application/evidence/evidenceArchiveStoragePort.js';

export type EvidencePackArchiveFormat = 'json' | 'pdf';

type EvidencePackArchiveProvider = 'gdrive' | 'local' | 's3';
type EvidenceArchiveSse = 'AES256' | 'aws:kms';
type EvidencePackArchiveS3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  prefix?: string;
  sse?: EvidenceArchiveSse;
  kmsKeyId?: string;
};

export type EvidencePackArchiveInput = {
  approvalInstanceId: string;
  snapshotId: string;
  snapshotVersion: number;
  format: EvidencePackArchiveFormat;
  mask: boolean;
  digest: string;
  exportedAt: Date;
  archivedBy: string | null;
  content: Buffer;
  contentType: string;
};

export type EvidencePackArchiveResult = {
  provider: EvidencePackArchiveProvider;
  objectKey: string;
  metadataKey: string;
  archiveUri: string;
  checksumSha256: string;
  sizeBytes: number;
  archivedAt: string;
};

type EvidencePackArchiveDependencies = {
  createContentStorage?: () => EvidenceArchiveStoragePort;
  createMetadataStorage?: () => EvidenceArchiveStoragePort;
  now?: () => Date;
};

function normalizeString(value: string | undefined) {
  const normalized = (value ?? '').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseBoolean(value: string | undefined) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return undefined;
}

function sanitizeSegment(value: string) {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
  const trimmed = normalized.replace(/^-+/, '').replace(/-+$/, '');
  return trimmed || 'unknown';
}

function resolveProvider(): EvidencePackArchiveProvider {
  const value = (process.env.EVIDENCE_ARCHIVE_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  if (value === 'gdrive' || value === 's3') return value;
  return 'local';
}

function resolveLocalArchiveDir() {
  return (
    process.env.EVIDENCE_ARCHIVE_LOCAL_DIR || '/tmp/erp4/evidence-archives'
  );
}

function resolveS3Config(): EvidencePackArchiveS3Config {
  const bucket = normalizeString(process.env.EVIDENCE_ARCHIVE_S3_BUCKET);
  const region =
    normalizeString(process.env.EVIDENCE_ARCHIVE_S3_REGION) ||
    normalizeString(process.env.AWS_REGION) ||
    normalizeString(process.env.AWS_DEFAULT_REGION);
  if (!bucket || !region) {
    throw new Error('evidence_archive_s3_config_invalid');
  }

  const endpoint = normalizeString(
    process.env.EVIDENCE_ARCHIVE_S3_ENDPOINT_URL,
  );
  if (endpoint) {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('evidence_archive_s3_config_invalid');
      }
    } catch {
      throw new Error('evidence_archive_s3_config_invalid');
    }
  }

  const forcePathStyle =
    parseBoolean(process.env.EVIDENCE_ARCHIVE_S3_FORCE_PATH_STYLE) ?? false;
  const prefix = normalizeString(process.env.EVIDENCE_ARCHIVE_S3_PREFIX);
  const sse = normalizeString(process.env.EVIDENCE_ARCHIVE_S3_SSE) as
    EvidenceArchiveSse | undefined;
  const kmsKeyId = normalizeString(process.env.EVIDENCE_ARCHIVE_S3_KMS_KEY_ID);
  if (sse && sse !== 'AES256' && sse !== 'aws:kms') {
    throw new Error('evidence_archive_s3_config_invalid');
  }
  if (sse === 'aws:kms' && !kmsKeyId) {
    throw new Error('evidence_archive_s3_config_invalid');
  }

  return {
    bucket,
    region,
    endpoint,
    forcePathStyle,
    prefix,
    sse,
    kmsKeyId,
  };
}

function buildObjectKey(input: {
  approvalInstanceId: string;
  snapshotVersion: number;
  format: EvidencePackArchiveFormat;
  digest: string;
  archivedAt: Date;
}) {
  const approval = sanitizeSegment(input.approvalInstanceId);
  const version = Math.max(1, Math.floor(input.snapshotVersion));
  const digest = sanitizeSegment(input.digest.slice(0, 16) || 'digest');
  const stamp = input.archivedAt.toISOString().replace(/[-:.TZ]/g, '');
  const extension = input.format === 'pdf' ? 'pdf' : 'json';
  return `${approval}/v${version}/${stamp}-${digest}.${extension}`;
}

function joinS3Key(prefix: string | undefined, key: string) {
  const normalizedPrefix = prefix?.replace(/^\/+|\/+$/g, '') || '';
  return normalizedPrefix ? `${normalizedPrefix}/${key}` : key;
}

function buildArchiveMetadata(
  input: EvidencePackArchiveInput,
  archivedAt: Date,
) {
  return {
    schemaVersion: 'evidence-pack-archive/v1',
    archivedAt: archivedAt.toISOString(),
    archivedBy: input.archivedBy,
    exportedAt: input.exportedAt.toISOString(),
    approvalInstanceId: input.approvalInstanceId,
    snapshotId: input.snapshotId,
    snapshotVersion: input.snapshotVersion,
    format: input.format,
    mask: input.mask,
    digest: input.digest,
    contentSha256: createHash('sha256').update(input.content).digest('hex'),
    sizeBytes: input.content.length,
    contentType: input.contentType,
  };
}

function createS3Client(config: {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
}) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });
}

let cachedS3Runtime:
  | {
      cacheKey: string;
      config: EvidencePackArchiveS3Config;
      client: S3Client;
    }
  | undefined;

function getS3Runtime() {
  const config = resolveS3Config();
  const cacheKey = JSON.stringify({
    region: config.region,
    endpoint: config.endpoint || null,
    forcePathStyle: config.forcePathStyle,
  });
  if (cachedS3Runtime && cachedS3Runtime.cacheKey === cacheKey) {
    return cachedS3Runtime;
  }
  const client = createS3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });
  cachedS3Runtime = {
    cacheKey,
    config,
    client,
  };
  return cachedS3Runtime;
}

export async function archiveEvidencePack(
  input: EvidencePackArchiveInput,
  dependencies: EvidencePackArchiveDependencies = {},
): Promise<EvidencePackArchiveResult> {
  const archivedAt = dependencies.now?.() ?? new Date();
  const objectKey = buildObjectKey({
    approvalInstanceId: input.approvalInstanceId,
    snapshotVersion: input.snapshotVersion,
    format: input.format,
    digest: input.digest,
    archivedAt,
  });
  const metadataKey = `${objectKey}.metadata.json`;
  const metadataPayload = buildArchiveMetadata(input, archivedAt);
  const metadataBody = `${JSON.stringify(metadataPayload, null, 2)}\n`;

  const provider = resolveProvider();
  if (provider === 'local') {
    const localDir = resolveLocalArchiveDir();
    const contentPath = path.join(localDir, objectKey);
    const metadataPath = path.join(localDir, metadataKey);
    await fs.mkdir(path.dirname(contentPath), { recursive: true });
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(contentPath, input.content);
    await fs.writeFile(metadataPath, metadataBody, 'utf8');

    return {
      provider,
      objectKey,
      metadataKey,
      archiveUri: `file://${contentPath}`,
      checksumSha256: metadataPayload.contentSha256,
      sizeBytes: input.content.length,
      archivedAt: archivedAt.toISOString(),
    };
  }

  if (provider === 'gdrive') {
    const checksumSha256 = metadataPayload.contentSha256;
    const contentStorage =
      dependencies.createContentStorage?.() ??
      createEvidenceArtifactStorageAdapter({ provider: 'gdrive' });
    const metadataStorage =
      dependencies.createMetadataStorage?.() ??
      createEvidenceArtifactStorageAdapter({
        provider: 'gdrive',
        metadata: true,
      });
    const idempotencyBase = [
      'evidence',
      input.approvalInstanceId,
      input.snapshotId,
      String(input.snapshotVersion),
      input.format,
      input.mask ? 'masked' : 'unmasked',
      input.digest,
      checksumSha256,
    ].join(':');
    const contentArtifact = await contentStorage.store({
      body: input.content,
      contentType: input.contentType,
      createdBy: input.archivedBy,
      idempotencyKey: idempotencyBase,
      originalName: `evidence-v${input.snapshotVersion}-${checksumSha256.slice(0, 16)}.${input.format}`,
      ownerId: input.approvalInstanceId,
      ownerType: 'approval_instance',
      sha256: checksumSha256,
      sizeBytes: input.content.length,
      storageName: `${checksumSha256}.${input.format}`,
    });
    const metadataBuffer = Buffer.from(metadataBody, 'utf8');
    const metadataSha256 = createHash('sha256')
      .update(metadataBuffer)
      .digest('hex');
    const metadataArtifact = await metadataStorage.store({
      body: metadataBuffer,
      contentType: 'application/json; charset=utf-8',
      createdBy: input.archivedBy,
      idempotencyKey: `${idempotencyBase}:metadata:${metadataSha256}`,
      originalName: `evidence-v${input.snapshotVersion}-${checksumSha256.slice(0, 16)}.metadata.json`,
      ownerId: input.approvalInstanceId,
      ownerType: 'approval_instance',
      sha256: metadataSha256,
      sizeBytes: metadataBuffer.length,
      storageName: `${checksumSha256}.metadata.json`,
    });

    return {
      provider,
      objectKey: contentArtifact.artifactId,
      metadataKey: metadataArtifact.artifactId,
      archiveUri: `/approval-instances/${encodeURIComponent(input.approvalInstanceId)}/evidence-pack/archives/${contentArtifact.artifactId}`,
      checksumSha256,
      sizeBytes: input.content.length,
      archivedAt: archivedAt.toISOString(),
    };
  }

  const runtime = getS3Runtime();
  const s3 = runtime.config;
  const client = runtime.client;
  const contentKey = joinS3Key(s3.prefix, objectKey);
  const contentMetadataKey = joinS3Key(s3.prefix, metadataKey);

  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: contentKey,
      Body: input.content,
      ContentType: input.contentType,
      Metadata: {
        approval_instance_id: sanitizeSegment(input.approvalInstanceId),
        snapshot_version: String(input.snapshotVersion),
        format: input.format,
        mask: input.mask ? '1' : '0',
        digest: sanitizeSegment(input.digest.slice(0, 64) || ''),
      },
      ServerSideEncryption: s3.sse,
      SSEKMSKeyId: s3.kmsKeyId,
    }),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: contentMetadataKey,
      Body: metadataBody,
      ContentType: 'application/json; charset=utf-8',
      ServerSideEncryption: s3.sse,
      SSEKMSKeyId: s3.kmsKeyId,
    }),
  );

  return {
    provider,
    objectKey: contentKey,
    metadataKey: contentMetadataKey,
    archiveUri: `s3://${s3.bucket}/${contentKey}`,
    checksumSha256: metadataPayload.contentSha256,
    sizeBytes: input.content.length,
    archivedAt: archivedAt.toISOString(),
  };
}
