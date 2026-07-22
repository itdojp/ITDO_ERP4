import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const backendRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(backendRoot, 'dist', 'cli', 'storageReadiness.js');

test('storage readiness CLI emits JSON and exit 3 for an unconfigured host', () => {
  const result = spawnSync(process.execPath, [cli], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 'erp4.storage.readiness.v1');
  assert.equal(report.overall.status, 'not_configured');
  assert.equal(report.overall.exitCode, 3);
  assert.equal(report.components.length, 8);
});

test('storage readiness CLI returns 64 for invalid arguments without echoing values', () => {
  const secretLikeValue = 'do-not-echo-value';
  const result = spawnSync(
    process.execPath,
    [cli, '--format', secretLikeValue],
    {
      cwd: backendRoot,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    },
  );
  assert.equal(result.status, 64);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /invalid configuration keys: --format/);
  assert.doesNotMatch(result.stderr, new RegExp(secretLikeValue));

  const positional = spawnSync(process.execPath, [cli, secretLikeValue], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(positional.status, 64);
  assert.match(positional.stderr, /invalid configuration keys: argument/);
  assert.doesNotMatch(positional.stderr, new RegExp(secretLikeValue));
});
