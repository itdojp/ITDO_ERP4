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
    OR: [
      { body: { contains: 'synthetic', mode: 'insensitive' } },
      {
        threadReplies: {
          some: {
            deletedAt: null,
            body: { contains: 'synthetic', mode: 'insensitive' },
          },
        },
      },
    ],
  });
  assert.equal(calls[0][1].take, 50);
  assert.deepEqual(
    result.map((entry) => entry.replyCount),
    [1, 0],
  );
});

test('reply creation rechecks the active root, same room, and post ACL in one transaction', async () => {
  const calls = [];
  const createdRow = {
    ...root('reply-1'),
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
  };
  delete createdRow._count;
  delete createdRow.threadReplies;
  const tx = {
    async $queryRaw(query) {
      if (/FROM "ChatMessage" AS root/.test(query.text)) {
        calls.push(['rootLock', query]);
        return [{ id: 'root-1', roomId: 'room-1' }];
      }
      if (/FROM "ChatRoom" AS room/.test(query.text)) {
        calls.push(['roomLock', query]);
        return [{ id: 'room-1' }];
      }
      if (/FROM "ChatRoomMember" AS member/.test(query.text)) {
        calls.push(['memberLock', query]);
        return [{ id: 'member-1' }];
      }
      throw new Error(`Unexpected lock query: ${query.text}`);
    },
    chatMessage: {
      async create(input) {
        calls.push(['create', input]);
        return createdRow;
      },
    },
    chatRoom: {
      async findUnique() {
        calls.push(['accessRoom']);
        return {
          id: 'room-1',
          type: 'project',
          projectId: 'project-1',
          isOfficial: true,
          groupId: null,
          viewerGroupIds: null,
          posterGroupIds: null,
          deletedAt: null,
          allowExternalUsers: false,
        };
      },
    },
    chatAckRequest: { findMany: async () => [] },
    chatAck: { findMany: async () => [] },
    chatAttachment: { findMany: async () => [] },
  };
  const host = {
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, 'ReadCommitted');
      return operation(tx);
    },
  };
  const repository = createPrismaChatThreadRepository(host);
  const result = await repository.createReply({
    rootMessageId: 'root-1',
    expectedRoomId: 'room-1',
    actor: {
      userId: 'user-1',
      roles: ['user'],
      projectIds: ['project-1'],
      groupIds: [],
      groupAccountIds: [],
    },
    draft: {
      body: 'Synthetic reply',
      mentions: {},
      mentionsAll: false,
    },
  });
  assert.equal(result.message.parentMessageId, 'root-1');
  assert.equal(result.message.threadRootId, 'root-1');
  assert.deepEqual(
    calls.slice(0, 5).map(([kind]) => kind),
    ['rootLock', 'roomLock', 'memberLock', 'accessRoom', 'create'],
  );
  const [rootLock, roomLock, memberLock] = calls;
  assert.match(rootLock[1].text, /FROM "ChatMessage" AS root/);
  assert.match(rootLock[1].text, /root\."parentMessageId" IS NULL/);
  assert.match(rootLock[1].text, /root\."threadRootId" IS NULL/);
  assert.match(rootLock[1].text, /root\."deletedAt" IS NULL/);
  assert.match(rootLock[1].text, /FOR UPDATE/);
  assert.deepEqual(rootLock[1].values, ['root-1']);
  assert.match(roomLock[1].text, /FROM "ChatRoom" AS room/);
  assert.match(roomLock[1].text, /room\."deletedAt" IS NULL/);
  assert.match(roomLock[1].text, /FOR SHARE/);
  assert.deepEqual(roomLock[1].values, ['room-1']);
  assert.match(memberLock[1].text, /FROM "ChatRoomMember" AS member/);
  assert.match(memberLock[1].text, /member\."deletedAt" IS NULL/);
  assert.match(memberLock[1].text, /FOR SHARE/);
  assert.deepEqual(memberLock[1].values, ['room-1', 'user-1']);
  assert.equal(calls[4][1].data.roomId, 'room-1');
  assert.equal(calls[4][1].data.parentMessageId, 'root-1');
});

