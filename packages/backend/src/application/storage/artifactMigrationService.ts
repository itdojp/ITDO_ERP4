import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  ArtifactStoragePort,
  StorageArtifactContext,
} from './artifactStoragePort.js';

export type ArtifactMigrationMode = 'apply' | 'dry-run';

export type ArtifactMigrationFile = {
  artifactId?: string;
  contentType: string | null;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  sourceKey: string;
  status: 'failed' | 'planned' | 'verified';
  errorCode?: string;
};

export type ArtifactMigrationReport = {
  schemaVersion: 1;
  context: StorageArtifactContext;
  generatedAt: string;
  mode: ArtifactMigrationMode;
  source: {
    count: number;
    digest: string;
    sizeBytes: number;
  };
  target: {
    count: number;
    digest: string | null;
    sizeBytes: number;
  };
  verified: boolean;
  files: ArtifactMigrationFile[];
};

type InventoryEntry = {
  absolutePath: string;
  contentType: string | null;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  sourceKey: string;
  storageName: string;
};

type PinnedInventoryEntry = InventoryEntry & {
  handle: FileHandle;
  sourceIdentity: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mtimeMs: number;
    size: number;
  };
};

const CONTENT_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

function safeErrorCode(error: unknown) {
  if (error instanceof Error) {
    const code = error.message;
    if (/^(artifact|google_drive|migration)_[a-z0-9_]+$/.test(code)) {
      return code;
    }
  }
  return 'migration_upload_failed';
}

async function sha256Handle(handle: FileHandle) {
  const hash = createHash('sha256');
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    start: 0,
  })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function sourceIdentity(info: Stats) {
  return {
    ctimeMs: info.ctimeMs,
    dev: info.dev,
    ino: info.ino,
    mtimeMs: info.mtimeMs,
    size: info.size,
  };
}

