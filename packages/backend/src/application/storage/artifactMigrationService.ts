import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
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

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
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

export async function inventoryLocalArtifacts(options: {
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

  const files: InventoryEntry[] = [];
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
      const info = await lstat(resolvedFile);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('migration_source_entry_unsupported');
      }
      if (!Number.isSafeInteger(info.size)) {
        throw new Error('migration_source_size_invalid');
      }
      const sha256 = await sha256File(resolvedFile);
      const sourceKey = createHash('sha256')
        .update(`${options.context}\0${relativePath}\0${sha256}`)
        .digest('hex');
      const extension = path.extname(relativePath).toLowerCase();
      files.push({
        absolutePath: resolvedFile,
        contentType: CONTENT_TYPES[extension] ?? null,
        relativePath,
        sha256,
        sizeBytes: info.size,
        sourceKey,
        storageName: storageName(options.context, sourceKey, relativePath),
      });
    }
  };

  await visit(sourceRoot);
  files.sort((left, right) =>
    compareText(left.relativePath, right.relativePath),
  );
  return files;
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
  const inventory = await inventoryLocalArtifacts(options);
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
      const stored = await options.port!.store({
        body: () => createReadStream(source.absolutePath),
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
