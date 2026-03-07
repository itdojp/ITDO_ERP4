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

function runNodeScript(scriptName, args = [], env = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
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

function withMockBin(commands, fn) {
  return withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    for (const [name, content] of Object.entries(commands)) {
      const cmdPath = path.join(binDir, name);
      writeFileSync(cmdPath, content);
      chmodSync(cmdPath, 0o755);
    }
    return fn(binDir);
  });
}

function hasCommand(name) {
  const result = spawnSync('/bin/bash', ['-lc', `command -v ${name}`], {
    env: process.env,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function writeDependabotLockfile(lockfilePath, versions = {}) {
  const data = {
    googleapis: versions.googleapis || '171.4.0',
    googleapisCommon: versions.googleapisCommon || '8.0.1',
    qs: versions.qs || '6.15.0',
    fastXmlParser: versions.fastXmlParser || '5.3.6',
  };

  writeFileSync(
    lockfilePath,
    JSON.stringify(
      {
        packages: {
          'node_modules/googleapis': { version: data.googleapis },
          'node_modules/googleapis-common': { version: data.googleapisCommon },
          'node_modules/qs': { version: data.qs },
          'node_modules/fast-xml-parser': { version: data.fastXmlParser },
        },
      },
      null,
      2,
    ),
  );
}

const DEPENDABOT_LOW_ALERT_JSON =
  '{"number":10,"state":"OPEN","vulnerableManifestPath":"packages/backend/package-lock.json","vulnerableRequirements":">= 6.7.0, <= 6.14.1","securityVulnerability":{"severity":"LOW","package":{"name":"qs"},"firstPatchedVersion":{"identifier":"6.14.2"}},"securityAdvisory":{"ghsaId":"GHSA-w7fw-mjwx-w883","summary":"qs advisory"}}';
const DEPENDABOT_HIGH_OPEN_ALERT_JSON =
  '{"number":11,"state":"OPEN","vulnerableManifestPath":"packages/backend/package-lock.json","vulnerableRequirements":"< 5.3.6","securityVulnerability":{"severity":"HIGH","package":{"name":"fast-xml-parser"},"firstPatchedVersion":{"identifier":"5.3.6"}},"securityAdvisory":{"ghsaId":"GHSA-jmr7-xgp7-cmfj","summary":"fast-xml-parser advisory"}}';

function makeDependabotGhStub(mode = 'highNotFound') {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$1" != "api" ]]; then',
    '  echo "unexpected gh invocation: $*" >&2',
    '  exit 2',
    'fi',
    'case "$2" in',
    '  repos/*/dependabot/alerts/10)',
    "    cat <<'JSON'",
    DEPENDABOT_LOW_ALERT_JSON,
    'JSON',
    '    ;;',
    '  repos/*/dependabot/alerts/11)',
  ];

  if (mode === 'highOpen') {
    lines.push("    cat <<'JSON'");
    lines.push(DEPENDABOT_HIGH_OPEN_ALERT_JSON);
    lines.push('JSON');
    lines.push('    ;;');
  } else {
    lines.push(
      '    echo "gh: No alert found for alert number 11 (HTTP 404)" >&2',
    );
    lines.push('    exit 1');
    lines.push('    ;;');
  }

  lines.push('  *)');
  lines.push('    echo "unexpected gh api path: $2" >&2');
  lines.push('    exit 2');
  lines.push('    ;;');
  lines.push('esac');
  return lines.join('\n');
}

function makeDependabotNpmStub(versions = {}) {
  const googleapis = versions.googleapis || '171.4.0';
  const googleapisCommon = versions.googleapisCommon || '8.0.1';
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$1" == "view" && "$3" == "version" && "$4" == "--json" ]]; then',
    '  case "$2" in',
    `    googleapis) echo '"${googleapis}"' ;;`,
    `    googleapis-common) echo '"${googleapisCommon}"' ;;`,
    '    *) echo "null" ;;',
    '  esac',
    '  exit 0',
    'fi',
    'echo "unexpected npm invocation: $*" >&2',
    'exit 2',
  ].join('\n');
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

test('check-po-migration-input-readiness: ONLY=users is accepted', () => {
  withTempDir((dir) => {
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      ONLY: 'users',
      STRICT: '0',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(String(res.stdout), /preflight completed/);
  });
});

test('check-po-migration-input-readiness: emits SUMMARY line for partial input', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'users.csv'),
      'legacyId,userId,userName\nlegacy-u-1,u-1,User One\n',
    );
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      ONLY: 'users,projects',
      STRICT: '0',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(
      String(res.stdout),
      /SUMMARY status=warn scopes=2 found=1 missing=1 invalid=0 valid=1 format=csv strict=0 only=users,projects/,
    );
  });
});

