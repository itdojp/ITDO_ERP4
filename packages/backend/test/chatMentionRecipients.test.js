import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expandRoomMentionRecipients,
  resolveRoomAudienceUserIds,
} from '../dist/services/chatMentionRecipients.js';

function createGroupAccountStub(groups = []) {
  const selectorMap = new Map();
  for (const group of groups) {
    const id = typeof group.id === 'string' ? group.id.trim() : '';
    const displayName =
      typeof group.displayName === 'string' ? group.displayName.trim() : '';
    if (id) selectorMap.set(id, group);
    if (displayName) selectorMap.set(displayName, group);
  }
  return {
    findMany: async ({ where }) => {
      const selectors = [
        ...(where?.OR?.[0]?.id?.in || []),
        ...(where?.OR?.[1]?.displayName?.in || []),
      ];
      const rows = [];
      for (const selector of selectors) {
        const group = selectorMap.get(selector);
        if (group) rows.push(group);
      }
      return rows;
    },
  };
}

function createUserGroupStub(memberships = []) {
  return {
    findMany: async ({ where }) => {
      const groupIds = where?.groupId?.in || [];
      return memberships
        .filter((member) => groupIds.includes(member.groupId))
        .map((member) => ({
          groupId: member.groupId,
          user: { userName: member.userId },
        }));
    },
  };
}

function createChatRoomMemberStub(members = []) {
  return {
    findMany: async ({ where }) => {
      const roomId = where?.roomId;
      return members
        .filter((member) => member.roomId === roomId)
        .map((member) => ({ userId: member.userId }));
    },
  };
}

function createClient({
  groupAccounts = [],
  memberships = [],
  roomMembers = [],
} = {}) {
  return {
    groupAccount: createGroupAccountStub(groupAccounts),
    userGroup: createUserGroupStub(memberships),
    chatRoomMember: createChatRoomMemberStub(roomMembers),
  };
}

test('resolveRoomAudienceUserIds: private_group uses room members', async () => {
  const client = createClient({
    roomMembers: [
      { roomId: 'r1', userId: 'u1' },
      { roomId: 'r1', userId: 'u2' },
    ],
  });
  const res = await resolveRoomAudienceUserIds({
    room: {
      id: 'r1',
      type: 'private_group',
      groupId: null,
      allowExternalUsers: false,
    },
    client,
  });
  assert.deepEqual(Array.from(res).sort(), ['u1', 'u2']);
});

test('resolveRoomAudienceUserIds: department resolves group members', async () => {
  const client = createClient({
    groupAccounts: [{ id: 'deptA-id', displayName: 'deptA' }],
    memberships: [{ groupId: 'deptA-id', userId: 'u1' }],
  });
  const res = await resolveRoomAudienceUserIds({
    room: {
      id: 'dept-room',
      type: 'department',
      groupId: 'deptA',
      allowExternalUsers: false,
    },
    client,
  });
  assert.deepEqual(Array.from(res), ['u1']);
});

test('expandRoomMentionRecipients: skips group members when audience empty', async () => {
  const client = createClient({
    groupAccounts: [{ id: 'deptB-id', displayName: 'deptB' }],
    memberships: [{ groupId: 'deptB-id', userId: 'u2' }],
  });
  const res = await expandRoomMentionRecipients({
    room: {
      id: 'dept-room',
      type: 'department',
      groupId: null,
      allowExternalUsers: false,
    },
    mentionUserIds: ['u3'],
    mentionGroupIds: ['deptB'],
    mentionsAll: false,
    client,
  });
  assert.deepEqual(res, ['u3']);
});

test('expandRoomMentionRecipients: intersects group mentions with audience', async () => {
  const client = createClient({
    groupAccounts: [
      { id: 'deptA-id', displayName: 'deptA' },
      { id: 'deptB-id', displayName: 'deptB' },
    ],
    memberships: [
      { groupId: 'deptA-id', userId: 'u1' },
      { groupId: 'deptB-id', userId: 'u2' },
    ],
  });
  const res = await expandRoomMentionRecipients({
    room: {
      id: 'dept-room',
      type: 'department',
      groupId: 'deptA',
      allowExternalUsers: false,
    },
    mentionUserIds: ['u3'],
    mentionGroupIds: ['deptA'],
    mentionsAll: false,
    client,
  });
  assert.deepEqual(res.sort(), ['u1', 'u3'].sort());
});

test('expandRoomMentionRecipients: @all adds room audience', async () => {
  const client = createClient({
    roomMembers: [
      { roomId: 'r1', userId: 'u1' },
      { roomId: 'r1', userId: 'u2' },
    ],
  });
  const res = await expandRoomMentionRecipients({
    room: {
      id: 'r1',
      type: 'private_group',
      groupId: null,
      allowExternalUsers: false,
    },
    mentionUserIds: ['u3'],
    mentionGroupIds: [],
    mentionsAll: true,
    client,
  });
  assert.deepEqual(res.sort(), ['u1', 'u2', 'u3'].sort());
});
