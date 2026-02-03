import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChatAckRequiredRecipientsForRoom } from '../dist/services/chatAckRecipients.js';

function buildRoom(overrides = {}) {
  return {
    id: 'room1',
    type: 'project',
    groupId: null,
    deletedAt: null,
    allowExternalUsers: false,
    ...overrides,
  };
}

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

test('validateChatAckRequiredRecipientsForRoom: project rejects non-members', async () => {
  const room = buildRoom({ id: 'p1', type: 'project' });
  const client = {
    userAccount: {
      findMany: async () => [{ userName: 'u1' }, { userName: 'u2' }],
    },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [{ userId: 'u1' }] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1', 'u2'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u2']);
  assert.equal(res.reason, 'required_users_forbidden');
});

test('validateChatAckRequiredRecipientsForRoom: project allowExternalUsers allows room members', async () => {
  const room = buildRoom({ id: 'p1', type: 'project', allowExternalUsers: true });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u2' }] },
    chatRoomMember: { findMany: async () => [{ userId: 'u2' }] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u2'],
    client,
  });
  assert.deepEqual(res, { ok: true, validUserIds: ['u2'] });
});

test('validateChatAckRequiredRecipientsForRoom: project allows admin/mgmt via group mapping', async () => {
  const original = process.env.AUTH_GROUP_TO_ROLE_MAP;
  delete process.env.AUTH_GROUP_TO_ROLE_MAP;
  try {
    const room = buildRoom({ id: 'p1', type: 'project' });
    const client = {
      userAccount: { findMany: async () => [{ userName: 'u2' }] },
      chatRoomMember: { findMany: async () => [] },
      projectMember: { findMany: async () => [] },
      groupAccount: createGroupAccountStub([
        { id: 'admin-id', displayName: 'admin' },
      ]),
      userGroup: {
        findMany: async () => [{ groupId: 'admin-id', user: { userName: 'u2' } }],
      },
    };

    const res = await validateChatAckRequiredRecipientsForRoom({
      room,
      requiredUserIds: ['u2'],
      client,
    });
    assert.deepEqual(res, { ok: true, validUserIds: ['u2'] });
  } finally {
    if (original === undefined) {
      delete process.env.AUTH_GROUP_TO_ROLE_MAP;
    } else {
      process.env.AUTH_GROUP_TO_ROLE_MAP = original;
    }
  }
});

test('validateChatAckRequiredRecipientsForRoom: department requires group membership', async () => {
  const room = buildRoom({ id: 'dept1', type: 'department', groupId: 'deptA' });
  const client = {
    userAccount: {
      findMany: async () => [{ userName: 'u1' }, { userName: 'u2' }],
    },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([
      { id: 'deptA-id', displayName: 'deptA' },
    ]),
    userGroup: {
      findMany: async () => [{ groupId: 'deptA-id', user: { userName: 'u1' } }],
    },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1', 'u2'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u2']);
  assert.equal(res.reason, 'required_users_forbidden');
});

test('validateChatAckRequiredRecipientsForRoom: department allowExternalUsers allows room members', async () => {
  const room = buildRoom({
    id: 'dept1',
    type: 'department',
    groupId: 'deptA',
    allowExternalUsers: true,
  });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u2' }] },
    chatRoomMember: { findMany: async () => [{ userId: 'u2' }] },
    groupAccount: createGroupAccountStub([
      { id: 'deptA-id', displayName: 'deptA' },
    ]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u2'],
    client,
  });
  assert.deepEqual(res, { ok: true, validUserIds: ['u2'] });
});

test('validateChatAckRequiredRecipientsForRoom: private_group requires room membership', async () => {
  const room = buildRoom({ id: 'pg1', type: 'private_group' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u1' }] },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u1']);
  assert.equal(res.reason, 'required_users_forbidden');
});

test('validateChatAckRequiredRecipientsForRoom: mixed inactive+forbidden uses required_users_invalid', async () => {
  const room = buildRoom({ id: 'pg1', type: 'private_group' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u1' }] },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1', 'u2'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u2', 'u1']);
  assert.equal(res.reason, 'required_users_invalid');
});

test('validateChatAckRequiredRecipientsForRoom: company without ACL skips access check but rejects inactive', async () => {
  const room = buildRoom({ id: 'company', type: 'company' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u1' }] },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1', 'u2'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u2']);
});

test('validateChatAckRequiredRecipientsForRoom: company with viewerGroupIds enforces membership', async () => {
  const room = buildRoom({
    id: 'company',
    type: 'company',
    viewerGroupIds: ['group-uuid'],
  });
  const client = {
    userAccount: {
      findMany: async () => [{ userName: 'u1' }, { userName: 'u2' }],
    },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: {
      findMany: async () => [{ groupId: 'group-uuid', user: { userName: 'u1' } }],
    },
    projectMember: { findMany: async () => [] },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u1', 'u2'],
    client,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.invalidUserIds, ['u2']);
  assert.equal(res.reason, 'required_users_forbidden');
});
