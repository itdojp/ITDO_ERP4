import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatRootTimelineMessageResponse,
  chatThreadMessageResponse,
} from '../dist/routes/chatThreadResponses.js';

const now = new Date('2026-08-08T00:00:00.000Z');

function message(overrides = {}) {
  return {
    id: 'message-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'user-1',
    body: 'Synthetic body',
    tags: ['tag'],
    reactions: { like: ['user-2'] },
    mentions: { userIds: ['user-2'] },
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

test('thread response exposes only the explicit additive topology contract', () => {
  const response = chatThreadMessageResponse(message());
  assert.deepEqual(Object.keys(response).sort(), [
    'ackRequest',
    'attachments',
    'body',
    'createdAt',
    'createdBy',
    'deleted',
    'deletedAt',
    'deletedReason',
    'id',
    'mentions',
    'mentionsAll',
    'messageType',
    'parentMessageId',
    'reactions',
    'roomId',
    'tags',
    'threadRootId',
    'updatedAt',
    'updatedBy',
    'userId',
  ]);
  assert.equal(response.createdAt, now.toISOString());
});

test('deleted thread placeholder contains no message content or child resources', () => {
  const response = chatThreadMessageResponse(
    message({
      body: null,
      tags: null,
      reactions: null,
      mentions: null,
      deletedAt: now,
      deletedReason: 'author_deleted',
    }),
  );
  assert.equal(response.deleted, true);
  assert.equal(response.body, null);
  assert.equal(response.tags, null);
  assert.equal(response.reactions, null);
  assert.equal(response.mentions, null);
  assert.deepEqual(response.attachments, []);
  assert.equal(response.ackRequest, null);
});

test('root timeline keeps the old response shape additive and omits thread-only deleted flag', () => {
  const response = chatRootTimelineMessageResponse({
    ...message(),
    replyCount: 2,
    lastReplyAt: new Date('2026-08-08T00:02:00.000Z'),
  });
  assert.equal(Object.hasOwn(response, 'deleted'), false);
  assert.equal(response.replyCount, 2);
  assert.equal(response.lastReplyAt, '2026-08-08T00:02:00.000Z');
});
