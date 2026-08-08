import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatReactionService } from '../dist/application/chat/chatReactionService.js';

const actor = {
  userId: ' user-1 ',
  roles: [' user ', 'user'],
  projectIds: [' project-1 ', 'project-1'],
  groupIds: [' group-1 '],
  groupAccountIds: [' group-account-1 '],
};

function harness(options = {}) {
  const calls = [];
  const updates = [];
  let transactionActive = false;
  const transaction = {
    async $queryRaw(query) {
      assert.equal(transactionActive, true);
      if (/FROM "ChatMessage" AS message/.test(query.text)) {
        calls.push(['messageLock', query]);
        return (
          options.lockedRows ?? [
            {
              id: options.messageId ?? 'root-1',
              roomId: 'room-1',
              reactions: options.reactions ?? null,
            },
          ]
        );
      }
      if (/FROM "ChatRoom" AS room/.test(query.text)) {
        calls.push(['roomLock', query]);
        return options.roomRows ?? [{ id: 'room-1' }];
      }
      if (/FROM "ChatRoomMember" AS member/.test(query.text)) {
        calls.push(['memberLock', query]);
        return (
          options.memberRows ?? [
            {
              id: 'member-1',
            },
          ]
        );
      }
      throw new Error(`Unexpected lock query: ${query.text}`);
    },
    chatMessage: {
      async update(input) {
        assert.equal(transactionActive, true);
        calls.push(['update', input]);
        updates.push(input);
        return { id: input.where.id };
      },
      async findUnique(input) {
        assert.equal(transactionActive, true);
        calls.push(['response', input]);
        const messageId = options.messageId ?? 'root-1';
        return (
          options.response ?? {
            id: messageId,
            roomId: 'room-1',
            messageType: 'text',
            parentMessageId: messageId.startsWith('reply') ? 'root-1' : null,
            threadRootId: messageId.startsWith('reply') ? 'root-1' : null,
            userId: 'user-2',
            body: 'Synthetic message',
            tags: null,
            mentions: null,
            mentionsAll: false,
            createdAt: new Date('2026-08-08T00:00:00.000Z'),
            createdBy: 'user-2',
            updatedAt: new Date('2026-08-08T00:00:01.000Z'),
            updatedBy: 'user-1',
            deletedAt: null,
            deletedReason: null,
          }
        );
      },
    },
  };
  const client = {
    async $transaction(operation, transactionOptions) {
      calls.push(['transaction', transactionOptions]);
      assert.equal(transactionActive, false);
      transactionActive = true;
      try {
        return await operation(transaction);
      } finally {
        transactionActive = false;
      }
    },
  };
  const ensureRoomAccess = async (input) => {
    assert.equal(transactionActive, true);
    calls.push(['access', input]);
    return options.accessAllowed === false
      ? { ok: false, reason: options.accessReason ?? 'forbidden_room_member' }
      : {
          ok: true,
          room: {
            id: input.roomId,
            type: 'company',
            isOfficial: true,
            groupId: null,
            deletedAt: null,
            allowExternalUsers: false,
          },
        };
  };
  return {
    calls,
    updates,
    service: createChatReactionService({ client, ensureRoomAccess }),
    transaction,
  };
}

