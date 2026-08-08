import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatAckMutationService } from '../dist/application/chat/chatAckMutationService.js';

const actor = {
  userId: ' user-1 ',
  roles: [' user ', 'user'],
  projectIds: [' project-1 '],
  groupIds: [' group-1 '],
  groupAccountIds: [' account-group-1 '],
};

function harness(options = {}) {
  const calls = [];
  let transactionActive = false;
  let canceledAt = options.canceledAt ?? null;
  let acks = [...(options.acks ?? [])];
  const request = () => ({
    id: 'ack-request-1',
    messageId: 'message-1',
    roomId: 'room-1',
    requiredUserIds: options.requiredUserIds ?? ['user-1'],
    requestedUserIds: null,
    requestedGroupIds: null,
    requestedRoles: null,
    dueAt: null,
    remindIntervalHours: null,
    escalationAfterHours: null,
    escalationUserIds: null,
    escalationGroupIds: null,
    escalationRoles: null,
    templateId: null,
    canceledAt,
    canceledBy: canceledAt ? 'user-1' : null,
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    createdBy: options.createdBy ?? 'author-1',
    acks: acks.map((ack, index) => ({
      id: ack.id ?? `ack-${index + 1}`,
      requestId: 'ack-request-1',
      userId: ack.userId,
      ackedAt: ack.ackedAt ?? new Date('2026-08-09T00:01:00.000Z'),
    })),
  });
  const tx = {
    async $queryRaw(query) {
      assert.equal(transactionActive, true);
      const sql = query.text;
      if (/FROM "ChatAckRequest"/.test(sql)) {
        calls.push(['lock-request', query]);
        return options.missingRequest
          ? []
          : [
              {
                id: 'ack-request-1',
                messageId: 'message-1',
                roomId: options.requestRoomId ?? 'room-1',
              },
            ];
      }
      if (/FROM "ChatMessage"/.test(sql)) {
        calls.push(['lock-message', query]);
        return options.missingMessage
          ? []
          : [{ id: 'message-1', roomId: 'room-1', userId: 'author-1' }];
      }
      if (/FROM "ChatRoom"/.test(sql)) {
        calls.push(['lock-room', query]);
        return options.missingRoom ? [] : [{ id: 'room-1' }];
      }
      if (/FROM "ChatRoomMember"/.test(sql)) {
        calls.push(['lock-member', query]);
        return options.memberMissing ? [] : [{ id: 'membership-1' }];
      }
      throw new Error(`Unexpected lock query: ${sql}`);
    },
    chatAckRequest: {
      async findUnique(input) {
        calls.push(['read-request', input]);
        return request();
      },
      async update(input) {
        calls.push(['cancel', input]);
        canceledAt = input.data.canceledAt;
        return { id: 'ack-request-1' };
      },
    },
    chatAck: {
      async create(input) {
        calls.push(['ack', input]);
        acks.push({ userId: input.data.userId });
        return { id: 'ack-created' };
      },
      async deleteMany(input) {
        calls.push(['revoke', input]);
        const before = acks.length;
        acks = acks.filter((ack) => ack.userId !== input.where.userId);
        return { count: before - acks.length };
      },
    },
  };
  const client = {
    async $transaction(operation, transactionOptions) {
      calls.push(['transaction', transactionOptions]);
      assert.equal(transactionActive, false);
      transactionActive = true;
      try {
        return await operation(tx);
      } finally {
        transactionActive = false;
      }
    },
  };
  const ensureRoomAccess = async (input) => {
    assert.equal(transactionActive, true);
    calls.push(['access', input]);
    return options.accessAllowed === false
      ? { ok: false, reason: 'forbidden_room_member' }
      : {
          ok: true,
          room: {
            id: 'room-1',
            type: 'private_group',
            isOfficial: false,
            groupId: null,
            deletedAt: null,
            allowExternalUsers: false,
          },
        };
  };
  return {
    calls,
    service: createChatAckMutationService({ client, ensureRoomAccess }),
  };
}

