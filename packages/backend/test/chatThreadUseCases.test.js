import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatThreadCursorError } from '../dist/application/chat/chatThreadCursor.js';
import { createChatThreadService } from '../dist/application/chat/chatThreadUseCases.js';

const now = new Date('2026-08-08T00:00:00.000Z');
const actor = {
  userId: 'user-1',
  roles: ['user'],
  projectIds: ['project-1'],
  groupIds: [],
  groupAccountIds: [],
};

function message(overrides = {}) {
  return {
    id: 'root-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'user-1',
    body: 'Synthetic body',
    tags: null,
    reactions: null,
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: now,
    createdBy: 'user-1',
    updatedAt: now,
    updatedBy: 'user-1',
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  };
}

function harness(overrides = {}) {
  const state = { snapshots: 0, decoded: [], encoded: [] };
  const root = message();
  const replies = [
    message({
      id: 'reply-1',
      parentMessageId: root.id,
      threadRootId: root.id,
      createdAt: new Date('2026-08-08T00:01:00.000Z'),
    }),
  ];
  const repository = {
    listRootTimeline: async () => [],
    async withReadSnapshot(operation) {
      state.snapshots += 1;
      return operation({
        resolveMessage: async () => ({
          id: root.id,
          roomId: root.roomId,
          parentMessageId: null,
          threadRootId: null,
        }),
        canReadRoom: async () => true,
        readThread: async () => ({
          root,
          replies,
          replyCount: 2,
          lastReplyAt: replies[0].createdAt,
          hasMore: true,
        }),
        ...overrides.repository,
      });
    },
  };
  const cursorCodec = {
    decode(input) {
      state.decoded.push(input);
      return { createdAt: now, id: 'previous-reply' };
    },
    encode(input) {
      state.encoded.push(input);
      return 'next-cursor';
    },
    ...overrides.cursorCodec,
  };
  return {
    state,
    service: createChatThreadService({ repository, cursorCodec }),
  };
}

test('chat thread resolves root and creates an actor/root-bound next cursor in one snapshot', async () => {
  const { service, state } = harness();
  const result = await service.getThread({
    actor: { ...actor, roles: ['user', 'user'] },
    messageId: ' root-1 ',
    limit: 25,
    cursor: 'previous-cursor',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.nextCursor, 'next-cursor');
  assert.equal(state.snapshots, 1);
  assert.equal(state.decoded[0].rootMessageId, 'root-1');
  assert.deepEqual(state.decoded[0].actor.roles, ['user']);
  assert.deepEqual(state.encoded[0].boundary, {
    createdAt: new Date('2026-08-08T00:01:00.000Z'),
    id: 'reply-1',
  });
});

test('chat thread accepts a reply ID but binds reads and cursors to its root', async () => {
  const { service, state } = harness({
    repository: {
      resolveMessage: async () => ({
        id: 'reply-1',
        roomId: 'room-1',
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
      }),
    },
  });
  const result = await service.getThread({
    actor,
    messageId: 'reply-1',
    cursor: 'cursor',
  });
  assert.equal(result.ok, true);
  assert.equal(state.decoded[0].rootMessageId, 'root-1');
  assert.equal(state.encoded[0].rootMessageId, 'root-1');
});

test('chat thread normalizes missing, unauthorized, and malformed topology to not_found', async () => {
  for (const repository of [
    { resolveMessage: async () => null },
    { canReadRoom: async () => false },
    {
      resolveMessage: async () => ({
        id: 'broken',
        roomId: 'room-1',
        parentMessageId: 'root-1',
        threadRootId: null,
      }),
    },
    { readThread: async () => null },
  ]) {
    const { service } = harness({ repository });
    assert.deepEqual(await service.getThread({ actor, messageId: 'id' }), {
      ok: false,
      reason: 'not_found',
    });
  }
});

test('chat thread normalizes signed cursor errors without querying the thread page', async () => {
  let reads = 0;
  const { service } = harness({
    cursorCodec: {
      decode() {
        throw new ChatThreadCursorError();
      },
    },
    repository: {
      readThread: async () => {
        reads += 1;
        return null;
      },
    },
  });
  assert.deepEqual(
    await service.getThread({ actor, messageId: 'root-1', cursor: 'bad' }),
    { ok: false, reason: 'invalid_cursor' },
  );
  assert.equal(reads, 0);
});

test('chat thread does not emit a cursor when the page is complete', async () => {
  const { service, state } = harness({
    repository: {
      readThread: async () => ({
        root: message(),
        replies: [],
        replyCount: 0,
        lastReplyAt: null,
        hasMore: false,
      }),
    },
  });
  const result = await service.getThread({ actor, messageId: 'root-1' });
  assert.equal(result.ok, true);
  assert.equal(result.value.nextCursor, null);
  assert.equal(state.encoded.length, 0);
});
