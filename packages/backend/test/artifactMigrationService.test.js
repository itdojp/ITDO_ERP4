import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  formatArtifactMigrationMarkdown,
  inventoryLocalArtifacts,
  migrateLocalArtifacts,
} from '../dist/application/storage/artifactMigrationService.js';
import { parseArtifactMigrationArgs } from '../dist/cli/storageArtifactMigration.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readAll(body) {
  const stream = Buffer.isBuffer(body) ? null : body();
  if (!stream) return body;
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function createScratchDir() {
  const scratchRoot = path.resolve(
    process.cwd(),
    '../..',
    '.codex-local',
    'tmp',
  );
  await mkdir(scratchRoot, { recursive: true });
  return mkdtemp(path.join(scratchRoot, 'erp4-artifact-migration-'));
}

async function createFixture() {
  const sourceDir = await createScratchDir();
  await mkdir(path.join(sourceDir, 'nested'));
  await writeFile(path.join(sourceDir, 'document.pdf'), Buffer.from('pdf'));
  await writeFile(
    path.join(sourceDir, 'nested', 'report.csv'),
    Buffer.from('csv'),
  );
  return sourceDir;
}

function createIdempotentPort(overrides = {}) {
  const artifacts = new Map();
  let calls = 0;
  return {
    artifacts,
    get calls() {
      return calls;
    },
    port: {
      open: async () => assert.fail('open must not be called'),
      store: async (input) => {
        calls += 1;
        const body = await readAll(input.body);
        assert.equal(body.length, input.sizeBytes);
        assert.equal(sha256(body), input.sha256);
        let artifactId = artifacts.get(input.idempotencyKey);
        if (!artifactId) {
          artifactId = randomUUID();
          artifacts.set(input.idempotencyKey, artifactId);
        }
        return {
          artifactId,
          contentType: input.contentType,
          createdAt: '2026-07-22T00:00:00.000Z',
          originalName: input.originalName,
          provider: 'gdrive',
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          ...overrides,
        };
      },
    },
  };
}

