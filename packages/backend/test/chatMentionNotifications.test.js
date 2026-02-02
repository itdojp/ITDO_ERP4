import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterChatAllPostRecipients,
  filterChatMentionRecipients,
} from '../dist/services/appNotifications.js';

function createClient({ roomSettings = [], userPreferences = [] } = {}) {
  return {
    chatRoomNotificationSetting: {
      findMany: async () => roomSettings,
    },
    userNotificationPreference: {
      findMany: async () => userPreferences,
    },
  };
}

test('filterChatMentionRecipients: returns all when roomId missing', async () => {
  const res = await filterChatMentionRecipients({
    roomId: null,
    userIds: ['u1', 'u2'],
  });
  assert.deepEqual(res, { allowed: ['u1', 'u2'], muted: [] });
});

test('filterChatMentionRecipients: respects muteAllUntil and room settings', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    roomSettings: [
      { userId: 'u1', notifyMentions: false, muteUntil: null },
      {
        userId: 'u2',
        notifyMentions: true,
        muteUntil: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        userId: 'u3',
        notifyMentions: true,
        muteUntil: new Date('2025-12-01T00:00:00.000Z'),
      },
    ],
    userPreferences: [
      { userId: 'u4', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterChatMentionRecipients({
    roomId: 'room1',
    userIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    client,
    now,
  });

  assert.deepEqual(res.allowed.sort(), ['u3', 'u5'].sort());
  assert.deepEqual(res.muted.sort(), ['u1', 'u2', 'u4'].sort());
});

test('filterChatAllPostRecipients: respects muteAllUntil and room settings', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    roomSettings: [
      { userId: 'u1', notifyAllPosts: false, muteUntil: null },
      {
        userId: 'u2',
        notifyAllPosts: true,
        muteUntil: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        userId: 'u3',
        notifyAllPosts: true,
        muteUntil: new Date('2025-12-01T00:00:00.000Z'),
      },
    ],
    userPreferences: [
      { userId: 'u4', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterChatAllPostRecipients({
    roomId: 'room1',
    userIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    client,
    now,
  });

  assert.deepEqual(res.allowed.sort(), ['u3', 'u5'].sort());
  assert.deepEqual(res.muted.sort(), ['u1', 'u2', 'u4'].sort());
});
