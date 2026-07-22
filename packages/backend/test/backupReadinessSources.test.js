import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createLocalBackupObjectSource,
  createS3BackupObjectSource,
  resolveSakuraBackupObjectSource,
} from '../dist/infrastructure/backup/backupReadinessSources.js';
import { inspectRestoreEvidence } from '../dist/infrastructure/backup/restoreEvidenceReadiness.js';

const scratchRoot = path.resolve(process.cwd(), '../..', '.codex-local', 'tmp');

test('local backup source hashes owner-controlled regular artifacts', async () => {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(
    path.join(scratchRoot, 'storage-local-source-'),
  );
  try {
    const artifact = 'erp4-generation-database.gpg';
    const content = Buffer.from('encrypted-placeholder');
    await writeFile(path.join(scratch, artifact), content, { mode: 0o600 });
    await writeFile(
      path.join(scratch, `${artifact}.manifest.json`),
      JSON.stringify({ schemaVersion: 'placeholder' }),
      { mode: 0o600 },
    );
    const source = createLocalBackupObjectSource({
      directory: scratch,
      prefix: 'erp4',
    });
    assert.equal((await source.list()).length, 2);
    assert.deepEqual(await source.statArtifact(artifact), {
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.length,
    });
    assert.deepEqual(await source.readManifest(`${artifact}.manifest.json`), {
      schemaVersion: 'placeholder',
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('local backup source rejects group-writable files', async () => {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(
    path.join(scratchRoot, 'storage-local-unsafe-'),
  );
  try {
    const artifact = path.join(scratch, 'erp4-generation-database.gpg');
    await writeFile(artifact, 'encrypted-placeholder', { mode: 0o600 });
    await chmod(artifact, 0o620);
    const source = createLocalBackupObjectSource({
      directory: scratch,
      prefix: 'erp4',
    });
    await assert.rejects(source.list(), /backup_local_entry_unsafe/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('S3 source paginates, bounds manifest reads and returns SHA metadata', async () => {
  const calls = [];
  const body = Buffer.from('{"schemaVersion":"placeholder"}');
  const client = {
    async send(command, requestOptions) {
      assert.equal(requestOptions.abortSignal instanceof AbortSignal, true);
      calls.push(command.constructor.name);
      if (command.constructor.name === 'ListObjectsV2Command') {
        if (!command.input.ContinuationToken) {
          return {
            Contents: [{ Key: 'erp4/prod/a.gpg', Size: 10 }],
            IsTruncated: true,
            NextContinuationToken: 'next-placeholder',
          };
        }
        return {
          Contents: [
            { Key: 'erp4/prod/a.gpg.manifest.json', Size: body.length },
          ],
          IsTruncated: false,
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return {
          ContentLength: body.length,
          Body: (async function* () {
            yield body;
          })(),
        };
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 10, Metadata: { sha256: 'a'.repeat(64) } };
      }
      assert.fail('unexpected command');
    },
  };
  const source = createS3BackupObjectSource({
    bucket: 'bucket-placeholder',
    client,
    prefix: 'erp4/prod',
  });
  assert.equal((await source.list()).length, 2);
  assert.deepEqual(
    (await source.list()).map((item) => item.key),
    ['a.gpg', 'a.gpg.manifest.json'],
  );
  assert.deepEqual(await source.readManifest('a.gpg.manifest.json'), {
    schemaVersion: 'placeholder',
  });
  assert.deepEqual(await source.statArtifact('a.gpg'), {
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
  });
  assert.deepEqual(calls, [
    'ListObjectsV2Command',
    'ListObjectsV2Command',
    'ListObjectsV2Command',
    'ListObjectsV2Command',
    'GetObjectCommand',
    'HeadObjectCommand',
  ]);
});

test('S3 source aborts inventory once the readiness cap is exceeded', async () => {
  let listCalls = 0;
  const client = {
    async send(command) {
      if (command.constructor.name !== 'ListObjectsV2Command') {
        assert.fail('unexpected command');
      }
      listCalls += 1;
      if (listCalls === 1) {
        return {
          Contents: Array.from({ length: 19_999 }, (_, index) => ({
            Key: `erp4/prod/${String(index).padStart(5, '0')}.gpg`,
            Size: 10,
          })),
          IsTruncated: true,
          NextContinuationToken: 'page-2',
        };
      }
      return {
        Contents: Array.from({ length: 2 }, (_, index) => ({
          Key: `erp4/prod/overflow-${String(index).padStart(2, '0')}.gpg`,
          Size: 10,
        })),
        IsTruncated: false,
        NextContinuationToken: 'should-not-be-used',
      };
    },
  };
  const source = createS3BackupObjectSource({
    bucket: 'bucket-placeholder',
    client,
    prefix: 'erp4/prod',
  });
  await assert.rejects(source.list(), /backup_inventory_too_large/);
  assert.equal(listCalls, 2);
});

test('Sakura source requires a credential-free HTTPS origin', () => {
  assert.throws(() =>
    resolveSakuraBackupObjectSource({ S3_PROVIDER: 'unexpected-provider' }),
  );
  assert.throws(() =>
    resolveSakuraBackupObjectSource({
      S3_PROVIDER: 'sakura',
      S3_ENDPOINT_URL: 'https://objects.example.invalid',
      S3_BUCKET: 'bucket-placeholder',
      S3_PREFIX: 'erp4/prod',
      S3_REGION: 'region-placeholder',
      STORAGE_READINESS_S3_TIMEOUT_MS: '999',
    }),
  );
  assert.throws(() =>
    resolveSakuraBackupObjectSource(
      {
        S3_PROVIDER: 'sakura',
        S3_ENDPOINT_URL: 'https://user:secret@example.invalid/private',
        S3_BUCKET: 'bucket-placeholder',
        S3_PREFIX: 'erp4/prod',
        S3_REGION: 'region-placeholder',
      },
      () => ({ send: async () => ({}) }),
    ),
  );
  let config;
  const result = resolveSakuraBackupObjectSource(
    {
      S3_PROVIDER: 'sakura',
      S3_ENDPOINT_URL: 'https://objects.example.invalid',
      S3_BUCKET: 'bucket-placeholder',
      S3_PREFIX: 'erp4/prod',
      S3_REGION: 'region-placeholder',
    },
    (value) => {
      config = value;
      return { send: async () => ({ Contents: [], IsTruncated: false }) };
    },
  );
  assert.equal(result.configured, true);
  assert.equal(config.endpoint, 'https://objects.example.invalid');
  assert.equal(config.region, 'region-placeholder');
});

test('restore evidence enforces owner-only strict JSON and compares private identifiers', async () => {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'restore-evidence-'));
  const file = path.join(scratch, 'evidence.json');
  try {
    await writeFile(
      file,
      `${JSON.stringify({
        schemaVersion: 'erp4.restore.evidence.v1',
        environment: 'prod',
        backupId: 'backup-placeholder',
        completedAt: '2026-07-22T09:00:00.000Z',
        result: 'pass',
        checks: { counts: true, amounts: true, references: true, files: true },
      })}\n`,
      { mode: 0o600 },
    );
    assert.deepEqual(
      await inspectRestoreEvidence({
        evidenceFile: file,
        expectedBackupId: 'backup-placeholder',
        expectedEnvironment: 'prod',
      }),
      {
        configured: true,
        backupIdMatches: true,
        completedAt: '2026-07-22T09:00:00.000Z',
        environmentMatches: true,
        result: 'pass',
      },
    );
    await writeFile(
      file,
      `${JSON.stringify({
        schemaVersion: 'erp4.restore.evidence.v1',
        environment: 'prod',
        backupId: 'backup-placeholder',
        completedAt: '2026-07-22T09:00:00.000Z',
        result: 'pass',
        checks: {
          counts: true,
          amounts: true,
          references: true,
          files: true,
          privateDetail: 'not-allowlisted',
        },
      })}\n`,
      { mode: 0o600 },
    );
    assert.deepEqual(
      await inspectRestoreEvidence({
        evidenceFile: file,
        expectedBackupId: 'backup-placeholder',
        expectedEnvironment: 'prod',
      }),
      { configured: true, errorCode: 'evidence_invalid' },
    );
    await chmod(file, 0o644);
    assert.deepEqual(
      await inspectRestoreEvidence({
        evidenceFile: file,
        expectedBackupId: 'backup-placeholder',
        expectedEnvironment: 'prod',
      }),
      { configured: true, errorCode: 'evidence_unreadable' },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
