import assert from 'node:assert/strict';
import {
  mkdtempSync,
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
