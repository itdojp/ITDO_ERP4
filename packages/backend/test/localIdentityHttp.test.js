import assert from 'node:assert/strict';
import test from 'node:test';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const {
  enforceLocalCredentialAdminRateLimit,
  requireActorUserId,
  sendLocalIdentityResult,
} = await import('../dist/routes/auth/localIdentityHttp.js');

function createReply() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    sent: false,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    header(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload) {
      this.payload = payload;
      this.sent = true;
      return this;
    },
  };
}

test('requireActorUserId maps missing actor to validation error before use case execution', () => {
  const reply = createReply();
  const actorId = requireActorUserId({ user: {} }, reply);

  assert.equal(actorId, null);
  assert.equal(reply.statusCode, 400);
  assert.equal(reply.payload.error.code, 'missing_user_id');
  assert.equal(reply.payload.error.category, 'validation');
});

test('enforceLocalCredentialAdminRateLimit returns explicit stop signal and error payload', async () => {
  const originalConsume = RateLimiterMemory.prototype.consume;
  RateLimiterMemory.prototype.consume = async function patchedConsume() {
    throw new Error('rate_limited_for_test');
  };
  try {
    const reply = createReply();
    const stopped = await enforceLocalCredentialAdminRateLimit(
      { ip: '203.0.113.10' },
      reply,
    );

    assert.equal(stopped, true);
    assert.equal(reply.statusCode, 429);
    assert.equal(reply.payload.error.code, 'local_credential_rate_limited');
    assert.equal(reply.payload.error.category, 'rate_limit');
  } finally {
    RateLimiterMemory.prototype.consume = originalConsume;
  }
});

test('sendLocalIdentityResult maps success no-content response at HTTP boundary', () => {
  const reply = createReply();

  sendLocalIdentityResult(reply, {
    kind: 'success',
    statusCode: 204,
  });

  assert.equal(reply.statusCode, 204);
  assert.deepEqual(reply.headers, {});
  assert.equal(reply.payload, undefined);
});
