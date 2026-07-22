import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  formatArtifactMigrationMarkdown,
  migrateLocalArtifacts,
} from '../application/storage/artifactMigrationService.js';
import {
  STORAGE_ARTIFACT_CONTEXTS,
  type StorageArtifactContext,
} from '../application/storage/artifactStoragePort.js';

type CliOptions = {
  allowEmpty: boolean;
  context: StorageArtifactContext;
  jsonOutput?: string;
  markdownOutput?: string;
  mode: 'apply' | 'dry-run';
  sourceDir: string;
};

const FOLDER_ENV_KEYS: Record<StorageArtifactContext, string> = {
  pdf: 'PDF_GDRIVE_FOLDER_ID',
  evidence: 'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
  evidence_metadata: 'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
  report: 'REPORT_GDRIVE_FOLDER_ID',
};

function valueAfter(args: string[], index: number, name: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`migration_argument_missing_${name}`);
  }
  return value;
}

export function parseArtifactMigrationArgs(args: string[]): CliOptions {
  let context: StorageArtifactContext | undefined;
  let sourceDir: string | undefined;
  let jsonOutput: string | undefined;
  let markdownOutput: string | undefined;
  let mode: CliOptions['mode'] = 'dry-run';
  let allowEmpty = false;
  let applySpecified = false;
  let dryRunSpecified = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      applySpecified = true;
      mode = 'apply';
    } else if (arg === '--dry-run') {
      dryRunSpecified = true;
      mode = 'dry-run';
    } else if (arg === '--allow-empty') {
      allowEmpty = true;
    } else if (arg === '--context') {
      const value = valueAfter(args, index, 'context');
      index += 1;
      if (
        !STORAGE_ARTIFACT_CONTEXTS.includes(value as StorageArtifactContext)
      ) {
        throw new Error('migration_context_invalid');
      }
      context = value as StorageArtifactContext;
    } else if (arg === '--source-dir') {
      sourceDir = valueAfter(args, index, 'source_dir');
      index += 1;
    } else if (arg === '--json-output') {
      jsonOutput = valueAfter(args, index, 'json_output');
      index += 1;
    } else if (arg === '--markdown-output') {
      markdownOutput = valueAfter(args, index, 'markdown_output');
      index += 1;
    } else {
      throw new Error('migration_argument_unknown');
    }
  }
  if (applySpecified && dryRunSpecified) {
    throw new Error('migration_mode_conflict');
  }
  if (!context) throw new Error('migration_context_required');
  if (!sourceDir) throw new Error('migration_source_dir_required');
  return {
    allowEmpty,
    context,
    jsonOutput,
    markdownOutput,
    mode,
    sourceDir,
  };
}

async function writePrivateFile(filePath: string, content: string) {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if ((await realpath(parent)) !== parent) {
      throw new Error('migration_output_directory_unsafe');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'migration_output_directory_unsafe'
    ) {
      throw error;
    }
    throw new Error('migration_output_directory_unsafe');
  }
  let output;
  try {
    output = await open(resolved, 'wx', 0o600);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    throw new Error(
      code === 'EEXIST'
        ? 'migration_output_exists'
        : 'migration_output_write_failed',
    );
  }
  let complete = false;
  try {
    await output.writeFile(content);
    await output.chmod(0o600);
    await output.sync();
    complete = true;
  } finally {
    await output.close();
    if (!complete) await unlink(resolved).catch(() => undefined);
  }
}

async function assertOutputFilesAvailable(
  filePaths: Array<string | undefined>,
) {
  const resolvedPaths = filePaths
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => path.resolve(filePath));
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    throw new Error('migration_output_conflict');
  }
  for (const filePath of resolvedPaths) {
    const exists = await lstat(filePath)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw new Error('migration_output_check_failed');
      });
    if (exists) throw new Error('migration_output_exists');
  }
}

function safeCliError(error: unknown) {
  if (
    error instanceof Error &&
    /^(artifact|google_drive|migration)_[a-z0-9_]+$/.test(error.message)
  ) {
    return error.message;
  }
  return 'migration_failed';
}

export async function runArtifactMigrationCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const options = parseArtifactMigrationArgs(args);
  await assertOutputFilesAvailable([
    options.jsonOutput,
    options.markdownOutput,
  ]);
  let port;
  if (options.mode === 'apply') {
    const { createArtifactStorageAdapter } =
      await import('../adapters/storage/artifactStorageAdapter.js');
    port = createArtifactStorageAdapter({
      context: options.context,
      env,
      folderEnvKey: FOLDER_ENV_KEYS[options.context],
      localDir: options.sourceDir,
      provider: 'gdrive',
    });
  }
  const report = await migrateLocalArtifacts({
    allowEmpty: options.allowEmpty,
    context: options.context,
    mode: options.mode,
    port,
    sourceDir: options.sourceDir,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = formatArtifactMigrationMarkdown(report);
  if (options.jsonOutput) await writePrivateFile(options.jsonOutput, json);
  if (options.markdownOutput) {
    await writePrivateFile(options.markdownOutput, markdown);
  }
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: report.schemaVersion,
      context: report.context,
      mode: report.mode,
      source: {
        count: report.source.count,
        sizeBytes: report.source.sizeBytes,
      },
      target: {
        count: report.target.count,
        sizeBytes: report.target.sizeBytes,
      },
      verified: report.verified,
    })}\n`,
  );
  if (options.mode === 'apply' && !report.verified) process.exitCode = 1;
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runArtifactMigrationCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeCliError(error)}\n`);
    process.exitCode = 1;
  });
}
