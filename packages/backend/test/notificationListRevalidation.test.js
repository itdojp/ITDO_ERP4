import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { buildNotificationPushFailureLog } from '../dist/services/appNotifications.js';
import { prisma } from '../dist/services/db.js';

const now = new Date('2026-08-09T00:00:00.000Z');
const headers = {
  'x-user-id': 'viewer-1',
  'x-roles': 'user',
};

test('notification push failure log exposes only bounded classification', () => {
  assert.deepEqual(buildNotificationPushFailureLog('chat_mention'), {
    phase: 'notification_push_dispatch',
    errorClass: 'notification_failure',
    errorType: 'unknown_error',
    kind: 'chat_mention',
  });
  const privateKind =
    'chat_mention private-message-id credential=private-token';
  const serialized = JSON.stringify(
    buildNotificationPushFailureLog(privateKind),
  );
  assert.equal(serialized.includes('private-message-id'), false);
  assert.equal(serialized.includes('private-token'), false);
  assert.deepEqual(buildNotificationPushFailureLog(privateKind), {
    phase: 'notification_push_dispatch',
    errorClass: 'notification_failure',
    errorType: 'unknown_error',
    kind: 'unknown',
  });
  const privateError = new TypeError(
    'private-message-id credential=private-token',
  );
  privateError.name = 'credential=private-token';
  const errorLog = buildNotificationPushFailureLog(
    'chat_message',
    privateError,
  );
  assert.deepEqual(errorLog, {
    phase: 'notification_push_dispatch',
    errorClass: 'notification_failure',
    errorType: 'type_error',
    kind: 'chat_message',
  });
  assert.equal(JSON.stringify(errorLog).includes('private-token'), false);
  assert.equal(
    buildNotificationPushFailureLog('chat_message', {
      name: 'private-token',
    }).errorType,
    'non_error',
  );
});

function notification(overrides = {}) {
  return {
    id: 'notification-1',
    userId: 'viewer-1',
    kind: 'chat_message',
    projectId: null,
    messageId: 'message-visible',
    payload: {
      fromUserId: 'sender-1',
      roomId: 'room-visible',
      excerpt: 'visible excerpt',
    },
    readAt: null,
    createdAt: now,
    createdBy: 'sender-1',
    updatedAt: now,
    updatedBy: 'sender-1',
    project: null,
    ...overrides,
  };
}

function room(id, overrides = {}) {
  return {
    id,
    type: 'private_group',
    projectId: null,
    isOfficial: false,
    groupId: null,
    viewerGroupIds: [],
    posterGroupIds: [],
    deletedAt: null,
    allowExternalUsers: false,
    ...overrides,
  };
}

function message(id, messageRoom, overrides = {}) {
  return {
    id,
    roomId: messageRoom.id,
    deletedAt: null,
    room: messageRoom,
    ...overrides,
  };
}

async function withNotificationListServer(fixtures, run) {
  const originalNotificationFindMany = prisma.appNotification.findMany;
  const originalNotificationCount = prisma.appNotification.count;
  const originalMessageFindMany = prisma.chatMessage.findMany;
  const originalRoomFindMany = prisma.chatRoom.findMany;
  const originalMemberFindMany = prisma.chatRoomMember.findMany;
  const originalTransaction = prisma.$transaction;
  const previousAuthMode = process.env.AUTH_MODE;
  const calls = {
    notifications: [],
    counts: [],
    messages: [],
    rooms: [],
    memberships: [],
    transactions: [],
  };

  process.env.AUTH_MODE = 'header';
  prisma.appNotification.findMany = async (args) => {
    calls.notifications.push(args);
    return fixtures.notifications;
  };
  prisma.appNotification.count = async (args) => {
    calls.counts.push(args);
    return fixtures.unreadCount ?? fixtures.notifications.length;
  };
  prisma.chatMessage.findMany = async (args) => {
    calls.messages.push(args);
    return fixtures.messages ?? [];
  };
  prisma.chatRoom.findMany = async (args) => {
    calls.rooms.push(args);
    return fixtures.rooms ?? [];
  };
  prisma.chatRoomMember.findMany = async (args) => {
    calls.memberships.push(args);
    return fixtures.memberships ?? [];
  };
  prisma.$transaction = async (operation, options) => {
    calls.transactions.push(options);
    return operation(prisma);
  };

  const server = await buildServer({ logger: false });
  try {
    await run(server, calls);
  } finally {
    await server.close();
    prisma.appNotification.findMany = originalNotificationFindMany;
    prisma.appNotification.count = originalNotificationCount;
    prisma.chatMessage.findMany = originalMessageFindMany;
    prisma.chatRoom.findMany = originalRoomFindMany;
    prisma.chatRoomMember.findMany = originalMemberFindMany;
    prisma.$transaction = originalTransaction;
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
  }
}

