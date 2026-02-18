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

function runHealthRequest(overrides = {}, headers = {}) {
  const script = `
    import { buildServer } from './dist/server.js';
    const server = await buildServer({ logger: false });
    try {
      const headers = process.env.TEST_HEADERS
        ? JSON.parse(process.env.TEST_HEADERS)
        : {};
      const res = await server.inject({ method: 'GET', url: '/healthz', headers });
      process.stdout.write(JSON.stringify({
        statusCode: res.statusCode,
        headers: {
          accessControlAllowOrigin: res.headers['access-control-allow-origin'] ?? null,
          contentSecurityPolicy: res.headers['content-security-policy'] ?? null,
        },
      }));
    } finally {
      await server.close();
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND_DIR,
    env: {
      ...BASE_ENV,
      ...overrides,
      TEST_HEADERS: JSON.stringify(headers),
    },
    encoding: 'utf8',
  });
  return result;
}

function parseResult(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('cors denies when ALLOWED_ORIGINS is empty', () => {
  const result = runHealthRequest(
    { ALLOWED_ORIGINS: '' },
    { origin: 'http://blocked.example' },
  );
  const payload = parseResult(result, 'cors-empty');
  assert.equal(payload.statusCode, 200);
  assert.equal(payload.headers.accessControlAllowOrigin, null);
});

test('cors allows configured origin', () => {
  const result = runHealthRequest(
    {
      ALLOWED_ORIGINS:
        'http://allowed.example,http://localhost:5173,http://127.0.0.1:5173',
    },
    { origin: 'http://allowed.example' },
  );
  const payload = parseResult(result, 'cors-allowed');
  assert.equal(payload.statusCode, 200);
  assert.equal(
    payload.headers.accessControlAllowOrigin,
    'http://allowed.example',
  );
});

test('cors rejects origin not in allowlist', () => {
  const result = runHealthRequest(
    { ALLOWED_ORIGINS: 'http://allowed.example' },
    { origin: 'http://blocked.example' },
  );
  const payload = parseResult(result, 'cors-blocked');
  assert.equal(payload.statusCode, 200);
  assert.equal(payload.headers.accessControlAllowOrigin, null);
});

test('csp header is attached with baseline directives', () => {
  const result = runHealthRequest();
  const payload = parseResult(result, 'csp');
  assert.equal(payload.statusCode, 200);
  const csp = String(payload.headers.contentSecurityPolicy || '');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
});
