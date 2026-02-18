import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(TEST_DIR, '..');

const BASE_ENV = {
  DATABASE_URL: MIN_DATABASE_URL,
};

function runNodeScript(script, overrides = {}) {
  const env = { ...BASE_ENV, ...overrides };
  return spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND_DIR,
    env,
    encoding: 'utf8',
  });
}

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
  return runNodeScript(script, overrides);
}

function runCurrentUserRequest(overrides = {}, headers = {}) {
  const script = `
    import { buildServer } from './dist/server.js';
    const server = await buildServer({ logger: false });
    try {
      const payload = process.env.TEST_HEADERS
        ? JSON.parse(process.env.TEST_HEADERS)
        : {};
      const res = await server.inject({ method: 'GET', url: '/me', headers: payload });
      process.stdout.write(JSON.stringify({
        statusCode: res.statusCode,
        body: res.body,
      }));
    } finally {
      await server.close();
    }
  `;
  return runNodeScript(script, {
    ...overrides,
    TEST_HEADERS: JSON.stringify(headers),
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
    AUTH_MODE: 'header',
    AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'yes',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_ALLOW_HEADER_FALLBACK_IN_PROD/);
});

test('envValidation: RATE_LIMIT_REDIS_URL validates redis scheme', () => {
  const result = runEnvValidation({
    RATE_LIMIT_REDIS_URL: 'https://example.com:6379',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RATE_LIMIT_REDIS_URL/);
});

test('envValidation: RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS validates positive integer', () => {
  const result = runEnvValidation({
    RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS: '0',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS/);
});

test('envValidation: RATE_LIMIT_MAX validates positive integer', () => {
  const result = runEnvValidation({
    RATE_LIMIT_MAX: '0',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RATE_LIMIT_MAX/);
});

test('envValidation: RATE_LIMIT_DOC_SEND_MAX validates positive integer', () => {
  const result = runEnvValidation({
    RATE_LIMIT_DOC_SEND_MAX: '-5',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RATE_LIMIT_DOC_SEND_MAX/);
});

test('auth plugin: production + AUTH_MODE=hybrid rejects missing bearer token by default', () => {
  const result = runCurrentUserRequest(
    {
      NODE_ENV: 'production',
      AUTH_MODE: 'hybrid',
      AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: '',
      JWT_ISSUER: 'test-issuer',
      JWT_AUDIENCE: 'test-audience',
      JWT_PUBLIC_KEY: 'dummy-public-key',
    },
    {
      'x-user-id': 'header-user',
      'x-roles': 'admin',
    },
  );

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 401);
});

test('auth plugin: production + AUTH_MODE=hybrid allows header fallback with explicit flag', () => {
  const result = runCurrentUserRequest(
    {
      NODE_ENV: 'production',
      AUTH_MODE: 'hybrid',
      AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'true',
      JWT_ISSUER: 'test-issuer',
      JWT_AUDIENCE: 'test-audience',
      JWT_PUBLIC_KEY: 'dummy-public-key',
    },
    {
      'x-user-id': 'header-user',
      'x-roles': 'admin',
    },
  );

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 200);
  const body = JSON.parse(payload.body);
  assert.equal(body.user?.userId, 'header-user');
});