test('ack locks request, active message, room, and membership before current ACL and mutation', async () => {
  const { calls, service } = harness();
  const result = await service.acknowledge({
    requestId: ' ack-request-1 ',
    actor,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.changed, true);
  assert.equal(result.value.ackedCount, 1);
  assert.equal(result.value.request.acks[0].userId, 'user-1');
  assert.deepEqual(
    calls.map(([kind]) => kind),
    [
      'transaction',
      'lock-request',
      'lock-message',
      'lock-room',
      'lock-member',
      'access',
      'read-request',
      'ack',
      'read-request',
    ],
  );
  assert.equal(calls[0][1].isolationLevel, 'ReadCommitted');
  assert.match(calls[1][1].text, /FOR UPDATE/);
  assert.match(calls[2][1].text, /"deletedAt" IS NULL/);
  assert.match(calls[2][1].text, /FOR UPDATE/);
  assert.match(calls[3][1].text, /FOR SHARE/);
  assert.match(calls[4][1].text, /FOR SHARE/);
  assert.equal(calls[5][1].client, calls[5][1].client);
  assert.equal(calls[5][1].userId, 'user-1');
  assert.deepEqual(calls[5][1].roles, ['user']);
});

test('ack replay is idempotent while canceled and non-required mutations are rejected', async () => {
  const replay = harness({ acks: [{ userId: 'user-1' }] });
  const replayResult = await replay.service.acknowledge({
    requestId: 'ack-request-1',
    actor,
  });
  assert.equal(replayResult.ok, true);
  assert.equal(replayResult.value.changed, false);
  assert.equal(
    replay.calls.some(([kind]) => kind === 'ack'),
    false,
  );

  assert.deepEqual(
    await harness({ canceledAt: new Date() }).service.acknowledge({
      requestId: 'ack-request-1',
      actor,
    }),
    { ok: false, reason: 'canceled' },
  );
  assert.deepEqual(
    await harness({ requiredUserIds: ['other-user'] }).service.acknowledge({
      requestId: 'ack-request-1',
      actor,
    }),
    { ok: false, reason: 'not_required' },
  );
});

test('missing, deleted, inaccessible, and invalid requests share not_found', async () => {
  for (const testCase of [
    { missingRequest: true },
    { missingMessage: true },
    { missingRoom: true },
    { accessAllowed: false },
    { requestRoomId: 'room-other' },
  ]) {
    assert.deepEqual(
      await harness(testCase).service.acknowledge({
        requestId: 'ack-request-1',
        actor,
      }),
      { ok: false, reason: 'not_found' },
    );
  }
  assert.deepEqual(
    await harness().service.acknowledge({ requestId: ' ', actor }),
    { ok: false, reason: 'not_found' },
  );
});

test('room mismatch rejects acknowledge, revoke, and cancel before ACL or mutation', async () => {
  for (const operation of ['acknowledge', 'revoke', 'cancel']) {
    const { calls, service } = harness({ requestRoomId: 'room-other' });
    assert.deepEqual(
      await service[operation]({ requestId: 'ack-request-1', actor }),
      { ok: false, reason: 'not_found' },
    );
    assert.deepEqual(
      calls.map(([kind]) => kind),
      ['transaction', 'lock-request', 'lock-message'],
    );
  }
});

test('revoke is serialized and idempotently removes only the actor acknowledgement', async () => {
  const { calls, service } = harness({
    acks: [{ userId: 'user-1' }, { userId: 'user-2' }],
  });
  const result = await service.revoke({
    requestId: 'ack-request-1',
    actor,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.changed, true);
  assert.deepEqual(
    result.value.request.acks.map((ack) => ack.userId),
    ['user-2'],
  );
  assert.ok(calls.find(([kind]) => kind === 'revoke'));

  const absent = harness();
  const absentResult = await absent.service.revoke({
    requestId: 'ack-request-1',
    actor,
  });
  assert.equal(absentResult.ok, true);
  assert.equal(absentResult.value.changed, false);
});

test('cancel permits the creator or privileged actor and preserves an existing cancellation', async () => {
  const owner = harness({ createdBy: 'user-1' });
  const ownerResult = await owner.service.cancel({
    requestId: 'ack-request-1',
    actor,
  });
  assert.equal(ownerResult.ok, true);
  assert.equal(ownerResult.value.changed, true);
  assert.ok(ownerResult.value.request.canceledAt instanceof Date);

  const privileged = harness({ createdBy: 'other-user' });
  const privilegedResult = await privileged.service.cancel({
    requestId: 'ack-request-1',
    actor: { ...actor, roles: ['mgmt'] },
  });
  assert.equal(privilegedResult.ok, true);
  assert.equal(privilegedResult.value.isPrivileged, true);

  assert.deepEqual(
    await harness({ createdBy: 'other-user' }).service.cancel({
      requestId: 'ack-request-1',
      actor,
    }),
    { ok: false, reason: 'forbidden' },
  );

  const alreadyCanceled = harness({
    createdBy: 'user-1',
    canceledAt: new Date('2026-08-09T02:00:00.000Z'),
  });
  const repeated = await alreadyCanceled.service.cancel({
    requestId: 'ack-request-1',
    actor,
  });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.value.changed, false);
  assert.equal(
    alreadyCanceled.calls.some(([kind]) => kind === 'cancel'),
    false,
  );
});
