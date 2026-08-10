import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatKnowledgeShareSummaryResponse,
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
  assert.equal(Object.hasOwn(response, 'knowledgeShare'), false);
});

test('the dedicated summary response exposes only the compact posted/revoked allowlist while old responses stay unchanged', () => {
  for (const [status, version] of [
    ['posted', 2],
    ['revoked', 3],
  ]) {
    const knowledgeShare = {
      shareId: `share-${status}`,
      status,
      version,
      schemaVersion: 1,
      body: 'must not leak',
      selectedContent: 'must not leak',
      sourceKnowledgeItemId: 'source-sensitive',
      provider: 'provider-sensitive',
    };
    const threadResponse = chatThreadMessageResponse(
      message({ knowledgeShare }),
    );
    assert.equal(Object.hasOwn(threadResponse, 'knowledgeShare'), false);
    const root = {
      ...message({ knowledgeShare }),
      replyCount: 0,
      lastReplyAt: null,
    };
    const timelineResponse = chatRootTimelineMessageResponse(root);
    assert.equal(Object.hasOwn(timelineResponse, 'knowledgeShare'), false);
    assert.deepEqual(
      chatKnowledgeShareSummaryResponse({
        messageId: 'message-1',
        ...knowledgeShare,
      }),
      {
        messageId: 'message-1',
        shareId: `share-${status}`,
        status,
        version,
        schemaVersion: 1,
      },
    );
  }
});

test('dedicated summary response discards message content and internal source fields', () => {
  const response = chatKnowledgeShareSummaryResponse({
    messageId: 'message-1',
    shareId: 'share-posted',
    status: 'posted',
    version: 2,
    schemaVersion: 1,
    body: 'must not leak',
    sourceKnowledgeItemId: 'must not leak',
    provider: 'must not leak',
  });
  assert.deepEqual(response, {
    messageId: 'message-1',
    shareId: 'share-posted',
    status: 'posted',
    version: 2,
    schemaVersion: 1,
  });
  assert.equal(JSON.stringify(response).includes('must not leak'), false);
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