test('add locks the active message and re-evaluates current read ACL in the same transaction', async () => {
  const { calls, service, transaction, updates } = harness({
    reactions: {
      '👍': { count: 1, userIds: ['user-2'] },
      malformed: { privatePayload: 'must not leave the service' },
    },
  });

  const result = await service.add({
    actor,
    messageId: ' root-1 ',
    emoji: ' 👍 ',
  });

  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      'transaction',
      'messageLock',
      'roomLock',
      'memberLock',
      'access',
      'update',
      'response',
    ],
  );
  assert.equal(calls[0][1].isolationLevel, 'ReadCommitted');
  const lockQuery = calls[1][1];
  assert.match(lockQuery.text, /FROM "ChatMessage" AS message/);
  assert.match(lockQuery.text, /message\."deletedAt" IS NULL/);
  assert.match(lockQuery.text, /FOR UPDATE/);
  assert.doesNotMatch(lockQuery.text, /"body"/);
  assert.deepEqual(lockQuery.values, ['root-1']);

  const roomLock = calls[2][1];
  assert.match(roomLock.text, /FROM "ChatRoom" AS room/);
  assert.match(roomLock.text, /room\."deletedAt" IS NULL/);
  assert.match(roomLock.text, /FOR SHARE/);
  assert.deepEqual(roomLock.values, ['room-1']);

  const membershipLock = calls[3][1];
  assert.match(membershipLock.text, /FROM "ChatRoomMember" AS member/);
  assert.match(membershipLock.text, /member\."deletedAt" IS NULL/);
  assert.match(membershipLock.text, /FOR SHARE/);
  assert.deepEqual(membershipLock.values, ['room-1', 'user-1']);

  const access = calls[4][1];
  assert.equal(access.client, transaction);
  assert.equal(access.roomId, 'room-1');
  assert.equal(access.userId, 'user-1');
  assert.equal(access.accessLevel, 'read');
  assert.deepEqual(access.roles, ['user']);
  assert.deepEqual(access.projectIds, ['project-1']);
  assert.deepEqual(access.groupIds, ['group-1']);
  assert.deepEqual(access.groupAccountIds, ['group-account-1']);

  assert.deepEqual(updates[0], {
    where: { id: 'root-1' },
    data: {
      reactions: {
        '👍': { count: 2, userIds: ['user-2', 'user-1'] },
        malformed: { privatePayload: 'must not leave the service' },
      },
      updatedBy: 'user-1',
    },
    select: { id: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.changed, true);
  assert.equal(result.value.message.id, 'root-1');
  assert.deepEqual(result.value.message.reactions, {
    '👍': { count: 2, userIds: ['user-1', 'user-2'] },
  });
  assert.deepEqual(Object.keys(result.value).sort(), ['changed', 'message']);
  assert.equal(JSON.stringify(result).includes('privatePayload'), false);
});

test('add treats root and reply IDs identically without topology filtering', async () => {
  for (const messageId of ['root-1', 'reply-1']) {
    const { calls, service } = harness({ messageId });
    const result = await service.add({ actor, messageId, emoji: '✅' });
    assert.equal(result.ok, true);
    assert.equal(result.value.message.id, messageId);
    const lockSql = calls.find(([kind]) => kind === 'messageLock')[1].text;
    assert.doesNotMatch(lockSql, /parentMessageId|threadRootId/);
  }
});

test('duplicate add is idempotent and does not write or inflate the count', async () => {
  const { calls, service, updates } = harness({
    reactions: {
      '👍': {
        count: 9,
        userIds: ['user-2', ' user-1 ', 'user-1'],
      },
    },
  });

  const result = await service.add({ actor, messageId: 'root-1', emoji: '👍' });

  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      'transaction',
      'messageLock',
      'roomLock',
      'memberLock',
      'access',
      'response',
    ],
  );
  assert.equal(updates.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.changed, false);
  assert.deepEqual(result.value.message.reactions, {
    '👍': { count: 9, userIds: ['user-1', 'user-2'] },
  });
});

