import assert from 'node:assert/strict';
import test from 'node:test';

import { runChatAckReminders } from '../dist/services/chatAckReminders.js';

function createClient({
  requests = [],
  userPreferences = [],
  roomSettings = [],
  existingNotifications = [],
} = {}) {
  const createdNotifications = [];
  const client = {
    chatAckRequest: {
      findMany: async () => requests,
    },
    userNotificationPreference: {
      findMany: async ({ where }) =>
        userPreferences.filter((item) => {
          const inScope = where?.userId?.in?.includes(item.userId);
          const mutedUntil =
            item.muteAllUntil instanceof Date ? item.muteAllUntil : null;
          const threshold = where?.muteAllUntil?.gt;
          return Boolean(
            inScope && mutedUntil && threshold && mutedUntil > threshold,
          );
        }),
    },
    chatRoomNotificationSetting: {
      findMany: async ({ where }) =>
        roomSettings.filter(
          (item) =>
            item.roomId === where?.roomId &&
            where?.userId?.in?.includes(item.userId),
        ),
    },
    appNotification: {
      findMany: async ({ where }) =>
        existingNotifications.filter((item) => {
          if (where?.kind && item.kind !== where.kind) return false;
          if (
            where?.messageId?.in &&
            !where.messageId.in.includes(item.messageId)
          ) {
            return false;
          }
          if (where?.userId?.in && !where.userId.in.includes(item.userId)) {
            return false;
          }
          if (where?.createdAt?.gte && item.createdAt < where.createdAt.gte) {
            return false;
          }
          return true;
        }),
      createMany: async ({ data }) => {
        createdNotifications.push(...data);
        return { count: data.length };
      },
    },
  };
  return { client, createdNotifications };
}

test('runChatAckReminders: chat_ack_escalation is delivered even when user is globally muted', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'room-company',
        messageId: 'msg-1',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['required-user'],
        remindIntervalHours: 24,
        escalationAfterHours: 1,
        escalationUserIds: ['escalation-user'],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: '期限確認してください',
          roomId: 'room-company',
          deletedAt: null,
        },
        room: {
          id: 'room-company',
          type: 'company',
          projectId: null,
          deletedAt: null,
        },
      },
    ],
    userPreferences: [
      {
        userId: 'required-user',
        muteAllUntil: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        userId: 'escalation-user',
        muteAllUntil: new Date('2026-03-01T00:00:00.000Z'),
      },
    ],
    roomSettings: [
      {
        roomId: 'room-company',
        userId: 'required-user',
        notifyMentions: true,
        muteUntil: null,
      },
    ],
  });

  const result = await runChatAckReminders({
    client,
    now,
    actorId: 'admin-user',
    resolveRecipients: async () => ['escalation-user'],
    filterVisibleRecipients: async ({ userIds }) => userIds,
  });

  assert.equal(result.candidateNotifications, 1);
  assert.equal(result.candidateEscalations, 1);
  assert.equal(result.createdNotifications, 1);
  assert.equal(result.createdEscalations, 1);
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].kind, 'chat_ack_escalation');
  assert.equal(createdNotifications[0].userId, 'escalation-user');
  assert.equal(createdNotifications[0].messageId, 'msg-1');
});

test('runChatAckReminders: chat_ack_required reminder is muted by muteAllUntil', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'room-company',
        messageId: 'msg-2',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['required-user'],
        remindIntervalHours: 24,
        escalationAfterHours: null,
        escalationUserIds: [],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: '進捗を確認してください',
          roomId: 'room-company',
          deletedAt: null,
        },
        room: {
          id: 'room-company',
          type: 'company',
          projectId: null,
          deletedAt: null,
        },
      },
    ],
    userPreferences: [
      {
        userId: 'required-user',
        muteAllUntil: new Date('2026-03-01T00:00:00.000Z'),
      },
    ],
    roomSettings: [
      {
        roomId: 'room-company',
        userId: 'required-user',
        notifyMentions: true,
        muteUntil: null,
      },
    ],
  });

  const result = await runChatAckReminders({
    client,
    now,
    actorId: 'admin-user',
    filterVisibleRecipients: async ({ userIds }) => userIds,
  });

  assert.equal(result.candidateNotifications, 1);
  assert.equal(result.candidateEscalations, 0);
  assert.equal(result.createdNotifications, 0);
  assert.equal(result.createdEscalations, 0);
  assert.deepEqual(createdNotifications, []);
});

