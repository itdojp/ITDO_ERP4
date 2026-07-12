import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDepartmentRoomId,
  buildDepartmentRoomTargets,
  buildDmRoomId,
  createPrivateGroupRoomWithMembers,
  ensureCompanyRoom,
  ensureDepartmentRooms,
  ensureDmRoomWithMembers,
  ensureProjectRooms,
} from '../dist/services/chatRoomProvisioning.js';

test('buildDepartmentRoomId is deterministic and trims group ids', () => {
  assert.equal(
    buildDepartmentRoomId(' group-a '),
    'dept_e610eab3e8256d8d66aca356f4975780',
  );
});

test('buildDepartmentRoomTargets resolves GroupAccount ids and keeps displayName legacy fallback', async () => {
  let findManyArgs = null;
  const client = {
    groupAccount: {
      findMany: async (args) => {
        findManyArgs = args;
        return [
          { id: 'ga-sales', displayName: 'Sales' },
          { id: 'ga-sales', displayName: 'Sales Duplicate' },
          { id: 'ga-hr', displayName: 'HR' },
          { id: ' ', displayName: 'Ignored' },
        ];
      },
    },
  };

  const targets = await buildDepartmentRoomTargets({
    groupIds: ['Sales', ' legacy-name ', 'Sales'],
    groupAccountIds: ['ga-hr', 'ga-sales'],
    client,
  });

  assert.deepEqual(findManyArgs.where.OR, [
    { id: { in: ['ga-hr', 'ga-sales'] } },
    { displayName: { in: ['Sales', 'legacy-name'] } },
  ]);
  assert.deepEqual(
    targets.map((target) => ({
      groupId: target.groupId,
      displayName: target.displayName,
      roomIdPrefix: target.roomId.slice(0, 5),
    })),
    [
      { groupId: 'ga-sales', displayName: 'Sales', roomIdPrefix: 'dept_' },
      { groupId: 'ga-hr', displayName: 'HR', roomIdPrefix: 'dept_' },
      {
        groupId: 'legacy-name',
        displayName: 'legacy-name',
        roomIdPrefix: 'dept_',
      },
    ],
  );
});

test('ensureCompanyRoom no-ops existing rooms and treats P2002 race as idempotent', async () => {
  let createCalled = false;
  const existingClient = {
    chatRoom: {
      findUnique: async () => ({ id: 'company', deletedAt: null }),
      create: async () => {
        createCalled = true;
      },
    },
  };
  const existing = await ensureCompanyRoom({
    userId: 'actor',
    client: existingClient,
  });
  assert.deepEqual(existing, { created: false, raced: false });
  assert.equal(createCalled, false);

  const racedClient = {
    chatRoom: {
      findUnique: async () => null,
      create: async () => {
        const err = new Error('duplicate');
        err.code = 'P2002';
        throw err;
      },
    },
  };
  const raced = await ensureCompanyRoom({
    userId: 'actor',
    client: racedClient,
  });
  assert.deepEqual(raced, { created: false, raced: true });
});

test('ensureDepartmentRooms normalizes legacy displayName rooms and creates missing targets once', async () => {
  const updates = [];
  let createManyArgs = null;
  const client = {
    chatRoom: {
      findMany: async () => [
        { id: 'legacy-room', groupId: 'Sales', name: 'Old Sales' },
      ],
      update: async (args) => {
        updates.push(args);
        return { id: args.where.id, ...args.data };
      },
      createMany: async (args) => {
        createManyArgs = args;
        return { count: args.data.length };
      },
    },
  };

  const result = await ensureDepartmentRooms({
    userId: 'actor',
    targets: [
      {
        roomId: buildDepartmentRoomId('ga-sales'),
        groupId: 'ga-sales',
        displayName: 'Sales',
      },
      {
        roomId: buildDepartmentRoomId('ga-hr'),
        groupId: 'ga-hr',
        displayName: 'HR',
      },
      {
        roomId: buildDepartmentRoomId('ga-hr'),
        groupId: 'ga-hr',
        displayName: 'HR',
      },
    ],
    client,
  });

  assert.deepEqual(result, { created: 1, updated: 1 });
  assert.deepEqual(updates, [
    {
      where: { id: 'legacy-room' },
      data: { groupId: 'ga-sales', name: 'Sales', updatedBy: 'actor' },
    },
  ]);
  assert.equal(createManyArgs.skipDuplicates, true);
  assert.deepEqual(createManyArgs.data, [
    {
      id: buildDepartmentRoomId('ga-hr'),
      type: 'department',
      name: 'HR',
      groupId: 'ga-hr',
      isOfficial: true,
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      createdBy: 'actor',
      updatedBy: 'actor',
    },
  ]);
});

