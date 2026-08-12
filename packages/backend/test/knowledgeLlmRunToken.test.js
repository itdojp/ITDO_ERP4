import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createKnowledgeLlmRunTokenCodec,
  KnowledgeLlmRunTokenError,
} from '../dist/application/knowledge/knowledgeLlmRunToken.js';

const actor = {
  userId: 'knowledge-llm-owner-synthetic',
  organizationId: 'knowledge-llm-org-synthetic',
  groupAccountIds: ['knowledge-llm-group-synthetic'],
};
const runId = '11111111-2222-4333-8444-123456789012';
const issuedAt = new Date('2026-08-12T00:00:00.000Z');
const privateSourceId = 'knowledge-source-private-canary-987654321';
const privatePrompt =
  'Private prompt canary that must never appear in a preview token.';

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const requestShapeHash = sha256(
  JSON.stringify({
    actor: actor.userId,
    sourceId: privateSourceId,
    provider: 'stub',
    model: 'stub-knowledge-v1',
  }),
);
const payloadHash = sha256(
  JSON.stringify({
    prompt: privatePrompt,
    sourceId: privateSourceId,
    exactVersion: 7,
  }),
);

function createCodec(overrides = {}) {
  return createKnowledgeLlmRunTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'knowledge-llm-run-token-test-secret-00000001',
    },
    now: () => issuedAt,
    randomId: () => runId,
    ...overrides,
  });
}

function created(codec = createCodec()) {
  const reservedRunId = codec.reserveRunId();
  return codec.create({
    actor,
    runId: reservedRunId,
    requestShapeHash,
    payloadHash,
  });
}

