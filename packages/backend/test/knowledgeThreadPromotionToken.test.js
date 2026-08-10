import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKnowledgeThreadPromotionTokenCodec,
  KnowledgeThreadPromotionTokenError,
} from '../dist/application/knowledge/knowledgeThreadPromotionToken.js';

const actor = {
  userId: 'knowledge-user-synthetic',
  organizationId: 'organization-synthetic',
  groupAccountIds: ['group-synthetic'],
  chat: {
    userId: 'chat-user-synthetic',
    roles: ['user'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: ['group-synthetic'],
  },
};
const rootMessageId = 'chat-root-private-synthetic';
const bindingHash = 'a'.repeat(64);
const promotionId = '11111111-2222-4333-8444-123456789012';
const now = new Date('2026-08-10T06:00:00.000Z');

function createCodec(overrides = {}) {
  return createKnowledgeThreadPromotionTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'thread-promotion-preview-test-secret-000001',
    },
    now: () => now,
    randomId: () => promotionId,
    ...overrides,
  });
}

function created(codec = createCodec()) {
  const reservedPromotionId = codec.reservePromotionId();
  return codec.create({
    actor,
    rootMessageId,
    bindingHash,
    promotionId: reservedPromotionId,
  });
}

function expectTokenError(code, work) {
  assert.throws(work, (error) => {
    assert.equal(error instanceof KnowledgeThreadPromotionTokenError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('promotion preview token verifies exact actor, root and payload binding', () => {
  const codec = createCodec();
  const value = created(codec);

  assert.equal(value.promotionId, promotionId);
  assert.equal(value.expiresAt.toISOString(), '2026-08-10T06:10:00.000Z');
  const verified = codec.verify({
    actor,
    rootMessageId,
    bindingHash,
    token: value.token,
  });
  assert.equal(verified.promotionId, promotionId);
  assert.match(verified.payloadBinding, /^[a-f0-9]{64}$/);
  assert.equal(verified.expiresAt.toISOString(), value.expiresAt.toISOString());
});

test('promotion preview token contains only opaque actor, root and payload fingerprints', () => {
  const { token } = created();
  const envelopeText = Buffer.from(token.split('.')[0], 'base64url').toString(
    'utf8',
  );
  const envelope = JSON.parse(envelopeText);

  for (const privateValue of [actor.userId, rootMessageId, bindingHash]) {
    assert.equal(token.includes(privateValue), false);
    assert.equal(envelopeText.includes(privateValue), false);
  }
  assert.deepEqual(Object.keys(envelope).sort(), [
    'actorFingerprint',
    'expiresAt',
    'issuedAt',
    'payloadBinding',
    'promotionId',
    'purpose',
    'rootFingerprint',
    'v',
  ]);
});

test('promotion preview token rejects actor/root mismatch and identifies stale exact state', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const valid = { actor, rootMessageId, bindingHash, token };

  expectTokenError('preview_token_invalid', () =>
    codec.verify({
      ...valid,
      actor: { ...actor, userId: 'another-knowledge-user' },
    }),
  );
  expectTokenError('preview_token_invalid', () =>
    codec.verify({ ...valid, rootMessageId: 'another-root' }),
  );
  expectTokenError('stale_preview', () =>
    codec.verify({ ...valid, bindingHash: 'b'.repeat(64) }),
  );
});

test('promotion preview token rejects tampering, malformed JSON and oversized input', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const [payload, signature] = token.split('.');
  const replacement = signature.at(-1) === 'A' ? 'B' : 'A';
  const tampered = `${payload}.${signature.slice(0, -1)}${replacement}`;
  const malformedEnvelope = Buffer.from('{', 'utf8').toString('base64url');

  for (const invalidToken of [
    tampered,
    `${token}.extra`,
    'not-base64url.*',
    `${malformedEnvelope}.${signature}`,
    '',
    'a'.repeat(4097),
    null,
  ]) {
    expectTokenError('preview_token_invalid', () =>
      codec.verify({
        actor,
        rootMessageId,
        bindingHash,
        token: invalidToken,
      }),
    );
  }
});

test('promotion preview token expires at ten minutes but remains readable for exact replay', () => {
  let current = now;
  const codec = createCodec({ now: () => current });
  const { token } = created(codec);

  current = new Date('2026-08-10T06:09:59.999Z');
  assert.equal(
    codec.verify({ actor, rootMessageId, bindingHash, token }).promotionId,
    promotionId,
  );
  current = new Date('2026-08-10T06:10:00.000Z');
  expectTokenError('preview_token_expired', () =>
    codec.verify({ actor, rootMessageId, bindingHash, token }),
  );
  assert.deepEqual(codec.readForReplay({ actor, rootMessageId, token }), {
    promotionId,
    payloadBinding: JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    ).payloadBinding,
    expiresAt: new Date('2026-08-10T06:10:00.000Z'),
  });
});

test('promotion preview token has a dedicated configured-secret domain', () => {
  const tokenA = created(createCodec()).token;
  const codecB = createCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'thread-promotion-preview-test-secret-000002',
    },
  });
  const tokenB = created(codecB).token;

  assert.notEqual(tokenA, tokenB);
  expectTokenError('preview_token_invalid', () =>
    codecB.verify({ actor, rootMessageId, bindingHash, token: tokenA }),
  );
});

test('promotion token requires a production secret and rejects invalid creation contracts', () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', KNOWLEDGE_CURSOR_SIGNING_SECRET: 'short' },
    { NODE_ENV: 'test', KNOWLEDGE_CURSOR_SIGNING_SECRET: ' '.repeat(32) },
  ]) {
    assert.throws(
      () => createKnowledgeThreadPromotionTokenCodec({ env }),
      /KNOWLEDGE_CURSOR_SIGNING_SECRET/,
    );
  }
  assert.throws(
    () => created(createCodec({ randomId: () => 'not-a-uuid' })),
    (error) => {
      assert.equal(
        error.message,
        'knowledge_thread_promotion_token_contract_invalid',
      );
      assert.equal(error.message.includes(rootMessageId), false);
      return true;
    },
  );
});
