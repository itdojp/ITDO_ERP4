import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type {
  BackupObjectEntry,
  BackupObjectSource,
} from '../../application/backup/backupManifestReadiness.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const SAFE_PREFIX = /^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_S3_TIMEOUT_MS = 30_000;
const MAX_S3_INVENTORY_ENTRIES = 20_000;

export class BackupReadinessSourceConfigurationError extends Error {
  constructor() {
    super('backup_readiness_source_configuration_invalid');
    this.name = 'BackupReadinessSourceConfigurationError';
  }
}

async function sha256Handle(handle: FileHandle) {
  const digest = createHash('sha256');
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    start: 0,
  })) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

function sameIdentity(
  left: Awaited<ReturnType<FileHandle['stat']>>,
  right: Awaited<ReturnType<FileHandle['stat']>>,
) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

export function createLocalBackupObjectSource(options: {
  directory: string;
  prefix: string;
}): BackupObjectSource {
  const directory = path.resolve(options.directory);
  if (!SAFE_FILENAME.test(options.prefix)) {
    throw new BackupReadinessSourceConfigurationError();
  }
  const resolveKey = (key: string) => {
    if (!SAFE_FILENAME.test(key) || !key.startsWith(`${options.prefix}-`)) {
      throw new Error('backup_local_key_invalid');
    }
    return path.join(directory, key);
  };
  const openOwnerFile = async (key: string) => {
    const filePath = resolveKey(key);
    const handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      const named = await lstat(filePath);
      if (
        !opened.isFile() ||
        !named.isFile() ||
        named.isSymbolicLink() ||
        opened.uid !== process.getuid?.() ||
        (opened.mode & 0o022) !== 0 ||
        !sameIdentity(opened, named)
      ) {
        throw new Error('backup_local_entry_unsafe');
      }
      return { filePath, handle, opened };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  };
  const assertUnchanged = async (
    filePath: string,
    handle: FileHandle,
    opened: Awaited<ReturnType<FileHandle['stat']>>,
  ) => {
    const named = await lstat(filePath);
    const current = await handle.stat();
    if (
      named.isSymbolicLink() ||
      !sameIdentity(opened, named) ||
      !sameIdentity(opened, current)
    ) {
      throw new Error('backup_local_artifact_changed');
    }
  };
  return {
    async list() {
      const root = await lstat(directory);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        root.uid !== process.getuid?.() ||
        (root.mode & 0o022) !== 0
      ) {
        throw new Error('backup_local_directory_unsafe');
      }
      const entries: BackupObjectEntry[] = [];
      for (const name of await readdir(directory)) {
        if (!name.startsWith(`${options.prefix}-`)) continue;
        const opened = await openOwnerFile(name);
        try {
          entries.push({ key: name, sizeBytes: opened.opened.size });
        } finally {
          await opened.handle.close().catch(() => undefined);
        }
      }
      return entries;
    },
    async readManifest(key) {
      if (!key.endsWith('.manifest.json')) {
        throw new Error('backup_local_manifest_key_invalid');
      }
      const opened = await openOwnerFile(key);
      try {
        if (
          opened.opened.size <= 0 ||
          opened.opened.size > MAX_MANIFEST_BYTES
        ) {
          throw new Error('backup_local_manifest_invalid');
        }
        const content = await opened.handle.readFile('utf8');
        await assertUnchanged(opened.filePath, opened.handle, opened.opened);
        return JSON.parse(content) as unknown;
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    },
    async statArtifact(key) {
      const opened = await openOwnerFile(key);
      try {
        if (opened.opened.size <= 0) {
          throw new Error('backup_local_artifact_invalid');
        }
        const sha256 = await sha256Handle(opened.handle);
        await assertUnchanged(opened.filePath, opened.handle, opened.opened);
        return { sha256, sizeBytes: opened.opened.size };
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    },
  };
}

type S3ReadinessClient = Pick<S3Client, 'send'>;

async function readBoundedBody(body: unknown, maximum: number) {
  if (!body || typeof body !== 'object' || !(Symbol.asyncIterator in body)) {
    throw new Error('backup_s3_body_invalid');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maximum) throw new Error('backup_s3_body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

export function createS3BackupObjectSource(options: {
  bucket: string;
  client: S3ReadinessClient;
  prefix: string;
  timeoutMs?: number;
}): BackupObjectSource {
  const normalizedPrefix = options.prefix.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_S3_TIMEOUT_MS;
  if (
    !options.bucket ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 300_000 ||
    !SAFE_PREFIX.test(normalizedPrefix) ||
    normalizedPrefix.includes('//') ||
    normalizedPrefix.split('/').some((segment) => segment === '..')
  ) {
    throw new BackupReadinessSourceConfigurationError();
  }
  const scopedPrefix = `${normalizedPrefix}/`;
  const toRelativeKey = (key: string) => {
    if (!key.startsWith(scopedPrefix) || key.includes('\0')) {
      throw new Error('backup_s3_key_out_of_scope');
    }
    const relative = key.slice(scopedPrefix.length);
    if (!relative || relative.startsWith('/') || relative.includes('//')) {
      throw new Error('backup_s3_key_invalid');
    }
    return relative;
  };
  const toRemoteKey = (key: string) => {
    if (
      !key ||
      key.startsWith('/') ||
      key.includes('\0') ||
      key.includes('//') ||
      key.split('/').some((segment) => !segment || segment === '..')
    ) {
      throw new Error('backup_s3_key_out_of_scope');
    }
    return `${scopedPrefix}${key}`;
  };
  return {
    async list() {
      const result: BackupObjectEntry[] = [];
      const seenTokens = new Set<string>();
      let continuationToken: string | undefined;
      do {
        const response = await options.client.send(
          new ListObjectsV2Command({
            Bucket: options.bucket,
            Prefix: scopedPrefix,
            ContinuationToken: continuationToken,
          }),
          { abortSignal: AbortSignal.timeout(timeoutMs) },
        );
        for (const object of response.Contents ?? []) {
          if (!object.Key || !Number.isSafeInteger(object.Size)) {
            throw new Error('backup_s3_inventory_invalid');
          }
          result.push({
            key: toRelativeKey(object.Key),
            sizeBytes: Number(object.Size),
          });
          if (result.length > MAX_S3_INVENTORY_ENTRIES) {
            throw new Error('backup_inventory_too_large');
          }
        }
        if (!response.IsTruncated) break;
        const next = response.NextContinuationToken;
        if (!next || seenTokens.has(next) || seenTokens.size >= 1000) {
          throw new Error('backup_s3_pagination_invalid');
        }
        seenTokens.add(next);
        continuationToken = next;
      } while (continuationToken);
      return result;
    },
    async readManifest(key) {
      const remoteKey = toRemoteKey(key);
      if (!key.endsWith('.manifest.json')) {
        throw new Error('backup_s3_manifest_key_invalid');
      }
      const response = await options.client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: remoteKey }),
        { abortSignal: AbortSignal.timeout(timeoutMs) },
      );
      if (
        !Number.isSafeInteger(response.ContentLength) ||
        Number(response.ContentLength) <= 0 ||
        Number(response.ContentLength) > MAX_MANIFEST_BYTES
      ) {
        throw new Error('backup_s3_manifest_invalid');
      }
      const body = await readBoundedBody(response.Body, MAX_MANIFEST_BYTES);
      if (body.length !== Number(response.ContentLength)) {
        throw new Error('backup_s3_manifest_size_mismatch');
      }
      return JSON.parse(body.toString('utf8')) as unknown;
    },
    async statArtifact(key) {
      const remoteKey = toRemoteKey(key);
      const response = await options.client.send(
        new HeadObjectCommand({ Bucket: options.bucket, Key: remoteKey }),
        { abortSignal: AbortSignal.timeout(timeoutMs) },
      );
      const sha256 = response.Metadata?.sha256 ?? null;
      return {
        sha256: sha256 && SHA256.test(sha256) ? sha256 : null,
        sizeBytes: Number(response.ContentLength),
      };
    },
  };
}

