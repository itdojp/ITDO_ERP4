import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  createKnowledgeCursorCodec,
  fingerprintKnowledgeCursorActor,
  hashKnowledgeCursorFilter,
  KnowledgeCursorError,
} from '../dist/application/knowledge/knowledgeCursor.js';

const SECRET = 'knowledge-cursor-unit-test-secret-v1';
const ENV = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET: SECRET,
};
const BOUNDARY = {
  updatedAt: new Date('2026-08-05T01:02:03.456Z'),
  id: 'item-0002',
};
const ACTOR = {
  userId: 'user-sensitive-value',
  organizationId: 'org-sensitive-value',
  groupAccountIds: ['group-b-sensitive', 'group-a-sensitive'],
};
const FILTER = {
  labels: {
    any: [{ id: 'label-1', includeDescendants: true }],
    all: [],
    not: [{ id: 'label-2', includeDescendants: false }],
  },
  sourceType: 'web',
  status: 'processed',
  facets: ['status', 'label'],
  limit: 50,
};

function decodeEnvelope(cursor) {
  const [payload] = cursor.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function signEnvelope(envelope) {
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(payload, 'ascii')
    .digest('base64url');
  return `${payload}.${signature}`;
}

function assertInvalidCursor(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof KnowledgeCursorError);
    assert.equal(error.code, 'invalid_cursor');
    assert.equal(error.message, 'invalid_cursor');
    return true;
  });
}

test('knowledge cursor: v1 envelope round-trips with canonical base64url HMAC', () => {
  const codec = createKnowledgeCursorCodec(ENV);
  const cursor = codec.encode({
    boundary: BOUNDARY,
    filter: FILTER,
    actor: ACTOR,
  });
  const [payload, signature, extra] = cursor.split('.');

  assert.equal(extra, undefined);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.match(signature, /^[A-Za-z0-9_-]+$/);
  assert.equal(
    Buffer.from(payload, 'base64url').toString('base64url'),
    payload,
  );
  assert.equal(
    Buffer.from(signature, 'base64url').toString('base64url'),
    signature,
  );

  const envelope = decodeEnvelope(cursor);
  assert.deepEqual(Object.keys(envelope).sort(), [
    'actorScopeFingerprint',
    'filterHash',
    'id',
    'updatedAt',
    'v',
  ]);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.updatedAt, BOUNDARY.updatedAt.toISOString());
  assert.equal(envelope.id, BOUNDARY.id);
  assert.match(envelope.filterHash, /^[a-f0-9]{64}$/);
  assert.match(envelope.actorScopeFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(envelope), /sensitive-value/);

  assert.deepEqual(codec.decode({ cursor, filter: FILTER, actor: ACTOR }), {
    updatedAt: BOUNDARY.updatedAt,
    id: BOUNDARY.id,
  });
});

test('knowledge cursor: filter hashing uses stable recursively sorted JSON keys', () => {
  const reorderedFilter = {
    limit: 50,
    facets: ['status', 'label'],
    status: 'processed',
    sourceType: 'web',
    labels: {
      not: [{ includeDescendants: false, id: 'label-2' }],
      all: [],
      any: [{ includeDescendants: true, id: 'label-1' }],
    },
  };

  assert.equal(
    hashKnowledgeCursorFilter(reorderedFilter),
    hashKnowledgeCursorFilter(FILTER),
  );
});

test('knowledge cursor: actor fingerprint is domain-separated and canonicalizes group scope', () => {
  const secret = Buffer.from(SECRET, 'utf8');
  const reorderedActor = {
    userId: ACTOR.userId,
    organizationId: ACTOR.organizationId,
    groupAccountIds: [
      'group-a-sensitive',
      'group-b-sensitive',
      'group-a-sensitive',
    ],
  };
  const fingerprint = fingerprintKnowledgeCursorActor(ACTOR, secret);

  assert.equal(
    fingerprintKnowledgeCursorActor(reorderedActor, secret),
    fingerprint,
  );
  assert.notEqual(
    fingerprintKnowledgeCursorActor(
      { ...ACTOR, organizationId: undefined },
      secret,
    ),
    fingerprint,
  );
  assert.notEqual(
    fingerprintKnowledgeCursorActor({ ...ACTOR, userId: 'other-user' }, secret),
    fingerprint,
  );
  assert.notEqual(
    fingerprint,
    createHmac('sha256', secret)
      .update(
        JSON.stringify({
          userId: ACTOR.userId,
          organizationId: ACTOR.organizationId,
          groupAccountIds: [...ACTOR.groupAccountIds].sort(),
        }),
      )
      .digest('hex'),
  );
});

