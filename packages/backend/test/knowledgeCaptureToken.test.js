import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeKnowledgeCapture } from '../dist/application/knowledge/knowledgeCaptureDraft.js';
import {
  createKnowledgeCaptureTokenCodec,
  KnowledgeCaptureTokenError,
} from '../dist/application/knowledge/knowledgeCaptureToken.js';

const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET:
    'knowledge-capture-signing-secret-value-0001',
};
const actor = {
  userId: 'owner-private-1',
  organizationId: 'organization-private-1',
  groupAccountIds: ['group-private-1'],
};

function binding(overrides = {}) {
  return {
    canonical: canonicalizeKnowledgeCapture({
      draft: {
        schemaVersion: 1,
        channel: 'browser_extension',
        title: 'Private selected body',
        url: null,
        selectedText: null,
        description: null,
        author: null,
        publishedAt: null,
        capturedAt: '2026-08-14T00:00:00.000Z',
      },
      selectedFields: ['title'],
    }),
    scope: 'personal',
    organizationId: null,
    groupAccountIds: [],
    sourceType: 'manual',
    ...overrides,
  };
}

test('capture preview token binds actor and exact selection without plaintext', () => {
  const codec = createKnowledgeCaptureTokenCodec({
    env,
    now: () => new Date('2026-08-14T00:00:00.000Z'),
    randomId: () => '11111111-2222-4333-8444-123456789012',
  });
  const value = binding();
  const created = codec.create({ actor, binding: value });
  assert.deepEqual(
    codec.verify({ actor, binding: value, token: created.token }),
    {
      captureId: '11111111-2222-4333-8444-123456789012',
      expiresAt: new Date('2026-08-14T00:10:00.000Z'),
    },
  );
  for (const secret of [
    actor.userId,
    value.canonical.draft.title,
    value.canonical.payloadHash,
  ]) {
    assert.equal(created.token.includes(secret), false);
  }
  assert.match(
    codec.requestKeyHash(actor, 'private-request-key'),
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    codec.requestKeyHash(actor, 'private-request-key').includes('private'),
    false,
  );
});

test('capture preview token rejects tamper, actor, payload, scope, and expiry', () => {
  let current = new Date('2026-08-14T00:00:00.000Z');
  const codec = createKnowledgeCaptureTokenCodec({
    env,
    now: () => current,
    randomId: () => '11111111-2222-4333-8444-123456789012',
  });
  const value = binding();
  const { token } = codec.create({ actor, binding: value });
  for (const candidate of [
    { actor, binding: value, token: `${token.slice(0, -1)}x` },
    { actor: { ...actor, userId: 'other' }, binding: value, token },
    { actor, binding: binding({ sourceType: 'web' }), token },
    {
      actor,
      binding: binding({
        scope: 'organization',
        organizationId: actor.organizationId,
        groupAccountIds: actor.groupAccountIds,
      }),
      token,
    },
  ]) {
    assert.throws(
      () => codec.verify(candidate),
      (error) =>
        error instanceof KnowledgeCaptureTokenError &&
        error.code === 'preview_token_invalid',
    );
  }
  current = new Date('2026-08-14T00:10:06.000Z');
  assert.throws(
    () => codec.verify({ actor, binding: value, token }),
    (error) =>
      error instanceof KnowledgeCaptureTokenError &&
      error.code === 'preview_token_expired',
  );
});

test('capture token requires the shared production signing secret', () => {
  assert.throws(
    () => createKnowledgeCaptureTokenCodec({ env: { NODE_ENV: 'production' } }),
    /KNOWLEDGE_CURSOR_SIGNING_SECRET is required/,
  );
});
