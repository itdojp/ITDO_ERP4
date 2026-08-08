import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterVisibleChatNotificationRecipients,
  isChatNotificationVisibleForUser,
} from '../dist/services/chatNotificationVisibility.js';

function harness(overrides = {}) {
  const calls = [];
  const room = {
    id: 'room-1',
    type: 'company',
    projectId: null,
    isOfficial: false,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
    ...overrides.room,
  };
  const accounts = overrides.accounts ?? [
    {
      active: true,
      deletedAt: null,
      userName: 'user-1',
      externalId: null,
      memberships: [],
    },
  ];
  const transaction = {
    chatMessage: {
      async findUnique(input) {
        calls.push(['message', input]);
        return overrides.message === undefined
          ? { id: 'message-1', roomId: room.id, deletedAt: null }
          : overrides.message;
      },
    },
    chatRoom: {
      async findUnique(input) {
        calls.push(['room', input]);
        return overrides.roomResult === undefined ? room : overrides.roomResult;
      },
    },
    project: {
      async findUnique(input) {
        calls.push(['project', input]);
        const projectId = room.projectId ?? room.id;
        return overrides.project === undefined
          ? { id: projectId, deletedAt: null }
          : overrides.project;
      },
    },
    userAccount: {
      async findMany(input) {
        calls.push(['accounts', input]);
        return accounts;
      },
    },
    chatRoomMember: {
      async findMany(input) {
        calls.push(['members', input]);
        return overrides.members ?? [];
      },
    },
    projectMember: {
      async findMany(input) {
        calls.push(['projectMembers', input]);
        return overrides.projectMembers ?? [];
      },
    },
  };
  const client = {
    async $transaction(operation, options) {
      calls.push(['transaction', options]);
      return operation(transaction);
    },
  };
  return { calls, client };
}

test('chat delivery visibility batches current company-room ACL in one snapshot', async () => {
  const { calls, client } = harness({
    accounts: [
      {
        active: true,
        deletedAt: null,
        userName: 'user-1',
        externalId: 'external-1',
        memberships: [],
      },
      {
        active: false,
        deletedAt: null,
        userName: 'revoked-user',
        externalId: null,
        memberships: [],
      },
    ],
  });

  const visible = await filterVisibleChatNotificationRecipients(
    {
      kind: 'chat_mention',
      userIds: ['user-1', 'external-1', 'revoked-user', 'user-1'],
      messageId: 'message-1',
      projectId: null,
      payload: { roomId: 'room-1' },
    },
    { client },
  );

  assert.deepEqual(visible, ['user-1', 'external-1']);
  assert.equal(calls.filter(([kind]) => kind === 'transaction').length, 1);
  assert.equal(calls[0][1].isolationLevel, 'RepeatableRead');
  assert.equal(calls.filter(([kind]) => kind === 'accounts').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'members').length, 1);
});

test('chat delivery visibility fails closed for stale or inconsistent references', async () => {
  const cases = [
    { label: 'missing-message', overrides: { message: null } },
    {
      label: 'deleted-message',
      overrides: {
        message: { id: 'message-1', roomId: 'room-1', deletedAt: new Date() },
      },
    },
    { label: 'missing-room', overrides: { roomResult: null } },
    {
      label: 'deleted-room',
      overrides: { room: { deletedAt: new Date() } },
    },
  ];
  for (const item of cases) {
    const { client } = harness(item.overrides);
    const visible = await filterVisibleChatNotificationRecipients(
      {
        kind: 'chat_message',
        userIds: ['user-1'],
        messageId: 'message-1',
        projectId: null,
        payload: { roomId: 'room-1' },
      },
      { client },
    );
    assert.deepEqual(visible, [], item.label);
  }

  const mismatch = harness();
  assert.deepEqual(
    await filterVisibleChatNotificationRecipients(
      {
        kind: 'chat_message',
        userIds: ['user-1'],
        messageId: 'message-1',
        projectId: null,
        payload: { roomId: 'different-room' },
      },
      { client: mismatch.client },
    ),
    [],
  );
});

test('chat delivery visibility enforces project alias, project membership, and group ACL', async () => {
  const project = harness({
    room: {
      id: 'legacy-project',
      type: 'project',
      projectId: null,
      isOfficial: true,
      viewerGroupIds: ['group-account-1'],
      allowExternalUsers: false,
    },
    accounts: [
      {
        active: true,
        deletedAt: null,
        userName: 'user-1',
        externalId: null,
        memberships: [
          { group: { id: 'group-account-1', displayName: 'group-name-1' } },
        ],
      },
      {
        active: true,
        deletedAt: null,
        userName: 'outsider',
        externalId: null,
        memberships: [],
      },
    ],
    projectMembers: [
      { projectId: 'legacy-project', userId: 'user-1' },
      { projectId: 'legacy-project', userId: 'outsider' },
    ],
  });
  const visible = await filterVisibleChatNotificationRecipients(
    {
      kind: 'chat_ack_required',
      userIds: ['user-1', 'outsider'],
      messageId: 'message-1',
      projectId: 'legacy-project',
      payload: { roomId: 'legacy-project' },
    },
    { client: project.client },
  );
  assert.deepEqual(visible, ['user-1']);

  const wrongProject = harness({
    room: {
      id: 'legacy-project',
      type: 'project',
      projectId: null,
      isOfficial: true,
    },
  });
  assert.equal(
    await isChatNotificationVisibleForUser(
      {
        kind: 'chat_mention',
        userId: 'user-1',
        messageId: 'message-1',
        projectId: 'different-project',
        payload: { roomId: 'legacy-project' },
      },
      { client: wrongProject.client },
    ),
    false,
  );
});

test('room ACL mismatch delivery is limited to current owner/admin members', async () => {
  const { client } = harness({
    members: [
      { userId: 'owner-user', role: 'owner' },
      { userId: 'member-user', role: 'member' },
    ],
    accounts: [
      {
        active: true,
        deletedAt: null,
        userName: 'owner-user',
        externalId: null,
        memberships: [],
      },
      {
        active: true,
        deletedAt: null,
        userName: 'member-user',
        externalId: null,
        memberships: [],
      },
    ],
  });
  const visible = await filterVisibleChatNotificationRecipients(
    {
      kind: 'chat_room_acl_mismatch',
      userIds: ['owner-user', 'member-user'],
      messageId: 'room-1',
      projectId: null,
      payload: { roomId: 'room-1' },
    },
    { client },
  );
  assert.deepEqual(visible, ['owner-user']);
});

test('unknown chat notification kinds fail closed without database access', async () => {
  let transactionCount = 0;
  const visible = await filterVisibleChatNotificationRecipients(
    {
      kind: 'chat_future_internal',
      userIds: ['user-1'],
      messageId: 'message-1',
      projectId: null,
      payload: { roomId: 'room-1' },
    },
    {
      client: {
        async $transaction() {
          transactionCount += 1;
          return [];
        },
      },
    },
  );
  assert.deepEqual(visible, []);
  assert.equal(transactionCount, 0);
});