test('knowledge cursor: reordered and duplicate actor groups retain cursor scope', () => {
  const codec = createKnowledgeCursorCodec(ENV);
  const cursor = codec.encode({
    boundary: BOUNDARY,
    filter: FILTER,
    actor: ACTOR,
  });

  assert.deepEqual(
    codec.decode({
      cursor,
      filter: FILTER,
      actor: {
        ...ACTOR,
        groupAccountIds: [
          'group-a-sensitive',
          'group-b-sensitive',
          'group-a-sensitive',
        ],
      },
    }),
    BOUNDARY,
  );
});

test('knowledge cursor: malformed, noncanonical, and tampered values share invalid_cursor', () => {
  const codec = createKnowledgeCursorCodec(ENV);
  const valid = codec.encode({
    boundary: BOUNDARY,
    filter: FILTER,
    actor: ACTOR,
  });
  const [payload, signature] = valid.split('.');
  const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;

  for (const cursor of [
    '',
    payload,
    `${payload}.${signature}.extra`,
    `${payload}=.${signature}`,
    `${payload}.${signature}=`,
    `${payload}.A`,
    `A.${signature}`,
    `${payload}.${tamperedSignature}`,
  ]) {
    assertInvalidCursor(() =>
      codec.decode({ cursor, filter: FILTER, actor: ACTOR }),
    );
  }
});

test('knowledge cursor: envelope schema and boundary values are strict', () => {
  const codec = createKnowledgeCursorCodec(ENV);
  const envelope = decodeEnvelope(
    codec.encode({ boundary: BOUNDARY, filter: FILTER, actor: ACTOR }),
  );
  const invalidEnvelopes = [
    { ...envelope, v: 2 },
    { ...envelope, extra: true },
    { ...envelope, updatedAt: '2026-08-05T01:02:03Z' },
    { ...envelope, updatedAt: '2026-02-30T01:02:03.456Z' },
    { ...envelope, id: '' },
    { ...envelope, filterHash: envelope.filterHash.toUpperCase() },
    { ...envelope, actorScopeFingerprint: '0'.repeat(63) },
  ];

  for (const invalidEnvelope of invalidEnvelopes) {
    assertInvalidCursor(() =>
      codec.decode({
        cursor: signEnvelope(invalidEnvelope),
        filter: FILTER,
        actor: ACTOR,
      }),
    );
  }
});

test('knowledge cursor: filter and actor scope mismatches are indistinguishable', () => {
  const codec = createKnowledgeCursorCodec(ENV);
  const cursor = codec.encode({
    boundary: BOUNDARY,
    filter: FILTER,
    actor: ACTOR,
  });

  assertInvalidCursor(() =>
    codec.decode({
      cursor,
      filter: { ...FILTER, limit: 51 },
      actor: ACTOR,
    }),
  );
  assertInvalidCursor(() =>
    codec.decode({
      cursor,
      filter: FILTER,
      actor: { ...ACTOR, organizationId: 'other-org' },
    }),
  );
});

test('knowledge cursor: invalid encode boundaries share invalid_cursor', () => {
  const codec = createKnowledgeCursorCodec(ENV);

  assertInvalidCursor(() =>
    codec.encode({
      boundary: { updatedAt: new Date(Number.NaN), id: BOUNDARY.id },
      filter: FILTER,
      actor: ACTOR,
    }),
  );
  assertInvalidCursor(() =>
    codec.encode({
      boundary: { updatedAt: BOUNDARY.updatedAt, id: '' },
      filter: FILTER,
      actor: ACTOR,
    }),
  );
});

test('knowledge cursor: non-production missing secret is stable for the process lifetime', () => {
  const issuer = createKnowledgeCursorCodec({ NODE_ENV: 'test' });
  const verifier = createKnowledgeCursorCodec({ NODE_ENV: 'development' });
  const cursor = issuer.encode({
    boundary: BOUNDARY,
    filter: FILTER,
    actor: ACTOR,
  });

  assert.deepEqual(
    verifier.decode({ cursor, filter: FILTER, actor: ACTOR }),
    BOUNDARY,
  );
});

test('knowledge cursor: configured short secret and production missing secret fail closed', () => {
  assert.throws(
    () =>
      createKnowledgeCursorCodec({
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET: 'short',
      }),
    /KNOWLEDGE_CURSOR_SIGNING_SECRET/,
  );
  assert.throws(
    () => createKnowledgeCursorCodec({ NODE_ENV: 'production' }),
    /KNOWLEDGE_CURSOR_SIGNING_SECRET/,
  );
});
