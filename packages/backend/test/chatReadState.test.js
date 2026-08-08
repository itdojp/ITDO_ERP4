import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getChatUnreadSummary,
  markChatAsRead,
} from '../dist/services/chatReadState.js';

function createReadStateClient(
  initialLastReadAt = null,
  initialLastReadMessageId = null,
  messages = [],
  initialLastReadActivitySequence = null,
) {
  let storedLastReadAt = initialLastReadAt
    ? new Date(initialLastReadAt.getTime())
    : null;
  let storedLastReadMessageId = initialLastReadMessageId;
  let storedLastReadActivitySequence = initialLastReadActivitySequence;
  let transactionCount = 0;
  const calls = {
    createMany: [],
    updateMany: [],
    findUnique: [],
    messageFindFirst: [],
  };
  const chatReadState = {
    async createMany(args) {
      calls.createMany.push(args);
      if (!storedLastReadAt) {
        storedLastReadAt = new Date(args.data.lastReadAt.getTime());
        storedLastReadMessageId = args.data.lastReadMessageId ?? null;
        storedLastReadActivitySequence =
          args.data.lastReadActivitySequence ?? null;
        return { count: 1 };
      }
      return { count: 0 };
    },
    async updateMany(args) {
      calls.updateMany.push(args);
      const nextAt = args.data.lastReadAt;
      const nextId = args.data.lastReadMessageId ?? null;
      const nextSequence = args.data.lastReadActivitySequence ?? null;
      const advances =
        storedLastReadAt &&
        (nextSequence !== null
          ? storedLastReadActivitySequence === null
            ? storedLastReadAt.getTime() <= nextAt.getTime()
            : storedLastReadActivitySequence < nextSequence
          : storedLastReadAt.getTime() < nextAt.getTime());
      if (advances) {
        storedLastReadAt = new Date(args.data.lastReadAt.getTime());
        storedLastReadMessageId = nextId;
        storedLastReadActivitySequence = nextSequence;
        return { count: 1 };
      }
      return { count: 0 };
    },
    async findUnique(args) {
      calls.findUnique.push(args);
      return storedLastReadAt
        ? {
            lastReadAt: new Date(storedLastReadAt.getTime()),
            lastReadMessageId: storedLastReadMessageId,
            lastReadActivitySequence: storedLastReadActivitySequence,
          }
        : null;
    },
  };
  const chatMessage = {
    async findFirst(args) {
      calls.messageFindFirst.push(args);
      return (
        messages.find(
          (message) =>
            message.id === args.where.id &&
            message.roomId === args.where.roomId &&
            message.deletedAt === null,
        ) ?? null
      );
    },
  };
  return {
    client: {
      chatReadState,
      chatMessage,
      async $transaction(callback) {
        transactionCount += 1;
        return callback({ chatReadState, chatMessage });
      },
    },
    calls,
    getStoredLastReadAt: () => storedLastReadAt,
    getStoredLastReadMessageId: () => storedLastReadMessageId,
    getStoredLastReadActivitySequence: () => storedLastReadActivitySequence,
    getTransactionCount: () => transactionCount,
  };
}

test('getChatUnreadSummary returns unread count without lastReadAt', async () => {
  let countWhere = null;
  const client = {
    chatReadState: {
      findUnique: async () => null,
    },
    chatMessage: {
      count: async ({ where }) => {
        countWhere = where;
        return 3;
      },
    },
  };

  const result = await getChatUnreadSummary({
    roomId: 'room-1',
    userId: 'user-1',
    client,
  });

  assert.equal(result.unreadCount, 3);
  assert.equal(result.lastReadAt, null);
  assert.equal(result.lastReadMessageId, null);
  assert.equal(countWhere.roomId, 'room-1');
  assert.equal(countWhere.deletedAt, null);
  assert.equal(countWhere.createdAt, undefined);
  assert.equal('parentMessageId' in countWhere, false);
  assert.equal('threadRootId' in countWhere, false);
});

