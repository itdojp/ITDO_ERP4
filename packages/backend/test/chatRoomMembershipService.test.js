import assert from 'node:assert/strict';
import test from 'node:test';

import { addChatRoomMembers } from '../dist/services/chatRoomMembership.js';

function room(overrides = {}) {
  return {
    id: 'room-1',
    type: 'private_group',
    isOfficial: false,
    deletedAt: null,
    ...overrides,
  };
}

test('addChatRoomMembers returns route-compatible errors for missing and DM rooms', async () => {
  const missing = await addChatRoomMembers({
    roomId: 'missing',
    actorUserId: 'actor',
    actorRoles: ['admin'],
    userIds: ['member'],
    client: { chatRoom: { findUnique: async () => null } },
  });
  assert.deepEqual(missing, {
    ok: false,
    statusCode: 404,
    error: { code: 'NOT_FOUND', message: 'Room not found' },
  });

  const dm = await addChatRoomMembers({
    roomId: 'dm-1',
    actorUserId: 'actor',
    actorRoles: ['admin'],
    userIds: ['member'],
    client: { chatRoom: { findUnique: async () => room({ type: 'dm' }) } },
  });
  assert.equal(dm.ok, false);
  assert.equal(dm.statusCode, 400);
  assert.equal(dm.error.code, 'INVALID_ROOM_TYPE');
});

test('addChatRoomMembers requires owner/admin membership for private groups', async () => {
  const result = await addChatRoomMembers({
    roomId: 'private-1',
    actorUserId: 'actor',
    actorRoles: ['user'],
    userIds: ['member'],
    client: {
      chatRoom: { findUnique: async () => room() },
      chatRoomMember: { findFirst: async () => ({ role: 'member' }) },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.error.code, 'FORBIDDEN_ROOM_MEMBER');
});

test('addChatRoomMembers adds deduped private-group members and skips the actor', async () => {
  let createManyArgs = null;
  const client = {
    chatRoom: { findUnique: async () => room() },
    chatRoomMember: {
      findFirst: async () => ({ role: 'owner' }),
      createMany: async (args) => {
        createManyArgs = args;
        return { count: args.data.length };
      },
    },
  };

  const result = await addChatRoomMembers({
    roomId: 'private-1',
    actorUserId: 'actor',
    actorRoles: ['user'],
    userIds: ['member-a', 'actor', 'member-a', 'member-b'],
    client,
  });

  assert.deepEqual(result, {
    ok: true,
    roomId: 'room-1',
    added: 2,
    addedUserIds: ['member-a', 'member-b'],
  });
  assert.equal(createManyArgs.skipDuplicates, true);
  assert.deepEqual(
    createManyArgs.data.map((member) => ({
      roomId: member.roomId,
      userId: member.userId,
      role: member.role,
      createdBy: member.createdBy,
      updatedBy: member.updatedBy,
    })),
    [
      {
        roomId: 'room-1',
        userId: 'member-a',
        role: 'member',
        createdBy: 'actor',
        updatedBy: 'actor',
      },
      {
        roomId: 'room-1',
        userId: 'member-b',
        role: 'member',
        createdBy: 'actor',
        updatedBy: 'actor',
      },
    ],
  );
});

test('addChatRoomMembers enforces admin or mgmt for official rooms', async () => {
  const forbidden = await addChatRoomMembers({
    roomId: 'company',
    actorUserId: 'actor',
    actorRoles: ['user'],
    userIds: ['member'],
    client: {
      chatRoom: {
        findUnique: async () =>
          room({ type: 'company', isOfficial: true, id: 'company' }),
      },
    },
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.error.code, 'FORBIDDEN_ROLE');

  const invalid = await addChatRoomMembers({
    roomId: 'custom-company',
    actorUserId: 'actor',
    actorRoles: ['admin'],
    userIds: ['member'],
    client: {
      chatRoom: {
        findUnique: async () =>
          room({ type: 'company', isOfficial: false, id: 'custom-company' }),
      },
    },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.error.code, 'INVALID_ROOM');
});

test('addChatRoomMembers no-ops when request only contains actor or blanks', async () => {
  let createManyCalled = false;
  const result = await addChatRoomMembers({
    roomId: 'private-1',
    actorUserId: 'actor',
    actorRoles: ['user'],
    userIds: ['actor', ' ', null],
    client: {
      chatRoom: { findUnique: async () => room() },
      chatRoomMember: {
        findFirst: async () => ({ role: 'admin' }),
        createMany: async () => {
          createManyCalled = true;
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: true,
    roomId: 'room-1',
    added: 0,
    addedUserIds: [],
  });
  assert.equal(createManyCalled, false);
});
