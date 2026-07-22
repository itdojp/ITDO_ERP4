import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type {
  ObjectStore,
  ObjectStoreMetadata,
} from '../../infrastructure/storage/objectStore.js';

const BACKUP_SCHEMA = 'v1';
const MANIFEST_SCHEMA = 'erp4.backup.manifest.v1';
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const REQUIRED_TYPES = ['database', 'globals', 'metadata'] as const;
const ARTIFACT_TYPES = [...REQUIRED_TYPES, 'assets'] as const;
const RETENTION_CLASSES = ['daily', 'weekly', 'monthly'] as const;
const ROLES = ['artifact', 'manifest'] as const;

export type BackupArtifactType = (typeof ARTIFACT_TYPES)[number];
export type BackupRetentionClass = (typeof RETENTION_CLASSES)[number];
type BackupObjectRole = (typeof ROLES)[number];

type BackupManifest = {
  schemaVersion: typeof MANIFEST_SCHEMA;
  backupId: string;
  generatedAt: string;
  environment: string;
  retentionClass: BackupRetentionClass;
  artifact: {
    type: BackupArtifactType;
    name: string;
    sourceName: string;
    sourceSizeBytes: number;
    sizeBytes: number;
    sha256: string;
  };
  encryption: { algorithm: 'openpgp' };
  application: { commitSha: string };
};

type SourceIdentity = {
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
};

type PinnedBackupArtifact = {
  artifactPath: string;
  handle: FileHandle;
  identity: SourceIdentity;
  manifest: BackupManifest;
  manifestBuffer: Buffer;
  manifestMd5: string;
  manifestSha256: string;
  md5: string;
};

type BackupInventoryRecord = {
  artifactType: BackupArtifactType;
  backupDigest: string;
  cipherSha256: string;
  generatedAt: string;
  key: string;
  metadata: ObjectStoreMetadata;
  retentionClass: BackupRetentionClass;
  role: BackupObjectRole;
};

export type BackupInventoryAnomalyCode =
  | 'checksum_metadata_mismatch'
  | 'duplicate_object'
  | 'generation_incomplete'
  | 'invalid_metadata'
  | 'orphan_pair'
  | 'zero_size';

export type BackupInventory = {
  anomalies: Array<{
    backupDigest?: string;
    code: BackupInventoryAnomalyCode;
  }>;
  records: BackupInventoryRecord[];
};

export type BackupInventorySummary = {
  anomalyCounts: Partial<Record<BackupInventoryAnomalyCode, number>>;
  classes: Record<
    BackupRetentionClass,
    {
      completeGenerations: number;
      freshness: 'fresh' | 'stale' | 'unknown';
      latestGeneratedAt: string | null;
    }
  >;
  objectCount: number;
  quota: 'unknown';
};

export type BackupRetentionPlan = {
  applyAllowed: boolean;
  candidateGenerations: number;
  candidateObjects: number;
  keys: string[];
  mode: 'dry-run';
  protectedGenerations: number;
};

function fail(code: string): never {
  throw new Error(code);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  choices: T,
): value is T[number] {
  return typeof value === 'string' && choices.includes(value);
}

function identity(
  info: Awaited<ReturnType<FileHandle['stat']>>,
): SourceIdentity {
  return {
    ctimeMs: Number(info.ctimeMs),
    dev: Number(info.dev),
    ino: Number(info.ino),
    mtimeMs: Number(info.mtimeMs),
    size: Number(info.size),
  };
}

function identitiesMatch(left: SourceIdentity, right: SourceIdentity) {
  return Object.keys(left).every(
    (key) =>
      left[key as keyof SourceIdentity] === right[key as keyof SourceIdentity],
  );
}

async function hashHandle(handle: FileHandle) {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    start: 0,
  })) {
    sha256.update(chunk);
    md5.update(chunk);
  }
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}