test('getChatUnreadSummary uses the DB arrival sequence rather than UUID order', async () => {
  const lastReadAt = new Date('2026-03-01T00:00:00.000Z');
  let countWhere = null;
  const client = {
    chatReadState: {
      findUnique: async () => ({
        lastReadAt,
        lastReadMessageId: 'zzzz-random-uuid',
        lastReadActivitySequence: 42n,
      }),
    },
    chatMessage: {
      count: async ({ where }) => {
        countWhere = where;
        return 1;
      },
    },
  };

  const result = await getChatUnreadSummary({
    roomId: 'room-2',
    userId: 'user-2',
    client,
  });

  assert.equal(result.unreadCount, 1);
  assert.equal(result.lastReadAt, '2026-03-01T00:00:00.000Z');
  assert.equal(result.lastReadMessageId, 'zzzz-random-uuid');
  assert.deepEqual(countWhere.activitySequence, { gt: 42n });
  assert.equal(countWhere.createdAt, undefined);
});

test('markChatAsRead keeps legacy bodyless callers on server now', async () => {
  const state = createReadStateClient();
  const before = new Date();

  const result = await markChatAsRead({
    roomId: 'room-3',
    userId: 'user-3',
    client: state.client,
  });
  const after = new Date();
  const lastReadAt = new Date(result.lastReadAt);

  assert.ok(lastReadAt.getTime() >= before.getTime());
  assert.ok(lastReadAt.getTime() <= after.getTime());
  assert.equal(state.getTransactionCount(), 1);
  assert.equal(state.calls.createMany[0].data.roomId, 'room-3');
  assert.equal(state.calls.createMany[0].data.userId, 'user-3');
  assert.equal(state.calls.createMany[0].skipDuplicates, true);
  assert.equal(state.calls.createMany[0].data.lastReadMessageId, null);
  assert.equal(state.calls.createMany[0].data.lastReadActivitySequence, null);
  assert.equal(result.lastReadMessageId, null);
  assert.equal(
    state.calls.createMany[0].data.lastReadAt.getTime(),
    lastReadAt.getTime(),
  );
});

test('markChatAsRead uses an optional through high-water', async () => {
  const through = new Date('2026-03-04T00:00:00.000Z');
  const serverNow = new Date('2026-03-04T00:05:00.000Z');
  const state = createReadStateClient();

  const result = await markChatAsRead({
    roomId: 'room-through',
    userId: 'user-through',
    through,
    at: serverNow,
    client: state.client,
  });

  assert.equal(result.lastReadAt, through.toISOString());
  assert.equal(state.calls.createMany[0].data.lastReadAt, through);
  assert.equal(state.calls.updateMany[0].where.roomId, 'room-through');
  assert.equal(state.calls.updateMany[0].where.userId, 'user-through');
  assert.deepEqual(state.calls.updateMany[0].where.lastReadAt, {
    lt: through,
  });
  assert.equal(state.calls.updateMany[0].where.OR, undefined);
  assert.equal(state.calls.updateMany[0].data.lastReadAt, through);
  assert.equal(state.calls.updateMany[0].data.lastReadMessageId, null);
  assert.equal(state.calls.updateMany[0].data.lastReadActivitySequence, null);
});

test('markChatAsRead clamps a future through high-water to server now', async () => {
  const serverNow = new Date('2026-03-04T00:05:00.000Z');
  const future = new Date('2026-03-05T00:00:00.000Z');
  const state = createReadStateClient();

  const result = await markChatAsRead({
    roomId: 'room-future',
    userId: 'user-future',
    through: future,
    at: serverNow,
    client: state.client,
  });

  assert.equal(result.lastReadAt, serverNow.toISOString());
  assert.equal(state.calls.createMany[0].data.lastReadAt, serverNow);
  assert.equal(state.calls.updateMany[0].data.lastReadAt, serverNow);
});

test('markChatAsRead never moves lastReadAt backward', async () => {
  const existing = new Date('2026-03-04T00:04:00.000Z');
  const through = new Date('2026-03-04T00:03:00.000Z');
  const serverNow = new Date('2026-03-04T00:05:00.000Z');
  const state = createReadStateClient(existing);

  const result = await markChatAsRead({
    roomId: 'room-monotonic',
    userId: 'user-monotonic',
    through,
    at: serverNow,
    client: state.client,
  });

  assert.equal(result.lastReadAt, existing.toISOString());
  assert.equal(
    state.getStoredLastReadAt().toISOString(),
    existing.toISOString(),
  );
  assert.equal(state.calls.createMany[0].skipDuplicates, true);
});