function sameSourceIdentity(
  left: PinnedInventoryEntry['sourceIdentity'],
  right: PinnedInventoryEntry['sourceIdentity'],
) {
  return (
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

async function assertPinnedSourceUnchanged(source: PinnedInventoryEntry) {
  if (
    !sameSourceIdentity(
      source.sourceIdentity,
      sourceIdentity(await source.handle.stat({ bigint: false })),
    )
  ) {
    throw new Error('migration_source_changed');
  }
}

function inventoryDigest(
  files: Array<Pick<InventoryEntry, 'relativePath' | 'sha256' | 'sizeBytes'>>,
) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(String(file.sizeBytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function toPosix(value: string) {
  return value.split(path.sep).join('/');
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function storageName(
  context: StorageArtifactContext,
  sourceKey: string,
  relativePath: string,
) {
  const rawExtension = path.extname(relativePath).toLowerCase();
  const extension = /^[.][a-z0-9]{1,10}$/.test(rawExtension)
    ? rawExtension
    : '';
  return `${context}-${sourceKey}${extension}`;
}

async function pinLocalArtifacts(options: {
  context: StorageArtifactContext;
  sourceDir: string;
}) {
  const sourceRoot = path.resolve(options.sourceDir);
  const sourceInfo = await lstat(sourceRoot).catch(() => null);
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error('migration_source_directory_invalid');
  }
  if ((await realpath(sourceRoot)) !== sourceRoot) {
    throw new Error('migration_source_directory_unsafe');
  }

  const files: PinnedInventoryEntry[] = [];
  const closePinnedFiles = async () => {
    await Promise.allSettled(files.map((file) => file.handle.close()));
  };
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('migration_source_symlink_unsupported');
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error('migration_source_entry_unsupported');
      }
      const resolvedFile = await realpath(absolutePath);
      const relativePath = toPosix(path.relative(sourceRoot, resolvedFile));
      if (
        !relativePath ||
        relativePath === '..' ||
        relativePath.startsWith('../') ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error('migration_source_path_unsafe');
      }
      const pathInfo = await lstat(resolvedFile);
      if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
        throw new Error('migration_source_entry_unsupported');
      }
      const handle = await open(
        resolvedFile,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      ).catch(() => {
        throw new Error('migration_source_entry_unsafe');
      });
      try {
        const openedInfo = await handle.stat({ bigint: false });
        if (
          !openedInfo.isFile() ||
          openedInfo.dev !== pathInfo.dev ||
          openedInfo.ino !== pathInfo.ino
        ) {
          throw new Error('migration_source_entry_unsafe');
        }
        if (!Number.isSafeInteger(openedInfo.size)) {
          throw new Error('migration_source_size_invalid');
        }
        const beforeHash = sourceIdentity(openedInfo);
        const sha256 = await sha256Handle(handle);
        const afterHash = sourceIdentity(await handle.stat({ bigint: false }));
        if (!sameSourceIdentity(beforeHash, afterHash)) {
          throw new Error('migration_source_changed');
        }
        const sourceKey = createHash('sha256')
          .update(`${options.context}\0${relativePath}\0${sha256}`)
          .digest('hex');
        const extension = path.extname(relativePath).toLowerCase();
        files.push({
          absolutePath: resolvedFile,
          contentType: CONTENT_TYPES[extension] ?? null,
          handle,
          relativePath,
          sha256,
          sizeBytes: openedInfo.size,
          sourceIdentity: afterHash,
          sourceKey,
          storageName: storageName(options.context, sourceKey, relativePath),
        });
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
    }
  };

  try {
    await visit(sourceRoot);
    files.sort((left, right) =>
      compareText(left.relativePath, right.relativePath),
    );
    return files;
  } catch (error) {
    await closePinnedFiles();
    throw error;
  }
}

function toInventoryEntry(source: PinnedInventoryEntry): InventoryEntry {
  return {
    absolutePath: source.absolutePath,
    contentType: source.contentType,
    relativePath: source.relativePath,
    sha256: source.sha256,
    sizeBytes: source.sizeBytes,
    sourceKey: source.sourceKey,
    storageName: source.storageName,
  };
}

export async function inventoryLocalArtifacts(options: {
  context: StorageArtifactContext;
  sourceDir: string;
}) {
  const pinned = await pinLocalArtifacts(options);
  try {
    return pinned.map(toInventoryEntry);
  } finally {
    await Promise.allSettled(pinned.map((source) => source.handle.close()));
  }
}

export async function migrateLocalArtifacts(options: {
  allowEmpty?: boolean;
  context: StorageArtifactContext;
  mode?: ArtifactMigrationMode;
  now?: () => Date;
  port?: ArtifactStoragePort;
  sourceDir: string;
}): Promise<ArtifactMigrationReport> {
  const mode = options.mode ?? 'dry-run';
  if (mode === 'apply' && !options.port) {
    throw new Error('migration_storage_port_required');
  }
  const inventory = await pinLocalArtifacts(options);
  try {
    if (inventory.length === 0 && !options.allowEmpty) {
      throw new Error('migration_source_empty');
    }

    const files: ArtifactMigrationFile[] = [];
    for (const source of inventory) {
      if (mode === 'dry-run') {
        files.push({
          contentType: source.contentType,
          relativePath: source.relativePath,
          sha256: source.sha256,
          sizeBytes: source.sizeBytes,
          sourceKey: source.sourceKey,
          status: 'planned',
        });
        continue;
      }
      try {
        await assertPinnedSourceUnchanged(source);
        const stored = await options.port!.store({
          body: () =>
            source.handle.createReadStream({ autoClose: false, start: 0 }),
          contentType: source.contentType,
          idempotencyKey: `storage-migration:v1:${options.context}:${source.sourceKey}`,
          originalName: path.basename(source.relativePath),
          ownerId: source.sourceKey,
          ownerType: 'legacy_storage_migration',
          sha256: source.sha256,
          sizeBytes: source.sizeBytes,
          storageName: source.storageName,
        });
        if (
          stored.sha256 !== source.sha256 ||
          stored.sizeBytes !== source.sizeBytes
        ) {
          throw new Error('migration_target_verification_failed');
        }
        files.push({
          artifactId: stored.artifactId,
          contentType: source.contentType,
          relativePath: source.relativePath,
          sha256: source.sha256,
          sizeBytes: source.sizeBytes,
          sourceKey: source.sourceKey,
          status: 'verified',
        });
      } catch (error) {
        files.push({
          contentType: source.contentType,
          errorCode: safeErrorCode(error),
          relativePath: source.relativePath,
          sha256: source.sha256,
          sizeBytes: source.sizeBytes,
          sourceKey: source.sourceKey,
          status: 'failed',
        });
      }
    }

    const verifiedFiles = files.filter((file) => file.status === 'verified');
    const sourceSize = inventory.reduce((sum, file) => sum + file.sizeBytes, 0);
    const targetSize = verifiedFiles.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    );
    const sourceDigest = inventoryDigest(inventory);
    const targetDigest =
      mode === 'apply'
        ? inventoryDigest(
            verifiedFiles.map((file) => ({
              relativePath: file.relativePath,
              sha256: file.sha256,
              sizeBytes: file.sizeBytes,
            })),
          )
        : null;
    const verified =
      mode === 'apply' &&
      verifiedFiles.length === inventory.length &&
      targetSize === sourceSize &&
      targetDigest === sourceDigest;

    return {
      schemaVersion: 1,
      context: options.context,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      mode,
      source: {
        count: inventory.length,
        digest: sourceDigest,
        sizeBytes: sourceSize,
      },
      target: {
        count: verifiedFiles.length,
        digest: targetDigest,
        sizeBytes: targetSize,
      },
      verified,
      files,
    };
  } finally {
    await Promise.allSettled(inventory.map((source) => source.handle.close()));
  }
}

export function formatArtifactMigrationMarkdown(
  report: ArtifactMigrationReport,
) {
  const lines = [
    '# Storage artifact migration report',
    '',
    `- Context: \`${report.context}\``,
    `- Mode: \`${report.mode}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Source: ${report.source.count} files / ${report.source.sizeBytes} bytes`,
    `- Target verified: ${report.target.count} files / ${report.target.sizeBytes} bytes`,
    `- Verification: **${report.verified ? 'PASS' : report.mode === 'dry-run' ? 'NOT RUN (dry-run)' : 'FAIL'}**`,
    '',
    '| source key | bytes | sha256 | status | error |',
    '| --- | ---: | --- | --- | --- |',
  ];
  for (const file of report.files) {
    lines.push(
      `| \`${file.sourceKey}\` | ${file.sizeBytes} | \`${file.sha256}\` | ${file.status} | ${file.errorCode ?? ''} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
