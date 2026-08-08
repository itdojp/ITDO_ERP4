import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChatThreadCursorError,
  createChatThreadCursorCodec,
} from '../dist/application/chat/chatThreadCursor.js';

const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET:
    'chat-thread-cursor-unit-test-secret-00000001',
};
const actor = {
  userId: 'user-1',
  roles: ['user', 'mgmt'],
  projectIds: ['project-1'],
  groupIds: ['group-1'],
  groupAccountIds: ['group-account-1'],
};
const boundary = {
  createdAt: new Date('2026-08-08T01:02:03.004Z'),
  id: 'reply-2',
};

function tamperLastCharacter(value) {
  const replacement = value.endsWith('A') ? 'B' : 'A';
  return `${value.slice(0, -1)}${replacement}`;
}

test('chat thread cursor round-trips without exposing actor, root, or reply identifiers', () => {
  const codec = createChatThreadCursorCodec(env);
  const cursor = codec.encode({
    actor,
    rootMessageId: 'root-private-id',
    boundary,
  });
  assert.deepEqual(
    codec.decode({ actor, rootMessageId: 'root-private-id', cursor }),
    boundary,
  );
  const decodedSegments = cursor
    .split('.')
    .slice(1)
    .map((segment) => Buffer.from(segment, 'base64url').toString('utf8'))
    .join('');
  assert.equal(decodedSegments.includes(actor.userId), false);
  assert.equal(decodedSegments.includes('root-private-id'), false);
  assert.equal(decodedSegments.includes(boundary.id), false);
  assert.equal(
    cursor.includes(Buffer.from(boundary.id).toString('base64url')),
    false,
  );
});

test('chat thread cursor canonicalizes actor scope ordering', () => {
  const codec = createChatThreadCursorCodec(env);
  const cursor = codec.encode({
    actor,
    rootMessageId: 'root-1',
    boundary,
  });
  assert.deepEqual(
    codec.decode({
      actor: {
        ...actor,
        roles: ['mgmt', 'user', 'user'],
        projectIds: ['project-1', 'project-1'],
      },
      rootMessageId: 'root-1',
      cursor,
    }),
    boundary,
  );
});

test('chat thread cursor rejects actor, root, signature, and shape mismatches', () => {
  const codec = createChatThreadCursorCodec(env);
  const cursor = codec.encode({
    actor,
    rootMessageId: 'root-1',
    boundary,
  });
  const inputs = [
    {
      actor: { ...actor, userId: 'outsider' },
      rootMessageId: 'root-1',
      cursor,
    },
    { actor, rootMessageId: 'root-2', cursor },
    { actor, rootMessageId: 'root-1', cursor: tamperLastCharacter(cursor) },
    {
      actor,
      rootMessageId: 'root-1',
      cursor: cursor.replace(/^v1\./, 'v2.'),
    },
    { actor, rootMessageId: 'root-1', cursor: 'not-a-cursor' },
  ];
  for (const input of inputs) {
    assert.throws(() => codec.decode(input), ChatThreadCursorError);
  }
});

test('chat thread cursor requires a production signing secret', () => {
  assert.throws(
    () => createChatThreadCursorCodec({ NODE_ENV: 'production' }),
    /KNOWLEDGE_CURSOR_SIGNING_SECRET is required/,
  );
  assert.throws(
    () =>
      createChatThreadCursorCodec({
        NODE_ENV: 'production',
        KNOWLEDGE_CURSOR_SIGNING_SECRET: 'too-short',
      }),
    /at least 32 UTF-8 bytes/,
  );
});
