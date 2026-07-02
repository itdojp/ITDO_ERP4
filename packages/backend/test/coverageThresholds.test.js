import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