test('check-po-migration-input-readiness: emits fail SUMMARY before strict exit', () => {
  withTempDir((dir) => {
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      ONLY: 'users',
      STRICT: '1',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stdout), /SUMMARY status=fail/);
    assert.match(
      String(res.stderr),
      /STRICT=1 and ONLY scopes contain missing files/,
    );
  });
});

test('check-po-migration-input-readiness: fails when csv headers miss required columns', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'users.csv'),
      'legacyId,userName\nu-1,User One\n',
    );
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'csv',
      ONLY: 'users',
      STRICT: '0',
    });
    assert.notEqual(res.status, 0);
    assert.match(
      String(res.stdout),
      /SUMMARY status=fail scopes=1 found=1 missing=0 invalid=1 valid=0 format=csv strict=0 only=users/,
    );
    assert.match(
      String(res.stderr),
      /INVALID users -> .*missing required headers: userId/,
    );
    assert.match(String(res.stderr), /input format validation failed/);
  });
});

test('check-po-migration-input-readiness: fails when json root is not an array', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'users.json'), '{"legacyId":"u-1"}\n');
    const res = runScript('check-po-migration-input-readiness.sh', {
      INPUT_DIR: dir,
      INPUT_FORMAT: 'json',
      ONLY: 'users',
      STRICT: '0',
    });
    assert.notEqual(res.status, 0);
    assert.match(
      String(res.stdout),
      /SUMMARY status=fail scopes=1 found=1 missing=0 invalid=1 valid=0 format=json strict=0 only=users/,
    );
    assert.match(
      String(res.stderr),
      /INVALID users -> .*JSON root must be an array/,
    );
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

test('check-backup-s3-readiness: validates STRICT value before AWS calls', () => {
  const res = runScript('check-backup-s3-readiness.sh', {
    S3_BUCKET: 'dummy-bucket',
    STRICT: '2',
    PATH: '/non-existent-path',
  });
  assert.notEqual(res.status, 0);
  assert.match(String(res.stderr), /STRICT must be 0\|1/);
});

test('check-backup-s3-readiness: validates CHECK_WRITE value before AWS calls', () => {
  const res = runScript('check-backup-s3-readiness.sh', {
    S3_BUCKET: 'dummy-bucket',
    CHECK_WRITE: 'yes',
    PATH: '/non-existent-path',
  });
  assert.notEqual(res.status, 0);
  assert.match(String(res.stderr), /CHECK_WRITE must be 0\|1/);
});

test('check-backup-s3-readiness: emits machine-readable SUMMARY line', () => {
  withFakeAwsBin((binDir) => {
    const res = runScript('check-backup-s3-readiness.sh', {
      S3_BUCKET: 'dummy-bucket',
      STRICT: '0',
      PATH: `${binDir}:${process.env.PATH || ''}`,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(
      String(res.stdout),
      /SUMMARY status=warn warning_count=[0-9]+ error_count=0 strict=0 check_write=0/,
    );
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

test('record-backup-s3-readiness: uses machine-readable SUMMARY line when available', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      logPath,
      [
        '[backup-s3-preflight][WARN] this warning count is lower than SUMMARY',
        '[backup-s3-preflight] SUMMARY status=warn warning_count=4 error_count=0 strict=0 check_write=1',
      ].join('\n'),
    );

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r-machine-summary',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(
      outDir,
      '2026-02-24-backup-s3-readiness-r-machine-summary.md',
    );
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /summarySource: summary-line/);
    assert.match(report, /summaryStatus: warn/);
    assert.match(report, /warningCount: 4/);
    assert.match(report, /errorCount: 0/);
  });
});

test('record-backup-s3-readiness: validates DATE_STAMP as a calendar date', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(logPath, '[backup-s3-preflight] readiness check passed\n');

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-30',
      RUN_LABEL: 'r-date',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /DATE_STAMP is not a valid calendar date/);
  });
});

