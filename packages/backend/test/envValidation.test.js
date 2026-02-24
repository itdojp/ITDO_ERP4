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

function runDelegatedJwtRequest({
  overrides = {},
  payload = {},
  method = 'GET',
  url = '/me',
  stubDb = false,
  stubAgent360 = false,
}) {
  const script = `
    import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

    const claims = process.env.TEST_JWT_PAYLOAD
      ? JSON.parse(process.env.TEST_JWT_PAYLOAD)
      : {};
    const method = process.env.TEST_METHOD || 'GET';
    const url = process.env.TEST_URL || '/me';
    const issuer = process.env.JWT_ISSUER || 'test-issuer';
    const audience = process.env.JWT_AUDIENCE || 'test-audience';

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicKeyPem = await exportSPKI(publicKey);
    process.env.AUTH_MODE = process.env.AUTH_MODE || 'jwt';
    process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || publicKeyPem;

    if (process.env.TEST_STUB_DB === '1') {
      const { prisma } = await import('./dist/services/db.js');
      prisma.userAccount.findUnique = async () => null;
      prisma.projectMember.findMany = async () => [];

      if (process.env.TEST_STUB_AGENT360 === '1') {
        prisma.project.groupBy = async () => [
          { status: 'active', _count: { _all: 1 } },
        ];
        prisma.invoice.groupBy = async () => [
          { status: 'draft', _count: { _all: 1 }, _sum: { totalAmount: 1000 } },
        ];
        prisma.timeEntry.groupBy = async () => [
          { status: 'approved', _count: { _all: 1 }, _sum: { minutes: 60 } },
        ];
        prisma.expense.groupBy = async () => [
          { status: 'approved', _count: { _all: 1 }, _sum: { amount: 500 } },
        ];
        prisma.approvalInstance.groupBy = async () => [
          { status: 'pending_qa', flowType: 'invoice', _count: { _all: 1 } },
        ];
        prisma.auditLog.create = async () => ({ id: 'audit-stub' });
      }
    }

    const { buildServer } = await import('./dist/server.js');

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method,
        url,
        headers: { authorization: 'Bearer ' + token },
      });
      process.stdout.write(JSON.stringify({ statusCode: res.statusCode, body: res.body }));
    } finally {
      await server.close();
    }
  `;
  return runNodeScript(script, {
    ...overrides,
    AUTH_MODE: 'jwt',
    JWT_ISSUER: overrides.JWT_ISSUER || 'test-issuer',
    JWT_AUDIENCE: overrides.JWT_AUDIENCE || 'test-audience',
    TEST_JWT_PAYLOAD: JSON.stringify(payload),
    TEST_METHOD: method,
    TEST_URL: url,
    TEST_STUB_DB: stubDb ? '1' : '0',
    TEST_STUB_AGENT360: stubAgent360 ? '1' : '0',
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

test('envValidation: ACTION_POLICY_ENFORCEMENT_PRESET validates allowed values', () => {
  const result = runEnvValidation({
    ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ACTION_POLICY_ENFORCEMENT_PRESET/);
});

test('envValidation: ACTION_POLICY_REQUIRED_ACTIONS validates flowType:actionKey format', () => {
  const result = runEnvValidation({
    ACTION_POLICY_REQUIRED_ACTIONS: 'invoice-send',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ACTION_POLICY_REQUIRED_ACTIONS/);
});

test('envValidation: APPROVAL_EVIDENCE_REQUIRED_ACTIONS validates flowType:actionKey format', () => {
  const result = runEnvValidation({
    APPROVAL_EVIDENCE_REQUIRED_ACTIONS: 'invoice',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVAL_EVIDENCE_REQUIRED_ACTIONS/);
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

test('auth plugin: jwt with revoked jti is rejected', () => {
  const result = runDelegatedJwtRequest({
    overrides: {
      JWT_REVOKED_JTI: 'tok-revoked',
    },
    payload: {
      sub: 'principal-user',
      scp: ['read-only'],
      roles: ['user'],
      jti: 'tok-revoked',
    },
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 401);
});

test('auth plugin: delegated read-only scope returns 403 scope_denied for write method', () => {
  const result = runDelegatedJwtRequest({
    payload: {
      sub: 'principal-user',
      act: { sub: 'agent-bot' },
      scp: ['read-only'],
      roles: ['user'],
      jti: 'tok-allow',
    },
    method: 'POST',
    url: '/me',
    stubDb: true,
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 403);
  const body = JSON.parse(payload.body);
  assert.equal(body.error?.code, 'scope_denied');
});

test('auth plugin: delegated read-only scope allows GET /project-360', () => {
  const result = runDelegatedJwtRequest({
    payload: {
      sub: 'principal-user',
      act: { sub: 'agent-bot' },
      scp: ['read-only'],
      roles: ['admin'],
      jti: 'tok-agent-read',
    },
    method: 'GET',
    url: '/project-360',
    stubDb: true,
    stubAgent360: true,
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 200);
  const body = JSON.parse(payload.body);
  assert.equal(body.projects?.total, 1);
  assert.equal(body.approvals?.pendingTotal, 1);
});

test('auth plugin: delegated write-limited scope passes auth guard for write method', () => {
  const result = runDelegatedJwtRequest({
    payload: {
      sub: 'principal-user',
      act: { sub: 'agent-bot' },
      scp: ['write-limited'],
      roles: ['admin'],
      jti: 'tok-agent-write',
    },
    method: 'POST',
    // No route: use 404 to verify auth guard passed (and avoid DB dependency).
    url: '/__agent-write-guard-check',
    stubDb: true,
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.statusCode, 404);
});
