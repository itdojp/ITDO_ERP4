import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getChatUnreadSummary,
  markChatAsRead,
} from '../dist/services/chatReadState.js';

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
  assert.equal(countWhere.roomId, 'room-1');
  assert.equal(countWhere.deletedAt, null);
  assert.equal(countWhere.createdAt, undefined);
});

test('getChatUnreadSummary includes gt filter when lastReadAt exists', async () => {
  const lastReadAt = new Date('2026-03-01T00:00:00.000Z');
  let countWhere = null;
  const client = {
    chatReadState: {
      findUnique: async () => ({ lastReadAt }),
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
  assert.deepEqual(countWhere.createdAt, { gt: lastReadAt });
});

test('markChatAsRead upserts and returns ISO timestamp', async () => {
  let upsertArgs = null;
  const at = new Date('2026-03-04T00:00:00.000Z');
  const client = {
    chatReadState: {
      upsert: async (args) => {
        upsertArgs = args;
        return { lastReadAt: at };
      },
    },
    chatMessage: { count: async () => 0 },
  };

  const result = await markChatAsRead({
    roomId: 'room-3',
    userId: 'user-3',
    at,
    client,
  });

  assert.equal(result.lastReadAt, '2026-03-04T00:00:00.000Z');
  assert.deepEqual(upsertArgs.where, {
    roomId_userId: { roomId: 'room-3', userId: 'user-3' },
  });
  assert.equal(upsertArgs.create.roomId, 'room-3');
  assert.equal(upsertArgs.create.userId, 'user-3');
  assert.equal(upsertArgs.update.lastReadAt, at);
});
