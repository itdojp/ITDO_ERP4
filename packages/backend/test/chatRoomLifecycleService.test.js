import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listChatRoomsForUser,
  updateManagedChatRoom,
} from '../dist/services/chatRoomLifecycle.js';

function baseRoom(overrides = {}) {
  return {
    id: 'room-1',
    type: 'company',
    name: '全社',
    isOfficial: true,
    allowExternalUsers: false,
    allowExternalIntegrations: false,
    viewerGroupIds: [],
    posterGroupIds: [],
    deletedAt: null,
    ...overrides,
  };
}

test('updateManagedChatRoom rejects missing, deleted, and DM rooms with route-compatible errors', async () => {
  const missingClient = {
    chatRoom: { findUnique: async () => null },
  };
  assert.deepEqual(
    await updateManagedChatRoom({
      roomId: 'missing',
      userId: 'actor',
      patch: { name: 'x' },
      client: missingClient,
    }),
    {
      ok: false,
      statusCode: 404,
      error: { code: 'NOT_FOUND', message: 'Room not found' },
    },
  );

  const dmClient = {
    chatRoom: { findUnique: async () => baseRoom({ type: 'dm' }) },
  };
  assert.deepEqual(
    await updateManagedChatRoom({
      roomId: 'dm-1',
      userId: 'actor',
      patch: { name: 'x' },
      client: dmClient,
    }),
    {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_ROOM_TYPE', message: 'dm cannot be updated' },
    },
  );
});

test('updateManagedChatRoom preserves official and project room guards', async () => {
  const nonOfficialClient = {
    chatRoom: { findUnique: async () => baseRoom({ isOfficial: false }) },
  };
  const nonOfficial = await updateManagedChatRoom({
    roomId: 'private-1',
    userId: 'actor',
    patch: { allowExternalUsers: true },
    client: nonOfficialClient,
  });
  assert.equal(nonOfficial.ok, false);
  assert.equal(nonOfficial.statusCode, 400);
  assert.equal(nonOfficial.error.code, 'INVALID_ROOM');

  const projectClient = {
    chatRoom: { findUnique: async () => baseRoom({ type: 'project' }) },
  };
  const project = await updateManagedChatRoom({
    roomId: 'project-1',
    userId: 'actor',
    patch: { name: 'New name' },
    client: projectClient,
  });
  assert.equal(project.ok, false);
  assert.equal(project.error.code, 'INVALID_ROOM_TYPE');
});

