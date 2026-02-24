import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

function runScript(scriptName, env = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const result = spawnSync('/bin/bash', [scriptPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
  return result;
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp4-readiness-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withFakeAwsBin(fn) {
  return withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    const awsPath = path.join(binDir, 'aws');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(awsPath, '#!/usr/bin/env bash\necho fake-aws >/dev/null\n');
    chmodSync(awsPath, 0o755);
    return fn(binDir);
  });
}

test('check-po-migration-input-readiness: fails when INPUT_DIR is missing', () => {
  const res = runScript('check-po-migration-input-readiness.sh', {
    INPUT_DIR: '',
  });
  assert.notEqual(res.status, 0);
  assert.match(String(res.stderr), /INPUT_DIR is required/);
});

test('check-po-migration-input-readiness: fails on invalid ONLY scope', () => {
  withTempDir((dir) => {
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      ONLY: 'invalid_scope',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /invalid scope in ONLY/);
  });
});

test('check-po-migration-input-readiness: STRICT=0 passes with empty input directory', () => {
  withTempDir((dir) => {
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      STRICT: '0',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(String(res.stdout), /preflight completed/);
  });
});

test('check-backup-s3-readiness: fails when aws command is missing', () => {
  const res = runScript('check-backup-s3-readiness.sh', {
    S3_BUCKET: 'dummy-bucket',
    PATH: '/non-existent-path',
  });
  assert.notEqual(res.status, 0);
  assert.match(String(res.stderr), /missing command: aws/);
});

test('check-backup-s3-readiness: validates EXPECT_SSE value before AWS calls', () => {
  withFakeAwsBin((binDir) => {
    const res = runScript('check-backup-s3-readiness.sh', {
      S3_BUCKET: 'dummy-bucket',
      EXPECT_SSE: 'invalid',
      PATH: `${binDir}:${process.env.PATH || ''}`,
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /EXPECT_SSE must be one of/);
  });
});

test('record-backup-s3-readiness: writes a report from an existing log file', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      logPath,
      [
        '[backup-s3-preflight] checking bucket access: s3://example-bucket',
        '[backup-s3-preflight][WARN] bucket lifecycle rule is empty',
        '[backup-s3-preflight][ERROR] failed with 1 warning(s)',
      ].join('\n'),
    );

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r1',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(
      outDir,
      '2026-02-24-backup-s3-readiness-r1.md',
    );
    assert.equal(existsSync(reportPath), true);
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /summaryStatus: fail/);
    assert.match(report, /warningCount: 1/);
    assert.match(report, /errorCount: 1/);
  });
});

test('record-backup-s3-readiness: auto increments run suffix when RUN_LABEL is omitted', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, '2026-02-24-backup-s3-readiness-r1.md'),
      '# existing report',
    );
    writeFileSync(logPath, '[backup-s3-preflight] readiness check passed\n');

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const generated = path.join(outDir, '2026-02-24-backup-s3-readiness-r2.md');
    assert.equal(existsSync(generated), true);
  });
});

test('record-backup-s3-readiness: uses summary warning count when WARN lines are missing', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      logPath,
      [
        '[backup-s3-preflight] checking bucket access: s3://example-bucket',
        '[backup-s3-preflight] completed with 3 warning(s)',
      ].join('\n'),
    );

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r-summary',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(
      outDir,
      '2026-02-24-backup-s3-readiness-r-summary.md',
    );
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /summaryStatus: warn/);
    assert.match(report, /warningCount: 3/);
    assert.match(report, /errorCount: 0/);
  });
});

test('record-backup-s3-readiness: runs CHECK_SCRIPT and respects FAIL_ON_CHECK', () => {
  withTempDir((dir) => {
    const checkScriptPath = path.join(dir, 'check-stub.sh');
    const logDir = path.join(dir, 'logs');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      checkScriptPath,
      [
        '#!/usr/bin/env bash',
        'echo "stub-check: starting"',
        'echo "stub-check: something went wrong" >&2',
        'exit 42',
        '',
      ].join('\n'),
    );
    chmodSync(checkScriptPath, 0o755);

    const res1 = runScript('record-backup-s3-readiness.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r-check1',
    });
    assert.equal(res1.status, 0, `${res1.stderr}\n${res1.stdout}`);

    const logs = readdirSync(logDir).filter(
      (name) =>
        name.startsWith('backup-s3-readiness-') && name.endsWith('.log'),
    );
    assert.equal(logs.length, 1);
    const logPath = path.join(logDir, logs[0]);
    const logContents = readFileSync(logPath, 'utf8');
    assert.match(logContents, /stub-check: starting/);
    assert.match(logContents, /stub-check: something went wrong/);

    const reportPath1 = path.join(
      outDir,
      '2026-02-24-backup-s3-readiness-r-check1.md',
    );
    assert.equal(existsSync(reportPath1), true);
    const report1 = readFileSync(reportPath1, 'utf8');
    assert.match(report1, /summaryStatus: fail/);
    assert.match(report1, /checkExitCode: 42/);
    assert.match(report1, /errorCount: 1/);

    const res2 = runScript('record-backup-s3-readiness.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r-check2',
      FAIL_ON_CHECK: '1',
    });
    assert.equal(res2.status, 42);
  });
});

test('record-po-migration-rehearsal: writes report from provided rehearsal report', () => {
  withTempDir((dir) => {
    const logDir = path.join(dir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const sourceReport = path.join(logDir, 'rehearsal-report.md');
    const outDir = path.join(dir, 'out');

    writeFileSync(sourceReport, '## migration summary\n\n- errors: 0\n');

    const res = runScript('record-po-migration-rehearsal.sh', {
      LOG_DIR: logDir,
      REPORT_SOURCE: sourceReport,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r1',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(
      outDir,
      '2026-02-24-po-migration-rehearsal-r1.md',
    );
    assert.equal(existsSync(reportPath), true);
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /# PO移行リハーサル記録/);
    assert.match(report, /## migration summary/);
    assert.match(report, /sourceLogDir:/);
  });
});

test('record-po-migration-rehearsal: auto increments run suffix when RUN_LABEL is omitted', () => {
  withTempDir((dir) => {
    const logDir = path.join(dir, 'logs');
    const sourceReport = path.join(logDir, 'rehearsal-report.md');
    const outDir = path.join(dir, 'out');
    mkdirSync(logDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(sourceReport, '## migration summary\n\n- errors: 0\n');
    writeFileSync(
      path.join(outDir, '2026-02-24-po-migration-rehearsal-r1.md'),
      '# existing report',
    );

    const res = runScript('record-po-migration-rehearsal.sh', {
      LOG_DIR: logDir,
      REPORT_SOURCE: sourceReport,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(
      existsSync(path.join(outDir, '2026-02-24-po-migration-rehearsal-r2.md')),
      true,
    );
  });
});
