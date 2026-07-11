import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SCRIPT_PATH = path.join(
  BACKEND_DIR,
  'scripts/check-coverage-thresholds.mjs',
);

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp4-coverage-thresholds-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir, thresholds) {
  const summaryPath = path.join(dir, 'coverage-summary.json');
  const configPath = path.join(dir, 'coverage-thresholds.json');
  writeFileSync(
    summaryPath,
    JSON.stringify({
      total: {
        statements: { pct: 26.49 },
        branches: { pct: 65.83 },
        functions: { pct: 19.34 },
        lines: { pct: 26.49 },
      },
    }),
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      auth: {
        summary: summaryPath,
        thresholds,
      },
    }),
  );
  return { configPath };
}

test('coverage threshold script passes when all metrics meet the scope threshold', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 25,
      branches: 60,
      functions: 18,
      lines: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /auth statements: 26\.49% >= 25\.00% PASS/);
    assert.match(result.stdout, /auth branches: 65\.83% >= 60\.00% PASS/);
  }));

test('coverage threshold script fails when any metric is below threshold', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 30,
      branches: 60,
      functions: 18,
      lines: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /auth statements: 26\.49% >= 30\.00% FAIL/);
    assert.match(result.stderr, /coverage threshold failed for auth/);
  }));

test('coverage threshold script reports missing option values clearly', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing value for --scope/);
  }));

test('coverage threshold script reports invalid threshold metrics clearly', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: '25',
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /invalid threshold for metric statements: expected number/,
    );
  }));

test('coverage threshold script aggregates configured files instead of repository total', () =>
  withTempDir((dir) => {
    const summaryPath = path.join(dir, 'coverage-summary.json');
    const configPath = path.join(dir, 'coverage-thresholds.json');
    const authFile = path.join(BACKEND_DIR, 'src/plugins/auth.ts');
    const unrelatedFile = path.join(BACKEND_DIR, 'src/unrelated.ts');

    writeFileSync(
      summaryPath,
      JSON.stringify({
        total: {
          statements: { total: 200, covered: 50, pct: 25 },
          branches: { total: 200, covered: 50, pct: 25 },
          functions: { total: 200, covered: 50, pct: 25 },
          lines: { total: 200, covered: 50, pct: 25 },
        },
        [authFile]: {
          statements: { total: 10, covered: 9, pct: 90 },
          branches: { total: 10, covered: 9, pct: 90 },
          functions: { total: 10, covered: 9, pct: 90 },
          lines: { total: 10, covered: 9, pct: 90 },
        },
        [unrelatedFile]: {
          statements: { total: 190, covered: 41, pct: 21.57 },
          branches: { total: 190, covered: 41, pct: 21.57 },
          functions: { total: 190, covered: 41, pct: 21.57 },
          lines: { total: 190, covered: 41, pct: 21.57 },
        },
      }),
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          summary: summaryPath,
          files: ['src/plugins/auth.ts'],
          thresholds: {
            statements: 80,
            branches: 80,
            functions: 80,
            lines: 80,
          },
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /auth statements: 90\.00% >= 80\.00% PASS/);
  }));

test('integrations coverage scope includes current integration route and service files', () => {
  const configPath = path.join(BACKEND_DIR, 'coverage-thresholds.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const configuredFiles = [...config.integrations.files].sort();
  const integrationServicePattern =
    /^(accountingIcsExport|accountingMappingRules|attendanceClosings|integration[A-Z].*|statutoryAccountingActuals)\.ts$/;
  const expectedFiles = [
    'src/routes/integrations.ts',
    ...readdirSync(path.join(BACKEND_DIR, 'src/services'))
      .filter((name) => integrationServicePattern.test(name))
      .map((name) => `src/services/${name}`),
  ].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
});
