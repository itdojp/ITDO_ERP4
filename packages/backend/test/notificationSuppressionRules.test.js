import assert from 'node:assert/strict';
import test from 'node:test';

import { filterNotificationRecipients } from '../dist/services/appNotifications.js';

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

test('filterNotificationRecipients: global scope applies muteAllUntil', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    userPreferences: [
      { userId: 'u2', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterNotificationRecipients({
    kind: 'project_member_added',
    scope: 'global',
    userIds: ['u1', 'u2'],
    client,
    now,
  });

  assert.deepEqual(res.allowed, ['u1']);
  assert.deepEqual(res.muted, ['u2']);
});

test('filterNotificationRecipients: bypass kinds are not muted', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    userPreferences: [
      { userId: 'u1', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterNotificationRecipients({
    kind: 'approval_pending',
    scope: 'global',
    userIds: ['u1', 'u2'],
    client,
    now,
  });

  assert.deepEqual(res.allowed, ['u1', 'u2']);
  assert.deepEqual(res.muted, []);
});

test('filterNotificationRecipients: chat mention scope applies room settings', async () => {
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

  const res = await filterNotificationRecipients({
    kind: 'chat_ack_required',
    scope: 'chat_mentions',
    roomId: 'room-1',
    userIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    client,
    now,
  });

  assert.deepEqual(res.allowed.sort(), ['u3', 'u5'].sort());
  assert.deepEqual(res.muted.sort(), ['u1', 'u2', 'u4'].sort());
});

test('filterNotificationRecipients: bypass kinds can be overridden by env', async () => {
  const prev = process.env.NOTIFICATION_MUTE_BYPASS_KINDS;
  process.env.NOTIFICATION_MUTE_BYPASS_KINDS = 'project_member_added';
  try {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const client = createClient({
      userPreferences: [
        { userId: 'u1', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
      ],
    });
    const res = await filterNotificationRecipients({
      kind: 'project_member_added',
      scope: 'global',
      userIds: ['u1'],
      client,
      now,
    });

    assert.deepEqual(res.allowed, ['u1']);
    assert.deepEqual(res.muted, []);
  } finally {
    if (prev === undefined) {
      delete process.env.NOTIFICATION_MUTE_BYPASS_KINDS;
    } else {
      process.env.NOTIFICATION_MUTE_BYPASS_KINDS = prev;
    }
  }
});