function redactedReferenceSurface(item) {
  return {
    projectId: item.projectId,
    messageId: item.messageId,
    payload: item.payload,
    project: item.project,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
  };
}

const expectedRedactedReferenceSurface = {
  projectId: null,
  messageId: null,
  payload: { redacted: true },
  project: null,
  createdBy: null,
  updatedBy: null,
};

test('notification list preserves an allowed chat notification and a non-chat notification', async () => {
  const visibleRoom = room('room-visible');
  const visibleChat = notification({
    internalProviderSecret: 'allowed-row-internal-secret',
    payload: {
      fromUserId: 'sender-1',
      roomId: visibleRoom.id,
      excerpt: 'visible excerpt',
      internalProviderSecret: 'payload-internal-secret',
    },
  });
  const visibleRoomAlert = notification({
    id: 'notification-room-alert',
    kind: 'chat_room_acl_mismatch',
    messageId: visibleRoom.id,
    payload: {
      roomId: visibleRoom.id,
      roomName: 'Visible room',
      mismatchGroupIds: ['group-1'],
    },
  });
  const nonChat = notification({
    id: 'notification-non-chat',
    kind: 'expense_mark_paid',
    projectId: 'project-accounting',
    messageId: 'expense-1',
    payload: { expenseId: 'expense-1', amount: '1200' },
    project: {
      id: 'project-accounting',
      code: 'ACCOUNTING',
      name: 'Accounting project',
      deletedAt: null,
    },
  });

  await withNotificationListServer(
    {
      notifications: [visibleChat, visibleRoomAlert, nonChat],
      messages: [message('message-visible', visibleRoom)],
      rooms: [visibleRoom],
      memberships: [{ roomId: visibleRoom.id, role: 'owner', deletedAt: null }],
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications?limit=200',
        headers,
      });

      assert.equal(response.statusCode, 200, response.body);
      const items = response.json().items;
      assert.deepEqual(items[0].payload, {
        fromUserId: 'sender-1',
        roomId: visibleRoom.id,
        excerpt: 'visible excerpt',
      });
      assert.equal(items[0].messageId, visibleChat.messageId);
      assert.deepEqual(items[0].project, visibleChat.project);
      assert.deepEqual(items[1].payload, visibleRoomAlert.payload);
      assert.equal(items[1].messageId, visibleRoomAlert.messageId);
      assert.deepEqual(items[2].payload, nonChat.payload);
      assert.equal(items[2].messageId, nonChat.messageId);
      assert.deepEqual(items[2].project, nonChat.project);
      assert.equal(
        response.body.includes('allowed-row-internal-secret'),
        false,
      );
      assert.equal(response.body.includes('payload-internal-secret'), false);
      assert.equal(Object.hasOwn(items[0], 'internalProviderSecret'), false);
      assert.equal(calls.notifications.length, 1);
      assert.equal(calls.notifications[0].take, 200);
      assert.equal(calls.messages.length, 1);
      assert.deepEqual(calls.messages[0].where.id.in, ['message-visible']);
      assert.equal(Object.hasOwn(calls.messages[0].select, 'body'), false);
      assert.equal(calls.rooms.length, 1);
      assert.deepEqual(calls.rooms[0].where.id.in, [visibleRoom.id]);
      assert.equal(calls.memberships.length, 1);
      assert.deepEqual(calls.transactions, [
        { isolationLevel: 'RepeatableRead' },
      ]);
    },
  );
});

test('notification list drops unknown fields and redacts a mismatched project reference', async () => {
  const projectRoom = room('room-project-alias', {
    type: 'project',
    projectId: 'project-canonical',
  });
  const secret = 'internal-provider-secret';
  await withNotificationListServer(
    {
      notifications: [
        notification({
          id: 'notification-project-mismatch',
          projectId: 'project-unrelated',
          messageId: 'message-project-alias',
          payload: {
            roomId: projectRoom.id,
            excerpt: 'must be redacted',
          },
          project: {
            id: 'project-unrelated',
            code: 'UNRELATED',
            name: 'Unrelated project',
            deletedAt: null,
          },
          internalProviderSecret: secret,
        }),
      ],
      messages: [message('message-project-alias', projectRoom)],
      rooms: [projectRoom],
    },
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications',
        headers: { ...headers, 'x-project-ids': 'project-canonical' },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(
        redactedReferenceSurface(response.json().items[0]),
        expectedRedactedReferenceSurface,
      );
      assert.equal(response.body.includes(secret), false);
      assert.equal(response.body.includes('project-unrelated'), false);
      assert.equal(response.body.includes('Unrelated project'), false);
      assert.equal(
        Object.hasOwn(response.json().items[0], 'internalProviderSecret'),
        false,
      );
    },
  );
});

