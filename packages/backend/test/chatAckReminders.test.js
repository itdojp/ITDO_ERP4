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
          const mutedUntil = item.muteAllUntil instanceof Date ? item.muteAllUntil : null;
          const threshold = where?.muteAllUntil?.gt;
          return Boolean(inScope && mutedUntil && threshold && mutedUntil > threshold);
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
          if (where?.messageId?.in && !where.messageId.in.includes(item.messageId)) {
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
        message: { userId: 'sender-user', body: '期限確認してください' },
        room: { type: 'company' },
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
        message: { userId: 'sender-user', body: '進捗を確認してください' },
        room: { type: 'company' },
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
  });

  assert.equal(result.candidateNotifications, 1);
  assert.equal(result.candidateEscalations, 0);
  assert.equal(result.createdNotifications, 0);
  assert.equal(result.createdEscalations, 0);
  assert.deepEqual(createdNotifications, []);
});