test('legacy numeric counts retain unattributed reactions across add and remove', async () => {
  const added = harness({ reactions: { '👍': 4, '👏': 3 } });
  const addedResult = await added.service.add({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(addedResult.value.message.reactions, {
    '👍': { count: 5, userIds: ['user-1'] },
    '👏': 3,
  });

  const removed = harness({
    reactions: added.updates[0].data.reactions,
  });
  const removedResult = await removed.service.remove({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(removedResult.value.message.reactions, {
    '👍': { count: 4, userIds: [] },
    '👏': 3,
  });
});

test('legacy attributed arrays retain every actor when promoted by a mutation', async () => {
  const added = harness({
    reactions: {
      '👍': ['old-app-reactor', ' old-app-reactor '],
      '👏': ['untouched-old-app-reactor'],
    },
  });
  const addedResult = await added.service.add({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(added.updates[0].data.reactions, {
    '👍': {
      count: 2,
      userIds: ['old-app-reactor', 'user-1'],
    },
    '👏': ['untouched-old-app-reactor'],
  });
  assert.deepEqual(addedResult.value.message.reactions, {
    '👍': {
      count: 2,
      userIds: ['old-app-reactor', 'user-1'],
    },
    '👏': {
      count: 1,
      userIds: ['untouched-old-app-reactor'],
    },
  });

  const removed = harness({
    reactions: {
      '👍': ['old-app-reactor', 'user-1'],
    },
  });
  const removedResult = await removed.service.remove({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(removed.updates[0].data.reactions, {
    '👍': { count: 1, userIds: ['old-app-reactor'] },
  });
  assert.deepEqual(removedResult.value.message.reactions, {
    '👍': { count: 1, userIds: ['old-app-reactor'] },
  });
});

test('remove decrements only the actor reaction and removes an empty emoji entry', async () => {
  const retained = harness({
    reactions: {
      '👍': { count: 2, userIds: ['user-1', 'user-2'] },
      '✅': { count: 1, userIds: ['user-3'] },
    },
  });
  const retainedResult = await retained.service.remove({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(retainedResult.value.message.reactions, {
    '👍': { count: 1, userIds: ['user-2'] },
    '✅': { count: 1, userIds: ['user-3'] },
  });
  assert.equal(retainedResult.value.changed, true);

  const removed = harness({
    reactions: { '👍': { count: 1, userIds: ['user-1'] } },
  });
  const removedResult = await removed.service.remove({
    actor,
    messageId: 'root-1',
    emoji: '👍',
  });
  assert.deepEqual(removedResult.value.message.reactions, {});
  assert.deepEqual(removed.updates[0].data.reactions, {});
});

test('remove is idempotent when the actor has not added the reaction', async () => {
  const { service, updates } = harness({
    reactions: {
      '👍': { count: 3, userIds: ['user-2'] },
      // Legacy numeric entries have no actor attribution and cannot be removed.
      '✅': 4,
    },
  });

  for (const emoji of ['👍', '✅', '❌']) {
    const result = await service.remove({
      actor,
      messageId: 'root-1',
      emoji,
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.changed, false);
    assert.equal(result.value.message.reactions['✅'], 4);
  }
  assert.equal(updates.length, 0);
});

test('missing, deleted, and unauthorized messages share the sanitized not_found result', async () => {
  for (const testCase of [
    { label: 'missing', lockedRows: [] },
    // deleted rows are excluded by the lock query and are indistinguishable here.
    { label: 'deleted', lockedRows: [] },
    { label: 'inactive room', roomRows: [] },
    ...[
      'not_found',
      'forbidden_project',
      'forbidden_room_member',
      'forbidden_external_room',
    ].map((accessReason) => ({
      label: `unauthorized:${accessReason}`,
      accessAllowed: false,
      accessReason,
    })),
  ]) {
    const { calls, service, updates } = harness(testCase);
    assert.deepEqual(
      await service.add({ actor, messageId: 'message-1', emoji: '👍' }),
      { ok: false, reason: 'not_found' },
      testCase.label,
    );
    assert.equal(updates.length, 0, testCase.label);
    if (testCase.lockedRows) {
      assert.equal(
        calls.some(([kind]) => kind === 'access'),
        false,
        testCase.label,
      );
    }
  }
});

test('stale room ACL fails closed after message, room, and membership locks without mutation', async () => {
  const { calls, service, updates } = harness({ accessAllowed: false });
  assert.deepEqual(
    await service.add({ actor, messageId: 'reply-1', emoji: '👍' }),
    { ok: false, reason: 'not_found' },
  );
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['transaction', 'messageLock', 'roomLock', 'memberLock', 'access'],
  );
  assert.equal(updates.length, 0);
});

test('invalid reaction input is rejected before opening a transaction', async () => {
  const { calls, service } = harness();
  for (const emoji of ['', '   ', 'x'.repeat(17), '__proto__']) {
    assert.deepEqual(await service.add({ actor, messageId: 'root-1', emoji }), {
      ok: false,
      reason: 'invalid_reaction',
    });
  }
  assert.equal(calls.length, 0);

  assert.deepEqual(
    await service.add({ actor, messageId: ' '.repeat(3), emoji: '👍' }),
    { ok: false, reason: 'not_found' },
  );
  assert.equal(calls.length, 0);
});