function expectTokenError(code, work) {
  assert.throws(work, (error) => {
    assert.equal(error instanceof KnowledgeLlmRunTokenError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

function replaceLastBase64UrlCharacter(value) {
  const replacement = value.at(-1) === 'A' ? 'B' : 'A';
  return `${value.slice(0, -1)}${replacement}`;
}

function nonCanonicalBase64UrlAlias(value) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const remainder = value.length % 4;
  const unusedBitCount = remainder === 2 ? 4 : remainder === 3 ? 2 : 0;
  assert.notEqual(unusedBitCount, 0);
  const lastIndex = alphabet.indexOf(value.at(-1));
  const unusedBitMask = (1 << unusedBitCount) - 1;
  assert.equal(lastIndex & unusedBitMask, 0);
  return `${value.slice(0, -1)}${alphabet[lastIndex + 1]}`;
}

test('knowledge LLM preview token verifies the exact actor, request shape and payload', () => {
  const codec = createCodec();
  const value = created(codec);

  assert.equal(value.runId, runId);
  assert.equal(value.expiresAt.toISOString(), '2026-08-12T00:10:00.000Z');
  assert.deepEqual(
    codec.verify({
      actor,
      requestShapeHash,
      payloadHash,
      token: value.token,
    }),
    {
      runId,
      expiresAt: value.expiresAt,
    },
  );
});

test('knowledge LLM preview token rejects signature tampering', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const [payloadSegment, signatureSegment] = token.split('.');
  const tampered = `${payloadSegment}.${replaceLastBase64UrlCharacter(signatureSegment)}`;

  expectTokenError('preview_token_invalid', () =>
    codec.verify({
      actor,
      requestShapeHash,
      payloadHash,
      token: tampered,
    }),
  );
});

test('knowledge LLM preview token requires canonical unpadded base64url segments', () => {
  const codec = createCodec();
  const { token } = created(codec);
  const [payloadSegment, signatureSegment] = token.split('.');
  const equivalentNonCanonicalSignature =
    nonCanonicalBase64UrlAlias(signatureSegment);
  assert.equal(
    Buffer.from(equivalentNonCanonicalSignature, 'base64url').equals(
      Buffer.from(signatureSegment, 'base64url'),
    ),
    true,
  );
  const nonCanonicalTokens = [
    `${payloadSegment}.${equivalentNonCanonicalSignature}`,
    `${payloadSegment}=.${signatureSegment}`,
    `${payloadSegment}.${signatureSegment}=`,
    `${payloadSegment}+.${signatureSegment}`,
    `${payloadSegment}.${signatureSegment}/`,
  ];

  for (const nonCanonicalToken of nonCanonicalTokens) {
    expectTokenError('preview_token_invalid', () =>
      codec.verify({
        actor,
        requestShapeHash,
        payloadHash,
        token: nonCanonicalToken,
      }),
    );
  }
});

test('knowledge LLM preview token rejects actor and request-shape mismatch', () => {
  const codec = createCodec();
  const { token } = created(codec);

  for (const mismatched of [
    {
      actor: { ...actor, userId: 'other-knowledge-owner' },
      requestShapeHash,
    },
    {
      actor,
      requestShapeHash: sha256('different-request-shape'),
    },
  ]) {
    expectTokenError('preview_token_invalid', () =>
      codec.verify({
        ...mismatched,
        payloadHash,
        token,
      }),
    );
  }
});

test('knowledge LLM preview token reports a payload mismatch as stale preview', () => {
  const codec = createCodec();
  const { token } = created(codec);

  expectTokenError('stale_preview', () =>
    codec.verify({
      actor,
      requestShapeHash,
      payloadHash: sha256('changed-payload'),
      token,
    }),
  );
  assert.equal(codec.payloadMatches(payloadHash, 'not-a-binding'), false);
});

test('knowledge LLM replay read accepts an expired token while full verify rejects it', () => {
  let current = issuedAt;
  const codec = createCodec({ now: () => current });
  const { token, expiresAt } = created(codec);

  current = new Date('2026-08-12T00:09:59.999Z');
  assert.equal(
    codec.verify({ actor, requestShapeHash, payloadHash, token }).runId,
    runId,
  );

  current = new Date('2026-08-12T00:10:00.000Z');
  expectTokenError('preview_token_expired', () =>
    codec.verify({ actor, requestShapeHash, payloadHash, token }),
  );

  const replay = codec.readForReplay({ actor, requestShapeHash, token });
  assert.equal(replay.runId, runId);
  assert.equal(replay.expiresAt.toISOString(), expiresAt.toISOString());
  assert.match(replay.payloadBinding, /^[a-f0-9]{64}$/);
  assert.equal(codec.payloadMatches(payloadHash, replay.payloadBinding), true);
  assert.equal(
    codec.payloadMatches(sha256('changed-payload'), replay.payloadBinding),
    false,
  );
});

test('knowledge LLM preview token rejects oversized and malformed values', () => {
  const codec = createCodec();
  const { token } = created(codec);

  for (const invalidToken of [
    'a'.repeat(4097),
    `${token}.extra`,
    '',
    null,
    undefined,
  ]) {
    expectTokenError('preview_token_invalid', () =>
      codec.verify({
        actor,
        requestShapeHash,
        payloadHash,
        token: invalidToken,
      }),
    );
  }
});

test('knowledge LLM preview token contains no raw body, identifier or input hash', () => {
  const { token } = created();
  const decodedEnvelope = Buffer.from(
    token.split('.')[0],
    'base64url',
  ).toString('utf8');

  for (const privateValue of [
    actor.userId,
    actor.organizationId,
    privateSourceId,
    privatePrompt,
    requestShapeHash,
    payloadHash,
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
    'requestShapeBinding',
    'runId',
    'v',
  ]);
  assert.equal(envelope.runId, runId);
  assert.match(envelope.actorFingerprint, /^[a-f0-9]{64}$/);
  assert.match(envelope.requestShapeBinding, /^[a-f0-9]{64}$/);
  assert.match(envelope.payloadBinding, /^[a-f0-9]{64}$/);
});