test('room ACL mismatch alert requires a current owner or admin membership', async () => {
  const roomId = 'room-alert-restricted';
  const roomName = 'Restricted room name';
  const restrictedRoom = room(roomId);

  await withNotificationListServer(
    {
      notifications: [
        notification({
          kind: 'chat_room_acl_mismatch',
          projectId: roomId,
          messageId: roomId,
          payload: {
            roomId,
            roomName,
            mismatchGroupIds: ['restricted-group'],
          },
        }),
      ],
      rooms: [restrictedRoom],
      memberships: [{ roomId, role: 'member', deletedAt: null }],
    },
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications',
        headers,
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(
        redactedReferenceSurface(response.json().items[0]),
        expectedRedactedReferenceSurface,
      );
      for (const secret of [roomId, roomName, 'restricted-group']) {
        assert.equal(response.body.includes(secret), false, secret);
      }
    },
  );
});

test('notification list gives deleted and missing message references the same redacted surface', async () => {
  const deletedMessageId = 'message-deleted-secret';
  const deletedRoomId = 'room-deleted-secret';
  const missingMessageId = 'message-missing-secret';
  const missingRoomId = 'room-missing-secret';
  const deletedExcerpt = 'deleted excerpt must not leak';
  const missingExcerpt = 'missing excerpt must not leak';
  const deletedRoom = room(deletedRoomId);

  await withNotificationListServer(
    {
      notifications: [
        notification({
          id: 'notification-deleted',
          kind: 'chat_mention',
          projectId: deletedRoomId,
          messageId: deletedMessageId,
          payload: {
            roomId: deletedRoomId,
            excerpt: deletedExcerpt,
          },
          project: {
            id: deletedRoomId,
            code: 'DELETED',
            name: deletedExcerpt,
            deletedAt: null,
          },
        }),
        notification({
          id: 'notification-missing',
          kind: 'chat_ack_escalation',
          projectId: missingRoomId,
          messageId: missingMessageId,
          payload: {
            roomId: missingRoomId,
            excerpt: missingExcerpt,
            dueAt: '2026-08-09T01:00:00.000Z',
          },
          project: {
            id: missingRoomId,
            code: 'MISSING',
            name: missingExcerpt,
            deletedAt: null,
          },
        }),
      ],
      messages: [message(deletedMessageId, deletedRoom, { deletedAt: now })],
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications',
        headers,
      });

      assert.equal(response.statusCode, 200, response.body);
      const items = response.json().items;
      assert.deepEqual(
        redactedReferenceSurface(items[0]),
        expectedRedactedReferenceSurface,
      );
      assert.deepEqual(
        redactedReferenceSurface(items[1]),
        expectedRedactedReferenceSurface,
      );
      for (const secret of [
        deletedMessageId,
        deletedRoomId,
        missingMessageId,
        missingRoomId,
        deletedExcerpt,
        missingExcerpt,
      ]) {
        assert.equal(response.body.includes(secret), false, secret);
      }
      assert.equal(calls.messages.length, 1);
      assert.deepEqual(
        new Set(calls.messages[0].where.id.in),
        new Set([deletedMessageId, missingMessageId]),
      );
      assert.equal(calls.memberships.length, 0);
      assert.equal(calls.rooms.length, 0);
    },
  );
});

test('notification list fails closed for an unknown future chat notification kind', async () => {
  const secret = 'future-chat-secret';
  await withNotificationListServer(
    {
      notifications: [
        notification({
          kind: 'chat_future_private_event',
          projectId: 'future-private-project',
          messageId: 'future-private-message',
          payload: { excerpt: secret, roomId: 'future-private-room' },
          createdBy: 'future-private-sender',
          updatedBy: 'future-private-sender',
        }),
      ],
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications',
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(
        redactedReferenceSurface(response.json().items[0]),
        expectedRedactedReferenceSurface,
      );
      for (const value of [
        secret,
        'future-private-project',
        'future-private-message',
        'future-private-room',
        'future-private-sender',
      ]) {
        assert.equal(response.body.includes(value), false);
      }
      assert.equal(calls.messages.length, 0);
      assert.equal(calls.rooms.length, 0);
      assert.equal(calls.memberships.length, 0);
    },
  );
});