test('record-backup-s3-readiness: validates RUN_LABEL format', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'backup-s3-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(logPath, '[backup-s3-preflight] readiness check passed\n');

    const res = runScript('record-backup-s3-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: '../r1',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /RUN_LABEL must match/);
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

test('record-po-migration-rehearsal: validates DATE_STAMP and RUN_LABEL', () => {
  withTempDir((dir) => {
    const logDir = path.join(dir, 'logs');
    const sourceReport = path.join(logDir, 'rehearsal-report.md');
    const outDir = path.join(dir, 'out');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(sourceReport, '## migration summary\n\n- errors: 0\n');

    const invalidDate = runScript('record-po-migration-rehearsal.sh', {
      LOG_DIR: logDir,
      REPORT_SOURCE: sourceReport,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-30',
      RUN_LABEL: 'r1',
    });
    assert.notEqual(invalidDate.status, 0);
    assert.match(
      String(invalidDate.stderr),
      /DATE_STAMP is not a valid calendar date/,
    );

    const invalidLabel = runScript('record-po-migration-rehearsal.sh', {
      LOG_DIR: logDir,
      REPORT_SOURCE: sourceReport,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: '../r1',
    });
    assert.notEqual(invalidLabel.status, 0);
    assert.match(String(invalidLabel.stderr), /RUN_LABEL must match/);
  });
});

test('record-po-migration-rehearsal: fails when RUN_LABEL output already exists', () => {
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
      RUN_LABEL: 'r1',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /output file already exists/);
  });
});

test('generate-po-migration-report: includes preflight summary and scope lists', () => {
  withTempDir((dir) => {
    const logDir = path.join(dir, 'logs');
    const outputPath = path.join(dir, 'rehearsal-report.md');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      path.join(logDir, 'preflight.log'),
      [
        '[po-migration-input-preflight] FOUND  users -> /tmp/input/users.csv',
        '[po-migration-input-preflight] FOUND  projects -> /tmp/input/projects.csv',
        '[po-migration-input-preflight][WARN] INVALID projects -> /tmp/input/projects.csv (missing required headers: code)',
        '[po-migration-input-preflight] SUMMARY status=fail scopes=2 found=2 missing=0 invalid=1 valid=1 format=csv strict=0 only=users,projects',
        '[po-migration-input-preflight] preflight completed',
      ].join('\n'),
    );

    const res = runNodeScript('generate-po-migration-report.mjs', [
      `--log-dir=${logDir}`,
      `--output=${outputPath}`,
      '--exit-code=0',
    ]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const report = readFileSync(outputPath, 'utf8');
    assert.match(report, /## preflight/);
    assert.match(report, /- status: fail/);
    assert.match(report, /- invalid: 1/);
    assert.match(report, /- valid: 1/);
    assert.match(report, /- foundScopes: users/);
    assert.match(report, /- missingScopes: \(none\)/);
    assert.match(report, /- invalidScopes: projects/);
    assert.match(report, /- projects: missing required headers: code/);
  });
});

test('run-po-migration-rehearsal: validates ONLY even when RUN_PREFLIGHT=0', () => {
  withTempDir((dir) => {
    const inputDir = path.join(dir, 'input');
    mkdirSync(inputDir, { recursive: true });

    const res = runScript('run-po-migration-rehearsal.sh', {
      INPUT_DIR: inputDir,
      ONLY: 'invalid_scope',
      RUN_PREFLIGHT: '0',
      GENERATE_REPORT: '0',
      RUN_INTEGRITY: '0',
      APPLY: '0',
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /invalid scope in ONLY/);
  });
});

test('run-and-record-po-migration-rehearsal: records report when run succeeds', () => {
  withTempDir((dir) => {
    const runStub = path.join(dir, 'run-stub.sh');
    const recordStub = path.join(dir, 'record-stub.sh');
    const logDir = path.join(dir, 'logs');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      runStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "run-ok" > "${LOG_DIR}/run.log"',
      ].join('\n'),
    );
    writeFileSync(
      recordStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "${DATE_STAMP}|${RUN_LABEL}|${OUT_DIR:-}" > "${LOG_DIR}/record.log"',
      ].join('\n'),
    );
    chmodSync(runStub, 0o755);
    chmodSync(recordStub, 0o755);

    const res = runScript('run-and-record-po-migration-rehearsal.sh', {
      RUN_SCRIPT_PATH: runStub,
      RECORD_SCRIPT_PATH: recordStub,
      LOG_DIR: logDir,
      DATE_STAMP: '2026-02-24',
      RUN_LABEL: 'r1',
      OUT_DIR: outDir,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(existsSync(path.join(logDir, 'run.log')), true);
    assert.equal(existsSync(path.join(logDir, 'record.log')), true);
    const record = readFileSync(path.join(logDir, 'record.log'), 'utf8');
    assert.match(record, /2026-02-24\|r1\|/);
  });
});

test('run-and-record-po-migration-rehearsal: records even when run fails if RECORD_ON_FAIL=1', () => {
  withTempDir((dir) => {
    const runStub = path.join(dir, 'run-stub.sh');
    const recordStub = path.join(dir, 'record-stub.sh');
    const logDir = path.join(dir, 'logs');

    writeFileSync(
      runStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "run-fail" > "${LOG_DIR}/run.log"',
        'exit 33',
      ].join('\n'),
    );
    writeFileSync(
      recordStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "record-on-fail" > "${LOG_DIR}/record.log"',
      ].join('\n'),
    );
    chmodSync(runStub, 0o755);
    chmodSync(recordStub, 0o755);

    const res = runScript('run-and-record-po-migration-rehearsal.sh', {
      RUN_SCRIPT_PATH: runStub,
      RECORD_SCRIPT_PATH: recordStub,
      LOG_DIR: logDir,
      RECORD_ON_FAIL: '1',
    });
    assert.equal(res.status, 33);
    assert.equal(existsSync(path.join(logDir, 'record.log')), true);
  });
});

