import assert from 'node:assert/strict';
import test from 'node:test';

import { createPrismaChatThreadRepository } from '../dist/adapters/chat/prismaChatThreadAdapter.js';

const now = new Date('2026-08-08T00:00:00.000Z');

function root(id, replies = []) {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'user-1',
    body: `Synthetic ${id}`,
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
    _count: { threadReplies: replies.length },
    threadReplies: replies.map((createdAt) => ({ createdAt })),
  };
}

test('root timeline applies root/deletion predicates before the bounded query without N+1 calls', async () => {
  const calls = [];
  const rows = [
    root('root-1', [new Date('2026-08-08T00:01:00.000Z')]),
    root('root-2'),
  ];
  const tx = {
    chatMessage: {
      async findMany(input) {
        calls.push(['roots', input]);
        return rows;
      },
      async groupBy() {
        calls.push(['aggregates']);
        return [
          {
            threadRootId: 'root-1',
            _count: { _all: 1 },
            _max: { createdAt: new Date('2026-08-08T00:01:00.000Z') },
          },
        ];
      },
    },
    chatAckRequest: {
      async findMany() {
        calls.push(['ackRequests']);
        return [];
      },
    },
    chatAck: {
      async findMany() {
        throw new Error('ack rows must not be queried without requests');
      },
    },
    chatAttachment: {
      async findMany() {
        calls.push(['attachments']);
        return [];
      },
    },
  };
  const host = {
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return operation(tx);
    },
  };
  const repository = createPrismaChatThreadRepository(host);
  const result = await repository.listRootTimeline({
    roomId: 'room-1',
    limit: 50,
    before: new Date('2026-08-09T00:00:00.000Z'),
    tag: 'tag-a',
    query: 'synthetic',
  });
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['roots', 'ackRequests', 'attachments', 'aggregates'],
  );
  assert.deepEqual(calls[0][1].where, {
    roomId: 'room-1',
    parentMessageId: null,
    threadRootId: null,
    deletedAt: null,
    createdAt: { lt: new Date('2026-08-09T00:00:00.000Z') },
    tags: { array_contains: ['tag-a'] },
    body: { contains: 'synthetic', mode: 'insensitive' },
  });
  assert.equal(calls[0][1].take, 50);
  assert.deepEqual(
    result.map((entry) => entry.replyCount),
    [1, 0],
  );
});

test('thread page uses one read snapshot for identity, access, root, and replies', async () => {
  const calls = [];
  const rootRow = root('root-1', [new Date('2026-08-08T00:01:00.000Z')]);
  const replyRow = {
    ...root('reply-1'),
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
  };
  delete replyRow._count;
  delete replyRow.threadReplies;
  const tx = {
    chatMessage: {
      async findUnique(input) {
        calls.push(['identity', input]);
        return {
          id: 'root-1',
          roomId: 'room-1',
          parentMessageId: null,
          threadRootId: null,
        };
      },
      async findFirst(input) {
        calls.push(['root', input]);
        return rootRow;
      },
      async findMany(input) {
        calls.push(['replies', input]);
        return [replyRow];
      },
      async groupBy() {
        calls.push(['aggregates']);
        return [
          {
            threadRootId: 'root-1',
            _count: { _all: 1 },
            _max: { createdAt: new Date('2026-08-08T00:01:00.000Z') },
          },
        ];
      },
    },
    chatRoom: {
      async findUnique() {
        calls.push(['room']);
        return {
          id: 'room-1',
          type: 'company',
          projectId: null,
          isOfficial: true,
          groupId: null,
          viewerGroupIds: null,
          posterGroupIds: null,
          deletedAt: null,
          allowExternalUsers: false,
        };
      },
    },
    chatAckRequest: {
      async findMany() {
        calls.push(['ackRequests']);
        return [];
      },
    },
    chatAck: {
      async findMany() {
        throw new Error('ack rows must not be queried without requests');
      },
    },
    chatAttachment: {
      async findMany() {
        calls.push(['attachments']);
        return [];
      },
    },
  };
  const host = {
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return operation(tx);
    },
  };
  const repository = createPrismaChatThreadRepository(host);
  const result = await repository.withReadSnapshot(async (snapshot) => {
    const identity = await snapshot.resolveMessage('root-1');
    assert.equal(identity.id, 'root-1');
    assert.equal(
      await snapshot.canReadRoom('room-1', {
        userId: 'user-1',
        roles: ['user'],
        projectIds: [],
        groupIds: [],
        groupAccountIds: [],
      }),
      true,
    );
    return snapshot.readThread({
      roomId: 'room-1',
      rootMessageId: 'root-1',
      limit: 10,
    });
  });
  assert.equal(result.root.id, 'root-1');
  assert.equal(result.replies.length, 1);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      'identity',
      'room',
      'root',
      'replies',
      'ackRequests',
      'attachments',
      'aggregates',
    ],
  );
});
