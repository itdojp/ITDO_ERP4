import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindKnowledgeConversationImportToOwner,
  encodeKnowledgeConversationImportInput,
  parseKnowledgeConversationImport,
} from '../dist/application/knowledge/knowledgeConversationImportParser.js';
import {
  createKnowledgeConversationImportTokenCodec,
  KnowledgeConversationImportTokenError,
} from '../dist/application/knowledge/knowledgeConversationImportToken.js';
import { hashKnowledgeConversationImportRequestKey } from '../dist/application/knowledge/knowledgeConversationImportUseCases.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};
const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET:
    'knowledge-import-preview-signing-secret-0001',
};

function canonical(overrides = {}) {
  const conversation = overrides.conversation ?? {
    title: 'Synthetic preview',
    turns: [{ role: 'user', origin: 'user', content: 'Private body' }],
  };
  const parsed = parseKnowledgeConversationImport({
    format: 'manual',
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(conversation),
    ),
    linkedItems: overrides.linkedItems ?? [
      { itemId: 'item-private-1', relationType: 'primary' },
    ],
  }).canonical;
  return bindKnowledgeConversationImportToOwner(parsed, actor.userId);
}

test('preview token round-trips and exposes no actor, item, or content', () => {
  const now = new Date('2026-08-08T00:00:00.000Z');
  const codec = createKnowledgeConversationImportTokenCodec({
    env,
    now: () => now,
    randomId: () => '11111111-1111-4111-8111-111111111111',
  });
  const value = canonical();
  const created = codec.create({ actor, canonical: value });
  assert.equal(created.expiresAt.toISOString(), '2026-08-08T00:10:00.000Z');
  assert.deepEqual(
    codec.verify({ actor, canonical: value, token: created.token }),
    {
      importId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date('2026-08-08T00:10:00.000Z'),
    },
  );
  assert.equal(created.token.includes('owner-1'), false);
  assert.equal(created.token.includes('item-private-1'), false);
  assert.equal(created.token.includes('Private body'), false);
  const envelope = JSON.parse(
    Buffer.from(created.token.split('.')[0], 'base64url').toString('utf8'),
  );
  assert.equal(envelope.payloadHash, undefined);
  assert.notEqual(envelope.payloadBinding, value.canonicalPayloadHash);
  assert.equal(
    JSON.stringify(envelope).includes(value.canonicalPayloadHash),
    false,
  );
});

test('preview token rejects tamper, actor, payload, format, and item mismatches', () => {
  const codec = createKnowledgeConversationImportTokenCodec({
    env,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
    randomId: () => '11111111-1111-4111-8111-111111111111',
  });
  const value = canonical();
  const { token } = codec.create({ actor, canonical: value });
  const changedPayload = canonical({
    conversation: {
      title: 'Changed',
      turns: [{ role: 'user', origin: 'user', content: 'Private body' }],
    },
  });
  const changedItems = canonical({
    linkedItems: [{ itemId: 'item-private-2', relationType: 'primary' }],
  });
  for (const candidate of [
    { actor, canonical: value, token: `${token.slice(0, -1)}x` },
    { actor: { ...actor, userId: 'owner-2' }, canonical: value, token },
    { actor, canonical: changedPayload, token },
    { actor, canonical: changedItems, token },
  ]) {
    assert.throws(
      () => codec.verify(candidate),
      (error) =>
        error instanceof KnowledgeConversationImportTokenError &&
        error.code === 'preview_token_invalid',
    );
  }
});

test('preview token expires at the ten-minute boundary', () => {
  let now = new Date('2026-08-08T00:00:00.000Z');
  const codec = createKnowledgeConversationImportTokenCodec({
    env,
    now: () => now,
    randomId: () => '11111111-1111-4111-8111-111111111111',
  });
  const value = canonical();
  const { token } = codec.create({ actor, canonical: value });
  now = new Date('2026-08-08T00:10:00.000Z');
  assert.throws(
    () => codec.verify({ actor, canonical: value, token }),
    (error) =>
      error instanceof KnowledgeConversationImportTokenError &&
      error.code === 'preview_token_expired',
  );
});

test('preview token requires the existing production signing-secret boundary', () => {
  assert.throws(
    () =>
      createKnowledgeConversationImportTokenCodec({
        env: { NODE_ENV: 'production' },
      }),
    /KNOWLEDGE_CURSOR_SIGNING_SECRET is required/,
  );
  assert.throws(
    () =>
      createKnowledgeConversationImportTokenCodec({
        env: {
          NODE_ENV: 'production',
          KNOWLEDGE_CURSOR_SIGNING_SECRET: 'short',
        },
      }),
    /at least 32 UTF-8 bytes/,
  );
});

test('persistent request-key hash is independent from preview signing-key rotation', () => {
  const first = hashKnowledgeConversationImportRequestKey(
    actor,
    'request-key-1',
  );
  createKnowledgeConversationImportTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'rotated-preview-signing-secret-value-0002',
    },
  });
  const second = hashKnowledgeConversationImportRequestKey(
    actor,
    'request-key-1',
  );
  assert.equal(first, second);
  assert.notEqual(
    first,
    hashKnowledgeConversationImportRequestKey(
      { ...actor, userId: 'owner-2' },
      'request-key-1',
    ),
  );
  assert.notEqual(
    first,
    hashKnowledgeConversationImportRequestKey(actor, 'request-key-2'),
  );
  assert.equal(first.includes('request-key-1'), false);
  assert.match(first, /^[a-f0-9]{64}$/);
});
