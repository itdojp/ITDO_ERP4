import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const parts = path.split('.');
    const target = parts.length === 1 ? prisma : prisma[parts[0]];
    const method = parts.length === 1 ? parts[0] : parts[1];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function withServer(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NOTIFICATION_PUSH_KINDS: '',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    },
  );
}

function userHeaders(projectIds = '') {
  return {
    'x-user-id': 'actor-user',
    'x-roles': 'user',
    ...(projectIds ? { 'x-project-ids': projectIds } : {}),
  };
}

function activeProjectRoom() {
  return {
    id: 'room-alias',
    type: 'project',
    projectId: 'project-canonical',
    isOfficial: false,
    groupId: null,
    viewerGroupIds: [],
    posterGroupIds: [],
    deletedAt: null,
    allowExternalUsers: false,
  };
}

function assertAckNotFound(response) {
  assert.equal(response.statusCode, 404, response.body);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'NOT_FOUND', message: 'Ack request not found' },
  });
}

test('POST room ACK request uses canonical project identity for recipients and notifications', async () => {
  const createdNotifications = [];
  const projectMemberQueries = [];
  const now = new Date('2026-08-09T00:00:00.000Z');
  const message = {
    id: 'message-1',
    roomId: 'room-alias',
    userId: 'actor-user',
    body: 'Synthetic ACK request',
    tags: null,
    reactions: null,
    mentions: null,
    mentionsAll: false,
    createdAt: now,
    createdBy: 'actor-user',
    updatedAt: now,
    updatedBy: 'actor-user',
    deletedAt: null,
    ackRequest: {
      id: 'ack-request-1',
      messageId: 'message-1',
      roomId: 'room-alias',
      requiredUserIds: ['required-user'],
      requestedUserIds: ['required-user'],
      requestedGroupIds: [],
      requestedRoles: [],
      dueAt: null,
      acks: [],
    },
  };

  await withServer(async (server) => {
    await withPrismaStubs(
      {
        'chatRoom.findUnique': async () => activeProjectRoom(),
        'chatSetting.findUnique': async () => null,
        'userAccount.findMany': async () => [
          { userName: 'required-user', externalId: null },
        ],
        'groupAccount.findMany': async () => [],
        'userGroup.findMany': async () => [],
        'projectMember.findMany': async ({ where }) => {
          projectMemberQueries.push(where);
          return [{ userId: 'required-user' }];
        },
        'chatMessage.create': async () => message,
        'userNotificationPreference.findMany': async () => [],
        'chatRoomNotificationSetting.findMany': async () => [],
        'appNotification.findMany': async () => [],
        'appNotification.createMany': async ({ data }) => {
          createdNotifications.push(...data);
          return { count: data.length };
        },
        'auditLog.create': async () => ({ id: 'audit-1' }),
      },
      async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/chat-rooms/room-alias/ack-requests',
          headers: {
            ...userHeaders('project-canonical'),
            'x-roles': 'admin',
          },
          payload: {
            body: 'Synthetic ACK request',
            requiredUserIds: ['required-user'],
          },
        });

        assert.equal(response.statusCode, 200, response.body);
      },
    );
  });

  assert.ok(projectMemberQueries.length > 0);
  assert.ok(
    projectMemberQueries.every(
      (where) => where.projectId === 'project-canonical',
    ),
  );
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].projectId, 'project-canonical');
  assert.equal(createdNotifications[0].payload.roomId, 'room-alias');
});