function normalized(value: string | undefined) {
  return value?.trim() || undefined;
}

function resolveS3Timeout(value: string | undefined) {
  const normalizedValue = normalized(value);
  if (!normalizedValue) return DEFAULT_S3_TIMEOUT_MS;
  if (!/^[0-9]+$/.test(normalizedValue)) {
    throw new BackupReadinessSourceConfigurationError();
  }
  const parsed = Number(normalizedValue);
  if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 300_000) {
    throw new BackupReadinessSourceConfigurationError();
  }
  return parsed;
}

export function resolveSakuraBackupObjectSource(
  env: NodeJS.ProcessEnv,
  createClient: (config: S3ClientConfig) => S3ReadinessClient = (config) =>
    new S3Client(config),
): { configured: false } | { configured: true; source: BackupObjectSource } {
  const provider = normalized(env.S3_PROVIDER);
  if (!provider || provider === 'aws') return { configured: false };
  if (provider !== 'sakura') {
    throw new BackupReadinessSourceConfigurationError();
  }
  const endpointValue = normalized(env.S3_ENDPOINT_URL);
  const bucket = normalized(env.S3_BUCKET);
  const prefix = normalized(env.S3_PREFIX);
  const region = normalized(env.S3_REGION);
  if (!endpointValue || !bucket || !prefix || !region) {
    throw new BackupReadinessSourceConfigurationError();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new BackupReadinessSourceConfigurationError();
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '') ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new BackupReadinessSourceConfigurationError();
  }
  return {
    configured: true,
    source: createS3BackupObjectSource({
      bucket,
      prefix,
      timeoutMs: resolveS3Timeout(env.STORAGE_READINESS_S3_TIMEOUT_MS),
      client: createClient({ endpoint: endpoint.origin, region }),
    }),
  };
}