test('inventory is deterministic, recursive, and hashes source content', async () => {
  const sourceDir = await createFixture();
  try {
    const files = await inventoryLocalArtifacts({
      context: 'pdf',
      sourceDir,
    });
    assert.deepEqual(
      files.map((file) => file.relativePath),
      ['document.pdf', 'nested/report.csv'],
    );
    assert.equal(files[0].sha256, sha256(Buffer.from('pdf')));
    assert.equal(files[0].contentType, 'application/pdf');
    assert.match(files[0].storageName, /^pdf-[a-f0-9]{64}\.pdf$/);
    assert.doesNotMatch(files[0].storageName, /document/);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('dry-run is the default and produces no target writes', async () => {
  const sourceDir = await createFixture();
  try {
    const report = await migrateLocalArtifacts({
      context: 'report',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      sourceDir,
    });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.source.count, 2);
    assert.equal(report.source.sizeBytes, 6);
    assert.equal(report.target.count, 0);
    assert.equal(report.target.digest, null);
    assert.equal(report.verified, false);
    assert.deepEqual(
      report.files.map((file) => file.status),
      ['planned', 'planned'],
    );
    const markdown = formatArtifactMigrationMarkdown(report);
    assert.match(markdown, /NOT RUN \(dry-run\)/);
    assert.doesNotMatch(markdown, /document\.pdf|report\.csv/);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('apply verifies count, size, digest and is idempotent on rerun', async () => {
  const sourceDir = await createFixture();
  const fake = createIdempotentPort();
  try {
    const first = await migrateLocalArtifacts({
      context: 'evidence',
      mode: 'apply',
      port: fake.port,
      sourceDir,
    });
    const second = await migrateLocalArtifacts({
      context: 'evidence',
      mode: 'apply',
      port: fake.port,
      sourceDir,
    });

    assert.equal(first.verified, true);
    assert.deepEqual(first.source, {
      count: 2,
      digest: first.target.digest,
      sizeBytes: 6,
    });
    assert.equal(first.target.count, 2);
    assert.equal(second.verified, true);
    assert.deepEqual(
      second.files.map((file) => file.artifactId),
      first.files.map((file) => file.artifactId),
    );
    assert.equal(fake.artifacts.size, 2);
    assert.equal(fake.calls, 4);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('apply streams the pinned source when its path is replaced after inventory', async () => {
  const sourceDir = await createScratchDir();
  const sourcePath = path.join(sourceDir, 'document.pdf');
  const movedPath = path.join(sourceDir, 'document-original.pdf');
  const outsideDir = await createScratchDir();
  const outsidePath = path.join(outsideDir, 'private.txt');
  const expected = Buffer.from('approved source');
  const privateContent = Buffer.from('must not be uploaded');
  await writeFile(sourcePath, expected);
  await writeFile(outsidePath, privateContent);
  let uploaded;
  try {
    const report = await migrateLocalArtifacts({
      context: 'pdf',
      mode: 'apply',
      port: {
        open: async () => assert.fail('open must not be called'),
        store: async (input) => {
          await rename(sourcePath, movedPath);
          await symlink(outsidePath, sourcePath);
          uploaded = await readAll(input.body);
          return {
            artifactId: randomUUID(),
            contentType: input.contentType,
            createdAt: '2026-07-22T00:00:00.000Z',
            originalName: input.originalName,
            provider: 'gdrive',
            sha256: input.sha256,
            sizeBytes: input.sizeBytes,
          };
        },
      },
      sourceDir,
    });

    assert.equal(report.verified, true);
    assert.deepEqual(uploaded, expected);
    assert.notDeepEqual(uploaded, privateContent);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('target checksum mismatch is reported without provider details', async () => {
  const sourceDir = await createFixture();
  const fake = createIdempotentPort({ sha256: '0'.repeat(64) });
  try {
    const report = await migrateLocalArtifacts({
      context: 'pdf',
      mode: 'apply',
      port: fake.port,
      sourceDir,
    });
    assert.equal(report.verified, false);
    assert.equal(report.target.count, 0);
    assert.deepEqual(
      report.files.map((file) => file.errorCode),
      [
        'migration_target_verification_failed',
        'migration_target_verification_failed',
      ],
    );
    assert.equal(
      report.files.every((file) => !Object.hasOwn(file, 'providerKey')),
      true,
    );
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('source symlinks and empty sources fail closed by default', async () => {
  const sourceDir = await createScratchDir();
  try {
    await assert.rejects(
      () => migrateLocalArtifacts({ context: 'pdf', sourceDir }),
      { message: 'migration_source_empty' },
    );
    const empty = await migrateLocalArtifacts({
      allowEmpty: true,
      context: 'pdf',
      sourceDir,
    });
    assert.equal(empty.source.count, 0);
    await writeFile(path.join(sourceDir, 'source.txt'), 'source');
    await symlink('source.txt', path.join(sourceDir, 'link.txt'));
    await assert.rejects(
      () => inventoryLocalArtifacts({ context: 'pdf', sourceDir }),
      { message: 'migration_source_symlink_unsupported' },
    );
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('CLI parsing is dry-run by default and rejects ambiguous modes', () => {
  assert.deepEqual(
    parseArtifactMigrationArgs([
      '--context',
      'evidence_metadata',
      '--source-dir',
      '/safe-placeholder',
    ]),
    {
      allowEmpty: false,
      context: 'evidence_metadata',
      jsonOutput: undefined,
      markdownOutput: undefined,
      mode: 'dry-run',
      sourceDir: '/safe-placeholder',
    },
  );
  assert.throws(
    () =>
      parseArtifactMigrationArgs([
        '--context',
        'pdf',
        '--source-dir',
        '/safe-placeholder',
        '--apply',
        '--dry-run',
      ]),
    { message: 'migration_mode_conflict' },
  );
  assert.throws(
    () =>
      parseArtifactMigrationArgs([
        '--context',
        'unknown',
        '--source-dir',
        '/safe-placeholder',
      ]),
    { message: 'migration_context_invalid' },
  );
});

test('dry-run CLI needs no database credentials and writes private evidence files', async () => {
  const sourceDir = await createFixture();
  const outputDir = await createScratchDir();
  const jsonOutput = path.join(outputDir, 'report.json');
  const markdownOutput = path.join(outputDir, 'report.md');
  try {
    const result = spawnSync(
      process.execPath,
      [
        'dist/cli/storageArtifactMigration.js',
        '--context',
        'pdf',
        '--source-dir',
        sourceDir,
        '--json-output',
        jsonOutput,
        '--markdown-output',
        markdownOutput,
      ],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).mode, 'dry-run');
    assert.doesNotMatch(result.stdout, /document\.pdf|report\.csv/);
    assert.equal(
      JSON.parse(await readFile(jsonOutput, 'utf8')).source.count,
      2,
    );
    assert.match(await readFile(markdownOutput, 'utf8'), /NOT RUN \(dry-run\)/);
    assert.equal((await stat(jsonOutput)).mode & 0o077, 0);
    assert.equal((await stat(markdownOutput)).mode & 0o077, 0);

    const repeated = spawnSync(
      process.execPath,
      [
        'dist/cli/storageArtifactMigration.js',
        '--context',
        'pdf',
        '--source-dir',
        sourceDir,
        '--json-output',
        jsonOutput,
        '--markdown-output',
        markdownOutput,
      ],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      },
    );
    assert.notEqual(repeated.status, 0);
    assert.equal(repeated.stderr, 'migration_output_exists\n');
    assert.doesNotMatch(
      repeated.stderr,
      /artifact-migration|report\.(json|md)/,
    );
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
});
