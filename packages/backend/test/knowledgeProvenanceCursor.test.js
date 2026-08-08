import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKnowledgeProvenanceCursorCodec,
  KnowledgeProvenanceCursorError,
} from '../dist/application/knowledge/knowledgeProvenanceCursor.js';
import { knowledgeProvenanceLimits } from '../dist/application/knowledge/knowledgeProvenancePorts.js';

const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET:
    'knowledge-provenance-cursor-test-secret-0001',
};
const actor = {
  userId: 'account-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-2', 'group-1'],
};

test('provenance page cursor round-trips without exposing actor or parent IDs', () => {
  const codec = createKnowledgeProvenanceCursorCodec(env);
  const cursor = codec.encodePage({
    kind: 'annotations',
    parentId: 'item-private-1',
    actor,
    boundary: {
      updatedAt: new Date('2026-08-06T01:02:03.000Z'),
      id: 'annotation-1',
    },
  });
  assert.deepEqual(
    codec.decodePage({
      cursor,
      kind: 'annotations',
      parentId: 'item-private-1',
      actor: { ...actor, groupAccountIds: ['group-1', 'group-2'] },
    }),
    {
      updatedAt: new Date('2026-08-06T01:02:03.000Z'),
      id: 'annotation-1',
    },
  );
  assert.equal(cursor.includes('account-1'), false);
  assert.equal(cursor.includes('item-private-1'), false);
  assert.equal(cursor.includes('org-1'), false);
});

test('annotation cursors bind the active and include-deleted views separately', () => {
  const codec = createKnowledgeProvenanceCursorCodec(env);
  const cursor = codec.encodePage({
    kind: 'annotations_with_deleted',
    parentId: 'item-private-1',
    actor,
    boundary: {
      updatedAt: new Date('2026-08-06T01:02:03.000Z'),
      id: 'annotation-deleted-1',
    },
  });
  assert.deepEqual(
    codec.decodePage({
      cursor,
      kind: 'annotations_with_deleted',
      parentId: 'item-private-1',
      actor,
    }),
    {
      updatedAt: new Date('2026-08-06T01:02:03.000Z'),
      id: 'annotation-deleted-1',
    },
  );
  assert.throws(
    () =>
      codec.decodePage({
        cursor,
        kind: 'annotations',
        parentId: 'item-private-1',
        actor,
      }),
    KnowledgeProvenanceCursorError,
  );
});

test('provenance sequence cursor is bound to actor, resource, and parent', () => {
  const codec = createKnowledgeProvenanceCursorCodec(env);
  const cursor = codec.encodeSequence({
    kind: 'conversation_turns',
    parentId: 'conversation-1',
    actor,
    boundary: { sequence: 17, id: 'turn-17' },
  });
  assert.deepEqual(
    codec.decodeSequence({
      cursor,
      kind: 'conversation_turns',
      parentId: 'conversation-1',
      actor,
    }),
    { sequence: 17, id: 'turn-17' },
  );
  const maximumCursor = codec.encodeSequence({
    kind: 'synthesis_versions',
    parentId: 'synthesis-maximum',
    actor,
    boundary: { sequence: 2_147_483_647, id: 'version-maximum' },
  });
  assert.deepEqual(
    codec.decodeSequence({
      cursor: maximumCursor,
      kind: 'synthesis_versions',
      parentId: 'synthesis-maximum',
      actor,
    }),
    { sequence: 2_147_483_647, id: 'version-maximum' },
  );
  const oversizedCursor = codec.encodeSequence({
    kind: 'synthesis_versions',
    parentId: 'synthesis-maximum',
    actor,
    boundary: { sequence: 2_147_483_648, id: 'version-oversized' },
  });
  assert.throws(
    () =>
      codec.decodeSequence({
        cursor: oversizedCursor,
        kind: 'synthesis_versions',
        parentId: 'synthesis-maximum',
        actor,
      }),
    KnowledgeProvenanceCursorError,
  );
  const maximumId = 'i'.repeat(knowledgeProvenanceLimits.id);
  const maximumIdCursor = codec.encodeSequence({
    kind: 'conversation_turns',
    parentId: 'conversation-maximum-id',
    actor,
    boundary: { sequence: 18, id: maximumId },
  });
  assert.deepEqual(
    codec.decodeSequence({
      cursor: maximumIdCursor,
      kind: 'conversation_turns',
      parentId: 'conversation-maximum-id',
      actor,
    }),
    { sequence: 18, id: maximumId },
  );
  const oversizedIdCursor = codec.encodeSequence({
    kind: 'conversation_turns',
    parentId: 'conversation-maximum-id',
    actor,
    boundary: { sequence: 19, id: `${maximumId}i` },
  });
  assert.throws(
    () =>
      codec.decodeSequence({
        cursor: oversizedIdCursor,
        kind: 'conversation_turns',
        parentId: 'conversation-maximum-id',
        actor,
      }),
    KnowledgeProvenanceCursorError,
  );

  for (const input of [
    {
      cursor,
      kind: 'annotation_revisions',
      parentId: 'conversation-1',
      actor,
    },
    {
      cursor,
      kind: 'conversation_turns',
      parentId: 'conversation-2',
      actor,
    },
    {
      cursor,
      kind: 'conversation_turns',
      parentId: 'conversation-1',
      actor: { ...actor, groupAccountIds: ['different-group'] },
    },
  ]) {
    assert.throws(
      () => codec.decodeSequence(input),
      KnowledgeProvenanceCursorError,
    );
  }
});

test('provenance cursor rejects tampering, cross-sort decoding, and unknown fields', () => {
  const codec = createKnowledgeProvenanceCursorCodec(env);
  const cursor = codec.encodePage({
    kind: 'syntheses',
    actor,
    boundary: {
      updatedAt: new Date('2026-08-06T02:00:00.000Z'),
      id: 'synthesis-1',
    },
  });
  const [payload, signature] = cursor.split('.');
  const tampered = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`;
  assert.throws(
    () => codec.decodePage({ cursor: tampered, kind: 'syntheses', actor }),
    KnowledgeProvenanceCursorError,
  );
  assert.throws(
    () =>
      codec.decodeSequence({
        cursor,
        kind: 'syntheses',
        parentId: 'synthesis-1',
        actor,
      }),
    KnowledgeProvenanceCursorError,
  );
});

test('production requires a sufficiently long signing secret', () => {
  assert.throws(
    () => createKnowledgeProvenanceCursorCodec({ NODE_ENV: 'production' }),
    /required in production/,
  );
  assert.throws(
    () =>
      createKnowledgeProvenanceCursorCodec({
        NODE_ENV: 'production',
        KNOWLEDGE_CURSOR_SIGNING_SECRET: 'short',
      }),
    /at least 32 UTF-8 bytes/,
  );
});
