import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectRestoreEvidence } from '../dist/infrastructure/backup/restoreEvidenceReadiness.js';

const scratchRoot = fileURLToPath(
  new URL('../../../.codex-local/tmp/', import.meta.url),
);
const options = {
  expectedBackupId: 'backup-placeholder',
  expectedEnvironment: 'test',
};
const validEvidence = {
  schemaVersion: 'erp4.restore.evidence.v1',
  environment: 'test',
  backupId: 'backup-placeholder',
  completedAt: '2026-09-06T00:00:00.000Z',
  result: 'pass',
  checks: { counts: true, amounts: true, references: true, files: true },
};

async function withScratch(run) {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'restore-file-types-'));
  try {
    await run(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test('restore evidence rejects a FIFO without a writer instead of waiting in open', async () => {
  await withScratch(async (scratch) => {
    const fifo = path.join(scratch, 'evidence.fifo');
    const created = spawnSync('mkfifo', ['-m', '600', fifo], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(created.status, 0, 'the POSIX FIFO fixture must be created');
    const moduleUrl = new URL(
      '../dist/infrastructure/backup/restoreEvidenceReadiness.js',
      import.meta.url,
    ).href;
    const script = `
      const { inspectRestoreEvidence } = await import(${JSON.stringify(moduleUrl)});
      const result = await inspectRestoreEvidence(${JSON.stringify({
        ...options,
        evidenceFile: fifo,
      })});
      process.stdout.write(JSON.stringify(result));
    `;
    // A subprocess bounds the regression even if open leaves a libuv worker blocked.
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      {
        encoding: 'utf8',
        timeout: 5_000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(child.error, undefined, 'FIFO inspection must not time out');
    assert.equal(child.signal, null);
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), {
      configured: true,
      errorCode: 'evidence_unreadable',
    });
  });
});

test('restore evidence still accepts owner-only regular JSON after nonblocking open', async () => {
  await withScratch(async (scratch) => {
    const file = path.join(scratch, 'evidence.json');
    await writeFile(file, JSON.stringify(validEvidence), { mode: 0o600 });
    assert.deepEqual(
      await inspectRestoreEvidence({ ...options, evidenceFile: file }),
      {
        configured: true,
        backupIdMatches: true,
        completedAt: validEvidence.completedAt,
        environmentMatches: true,
        result: 'pass',
      },
    );
  });
});

test('restore evidence preserves symlink, directory, permissions, size and JSON rejection', async () => {
  await withScratch(async (scratch) => {
    const file = path.join(scratch, 'evidence.json');
    const link = path.join(scratch, 'evidence-link.json');
    const unreadable = { configured: true, errorCode: 'evidence_unreadable' };
    await writeFile(file, JSON.stringify(validEvidence), { mode: 0o600 });
    await symlink(file, link);
    for (const evidenceFile of [link, scratch]) {
      assert.deepEqual(
        await inspectRestoreEvidence({ ...options, evidenceFile }),
        unreadable,
      );
    }
    await chmod(file, 0o644);
    assert.deepEqual(
      await inspectRestoreEvidence({ ...options, evidenceFile: file }),
      unreadable,
    );
    await chmod(file, 0o600);
    for (const content of ['', 'x'.repeat(64 * 1024 + 1)]) {
      await writeFile(file, content);
      assert.deepEqual(
        await inspectRestoreEvidence({ ...options, evidenceFile: file }),
        unreadable,
      );
    }
    await writeFile(file, '{invalid');
    assert.deepEqual(
      await inspectRestoreEvidence({ ...options, evidenceFile: file }),
      { configured: true, errorCode: 'evidence_invalid' },
    );
  });
});
