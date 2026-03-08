import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
  return spawnSync('/bin/bash', [scriptPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp4-ops-record-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('record-eslint10-readiness: writes a report from an existing log file', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'eslint10-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      logPath,
      [
        'pluginTarget: @typescript-eslint/eslint-plugin@latest',
        'pluginVersion: 8.56.0',
        'pluginPeerEslint: ^8.57.0 || ^9.0.0 || ^10.0.0',
        'pluginSupportsEslint10: true',
        'parserTarget: @typescript-eslint/parser@latest',
        'parserVersion: 8.56.0',
        'parserPeerEslint: ^8.57.0 || ^9.0.0 || ^10.0.0',
        'parserSupportsEslint10: true',
        'reactPluginTarget: eslint-plugin-react@latest',
        'reactPluginVersion: 7.37.5',
        'reactPluginPeerEslint: ^9.7',
        'reactPluginSupportsEslint10: false',
        'reactHooksPluginTarget: eslint-plugin-react-hooks@latest',
        'reactHooksPluginVersion: 7.0.1',
        'reactHooksPluginPeerEslint: ^9.0.0',
        'reactHooksPluginSupportsEslint10: false',
        'ready: false',
        'NG: eslint@10 is not supported by all required packages yet.',
      ].join('\n'),
    );

    const res = runScript('record-eslint10-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r1',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(outDir, '2026-03-08-eslint10-readiness-r1.md');
    assert.equal(existsSync(reportPath), true);
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /# ESLint10 readiness 記録/);
    assert.match(report, /- branch: `.+`/);
    assert.match(report, /- commit: `.+`/);
    assert.match(report, /summaryStatus: fail/);
    assert.match(report, /ready: false/);
    assert.match(report, /reactPluginSupportsEslint10: false/);
    assert.match(report, /## ログ\n```text\n/);
    assert.doesNotMatch(report, /\\```text/);
  });
});

test('record-eslint10-readiness: auto increments run suffix when RUN_LABEL is omitted', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'eslint10-readiness.log');
    const outDir = path.join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(logPath, 'ready: true\n');
    writeFileSync(
      path.join(outDir, '2026-03-08-eslint10-readiness-r1.md'),
      '# existing report',
    );

    const res = runScript('record-eslint10-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-eslint10-readiness-r2.md')),
      true,
    );
  });
});

test('record-eslint10-readiness: validates DATE_STAMP and RUN_LABEL', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'eslint10-readiness.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(logPath, 'ready: true\n');

    const invalidDate = runScript('record-eslint10-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-30',
      RUN_LABEL: 'r1',
    });
    assert.notEqual(invalidDate.status, 0);
    assert.match(
      String(invalidDate.stderr),
      /DATE_STAMP is not a valid calendar date/,
    );

    const invalidLabel = runScript('record-eslint10-readiness.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: '../r1',
    });
    assert.notEqual(invalidLabel.status, 0);
    assert.match(String(invalidLabel.stderr), /RUN_LABEL must match/);
  });
});

test('record-eslint10-readiness: runs CHECK_SCRIPT and respects FAIL_ON_CHECK', () => {
  withTempDir((dir) => {
    const checkScriptPath = path.join(dir, 'check-eslint10-stub.sh');
    const logDir = path.join(dir, 'logs');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      checkScriptPath,
      [
        '#!/usr/bin/env bash',
        'echo "pluginTarget: eslint@latest"',
        'echo "ready: false"',
        'echo "NG: blocked" >&2',
        'exit 2',
      ].join('\n'),
    );
    chmodSync(checkScriptPath, 0o755);

    const res1 = runScript('record-eslint10-readiness.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r1',
    });
    assert.equal(res1.status, 0, `${res1.stderr}\n${res1.stdout}`);
    const report1 = readFileSync(
      path.join(outDir, '2026-03-08-eslint10-readiness-r1.md'),
      'utf8',
    );
    assert.match(report1, /checkExitCode: 2/);

    const res2 = runScript('record-eslint10-readiness.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r2',
      FAIL_ON_CHECK: '1',
    });
    assert.equal(res2.status, 2);
  });
});

test('record-dependabot-alerts: writes a report from an existing log file', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'dependabot-alerts.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      logPath,
      [
        'alertLowState: OPEN',
        'alertLowGhsa: GHSA-w7fw-mjwx-w883',
        'alertHighState: NOT_FOUND',
        'alertHighGhsa: ',
        'googleapisCurrent: 171.4.0',
        'googleapisLatest: 171.4.0',
        'googleapisCommonCurrent: 8.0.1',
        'googleapisCommonLatest: 8.0.1',
        'qsResolvedVersion: 6.15.0',
        'qsPatched: true',
        'fastXmlResolvedVersion: 5.3.6',
        'fastXmlPatched: true',
        'upstreamUpdated: false',
        'actionRequired: false',
        'OK: alerts are stable and patched versions are resolved.',
      ].join('\n'),
    );

    const res = runScript('record-dependabot-alerts.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r1',
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const reportPath = path.join(outDir, '2026-03-08-dependabot-alerts-r1.md');
    assert.equal(existsSync(reportPath), true);
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /# Dependabot alerts 監視記録/);
    assert.match(report, /- branch: `.+`/);
    assert.match(report, /- commit: `.+`/);
    assert.match(report, /summaryStatus: pass/);
    assert.match(report, /actionRequired: false/);
    assert.match(report, /qsPatched: true/);
    assert.match(report, /## ログ\n```text\n/);
    assert.doesNotMatch(report, /\\```text/);
  });
});

test('record-dependabot-alerts: validates DATE_STAMP and RUN_LABEL', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'dependabot-alerts.log');
    const outDir = path.join(dir, 'out');
    writeFileSync(logPath, 'actionRequired: false\n');

    const invalidDate = runScript('record-dependabot-alerts.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-02-30',
      RUN_LABEL: 'r1',
    });
    assert.notEqual(invalidDate.status, 0);
    assert.match(
      String(invalidDate.stderr),
      /DATE_STAMP is not a valid calendar date/,
    );

    const invalidLabel = runScript('record-dependabot-alerts.sh', {
      LOG_FILE: logPath,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: '../r1',
    });
    assert.notEqual(invalidLabel.status, 0);
    assert.match(String(invalidLabel.stderr), /RUN_LABEL must match/);
  });
});

test('record-dependabot-alerts: runs CHECK_SCRIPT and respects FAIL_ON_CHECK', () => {
  withTempDir((dir) => {
    const checkScriptPath = path.join(dir, 'check-dependabot-stub.sh');
    const logDir = path.join(dir, 'logs');
    const outDir = path.join(dir, 'out');
    writeFileSync(
      checkScriptPath,
      [
        '#!/usr/bin/env bash',
        'echo "alertLowState: OPEN"',
        'echo "actionRequired: true"',
        'echo "NG: follow-up required" >&2',
        'exit 2',
      ].join('\n'),
    );
    chmodSync(checkScriptPath, 0o755);

    const res1 = runScript('record-dependabot-alerts.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r1',
    });
    assert.equal(res1.status, 0, `${res1.stderr}\n${res1.stdout}`);
    const report1 = readFileSync(
      path.join(outDir, '2026-03-08-dependabot-alerts-r1.md'),
      'utf8',
    );
    assert.match(report1, /summaryStatus: fail/);
    assert.match(report1, /checkExitCode: 2/);

    const res2 = runScript('record-dependabot-alerts.sh', {
      RUN_CHECK: '1',
      CHECK_SCRIPT: checkScriptPath,
      LOG_DIR: logDir,
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'r2',
      FAIL_ON_CHECK: '1',
    });
    assert.equal(res2.status, 2);
  });
});

test('run-and-record-dependency-watch: generates paired reports with the same auto label', () => {
  withTempDir((dir) => {
    const tokenCheckPath = path.join(dir, 'token-check.sh');
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');
    const dependabotLogDir = path.join(dir, 'dependabot-logs');
    const eslintLogDir = path.join(dir, 'eslint-logs');

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, '2026-03-08-dependabot-alerts-r1.md'),
      '# existing dependabot report',
    );
    writeFileSync(
      path.join(outDir, '2026-03-08-eslint10-readiness-r1.md'),
      '# existing eslint report',
    );

    writeFileSync(
      tokenCheckPath,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'exit 0'].join('\n'),
    );
    writeFileSync(
      dependabotRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "${DATE_STAMP}|${RUN_LABEL}|${LOG_DIR}|${CHECK_SCRIPT}|${FAIL_ON_CHECK}" > "$OUT_DIR/dependabot-marker.txt"',
        'echo "# dependabot" > "$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "${DATE_STAMP}|${RUN_LABEL}|${LOG_DIR}|${CHECK_SCRIPT}|${FAIL_ON_CHECK}" > "$OUT_DIR/eslint-marker.txt"',
        'echo "# eslint" > "$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    chmodSync(tokenCheckPath, 0o755);
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_TOKEN_CHECK: '0',
      TOKEN_CHECK_SCRIPT: tokenCheckPath,
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
      DEPENDABOT_CHECK_SCRIPT: path.join(dir, 'dependabot-check.sh'),
      ESLINT_CHECK_SCRIPT: path.join(dir, 'eslint-check.sh'),
      DEPENDABOT_LOG_DIR: dependabotLogDir,
      ESLINT_LOG_DIR: eslintLogDir,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-dependabot-alerts-r2.md')),
      true,
    );
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-eslint10-readiness-r2.md')),
      true,
    );
    assert.equal(
      readFileSync(path.join(outDir, 'dependabot-marker.txt'), 'utf8').trim(),
      `2026-03-08|r2|${dependabotLogDir}|${path.join(dir, 'dependabot-check.sh')}|1`,
    );
    assert.equal(
      readFileSync(path.join(outDir, 'eslint-marker.txt'), 'utf8').trim(),
      `2026-03-08|r2|${eslintLogDir}|${path.join(dir, 'eslint-check.sh')}|0`,
    );
  });
});

test('run-and-record-dependency-watch: fails fast when explicit RUN_LABEL output already exists', () => {
  withTempDir((dir) => {
    const tokenCheckPath = path.join(dir, 'token-check.sh');
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, '2026-03-08-dependabot-alerts-ops-run.md'),
      '# existing dependabot report',
    );

    writeFileSync(
      tokenCheckPath,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'exit 0'].join('\n'),
    );
    writeFileSync(
      dependabotRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo called > "$OUT_DIR/dependabot-called.txt"',
      ].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo called > "$OUT_DIR/eslint-called.txt"',
      ].join('\n'),
    );
    chmodSync(tokenCheckPath, 0o755);
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'ops-run',
      TOKEN_CHECK_SCRIPT: tokenCheckPath,
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
    });
    assert.notEqual(res.status, 0);
    assert.match(String(res.stderr), /dependabot output file already exists/);
    assert.equal(existsSync(path.join(outDir, 'dependabot-called.txt')), false);
    assert.equal(existsSync(path.join(outDir, 'eslint-called.txt')), false);
  });
});

test('run-and-record-dependency-watch: token check failure prevents child scripts', () => {
  withTempDir((dir) => {
    const tokenCheckPath = path.join(dir, 'token-check.sh');
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      tokenCheckPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo blocked >&2',
        'exit 2',
      ].join('\n'),
    );
    writeFileSync(
      dependabotRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo called > "$OUT_DIR/dependabot-called.txt"',
      ].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo called > "$OUT_DIR/eslint-called.txt"',
      ].join('\n'),
    );
    chmodSync(tokenCheckPath, 0o755);
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'ops-run',
      RUN_TOKEN_CHECK: '1',
      TOKEN_STRICT: '1',
      TOKEN_CHECK_SCRIPT: tokenCheckPath,
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
    });
    assert.equal(res.status, 2);
    assert.equal(existsSync(path.join(outDir, 'dependabot-called.txt')), false);
    assert.equal(existsSync(path.join(outDir, 'eslint-called.txt')), false);
  });
});

test('run-and-record-dependency-watch: skips token script validation when RUN_TOKEN_CHECK=0', () => {
  withTempDir((dir) => {
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      dependabotRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "# dependabot" > "$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "# eslint" > "$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'ops-run',
      RUN_TOKEN_CHECK: '0',
      TOKEN_CHECK_SCRIPT: path.join(dir, 'missing-token-check.sh'),
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-dependabot-alerts-ops-run.md')),
      true,
    );
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-eslint10-readiness-ops-run.md')),
      true,
    );
  });
});

test('run-and-record-dependency-watch: keeps eslint record generation even when dependabot record fails', () => {
  withTempDir((dir) => {
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      dependabotRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "# dependabot" > "$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${RUN_LABEL}.md"',
        'exit 2',
      ].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "# eslint" > "$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'ops-run',
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
    });
    assert.equal(res.status, 2);
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-dependabot-alerts-ops-run.md')),
      true,
    );
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-eslint10-readiness-ops-run.md')),
      true,
    );
  });
});

test('run-and-record-dependency-watch: preserves child exit code when output is missing', () => {
  withTempDir((dir) => {
    const dependabotRecorder = path.join(dir, 'dependabot-record.sh');
    const eslintRecorder = path.join(dir, 'eslint-record.sh');
    const outDir = path.join(dir, 'out');

    writeFileSync(
      dependabotRecorder,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'exit 7'].join('\n'),
    );
    writeFileSync(
      eslintRecorder,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'mkdir -p "$OUT_DIR"',
        'echo "# eslint" > "$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${RUN_LABEL}.md"',
      ].join('\n'),
    );
    chmodSync(dependabotRecorder, 0o755);
    chmodSync(eslintRecorder, 0o755);

    const res = runScript('run-and-record-dependency-watch.sh', {
      OUT_DIR: outDir,
      DATE_STAMP: '2026-03-08',
      RUN_LABEL: 'ops-run',
      DEPENDABOT_RECORD_SCRIPT: dependabotRecorder,
      ESLINT_RECORD_SCRIPT: eslintRecorder,
    });
    assert.equal(res.status, 7);
    assert.match(
      String(res.stdout),
      /dependabot recorder exited with status 7 and did not produce expected output/,
    );
    assert.equal(
      existsSync(path.join(outDir, '2026-03-08-eslint10-readiness-ops-run.md')),
      true,
    );
  });
});