test('markChatAsRead converges concurrent callers on the greatest high-water', async () => {
  const lower = new Date('2026-03-04T00:02:00.000Z');
  const higher = new Date('2026-03-04T00:04:00.000Z');
  const serverNow = new Date('2026-03-04T00:05:00.000Z');
  const state = createReadStateClient();

  const results = await Promise.all([
    markChatAsRead({
      roomId: 'room-concurrent',
      userId: 'user-concurrent',
      through: lower,
      at: serverNow,
      client: state.client,
    }),
    markChatAsRead({
      roomId: 'room-concurrent',
      userId: 'user-concurrent',
      through: higher,
      at: serverNow,
      client: state.client,
    }),
  ]);

  assert.ok(
    [lower.toISOString(), higher.toISOString()].includes(results[0].lastReadAt),
  );
  assert.equal(results[1].lastReadAt, higher.toISOString());
  assert.equal(state.getStoredLastReadAt().toISOString(), higher.toISOString());
  assert.equal(state.getTransactionCount(), 2);
});

test('markChatAsRead accepts an existing transaction client', async () => {
  const through = new Date('2026-03-04T00:01:00.000Z');
  const serverNow = new Date('2026-03-04T00:05:00.000Z');
  const state = createReadStateClient();

  const result = await markChatAsRead({
    roomId: 'room-tx',
    userId: 'user-tx',
    through,
    at: serverNow,
    client: {
      chatReadState: state.client.chatReadState,
      chatMessage: state.client.chatMessage,
    },
  });

  assert.equal(result.lastReadAt, through.toISOString());
  assert.equal(state.getTransactionCount(), 0);
});

test('same-millisecond messages use DB arrival sequence as the read boundary', async () => {
  const through = new Date('2026-03-04T00:01:00.123Z');
  const state = createReadStateClient(null, null, [
    {
      id: 'message-100',
      roomId: 'room-tie',
      createdAt: through,
      deletedAt: null,
      activitySequence: 100n,
    },
  ]);

  const result = await markChatAsRead({
    roomId: 'room-tie',
    userId: 'user-tie',
    through,
    throughMessageId: 'message-100',
    at: new Date('2026-03-04T00:02:00.000Z'),
    client: state.client,
  });

  assert.deepEqual(result, {
    lastReadAt: through.toISOString(),
    lastReadMessageId: 'message-100',
  });
  assert.equal(state.calls.messageFindFirst.length, 1);
  assert.equal(state.getStoredLastReadMessageId(), 'message-100');
  assert.equal(state.getStoredLastReadActivitySequence(), 100n);
  assert.deepEqual(state.calls.updateMany[0].where.OR, [
    {
      lastReadActivitySequence: null,
      lastReadAt: { lte: through },
    },
    { lastReadActivitySequence: { lt: 100n } },
  ]);
  assert.equal(state.calls.updateMany[0].data.lastReadActivitySequence, 100n);
});

test('message-bound read rejects a missing or timestamp-mismatched boundary', async () => {
  const through = new Date('2026-03-04T00:01:00.123Z');
  const state = createReadStateClient(null, null, [
    {
      id: 'message-other-time',
      roomId: 'room-boundary',
      createdAt: new Date('2026-03-04T00:01:00.124Z'),
      deletedAt: null,
    },
  ]);

  for (const throughMessageId of ['message-missing', 'message-other-time']) {
    await assert.rejects(
      markChatAsRead({
        roomId: 'room-boundary',
        userId: 'user-boundary',
        through,
        throughMessageId,
        at: new Date('2026-03-04T00:02:00.000Z'),
        client: state.client,
      }),
      { name: 'InvalidChatReadBoundaryError' },
    );
  }
  assert.equal(state.calls.createMany.length, 0);
});
