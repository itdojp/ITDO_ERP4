import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatMessageLifecycleService } from '../dist/services/chatMessageLifecycle.js';

const actor = {
  userId: 'user-1',
  roles: ['user'],
  projectIds: ['project-1'],
  groupIds: [],
  groupAccountIds: [],
};

function harness(overrides = {}) {
  const calls = [];
  const updates = [];
  let transactionActive = false;
  const defaultMessage = {
    id: 'reply-1',
    roomId: 'room-1',
    userId: 'user-1',
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
  };
  const tx = {
    async $queryRaw(query) {
      assert.equal(transactionActive, true);
      if (/FROM "ChatMessage" AS message/.test(query.text)) {
        calls.push(['messageLock', query]);
        return overrides.messageRows ?? [defaultMessage];
      }
      if (/FROM "ChatRoom" AS room/.test(query.text)) {
        calls.push(['roomLock', query]);
        return overrides.roomRows ?? [{ id: 'room-1' }];
      }
      if (/FROM "ChatRoomMember" AS member/.test(query.text)) {
        calls.push(['memberLock', query]);
        return overrides.memberRows ?? [{ id: 'member-1' }];
      }
      throw new Error(`Unexpected lock query: ${query.text}`);
    },
    chatMessage: {
      updateMany: async (input) => {
        calls.push(['update', input]);
        updates.push(input);
        return { count: 1 };
      },
      ...overrides.chatMessage,
    },
    chatRoom: {
      findUnique: async () => {
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
      ...overrides.chatRoom,
    },
  };
  const client = {
    async $transaction(operation, options) {
      calls.push(['transaction']);
      assert.equal(options.isolationLevel, 'ReadCommitted');
      assert.equal(transactionActive, false);
      transactionActive = true;
      try {
        return await operation(tx);
      } finally {
        transactionActive = false;
      }
    },
  };
  return {
    calls,
    updates,
    service: createChatMessageLifecycleService(client),
    tx,
  };
}

test('message author locks message, room, and membership before ACL and logical delete', async () => {
  const { calls, service, updates } = harness();
  const at = new Date('2026-08-08T01:00:00.000Z');
  const result = await service.deleteMessage({
    messageId: 'reply-1',
    actor,
    reason: 'user_retract',
    at,
  });
  assert.deepEqual(result, {
    id: 'reply-1',
    roomId: 'room-1',
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
    deletedAt: at,
    deletedReason: 'user_retract',
  });
  assert.deepEqual(updates[0].where, { id: 'reply-1', deletedAt: null });
  assert.equal(updates[0].data.deletedReason, 'user_retract');
  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      'transaction',
      'messageLock',
      'roomLock',
      'memberLock',
      'accessRoom',
      'update',
    ],
  );
  const messageLock = calls[1][1];
  assert.match(messageLock.text, /FROM "ChatMessage" AS message/);
  assert.match(messageLock.text, /message\."deletedAt" IS NULL/);
  assert.match(messageLock.text, /FOR UPDATE/);
  assert.deepEqual(messageLock.values, ['reply-1']);
  const roomLock = calls[2][1];
  assert.match(roomLock.text, /FROM "ChatRoom" AS room/);
  assert.match(roomLock.text, /room\."deletedAt" IS NULL/);
  assert.match(roomLock.text, /FOR SHARE/);
  assert.deepEqual(roomLock.values, ['room-1']);
  const memberLock = calls[3][1];
  assert.match(memberLock.text, /FROM "ChatRoomMember" AS member/);
  assert.match(memberLock.text, /member\."deletedAt" IS NULL/);
  assert.match(memberLock.text, /FOR SHARE/);
  assert.deepEqual(memberLock.values, ['room-1', 'user-1']);
});

test('moderation requires a moderator role while an outsider and a deleted row are hidden', async () => {
  const { service } = harness();
  assert.equal(
    await service.deleteMessage({
      messageId: 'reply-1',
      actor,
      reason: 'admin_moderation',
    }),
    null,
  );
  const outsider = harness({
    messageRows: [
      {
        id: 'reply-1',
        roomId: 'room-1',
        userId: 'user-2',
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
      },
    ],
  }).service;
  assert.equal(
    await outsider.deleteMessage({
      messageId: 'reply-1',
      actor,
      reason: 'user_retract',
    }),
    null,
  );
  const deleted = harness({
    // Deleted rows are excluded by the lock query and remain indistinguishable
    // from missing rows to callers.
    messageRows: [],
  }).service;
  assert.equal(
    await deleted.deleteMessage({
      messageId: 'reply-1',
      actor,
      reason: 'user_retract',
    }),
    null,
  );
});

test('stale room ACL fails closed after all locks without deleting the message', async () => {
  const { calls, service, updates } = harness({
    chatRoom: {
      findUnique: async () => {
        calls.push(['accessRoom']);
        return {
          id: 'room-1',
          type: 'project',
          projectId: 'project-2',
          isOfficial: true,
          groupId: null,
          viewerGroupIds: null,
          posterGroupIds: null,
          deletedAt: null,
          allowExternalUsers: false,
        };
      },
    },
  });
  assert.equal(
    await service.deleteMessage({
      messageId: 'reply-1',
      actor,
      reason: 'user_retract',
    }),
    null,
  );
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['transaction', 'messageLock', 'roomLock', 'memberLock', 'accessRoom'],
  );
  assert.equal(updates.length, 0);
});

test('admin can moderate an accessible message and a concurrent delete converges to not_found', async () => {
  const { service } = harness({
    chatMessage: { updateMany: async () => ({ count: 1 }) },
  });
  const admin_moderation = await service.deleteMessage({
    messageId: 'reply-1',
    actor: { ...actor, userId: 'admin-1', roles: ['admin'] },
    reason: 'admin_moderation',
  });
  assert.equal(admin_moderation.deletedReason, 'admin_moderation');

  const raced = harness({
    chatMessage: { updateMany: async () => ({ count: 0 }) },
  }).service;
  assert.equal(
    await raced.deleteMessage({
      messageId: 'reply-1',
      actor,
      reason: 'user_retract',
    }),
    null,
  );
});