test('runChatAckReminders: project notification uses canonical project alias', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'room-alias',
        messageId: 'msg-project',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['required-user'],
        remindIntervalHours: 24,
        escalationAfterHours: null,
        escalationUserIds: [],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: '確認してください',
          roomId: 'room-alias',
          deletedAt: null,
        },
        room: {
          id: 'room-alias',
          type: 'project',
          projectId: 'project-canonical',
          deletedAt: null,
        },
      },
    ],
  });

  const result = await runChatAckReminders({
    client,
    now,
    actorId: 'admin-user',
    filterVisibleRecipients: async ({ userIds }) => userIds,
  });

  assert.equal(result.createdNotifications, 1);
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].projectId, 'project-canonical');
  assert.equal(createdNotifications[0].payload.roomId, 'room-alias');
});

test('runChatAckReminders: legacy project room without projectId falls back to roomId', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'legacy-project-room',
        messageId: 'msg-legacy',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['required-user'],
        remindIntervalHours: 24,
        escalationAfterHours: null,
        escalationUserIds: [],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: '確認してください',
          roomId: 'legacy-project-room',
          deletedAt: null,
        },
        room: {
          id: 'legacy-project-room',
          type: 'project',
          projectId: null,
          deletedAt: null,
        },
      },
    ],
  });

  const result = await runChatAckReminders({
    client,
    now,
    filterVisibleRecipients: async ({ userIds }) => userIds,
  });

  assert.equal(result.createdNotifications, 1);
  assert.equal(createdNotifications[0].projectId, 'legacy-project-room');
});

test('runChatAckReminders: skips request/message room mismatch before recipient delivery', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'room-1',
        messageId: 'message-1',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['required-user'],
        remindIntervalHours: 24,
        escalationAfterHours: null,
        escalationUserIds: [],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: 'must not be delivered',
          roomId: 'different-room',
          deletedAt: null,
        },
        room: {
          id: 'room-1',
          type: 'company',
          projectId: null,
          deletedAt: null,
        },
      },
    ],
  });
  let visibilityCalls = 0;
  const result = await runChatAckReminders({
    client,
    now,
    filterVisibleRecipients: async () => {
      visibilityCalls += 1;
      return ['required-user'];
    },
  });
  assert.equal(result.candidateNotifications, 0);
  assert.equal(visibilityCalls, 0);
  assert.deepEqual(createdNotifications, []);
});

test('runChatAckReminders: revalidates current chat visibility immediately before create', async () => {
  const now = new Date('2026-02-10T00:00:00.000Z');
  const { client, createdNotifications } = createClient({
    requests: [
      {
        roomId: 'room-1',
        messageId: 'message-1',
        dueAt: new Date('2026-02-09T00:00:00.000Z'),
        requiredUserIds: ['revoked-user'],
        remindIntervalHours: 24,
        escalationAfterHours: null,
        escalationUserIds: [],
        escalationGroupIds: [],
        escalationRoles: [],
        acks: [],
        message: {
          userId: 'sender-user',
          body: 'must not be delivered',
          roomId: 'room-1',
          deletedAt: null,
        },
        room: {
          id: 'room-1',
          type: 'company',
          projectId: null,
          deletedAt: null,
        },
      },
    ],
  });
  const result = await runChatAckReminders({
    client,
    now,
    filterVisibleRecipients: async () => [],
  });
  assert.equal(result.candidateNotifications, 1);
  assert.equal(result.createdNotifications, 0);
  assert.deepEqual(createdNotifications, []);
});
