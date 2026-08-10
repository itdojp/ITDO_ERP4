import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKnowledgeShareTokenCodec,
  KnowledgeShareTokenError,
} from '../dist/application/knowledge/knowledgeShareToken.js';

const actor = {
  userId: 'owner-synthetic',
  organizationId: 'org-synthetic',
  groupAccountIds: ['group-synthetic'],
};
const sourceItemId = 'item-private-canary';
const destinationRoomId = 'room-synthetic';
const bindingHash = 'a'.repeat(64);
const now = new Date('2026-08-10T00:00:00.000Z');
const shareId = '11111111-2222-4333-8444-123456789012';

function createCodec(overrides = {}) {
  return createKnowledgeShareTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'knowledge-share-preview-test-secret-00000001',
    },
    now: () => now,
    randomId: () => shareId,
    ...overrides,
  });
}

function created(codec = createCodec()) {
  const reservedShareId = codec.reserveShareId();
  return codec.create({
    actor,
    sourceItemId,
    destinationRoomId,
    bindingHash,
    shareId: reservedShareId,
  });
}

function expectTokenError(code, work) {
  assert.throws(work, (error) => {
    assert.equal(error instanceof KnowledgeShareTokenError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('share preview token verifies the exact actor, source, room and binding', () => {
  const codec = createCodec();
  const value = created(codec);

  assert.equal(value.shareId, shareId);
  assert.equal(value.expiresAt.toISOString(), '2026-08-10T00:10:00.000Z');
  assert.deepEqual(
    codec.verify({
      actor,
      sourceItemId,
      destinationRoomId,
      bindingHash,
      token: value.token,
    }),
    {
      shareId,
      payloadBinding: JSON.parse(
        Buffer.from(value.token.split('.')[0], 'base64url').toString('utf8'),
      ).payloadBinding,
      expiresAt: value.expiresAt,
    },
  );
});

test('share preview token does not contain raw actor, source, room or binding values', () => {
  const { token } = created();
  const decodedEnvelope = Buffer.from(
    token.split('.')[0],
    'base64url',
  ).toString('utf8');

  for (const privateValue of [
    actor.userId,
    sourceItemId,
    destinationRoomId,
    bindingHash,
  ]) {
    assert.equal(token.includes(privateValue), false);
    assert.equal(decodedEnvelope.includes(privateValue), false);
  }
  const envelope = JSON.parse(decodedEnvelope);
  assert.deepEqual(Object.keys(envelope).sort(), [
    'actorFingerprint',
    'expiresAt',
    'issuedAt',
    'payloadBinding',
    'purpose',
    'roomFingerprint',
    'shareId',
    'sourceFingerprint',
    'v',
  ]);
});

test('share preview token rejects actor/source/room mismatch and identifies stale binding', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const valid = { actor, sourceItemId, destinationRoomId, bindingHash, token };

  for (const changed of [
    { ...valid, actor: { ...actor, userId: 'other-owner' } },
    { ...valid, sourceItemId: 'other-item' },
    { ...valid, destinationRoomId: 'other-room' },
  ]) {
    expectTokenError('preview_token_invalid', () => codec.verify(changed));
  }
  expectTokenError('stale_preview', () =>
    codec.verify({ ...valid, bindingHash: 'b'.repeat(64) }),
  );
});

test('share preview token rejects tampering and malformed or oversized input', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const [payload, signature] = token.split('.');
  const replacement = signature.at(-1) === 'A' ? 'B' : 'A';
  const tampered = `${payload}.${signature.slice(0, -1)}${replacement}`;

  for (const invalidToken of [
    tampered,
    `${token}.extra`,
    'not-base64url.*',
    '',
    'a'.repeat(4097),
    null,
  ]) {
    expectTokenError('preview_token_invalid', () =>
      codec.verify({
        actor,
        sourceItemId,
        destinationRoomId,
        bindingHash,
        token: invalidToken,
      }),
    );
  }
});

test('share preview token expires at the exact ten minute boundary', () => {
  let current = now;
  const codec = createCodec({ now: () => current });
  const { token } = created(codec);

  current = new Date('2026-08-10T00:09:59.999Z');
  assert.equal(
    codec.verify({
      actor,
      sourceItemId,
      destinationRoomId,
      bindingHash,
      token,
    }).shareId,
    shareId,
  );

  current = new Date('2026-08-10T00:10:00.000Z');
  expectTokenError('preview_token_expired', () =>
    codec.verify({
      actor,
      sourceItemId,
      destinationRoomId,
      bindingHash,
      token,
    }),
  );

  const replay = codec.readForReplay({
    actor,
    sourceItemId,
    destinationRoomId,
    token,
  });
  assert.equal(replay.shareId, shareId);
  assert.match(replay.payloadBinding, /^[a-f0-9]{64}$/);
  assert.equal(replay.expiresAt.toISOString(), '2026-08-10T00:10:00.000Z');
});

test('share preview token uses a domain-separated configured secret', () => {
  const tokenA = created(createCodec()).token;
  const tokenB = created(
    createCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'knowledge-share-preview-test-secret-00000002',
      },
    }),
  ).token;

  assert.notEqual(tokenA, tokenB);
  expectTokenError('preview_token_invalid', () =>
    createCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'knowledge-share-preview-test-secret-00000002',
      },
    }).verify({
      actor,
      sourceItemId,
      destinationRoomId,
      bindingHash,
      token: tokenA,
    }),
  );
});

test('share preview token requires a strong configured secret in production', () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', KNOWLEDGE_CURSOR_SIGNING_SECRET: 'short' },
    { NODE_ENV: 'test', KNOWLEDGE_CURSOR_SIGNING_SECRET: ' '.repeat(32) },
  ]) {
    assert.throws(
      () => createKnowledgeShareTokenCodec({ env }),
      /KNOWLEDGE_CURSOR_SIGNING_SECRET/,
    );
  }
});

test('share preview token rejects invalid creation contracts without exposing input', () => {
  const codec = createCodec({ randomId: () => 'not-a-uuid' });
  assert.throws(
    () => created(codec),
    (error) => {
      assert.equal(error.message, 'knowledge_share_token_contract_invalid');
      assert.equal(error.message.includes(sourceItemId), false);
      return true;
    },
  );
});