test('GET ACK request normalizes missing, deleted, and unauthorized root/reply to the same 404', async () => {
  const cases = [
    { name: 'missing', target: null },
    {
      name: 'deleted root',
      target: {
        id: 'ack-request-1',
        roomId: 'room-alias',
        message: {
          id: 'root-1',
          roomId: 'room-alias',
          parentMessageId: null,
          deletedAt: new Date('2026-08-09T00:00:00.000Z'),
        },
      },
    },
    {
      name: 'deleted reply',
      target: {
        id: 'ack-request-1',
        roomId: 'room-alias',
        message: {
          id: 'reply-1',
          roomId: 'room-alias',
          parentMessageId: 'root-1',
          deletedAt: new Date('2026-08-09T00:00:00.000Z'),
        },
      },
    },
    {
      name: 'unauthorized root',
      target: {
        id: 'ack-request-1',
        roomId: 'room-alias',
        message: {
          id: 'root-1',
          roomId: 'room-alias',
          parentMessageId: null,
          deletedAt: null,
        },
      },
    },
    {
      name: 'deleted reply',
      target: {
        id: 'ack-request-1',
        roomId: 'room-alias',
        message: {
          id: 'reply-1',
          roomId: 'room-alias',
          parentMessageId: 'root-1',
          deletedAt: new Date('2026-08-09T00:00:00.000Z'),
        },
      },
    },
    {
      name: 'unauthorized reply',
      target: {
        id: 'ack-request-1',
        roomId: 'room-alias',
        message: {
          id: 'reply-1',
          roomId: 'room-alias',
          parentMessageId: 'root-1',
          deletedAt: null,
        },
      },
    },
  ];

  await withServer(async (server) => {
    for (const scenario of cases) {
      let fullRowReads = 0;
      const transaction = {
        chatAckRequest: {
          findUnique: async (args) => {
            if (args.select) return scenario.target;
            fullRowReads += 1;
            return { private: 'must-not-be-read' };
          },
        },
        chatRoom: {
          findUnique: async () => activeProjectRoom(),
        },
        chatRoomMember: {
          findFirst: async () => null,
        },
      };
      let isolationLevel;
      await withPrismaStubs(
        {
          $transaction: async (operation, options) => {
            isolationLevel = options?.isolationLevel;
            return operation(transaction);
          },
        },
        async () => {
          const response = await server.inject({
            method: 'GET',
            url: '/chat-ack-requests/ack-request-1',
            headers: userHeaders(),
          });
          assertAckNotFound(response);
        },
      );
      assert.equal(
        fullRowReads,
        0,
        `${scenario.name} exposed the full ACK row before authorization`,
      );
      assert.equal(isolationLevel, 'RepeatableRead');
    }
  });
});

test('GET ACK request returns the full row only after current project ACL succeeds', async () => {
  const now = new Date('2026-08-09T00:00:00.000Z');
  const target = {
    id: 'ack-request-1',
    roomId: 'room-alias',
    message: {
      id: 'reply-1',
      roomId: 'room-alias',
      parentMessageId: 'root-1',
      deletedAt: null,
    },
  };
  const responseRow = {
    id: 'ack-request-1',
    messageId: 'reply-1',
    roomId: 'room-alias',
    requiredUserIds: ['actor-user'],
    createdAt: now,
    message: target.message,
    acks: [],
    links: [],
  };
  let fullRowReads = 0;
  const transaction = {
    chatAckRequest: {
      findUnique: async (args) => {
        if (args.select?.message) return target;
        fullRowReads += 1;
        const {
          message: _message,
          acks: _acks,
          links: _links,
          ...request
        } = responseRow;
        return request;
      },
    },
    chatMessage: {
      findUnique: async () => responseRow.message,
    },
    chatAck: {
      findMany: async () => responseRow.acks,
    },
    chatAckLink: {
      findMany: async () => responseRow.links,
    },
    chatRoom: {
      findUnique: async () => activeProjectRoom(),
    },
    chatRoomMember: {
      findFirst: async () => null,
    },
  };

  await withServer(async (server) => {
    await withPrismaStubs(
      {
        $transaction: async (operation) => operation(transaction),
      },
      async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/chat-ack-requests/ack-request-1',
          headers: userHeaders('project-canonical'),
        });

        assert.equal(response.statusCode, 200, response.body);
        assert.equal(JSON.parse(response.body).id, 'ack-request-1');
      },
    );
  });
  assert.equal(fullRowReads, 1);
});
