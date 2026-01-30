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

test('validateChatAckRequiredRecipientsForRoom: project rejects non-members', async () => {
  const room = buildRoom({ id: 'p1', type: 'project' });
  const client = {
    userAccount: {
      findMany: async () => [{ userName: 'u1' }, { userName: 'u2' }],
    },
    chatRoomMember: { findMany: async () => [] },
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

test('validateChatAckRequiredRecipientsForRoom: project allows admin/mgmt via group mapping', async () => {
  delete process.env.AUTH_GROUP_TO_ROLE_MAP;
  const room = buildRoom({ id: 'p1', type: 'project' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u2' }] },
    chatRoomMember: { findMany: async () => [] },
    projectMember: { findMany: async () => [] },
    userGroup: {
      findMany: async () => [{ user: { userName: 'u2' } }],
    },
  };

  const res = await validateChatAckRequiredRecipientsForRoom({
    room,
    requiredUserIds: ['u2'],
    client,
  });
  assert.deepEqual(res, { ok: true, validUserIds: ['u2'] });
});

test('validateChatAckRequiredRecipientsForRoom: department requires group membership', async () => {
  const room = buildRoom({ id: 'dept1', type: 'department', groupId: 'deptA' });
  const client = {
    userAccount: {
      findMany: async () => [{ userName: 'u1' }, { userName: 'u2' }],
    },
    chatRoomMember: { findMany: async () => [] },
    userGroup: {
      findMany: async () => [{ user: { userName: 'u1' } }],
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
});

test('validateChatAckRequiredRecipientsForRoom: private_group requires room membership', async () => {
  const room = buildRoom({ id: 'pg1', type: 'private_group' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u1' }] },
    chatRoomMember: { findMany: async () => [] },
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
});

test('validateChatAckRequiredRecipientsForRoom: company skips access check but rejects inactive', async () => {
  const room = buildRoom({ id: 'company', type: 'company' });
  const client = {
    userAccount: { findMany: async () => [{ userName: 'u1' }] },
    chatRoomMember: { findMany: async () => [] },
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