test('updateManagedChatRoom validates group selectors before updating ACL fields', async () => {
  let updateCalled = false;
  const client = {
    chatRoom: {
      findUnique: async () => baseRoom({ viewerGroupIds: ['ga-sales'] }),
      update: async () => {
        updateCalled = true;
      },
    },
    groupAccount: {
      findMany: async () => [{ id: 'ga-sales', displayName: 'Sales' }],
    },
  };

  const result = await updateManagedChatRoom({
    roomId: 'company',
    userId: 'actor',
    patch: { viewerGroupIds: ['Sales', 'unknown'] },
    client,
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.error.code, 'INVALID_GROUP_IDS');
  assert.deepEqual(result.error.details, { groupIds: ['unknown'] });
  assert.equal(updateCalled, false);
});

test('updateManagedChatRoom updates flags and ACL with audit-ready changes', async () => {
  let updateArgs = null;
  const client = {
    chatRoom: {
      findUnique: async () =>
        baseRoom({
          name: '全社',
          viewerGroupIds: ['ga-sales'],
          posterGroupIds: [],
        }),
      update: async (args) => {
        updateArgs = args;
        return { id: args.where.id, type: 'company', ...args.data };
      },
    },
    groupAccount: {
      findMany: async () => [
        { id: 'ga-sales', displayName: 'Sales' },
        { id: 'ga-hr', displayName: 'HR' },
      ],
    },
  };

  const result = await updateManagedChatRoom({
    roomId: 'company',
    userId: 'actor',
    patch: {
      name: '全社チャット',
      allowExternalUsers: true,
      viewerGroupIds: ['HR'],
      posterGroupIds: ['ga-sales'],
    },
    client,
  });

  assert.equal(result.ok, true);
  assert.equal(updateArgs.where.id, 'room-1');
  assert.equal(updateArgs.data.updatedBy, 'actor');
  assert.equal(updateArgs.data.name, '全社チャット');
  assert.equal(updateArgs.data.allowExternalUsers, true);
  assert.deepEqual(updateArgs.data.viewerGroupIds, ['ga-hr']);
  assert.deepEqual(updateArgs.data.posterGroupIds, ['ga-sales']);
  assert.deepEqual(result.changes.name, { from: '全社', to: '全社チャット' });
  assert.deepEqual(result.changes.viewerGroupIds, {
    from: ['ga-sales'],
    to: ['ga-hr'],
  });
});

test('updateManagedChatRoom returns current room on no-op and does not write', async () => {
  let updateCalled = false;
  const room = baseRoom({ viewerGroupIds: ['ga-sales'] });
  const client = {
    chatRoom: {
      findUnique: async () => room,
      update: async () => {
        updateCalled = true;
      },
    },
    groupAccount: {
      findMany: async () => [{ id: 'ga-sales', displayName: 'Sales' }],
    },
  };

  const result = await updateManagedChatRoom({
    roomId: 'company',
    userId: 'actor',
    patch: { viewerGroupIds: ['ga-sales'] },
    client,
  });

  assert.equal(result.ok, true);
  assert.equal(result.room, room);
  assert.deepEqual(result.changes, {});
  assert.equal(updateCalled, false);
});

test('listChatRoomsForUser bootstraps official rooms and returns visible metadata without Fastify', async () => {
  const now = new Date('2026-07-13T00:00:00.000Z');
  const createManyCalls = [];
  const createdRooms = [];
  const client = {
    groupAccount: {
      findMany: async () => [{ id: 'ga-sales', displayName: 'Sales' }],
    },
    project: {
      findMany: async () => [
        { id: 'proj-1', code: 'P-001', name: 'Project One', createdAt: now },
      ],
    },
    chatRoom: {
      findUnique: async ({ where }) =>
        where.id === 'company' ? null : { id: where.id, deletedAt: null },
      create: async (args) => {
        createdRooms.push(args.data);
        return { ...args.data, createdAt: now, updatedAt: now };
      },
      findMany: async (args) => {
        if (args.where?.type === 'project' && args.select?.createdAt) {
          return [
            {
              id: 'proj-1',
              type: 'project',
              name: 'P-001',
              isOfficial: true,
              projectId: 'proj-1',
              groupId: null,
              viewerGroupIds: [],
              posterGroupIds: [],
              allowExternalUsers: false,
              allowExternalIntegrations: false,
              createdAt: now,
              createdBy: 'actor',
              updatedAt: now,
              updatedBy: null,
            },
          ];
        }
        if (args.where?.type === 'project' && args.select?.projectId) {
          return [];
        }
        if (args.where?.type === 'department') {
          return [];
        }
        if (args.where?.type?.not === 'project') {
          return [
            {
              id: 'company',
              type: 'company',
              name: '全社',
              isOfficial: true,
              projectId: null,
              groupId: null,
              viewerGroupIds: [],
              posterGroupIds: [],
              allowExternalUsers: false,
              allowExternalIntegrations: false,
              createdAt: now,
              createdBy: 'actor',
              updatedAt: now,
              updatedBy: 'actor',
            },
            {
              id: 'dept-test',
              type: 'department',
              name: 'Sales',
              isOfficial: true,
              projectId: null,
              groupId: 'ga-sales',
              viewerGroupIds: [],
              posterGroupIds: [],
              allowExternalUsers: false,
              allowExternalIntegrations: false,
              createdAt: now,
              createdBy: 'actor',
              updatedAt: now,
              updatedBy: 'actor',
            },
          ];
        }
        return [];
      },
      createMany: async (args) => {
        createManyCalls.push(args);
        return { count: args.data.length };
      },
    },
    chatRoomMember: {
      findMany: async () => [],
    },
  };

  const result = await listChatRoomsForUser({
    roles: ['admin'],
    userId: 'actor',
    projectIds: [],
    groupIds: ['Sales'],
    groupAccountIds: ['ga-sales'],
    client,
  });

  assert.deepEqual(
    createdRooms.map((room) => ({ id: room.id, type: room.type })),
    [{ id: 'company', type: 'company' }],
  );
  assert.deepEqual(
    createManyCalls.map((call) => ({
      skipDuplicates: call.skipDuplicates,
      types: call.data.map((room) => room.type),
    })),
    [
      { skipDuplicates: true, types: ['project'] },
      { skipDuplicates: true, types: ['department'] },
    ],
  );
  assert.deepEqual(
    result.items.map((item) => ({
      id: item.id,
      type: item.type,
      isMember: item.isMember ?? null,
      projectCode: item.projectCode ?? null,
      groupId: item.groupId ?? null,
    })),
    [
      {
        id: 'proj-1',
        type: 'project',
        isMember: null,
        projectCode: 'P-001',
        groupId: null,
      },
      {
        id: 'company',
        type: 'company',
        isMember: true,
        projectCode: null,
        groupId: null,
      },
      {
        id: 'dept-test',
        type: 'department',
        isMember: true,
        projectCode: null,
        groupId: 'ga-sales',
      },
    ],
  );
});