test('run-and-record-po-migration-rehearsal: skips record when run fails and RECORD_ON_FAIL=0', () => {
  withTempDir((dir) => {
    const runStub = path.join(dir, 'run-stub.sh');
    const recordStub = path.join(dir, 'record-stub.sh');
    const logDir = path.join(dir, 'logs');

    writeFileSync(
      runStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "run-fail" > "${LOG_DIR}/run.log"',
        'exit 34',
      ].join('\n'),
    );
    writeFileSync(
      recordStub,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "${LOG_DIR}"',
        'echo "should-not-run" > "${LOG_DIR}/record.log"',
      ].join('\n'),
    );
    chmodSync(runStub, 0o755);
    chmodSync(recordStub, 0o755);

    const res = runScript('run-and-record-po-migration-rehearsal.sh', {
      RUN_SCRIPT_PATH: runStub,
      RECORD_SCRIPT_PATH: recordStub,
      LOG_DIR: logDir,
      RECORD_ON_FAIL: '0',
    });
    assert.equal(res.status, 34);
    assert.equal(existsSync(path.join(logDir, 'record.log')), false);
  });
});

test('check-dependabot-alerts: treats optional high alert 404 as NOT_FOUND', (t) => {
  if (!hasCommand('jq')) {
    t.skip('jq is required by check-dependabot-alerts.sh');
    return;
  }

  withTempDir((dir) => {
    const lockfile = path.join(dir, 'package-lock.json');
    writeDependabotLockfile(lockfile);
    withMockBin(
      {
        gh: makeDependabotGhStub('highNotFound'),
        npm: makeDependabotNpmStub(),
      },
      (binDir) => {
        const res = runScript('check-dependabot-alerts.sh', {
          GITHUB_REPOSITORY: 'itdojp/ITDO_ERP4',
          ALERT_LOW_NUMBER: '10',
          ALERT_HIGH_NUMBER: '11',
          BACKEND_LOCKFILE: lockfile,
          STRICT: '0',
          PATH: `${binDir}:${process.env.PATH || ''}`,
        });
        assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
        assert.match(String(res.stderr), /treating as NOT_FOUND/);
        assert.match(String(res.stdout), /alertHighState: NOT_FOUND/);
        assert.match(String(res.stdout), /actionRequired: false/);
      },
    );
  });
});

test('check-dependabot-alerts: exits with STRICT error when high alert is OPEN', (t) => {
  if (!hasCommand('jq')) {
    t.skip('jq is required by check-dependabot-alerts.sh');
    return;
  }

  withTempDir((dir) => {
    const lockfile = path.join(dir, 'package-lock.json');
    writeDependabotLockfile(lockfile);
    withMockBin(
      {
        gh: makeDependabotGhStub('highOpen'),
        npm: makeDependabotNpmStub(),
      },
      (binDir) => {
        const res = runScript('check-dependabot-alerts.sh', {
          GITHUB_REPOSITORY: 'itdojp/ITDO_ERP4',
          ALERT_LOW_NUMBER: '10',
          ALERT_HIGH_NUMBER: '11',
          BACKEND_LOCKFILE: lockfile,
          STRICT: '1',
          PATH: `${binDir}:${process.env.PATH || ''}`,
        });
        assert.equal(res.status, 2, `${res.stderr}\n${res.stdout}`);
        assert.match(String(res.stderr), /Dependabot alerts require follow-up/);
        assert.match(String(res.stdout), /alertHighState: OPEN/);
        assert.match(String(res.stdout), /actionRequired: true/);
      },
    );
  });
});