test('ensureProjectRooms creates only missing official project rooms', async () => {
  let createManyArgs = null;
  const client = {
    chatRoom: {
      findMany: async () => [{ id: 'p1', projectId: 'p1' }],
      createMany: async (args) => {
        createManyArgs = args;
        return { count: args.data.length };
      },
    },
  };

  const result = await ensureProjectRooms({
    userId: 'actor',
    projects: [
      { id: 'p1', code: 'P-001' },
      { id: 'p2', code: 'P-002' },
    ],
    client,
  });

  assert.deepEqual(result, { created: 1 });
  assert.deepEqual(createManyArgs.data, [
    {
      id: 'p2',
      type: 'project',
      name: 'P-002',
      isOfficial: true,
      projectId: 'p2',
      createdBy: 'actor',
    },
  ]);
  assert.equal(createManyArgs.skipDuplicates, true);
});

test('DM provisioning uses sorted deterministic room id and restores both owner memberships', async () => {
  const roomId = buildDmRoomId('user-b', 'user-a');
  assert.equal(roomId, buildDmRoomId('user-a', 'user-b'));

  const upserts = [];
  let createdRoom = null;
  const client = {
    chatRoom: {
      findUnique: async () => null,
      create: async (args) => {
        createdRoom = args.data;
        return { ...args.data, id: args.data.id };
      },
      update: async () => {
        throw new Error('update should not be called for a new DM');
      },
    },
    chatRoomMember: {
      upsert: async (args) => {
        upserts.push(args);
        return args.create;
      },
    },
  };

  const ensured = await ensureDmRoomWithMembers({
    userId: 'user-b',
    partnerUserId: 'user-a',
    client,
  });

  assert.equal(ensured.created, true);
  assert.equal(createdRoom.id, roomId);
  assert.equal(createdRoom.name, 'dm:user-a:user-b');
  assert.deepEqual(
    upserts.map((entry) => entry.where.roomId_userId),
    [
      { roomId, userId: 'user-b' },
      { roomId, userId: 'user-a' },
    ],
  );
  assert.equal(upserts[0].update.deletedAt, null);
  assert.equal(upserts[1].create.role, 'owner');
});

test('private group provisioning creates owner plus deduped members', async () => {
  let createManyArgs = null;
  const now = new Date('2026-07-13T00:00:00.000Z');
  const client = {
    chatRoom: {
      create: async (args) => ({ id: 'room-1', ...args.data }),
    },
    chatRoomMember: {
      createMany: async (args) => {
        createManyArgs = args;
        return { count: args.data.length };
      },
    },
  };

  const result = await createPrivateGroupRoomWithMembers({
    userId: 'owner',
    name: 'Project side room',
    memberUserIds: ['member-a', 'owner', 'member-a', 'member-b'],
    now,
    client,
  });

  assert.equal(result.memberCount, 3);
  assert.deepEqual(
    createManyArgs.data.map((member) => ({
      roomId: member.roomId,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    })),
    [
      {
        roomId: 'room-1',
        userId: 'owner',
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      },
      {
        roomId: 'room-1',
        userId: 'member-a',
        role: 'member',
        createdAt: now,
        updatedAt: now,
      },
      {
        roomId: 'room-1',
        userId: 'member-b',
        role: 'member',
        createdAt: now,
        updatedAt: now,
      },
    ],
  );
  assert.equal(createManyArgs.skipDuplicates, true);
});