function hashBuffer(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function md5Buffer(buffer: Buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function backupTimestamp(backupId: string) {
  const match = /-([0-9]{8})-([0-9]{6})-[A-Fa-f0-9]{7,64}$/.exec(backupId);
  if (!match) fail('backup_google_drive_backup_id_invalid');
  const compact = `${match[1]}${match[2]}`;
  const date = new Date(
    `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}Z`,
  );
  const roundTrip =
    `${date.getUTCFullYear()}`.padStart(4, '0') +
    `${date.getUTCMonth() + 1}`.padStart(2, '0') +
    `${date.getUTCDate()}`.padStart(2, '0') +
    `${date.getUTCHours()}`.padStart(2, '0') +
    `${date.getUTCMinutes()}`.padStart(2, '0') +
    `${date.getUTCSeconds()}`.padStart(2, '0');
  if (Number.isNaN(date.getTime()) || roundTrip !== compact)
    fail('backup_google_drive_backup_id_invalid');
  return date.toISOString();
}

function parseManifest(value: unknown, artifactName: string): BackupManifest {
  const root = asRecord(value);
  const artifact = asRecord(root?.artifact);
  const encryption = asRecord(root?.encryption);
  const application = asRecord(root?.application);
  if (
    root?.schemaVersion !== MANIFEST_SCHEMA ||
    typeof root.backupId !== 'string' ||
    !SAFE_TOKEN.test(root.backupId) ||
    !isCanonicalIso(root.generatedAt) ||
    backupTimestamp(root.backupId) !== root.generatedAt ||
    typeof root.environment !== 'string' ||
    !SAFE_TOKEN.test(root.environment) ||
    !isOneOf(root.retentionClass, RETENTION_CLASSES) ||
    !isOneOf(artifact?.type, ARTIFACT_TYPES) ||
    artifact?.name !== artifactName ||
    typeof artifact?.sourceName !== 'string' ||
    !SAFE_FILENAME.test(artifact.sourceName) ||
    !Number.isSafeInteger(artifact?.sourceSizeBytes) ||
    Number(artifact.sourceSizeBytes) < 0 ||
    !Number.isSafeInteger(artifact?.sizeBytes) ||
    Number(artifact.sizeBytes) <= 0 ||
    typeof artifact?.sha256 !== 'string' ||
    !SHA256.test(artifact.sha256) ||
    encryption?.algorithm !== 'openpgp' ||
    typeof application?.commitSha !== 'string' ||
    !SAFE_TOKEN.test(application.commitSha)
  ) {
    fail('backup_google_drive_manifest_invalid');
  }
  return value as BackupManifest;
}

async function readManifestFile(manifestPath: string, artifactName: string) {
  const handle = await open(
    manifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => fail('backup_google_drive_manifest_invalid'));
  try {
    const info = await handle.stat({ bigint: false });
    if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) {
      fail('backup_google_drive_manifest_invalid');
    }
    const buffer = await handle.readFile();
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch {
      fail('backup_google_drive_manifest_invalid');
    }
    return { buffer, manifest: parseManifest(parsed, artifactName) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function assertOpenPgpEncrypted(
  handle: FileHandle,
  env: NodeJS.ProcessEnv = process.env,
) {
  const args = ['--batch', '--no-options'];
  if (env.GPG_HOME?.trim()) args.push('--homedir', env.GPG_HOME.trim());
  args.push('--list-packets');
  const child = spawn('gpg', args, {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let output = '';
  let exceeded = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (output.length + chunk.length > 1024 * 1024) {
      exceeded = true;
      child.kill();
      return;
    }
    output += chunk;
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await pipeline(
    handle.createReadStream({ autoClose: false, start: 0 }),
    child.stdin,
  ).catch(() => undefined);
  const status = await completion.catch(() => null);
  if (
    exceeded ||
    status !== 0 ||
    !/^:pubkey enc packet:/m.test(output) ||
    !/^:(aead encrypted packet|encrypted data packet):/m.test(output)
  ) {
    fail('backup_google_drive_openpgp_required');
  }
}

async function pinArtifact(
  artifactPath: string,
  assertEncrypted: (handle: FileHandle) => Promise<void>,
): Promise<PinnedBackupArtifact> {
  const artifactName = path.basename(artifactPath);
  if (
    artifactPath !== path.resolve(artifactPath) ||
    !SAFE_FILENAME.test(artifactName) ||
    !artifactName.endsWith('.gpg')
  ) {
    fail('backup_google_drive_encrypted_artifact_required');
  }
  const handle = await open(
    artifactPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => fail('backup_google_drive_encrypted_artifact_required'));
  try {
    const opened = await handle.stat({ bigint: false });
    if (
      !opened.isFile() ||
      opened.size <= 0 ||
      !Number.isSafeInteger(opened.size)
    ) {
      fail('backup_google_drive_encrypted_artifact_required');
    }
    const sourceIdentity = identity(opened);
    await assertEncrypted(handle);
    if (
      !identitiesMatch(
        sourceIdentity,
        identity(await handle.stat({ bigint: false })),
      )
    ) {
      fail('backup_google_drive_source_changed');
    }
    const digest = await hashHandle(handle);
    if (
      !identitiesMatch(
        sourceIdentity,
        identity(await handle.stat({ bigint: false })),
      )
    ) {
      fail('backup_google_drive_source_changed');
    }
    const manifestPath = `${artifactPath}.manifest.json`;
    const { buffer, manifest } = await readManifestFile(
      manifestPath,
      artifactName,
    );
    if (
      manifest.artifact.sizeBytes !== opened.size ||
      manifest.artifact.sha256 !== digest.sha256
    ) {
      fail('backup_google_drive_artifact_integrity_mismatch');
    }
    return {
      artifactPath,
      handle,
      identity: sourceIdentity,
      manifest,
      manifestBuffer: buffer,
      manifestMd5: md5Buffer(buffer),
      manifestSha256: hashBuffer(buffer),
      md5: digest.md5,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function pinBundle(
  artifactPaths: string[],
  assertEncrypted: (handle: FileHandle) => Promise<void>,
) {
  if (artifactPaths.length < 3 || artifactPaths.length > 4) {
    fail('backup_google_drive_bundle_invalid');
  }
  const pinned: PinnedBackupArtifact[] = [];
  try {
    for (const artifactPath of artifactPaths) {
      pinned.push(
        await pinArtifact(path.resolve(artifactPath), assertEncrypted),
      );
    }
    const first = pinned[0].manifest;
    const types = new Set<BackupArtifactType>();
    for (const source of pinned) {
      const manifest = source.manifest;
      if (
        manifest.backupId !== first.backupId ||
        manifest.generatedAt !== first.generatedAt ||
        manifest.environment !== first.environment ||
        manifest.retentionClass !== first.retentionClass ||
        manifest.application.commitSha !== first.application.commitSha ||
        types.has(manifest.artifact.type)
      ) {
        fail('backup_google_drive_bundle_invalid');
      }
      types.add(manifest.artifact.type);
    }
    if (REQUIRED_TYPES.some((type) => !types.has(type))) {
      fail('backup_google_drive_bundle_invalid');
    }
    return pinned;
  } catch (error) {
    await Promise.allSettled(pinned.map((source) => source.handle.close()));
    throw error;
  }
}

function backupProperties(
  manifest: BackupManifest,
  role: BackupObjectRole,
  objectSha256: string,
  objectMd5: string,
) {
  return {
    erp4BackupSchema: BACKUP_SCHEMA,
    erp4BackupId: hashBuffer(Buffer.from(manifest.backupId)),
    erp4Retention: manifest.retentionClass,
    erp4ArtifactType: manifest.artifact.type,
    erp4BackupRole: role,
    erp4CipherSha256: manifest.artifact.sha256,
    erp4GeneratedAt: manifest.generatedAt,
    erp4ObjectSha256: objectSha256,
    erp4ObjectMd5: objectMd5,
  };
}

function assertRemoteObject(
  metadata: ObjectStoreMetadata,
  expected: {
    name: string;
    properties: Record<string, string>;
    md5: string;
    sha256: string;
    sizeBytes: number;
  },
) {
  if (
    metadata.trashed ||
    metadata.originalName !== expected.name ||
    metadata.sizeBytes !== expected.sizeBytes ||
    metadata.checksum.sha256 !== expected.sha256 ||
    metadata.checksum.md5 !== expected.md5 ||
    Object.entries(expected.properties).some(
      ([key, value]) => metadata.appProperties?.[key] !== value,
    )
  ) {
    fail('backup_google_drive_remote_verification_failed');
  }
}

function backupObjectIdentity(properties: Record<string, string>) {
  return {
    erp4BackupSchema: properties.erp4BackupSchema,
    erp4BackupId: properties.erp4BackupId,
    erp4ArtifactType: properties.erp4ArtifactType,
    erp4BackupRole: properties.erp4BackupRole,
  };
}

async function putIdempotently(
  store: ObjectStore,
  input: {
    body: Buffer | ((start?: number) => NodeJS.ReadableStream);
    contentType: string | null;
    name: string;
    properties: Record<string, string>;
    md5: string;
    sha256: string;
    sizeBytes: number;
  },
) {
  const existing = await store.list({
    appProperties: backupObjectIdentity(input.properties),
  });
  if (existing.items.length > 1) fail('backup_google_drive_duplicate_object');
  let metadata = existing.items[0];
  if (!metadata) {
    metadata = await store.put({
      body: input.body as
        Buffer | ((start?: number) => import('node:stream').Readable),
      contentType: input.contentType,
      originalName: input.name,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      appProperties: input.properties,
    });
  }
  const verified = await store.stat(metadata.key);
  assertRemoteObject(verified, {
    name: input.name,
    properties: input.properties,
    md5: input.md5,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
  });
  return verified;
}

async function readRemote(store: ObjectStore, metadata: ObjectStoreMetadata) {
  const opened = await store.get(metadata.key);
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let size = 0;
  for await (const chunk of opened.stream) {
    const buffer = Buffer.from(chunk);
    sha256.update(buffer);
    md5.update(buffer);
    size += buffer.length;
  }
  if (
    size !== metadata.sizeBytes ||
    sha256.digest('hex') !== metadata.checksum.sha256 ||
    md5.digest('hex') !== metadata.checksum.md5
  ) {
    fail('backup_google_drive_download_verification_failed');
  }
}

async function ensurePrivateStateDir(stateDir: string) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const info = await lstat(stateDir);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  ) {
    fail('backup_google_drive_state_directory_unsafe');
  }
}

type GenerationUploadLock = {
  dev: number;
  handle: FileHandle;
  ino: number;
  lockPath: string;
};

async function acquireGenerationUploadLock(
  stateDir: string,
  backupDigest: string,
): Promise<GenerationUploadLock> {
  await ensurePrivateStateDir(stateDir);
  const lockPath = path.join(stateDir, `.upload-${backupDigest}.lock`);
  let handle: FileHandle;
  try {
    handle = await open(
      lockPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === 'EEXIST') fail('backup_google_drive_upload_in_progress');
    fail('backup_google_drive_lock_failed');
  }
  try {
    const info = await handle.stat({ bigint: false });
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    ) {
      fail('backup_google_drive_lock_failed');
    }
    await handle.sync();
    return {
      dev: Number(info.dev),
      handle,
      ino: Number(info.ino),
      lockPath,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}

async function releaseGenerationUploadLock(lock: GenerationUploadLock) {
  try {
    const [opened, current] = await Promise.all([
      lock.handle.stat({ bigint: false }),
      lstat(lock.lockPath),
    ]);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.uid !== process.getuid?.() ||
      (current.mode & 0o077) !== 0 ||
      Number(opened.dev) !== lock.dev ||
      Number(opened.ino) !== lock.ino ||
      Number(current.dev) !== lock.dev ||
      Number(current.ino) !== lock.ino
    ) {
      fail('backup_google_drive_lock_release_failed');
    }
    await unlink(lock.lockPath);
  } catch {
    fail('backup_google_drive_lock_release_failed');
  } finally {
    await lock.handle.close().catch(() => undefined);
  }
}

async function writePrivateState(
  stateDir: string,
  document: Record<string, unknown>,
  backupDigest: string,
) {
  await ensurePrivateStateDir(stateDir);
  const destination = path.join(stateDir, `${backupDigest}.json`);
  const content = `${JSON.stringify(document, null, 2)}\n`;
  const existing = await lstat(destination).catch(() => null);
  if (existing) {
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.uid !== process.getuid?.() ||
      (existing.mode & 0o077) !== 0 ||
      (await readFile(destination, 'utf8')) !== content
    ) {
      fail('backup_google_drive_state_conflict');
    }
    return;
  }
  const handle = await open(destination, 'wx', 0o600).catch(() =>
    fail('backup_google_drive_state_conflict'),
  );
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function uploadBackupBundle(options: {
  artifactPaths: string[];
  assertEncrypted?: (handle: FileHandle) => Promise<void>;
  stateDir: string;
  store: ObjectStore;
  verifyDownload?: boolean;
}) {
  const pinned = await pinBundle(
    options.artifactPaths,
    options.assertEncrypted ?? ((handle) => assertOpenPgpEncrypted(handle)),
  );
  try {
    const first = pinned[0].manifest;
    const backupDigest = hashBuffer(Buffer.from(first.backupId));
    const lock = await acquireGenerationUploadLock(
      options.stateDir,
      backupDigest,
    );
    try {
      const uploaded: Array<{
        artifactType: BackupArtifactType;
        fileId: string;
        originalName: string;
        role: BackupObjectRole;
        sha256: string;
        sizeBytes: number;
      }> = [];
      for (const source of pinned) {
        if (
          !identitiesMatch(
            source.identity,
            identity(await source.handle.stat({ bigint: false })),
          )
        ) {
          fail('backup_google_drive_source_changed');
        }
        const artifactName = path.basename(source.artifactPath);
        const artifactProperties = backupProperties(
          source.manifest,
          'artifact',
          source.manifest.artifact.sha256,
          source.md5,
        );
        const artifact = await putIdempotently(options.store, {
          body: (start = 0) =>
            source.handle.createReadStream({ autoClose: false, start }),
          contentType: 'application/octet-stream',
          name: artifactName,
          properties: artifactProperties,
          md5: source.md5,
          sha256: source.manifest.artifact.sha256,
          sizeBytes: source.manifest.artifact.sizeBytes,
        });
        const manifestName = `${artifactName}.manifest.json`;
        const manifestProperties = backupProperties(
          source.manifest,
          'manifest',
          source.manifestSha256,
          source.manifestMd5,
        );
        const manifest = await putIdempotently(options.store, {
          body: source.manifestBuffer,
          contentType: 'application/json',
          name: manifestName,
          properties: manifestProperties,
          md5: source.manifestMd5,
          sha256: source.manifestSha256,
          sizeBytes: source.manifestBuffer.length,
        });
        await readRemote(options.store, manifest);
        if (options.verifyDownload) await readRemote(options.store, artifact);
        uploaded.push(
          {
            artifactType: source.manifest.artifact.type,
            fileId: artifact.key,
            originalName: artifactName,
            role: 'artifact',
            sha256: source.manifest.artifact.sha256,
            sizeBytes: source.manifest.artifact.sizeBytes,
          },
          {
            artifactType: source.manifest.artifact.type,
            fileId: manifest.key,
            originalName: manifestName,
            role: 'manifest',
            sha256: source.manifestSha256,
            sizeBytes: source.manifestBuffer.length,
          },
        );
      }
      await writePrivateState(
        options.stateDir,
        {
          schemaVersion: 'erp4.backup.gdrive-state.v1',
          backupDigest,
          generatedAt: first.generatedAt,
          retentionClass: first.retentionClass,
          files: uploaded,
        },
        backupDigest,
      );
      return {
        backupDigest,
        objectCount: uploaded.length,
        retentionClass: first.retentionClass,
        status: 'success' as const,
      };
    } finally {
      await releaseGenerationUploadLock(lock);
    }
  } finally {
    await Promise.allSettled(pinned.map((source) => source.handle.close()));
  }
}

function parseInventoryRecord(
  metadata: ObjectStoreMetadata,
): BackupInventoryRecord | null {
  const properties = metadata.appProperties;
  if (
    properties?.erp4BackupSchema !== BACKUP_SCHEMA ||
    !SHA256.test(properties.erp4BackupId ?? '') ||
    !isOneOf(properties.erp4Retention, RETENTION_CLASSES) ||
    !isOneOf(properties.erp4ArtifactType, ARTIFACT_TYPES) ||
    !isOneOf(properties.erp4BackupRole, ROLES) ||
    !SHA256.test(properties.erp4CipherSha256 ?? '') ||
    !SHA256.test(properties.erp4ObjectSha256 ?? '') ||
    !MD5.test(properties.erp4ObjectMd5 ?? '') ||
    !isCanonicalIso(properties.erp4GeneratedAt) ||
    !SAFE_FILENAME.test(metadata.originalName) ||
    (properties.erp4BackupRole === 'artifact' &&
      !metadata.originalName.endsWith('.gpg')) ||
    (properties.erp4BackupRole === 'manifest' &&
      !metadata.originalName.endsWith('.gpg.manifest.json'))
  ) {
    return null;
  }
  return {
    artifactType: properties.erp4ArtifactType,
    backupDigest: properties.erp4BackupId,
    cipherSha256: properties.erp4CipherSha256,
    generatedAt: properties.erp4GeneratedAt,
    key: metadata.key,
    metadata,
    retentionClass: properties.erp4Retention,
    role: properties.erp4BackupRole,
  };
}

function logicalKey(record: BackupInventoryRecord) {
  return `${record.backupDigest}:${record.artifactType}:${record.role}`;
}

function completeGenerationRecords(
  inventory: BackupInventory,
  backupDigest: string,
) {
  const records = inventory.records.filter(
    (record) => record.backupDigest === backupDigest,
  );
  const keys = new Set(records.map(logicalKey));
  const complete = REQUIRED_TYPES.every((type) =>
    ROLES.every((role) => keys.has(`${backupDigest}:${type}:${role}`)),
  );
  return { complete, records };
}

export async function inventoryGoogleDriveBackups(
  store: ObjectStore,
): Promise<BackupInventory> {
  const listed = await store.list({
    appProperties: { erp4BackupSchema: BACKUP_SCHEMA },
  });
  const anomalies: BackupInventory['anomalies'] = [];
  const records: BackupInventoryRecord[] = [];
  for (const metadata of listed.items) {
    const record = parseInventoryRecord(metadata);
    if (!record) {
      anomalies.push({ code: 'invalid_metadata' });
      continue;
    }
    if (!metadata.sizeBytes || metadata.sizeBytes <= 0) {
      anomalies.push({ backupDigest: record.backupDigest, code: 'zero_size' });
    }
    if (
      metadata.checksum.sha256 !== metadata.appProperties?.erp4ObjectSha256 ||
      metadata.checksum.md5 !== metadata.appProperties?.erp4ObjectMd5
    ) {
      anomalies.push({
        backupDigest: record.backupDigest,
        code: 'checksum_metadata_mismatch',
      });
    }
    records.push(record);
  }
  const logicalCounts = new Map<string, number>();
  for (const record of records) {
    const key = logicalKey(record);
    logicalCounts.set(key, (logicalCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of logicalCounts) {
    if (count > 1) {
      anomalies.push({
        backupDigest: key.slice(0, 64),
        code: 'duplicate_object',
      });
    }
  }
  const digests = new Set(records.map((record) => record.backupDigest));
  for (const backupDigest of digests) {
    const generation = records.filter(
      (record) => record.backupDigest === backupDigest,
    );
    const generationKeys = new Set(generation.map(logicalKey));
    if (
      new Set(generation.map((record) => record.generatedAt)).size !== 1 ||
      new Set(generation.map((record) => record.retentionClass)).size !== 1
    ) {
      anomalies.push({ backupDigest, code: 'invalid_metadata' });
    }
    for (const type of ARTIFACT_TYPES) {
      const artifactRecords = generation.filter(
        (record) => record.artifactType === type && record.role === 'artifact',
      );
      const manifestRecords = generation.filter(
        (record) => record.artifactType === type && record.role === 'manifest',
      );
      if (
        (artifactRecords.length === 0) !== (manifestRecords.length === 0) ||
        (artifactRecords.length === 1 &&
          manifestRecords.length === 1 &&
          (artifactRecords[0].cipherSha256 !==
            manifestRecords[0].cipherSha256 ||
            `${artifactRecords[0].metadata.originalName}.manifest.json` !==
              manifestRecords[0].metadata.originalName))
      ) {
        anomalies.push({ backupDigest, code: 'orphan_pair' });
      }
    }
    if (
      REQUIRED_TYPES.some((type) =>
        ROLES.some(
          (role) => !generationKeys.has(`${backupDigest}:${type}:${role}`),
        ),
      )
    ) {
      anomalies.push({ backupDigest, code: 'generation_incomplete' });
    }
  }
  return { anomalies, records };
}

export function summarizeBackupInventory(
  inventory: BackupInventory,
  now = new Date(),
): BackupInventorySummary {
  const anomalyCounts: BackupInventorySummary['anomalyCounts'] = {};
  for (const anomaly of inventory.anomalies) {
    anomalyCounts[anomaly.code] = (anomalyCounts[anomaly.code] ?? 0) + 1;
  }
  const staleAfterMs: Record<BackupRetentionClass, number> = {
    daily: 48 * 60 * 60 * 1000,
    weekly: 9 * 24 * 60 * 60 * 1000,
    monthly: 40 * 24 * 60 * 60 * 1000,
  };
  const invalidDigests = new Set(
    inventory.anomalies.flatMap((anomaly) =>
      anomaly.backupDigest ? [anomaly.backupDigest] : [],
    ),
  );
  const classes = Object.fromEntries(
    RETENTION_CLASSES.map((retentionClass) => {
      const digests = new Set(
        inventory.records
          .filter((record) => record.retentionClass === retentionClass)
          .map((record) => record.backupDigest),
      );
      const complete = [...digests]
        .map((digest) => completeGenerationRecords(inventory, digest))
        .filter(
          (generation) =>
            generation.complete &&
            !invalidDigests.has(generation.records[0].backupDigest),
        );
      const timestamps = complete
        .flatMap((generation) => generation.records)
        .map((record) => record.generatedAt)
        .sort();
      const latest = timestamps[timestamps.length - 1];
      return [
        retentionClass,
        {
          completeGenerations: complete.length,
          freshness: !latest
            ? 'unknown'
            : now.getTime() - new Date(latest).getTime() <=
                staleAfterMs[retentionClass]
              ? 'fresh'
              : 'stale',
          latestGeneratedAt: latest ?? null,
        },
      ];
    }),
  ) as BackupInventorySummary['classes'];
  return {
    anomalyCounts,
    classes,
    objectCount: inventory.records.length,
    quota: 'unknown',
  };
}

export function summarizeBackupGeneration(
  inventory: BackupInventory,
  backupDigest: string,
) {
  if (!SHA256.test(backupDigest)) fail('backup_google_drive_selector_invalid');
  const generation = completeGenerationRecords(inventory, backupDigest);
  if (generation.records.length === 0) fail('backup_google_drive_not_found');
  const valid =
    generation.complete &&
    !inventory.anomalies.some(
      (anomaly) => anomaly.backupDigest === backupDigest,
    );
  return {
    complete: valid,
    checksumStatus: valid ? ('verified' as const) : ('invalid' as const),
    generatedAt: generation.records[0].generatedAt,
    objectCount: generation.records.length,
    retentionClass: generation.records[0].retentionClass,
    status: valid ? ('ready' as const) : ('invalid' as const),
    totalSizeBytes: generation.records.reduce(
      (total, record) => total + (record.metadata.sizeBytes ?? 0),
      0,
    ),
  };
}

async function downloadObject(
  store: ObjectStore,
  record: BackupInventoryRecord,
  destination: string,
) {
  const handle = await open(destination, 'wx', 0o600).catch(() =>
    fail('backup_google_drive_download_destination_exists'),
  );
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const buffer = Buffer.from(chunk);
      sha256.update(buffer);
      md5.update(buffer);
      size += buffer.length;
      callback(null, buffer);
    },
  });
  try {
    const opened = await store.get(record.key);
    await pipeline(
      opened.stream,
      meter,
      handle.createWriteStream({ autoClose: true }),
    );
    if (
      size !== record.metadata.sizeBytes ||
      sha256.digest('hex') !== record.metadata.checksum.sha256 ||
      md5.digest('hex') !== record.metadata.checksum.md5
    ) {
      fail('backup_google_drive_download_verification_failed');
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  await handle.close().catch(() => undefined);
}

export async function downloadBackupGeneration(options: {
  assertEncrypted?: (handle: FileHandle) => Promise<void>;
  backupDigest: string;
  destinationDir: string;
  handoffFile: string;
  inventory: BackupInventory;
  store: ObjectStore;
}) {
  const generation = completeGenerationRecords(
    options.inventory,
    options.backupDigest,
  );
  if (
    !generation.complete ||
    options.inventory.anomalies.some(
      (anomaly) => anomaly.backupDigest === options.backupDigest,
    )
  ) {
    fail('backup_google_drive_generation_invalid');
  }
  await mkdir(options.destinationDir, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(options.destinationDir);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    directoryInfo.uid !== process.getuid?.() ||
    (directoryInfo.mode & 0o077) !== 0
  ) {
    fail('backup_google_drive_download_directory_unsafe');
  }
  if (path.dirname(options.handoffFile) !== options.destinationDir) {
    fail('backup_google_drive_handoff_invalid');
  }
  const destinations: Partial<Record<BackupArtifactType, string>> = {};
  const created: string[] = [];
  try {
    for (const record of generation.records.sort((left, right) =>
      left.metadata.originalName.localeCompare(right.metadata.originalName),
    )) {
      const destination = path.join(
        options.destinationDir,
        record.metadata.originalName,
      );
      await downloadObject(options.store, record, destination);
      created.push(destination);
      if (record.role === 'artifact') {
        destinations[record.artifactType] = destination;
      }
    }
    const verified = await pinBundle(
      Object.values(destinations),
      options.assertEncrypted ?? ((handle) => assertOpenPgpEncrypted(handle)),
    );
    await Promise.allSettled(verified.map((source) => source.handle.close()));
    const handoff = {
      schemaVersion: 'erp4.backup.restore-handoff.v1',
      backupDigest: options.backupDigest,
      BACKUP_FILE: destinations.database,
      BACKUP_GLOBALS_FILE: destinations.globals,
      BACKUP_ASSETS_FILE: destinations.assets ?? null,
      BACKUP_METADATA_FILE: destinations.metadata,
    };
    const handoffHandle = await open(options.handoffFile, 'wx', 0o600).catch(
      () => fail('backup_google_drive_handoff_exists'),
    );
    created.push(options.handoffFile);
    try {
      await handoffHandle.writeFile(`${JSON.stringify(handoff, null, 2)}\n`);
    } finally {
      await handoffHandle.close().catch(() => undefined);
    }
    return {
      artifactCount: Object.keys(destinations).length,
      handoffCreated: true,
      status: 'success' as const,
    };
  } catch (error) {
    await Promise.allSettled(created.map((file) => unlink(file)));
    throw error;
  }
}

export function planBackupRetention(
  inventory: BackupInventory,
  now = new Date(),
): BackupRetentionPlan {
  if (inventory.anomalies.length > 0) {
    return {
      applyAllowed: false,
      candidateGenerations: 0,
      candidateObjects: 0,
      keys: [],
      mode: 'dry-run',
      protectedGenerations: 0,
    };
  }
  const retentionMs: Record<BackupRetentionClass, number> = {
    daily: 30 * 24 * 60 * 60 * 1000,
    weekly: 12 * 7 * 24 * 60 * 60 * 1000,
    monthly: 13 * 31 * 24 * 60 * 60 * 1000,
  };
  const keys: string[] = [];
  let candidateGenerations = 0;
  let protectedGenerations = 0;
  for (const retentionClass of RETENTION_CLASSES) {
    const digests = [
      ...new Set(
        inventory.records
          .filter((record) => record.retentionClass === retentionClass)
          .map((record) => record.backupDigest),
      ),
    ].sort((left, right) => {
      const leftDate = inventory.records.find(
        (record) => record.backupDigest === left,
      )!.generatedAt;
      const rightDate = inventory.records.find(
        (record) => record.backupDigest === right,
      )!.generatedAt;
      return rightDate.localeCompare(leftDate);
    });
    for (const [index, digest] of digests.entries()) {
      const generation = completeGenerationRecords(inventory, digest);
      const generatedAt = new Date(generation.records[0].generatedAt);
      if (
        index > 0 &&
        now.getTime() - generatedAt.getTime() > retentionMs[retentionClass]
      ) {
        candidateGenerations += 1;
        keys.push(...generation.records.map((record) => record.key));
      } else {
        protectedGenerations += 1;
      }
    }
  }
  return {
    applyAllowed: true,
    candidateGenerations,
    candidateObjects: keys.length,
    keys,
    mode: 'dry-run',
    protectedGenerations,
  };
}

export async function applyBackupTrash(store: ObjectStore, keys: string[]) {
  for (const key of keys) await store.trash(key);
  return { status: 'trashed' as const, objectCount: keys.length };
}

export async function trashBackupGeneration(
  store: ObjectStore,
  inventory: BackupInventory,
  backupDigest: string,
) {
  const generation = completeGenerationRecords(inventory, backupDigest);
  if (
    !generation.complete ||
    inventory.anomalies.some((anomaly) => anomaly.backupDigest === backupDigest)
  ) {
    fail('backup_google_drive_generation_invalid');
  }
  return applyBackupTrash(
    store,
    generation.records.map((record) => record.key),
  );
}