test('reply creation fails closed after locks when the root, room, or current post ACL is unavailable', async () => {
  for (const testCase of [
    { label: 'missing root', rootRows: [] },
    { label: 'inactive room', roomRows: [] },
    { label: 'stale post ACL', accessProjectId: 'project-2' },
  ]) {
    let created = false;
    const calls = [];
    const tx = {
      async $queryRaw(query) {
        if (/FROM "ChatMessage" AS root/.test(query.text)) {
          calls.push('rootLock');
          return testCase.rootRows ?? [{ id: 'root-1', roomId: 'room-1' }];
        }
        if (/FROM "ChatRoom" AS room/.test(query.text)) {
          calls.push('roomLock');
          return testCase.roomRows ?? [{ id: 'room-1' }];
        }
        if (/FROM "ChatRoomMember" AS member/.test(query.text)) {
          calls.push('memberLock');
          return [{ id: 'member-1' }];
        }
        throw new Error(`Unexpected lock query: ${query.text}`);
      },
      chatMessage: {
        create: async () => {
          created = true;
          return root('unexpected');
        },
      },
      chatRoom: {
        findUnique: async () => ({
          id: 'room-1',
          type: 'project',
          projectId: testCase.accessProjectId ?? 'project-1',
          isOfficial: true,
          groupId: null,
          viewerGroupIds: null,
          posterGroupIds: null,
          deletedAt: null,
          allowExternalUsers: false,
        }),
      },
    };
    const repository = createPrismaChatThreadRepository({
      $transaction: async (operation) => operation(tx),
    });
    const result = await repository.createReply({
      rootMessageId: 'root-1',
      expectedRoomId: 'room-1',
      actor: {
        userId: 'user-1',
        roles: ['user'],
        projectIds: ['project-1'],
        groupIds: [],
        groupAccountIds: [],
      },
      draft: { body: 'Synthetic', mentions: {}, mentionsAll: false },
    });
    assert.equal(result, null, testCase.label);
    assert.equal(created, false, testCase.label);
    if (testCase.label === 'stale post ACL') {
      assert.deepEqual(calls, ['rootLock', 'roomLock', 'memberLock']);
    }
  }
});

test('reply creation normalizes a concurrent root-state check violation', async () => {
  const repository = createPrismaChatThreadRepository({
    async $transaction() {
      throw {
        code: 'P2004',
        meta: {
          database_error: {
            code: '23514',
            message:
              'chat reply parent must be an active root in the same room',
            constraint: 'ChatMessage_reply_parent_active_root',
          },
        },
      };
    },
  });
  const result = await repository.createReply({
    rootMessageId: 'root-1',
    actor: {
      userId: 'user-1',
      roles: ['user'],
      projectIds: [],
      groupIds: [],
      groupAccountIds: [],
    },
    draft: { body: 'Synthetic', mentions: {}, mentionsAll: false },
  });
  assert.equal(result, null);
});

test('reply creation recognizes the Prisma string form of the active-root constraint', async () => {
  const repository = createPrismaChatThreadRepository({
    async $transaction() {
      throw {
        code: 'P2004',
        meta: {
          database_error:
            'ERROR: chat reply parent must be an active root in the same room (SQLSTATE 23514, CONSTRAINT ChatMessage_reply_parent_active_root)',
        },
      };
    },
  });
  const result = await repository.createReply({
    rootMessageId: 'root-1',
    actor: {
      userId: 'user-1',
      roles: ['user'],
      projectIds: [],
      groupIds: [],
      groupAccountIds: [],
    },
    draft: { body: 'Synthetic', mentions: {}, mentionsAll: false },
  });
  assert.equal(result, null);
});

test('reply creation recognizes the Prisma adapter top-level active-root error', async () => {
  const repository = createPrismaChatThreadRepository({
    async $transaction() {
      throw new Error(
        'Invalid prisma.chatMessage.create() invocation: Database error. Code: 23514. Message: chat reply parent must be an active root in the same room',
      );
    },
  });
  const result = await repository.createReply({
    rootMessageId: 'root-1',
    actor: {
      userId: 'user-1',
      roles: ['user'],
      projectIds: [],
      groupIds: [],
      groupAccountIds: [],
    },
    draft: { body: 'Synthetic', mentions: {}, mentionsAll: false },
  });
  assert.equal(result, null);
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
