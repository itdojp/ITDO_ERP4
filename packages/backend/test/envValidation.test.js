import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function runEnvValidation(overrides = {}) {
  const script = `
    import { assertValidBackendEnv } from './dist/services/envValidation.js';
    try {
      assertValidBackendEnv();
      process.stdout.write('OK');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message);
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: MIN_DATABASE_URL,
      ...overrides,
    },
  });
}

test('envValidation: production + AUTH_MODE=header is rejected by default', () => {
  const result = runEnvValidation({
    NODE_ENV: 'production',
    AUTH_MODE: 'header',
    AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /AUTH_MODE/);
});

test('envValidation: production + AUTH_MODE=header is allowed with explicit flag', () => {
  const result = runEnvValidation({
    NODE_ENV: 'production',
    AUTH_MODE: 'header',
    AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'true',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout.toString(), /OK/);
});

test('envValidation: AUTH_ALLOW_HEADER_FALLBACK_IN_PROD validates boolean values', () => {
  const result = runEnvValidation({
    NODE_ENV: 'development',
    AUTH_MODE: 'jwt',
    AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'yes',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /AUTH_ALLOW_HEADER_FALLBACK_IN_PROD/);
});