test('notification list batches membership ACL checks and redacts a revoked room without identifier leaks', async () => {
  const allowedMessageId = 'message-member-allowed';
  const allowedRoomId = 'room-member-allowed';
  const revokedMessageId = 'message-revoked-secret';
  const revokedRoomId = 'room-revoked-secret';
  const revokedExcerpt = 'revoked excerpt must not leak';
  const allowedRoom = room(allowedRoomId);
  const revokedRoom = room(revokedRoomId);

  await withNotificationListServer(
    {
      notifications: [
        notification({
          id: 'notification-member-allowed',
          messageId: allowedMessageId,
          payload: {
            roomId: allowedRoomId,
            excerpt: 'member-visible excerpt',
          },
        }),
        notification({
          id: 'notification-revoked',
          kind: 'chat_ack_required',
          projectId: revokedRoomId,
          messageId: revokedMessageId,
          payload: {
            roomId: revokedRoomId,
            excerpt: revokedExcerpt,
            dueAt: '2026-08-09T01:00:00.000Z',
          },
          project: {
            id: revokedRoomId,
            code: 'REVOKED',
            name: revokedExcerpt,
            deletedAt: null,
          },
        }),
        notification({
          id: 'notification-room-revoked',
          kind: 'chat_room_acl_mismatch',
          projectId: revokedRoomId,
          messageId: revokedRoomId,
          payload: {
            roomId: revokedRoomId,
            roomName: revokedExcerpt,
            mismatchGroupIds: ['revoked-group-secret'],
          },
          project: {
            id: revokedRoomId,
            code: 'ROOM-REVOKED',
            name: revokedExcerpt,
            deletedAt: null,
          },
        }),
      ],
      messages: [
        message(allowedMessageId, allowedRoom),
        message(revokedMessageId, revokedRoom),
      ],
      rooms: [allowedRoom, revokedRoom],
      memberships: [{ roomId: allowedRoomId, role: 'member' }],
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'GET',
        url: '/notifications',
        headers,
      });

      assert.equal(response.statusCode, 200, response.body);
      const items = response.json().items;
      assert.equal(items[0].messageId, allowedMessageId);
      assert.equal(items[0].payload.roomId, allowedRoomId);
      assert.deepEqual(
        redactedReferenceSurface(items[1]),
        expectedRedactedReferenceSurface,
      );
      assert.deepEqual(
        redactedReferenceSurface(items[2]),
        expectedRedactedReferenceSurface,
      );
      for (const secret of [
        revokedMessageId,
        revokedRoomId,
        revokedExcerpt,
        'revoked-group-secret',
      ]) {
        assert.equal(response.body.includes(secret), false, secret);
      }
      assert.equal(calls.messages.length, 1);
      assert.equal(calls.rooms.length, 1);
      assert.deepEqual(
        new Set(calls.rooms[0].where.id.in),
        new Set([allowedRoomId, revokedRoomId]),
      );
      assert.equal(calls.memberships.length, 1);
      assert.equal(calls.memberships[0].where.userId, 'viewer-1');
      assert.equal(calls.memberships[0].where.deletedAt, null);
      assert.deepEqual(
        new Set(calls.memberships[0].where.roomId.in),
        new Set([allowedRoomId, revokedRoomId]),
      );
    },
  );
});

test('unread count retains content-unavailable notification events without exposing chat references', async () => {
  const revokedMessageId = 'message-revoked-unread-secret';
  const revokedRoomId = 'room-revoked-unread-secret';
  const revokedRoom = room(revokedRoomId);
  await withNotificationListServer(
    {
      notifications: [
        notification({
          kind: 'chat_ack_required',
          projectId: revokedRoomId,
          messageId: revokedMessageId,
          payload: {
            roomId: revokedRoomId,
            excerpt: 'revoked unread excerpt',
          },
        }),
      ],
      messages: [message(revokedMessageId, revokedRoom)],
      rooms: [revokedRoom],
      memberships: [],
      unreadCount: 1,
    },
    async (server, calls) => {
      const listResponse = await server.inject({
        method: 'GET',
        url: '/notifications?unread=1',
        headers,
      });
      assert.equal(listResponse.statusCode, 200, listResponse.body);
      assert.deepEqual(
        redactedReferenceSurface(listResponse.json().items[0]),
        expectedRedactedReferenceSurface,
      );

      const countResponse = await server.inject({
        method: 'GET',
        url: '/notifications/unread-count',
        headers,
      });
      assert.equal(countResponse.statusCode, 200, countResponse.body);
      assert.deepEqual(countResponse.json(), { unreadCount: 1 });
      assert.deepEqual(calls.counts, [
        { where: { userId: 'viewer-1', readAt: null } },
      ]);
      assert.equal(countResponse.body.includes(revokedMessageId), false);
      assert.equal(countResponse.body.includes(revokedRoomId), false);
    },
  );
});
