import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureChatRoomContentAccess } from '../dist/services/chatRoomAccess.js';

function buildRoom(overrides = {}) {
  return {
    id: 'room1',
    type: 'department',
    groupId: 'deptA',
    deletedAt: null,
    allowExternalUsers: false,
    ...overrides,
  };
}

function createClient(room) {
  return {
    chatRoom: {
      findUnique: async ({ where }) =>
        where?.id === room.id ? { ...room } : null,
    },
    chatRoomMember: {
      findFirst: async () => null,
    },
  };
}

test('ensureChatRoomContentAccess: department allows groupAccountIds match', async () => {
  const room = buildRoom({ groupId: 'group-uuid-1' });
  const client = createClient(room);

  const res = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: ['group-uuid-1'],
    client,
  });

  assert.equal(res.ok, true);
});

test('ensureChatRoomContentAccess: department allows groupIds match', async () => {
  const room = buildRoom({ groupId: 'dept-sales' });
  const client = createClient(room);

  const res = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: ['dept-sales'],
    groupAccountIds: [],
    client,
  });

  assert.equal(res.ok, true);
});

test('ensureChatRoomContentAccess: department denies when no group match', async () => {
  const room = buildRoom({ groupId: 'dept-sales' });
  const client = createClient(room);

  const res = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: ['dept-hr'],
    groupAccountIds: ['group-uuid-9'],
    client,
  });

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'forbidden_room_member');
});

test('ensureChatRoomContentAccess: viewerGroupIds restricts read access', async () => {
  const room = buildRoom({
    groupId: 'dept-sales',
    viewerGroupIds: ['group-uuid-1'],
  });
  const client = createClient(room);

  const res = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: ['dept-sales'],
    groupAccountIds: [],
    client,
  });

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'forbidden_room_member');
});

test('ensureChatRoomContentAccess: posterGroupIds restricts post access only', async () => {
  const room = buildRoom({
    groupId: 'dept-sales',
    posterGroupIds: ['group-uuid-1'],
  });
  const client = createClient(room);

  const readRes = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: ['dept-sales'],
    groupAccountIds: [],
    client,
  });
  assert.equal(readRes.ok, true);

  const postRes = await ensureChatRoomContentAccess({
    roomId: room.id,
    userId: 'u1',
    roles: ['user'],
    projectIds: [],
    groupIds: ['dept-sales'],
    groupAccountIds: [],
    accessLevel: 'post',
    client,
  });
  assert.equal(postRes.ok, false);
  assert.equal(postRes.reason, 'forbidden_room_member');
});
