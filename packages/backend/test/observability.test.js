import assert from 'node:assert/strict';
import test from 'node:test';

const DEFAULT_DATABASE_URL =
  'postgresql://user:pass@localhost:5432/postgres?schema=public';

async function buildTestServer() {
  process.env.DATABASE_URL ||= DEFAULT_DATABASE_URL;
  const { buildServer } = await import('../dist/server.js');
  const server = await buildServer({ logger: false });
  return server;
}

test('request-id is attached to responses', async () => {
  const server = await buildTestServer();
  const res = await server.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['x-request-id']);
  await server.close();
});

test('inbound request-id is echoed if safe', async () => {
  const server = await buildTestServer();
  const res = await server.inject({
    method: 'GET',
    url: '/healthz',
    headers: { 'x-request-id': 'test-123' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-request-id'], 'test-123');
  await server.close();
});

test('cache-control no-store headers are attached to success responses', async () => {
  const server = await buildTestServer();
  const res = await server.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers.pragma, 'no-cache');
  await server.close();
});

test('cache-control no-store headers are attached to error responses', async () => {
  const server = await buildTestServer();
  const res = await server.inject({ method: 'GET', url: '/missing-path' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers.pragma, 'no-cache');
  await server.close();
});

test('legacy error responses are normalized', async () => {
  const server = await buildTestServer();
  const res = await server.inject({
    method: 'POST',
    url: '/rate-cards',
    headers: {
      'content-type': 'application/json',
      'x-user-id': 'u1',
      'x-roles': 'admin',
    },
    payload: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(typeof body.error?.code, 'string');
  assert.equal(body.error.code, 'role_required');
  assert.equal(typeof body.error?.message, 'string');
  assert.ok(res.headers['x-request-id']);
  await server.close();
});

test('validation errors are returned with unified envelope', async () => {
  const server = await buildTestServer();
  const res = await server.inject({
    method: 'POST',
    url: '/projects',
    headers: { 'content-type': 'application/json', 'x-user-id': 'u1', 'x-roles': 'admin' },
    payload: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error?.code, 'VALIDATION_ERROR');
  assert.ok(body.error?.details);
  assert.ok(res.headers['x-request-id']);
  await server.close();
});
