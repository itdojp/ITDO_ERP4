import assert from 'node:assert/strict';
import test from 'node:test';

import { filterNotificationRecipients } from '../dist/services/appNotifications.js';

function createClient({ roomSettings = [], userPreferences = [] } = {}) {
  return {
    chatRoomNotificationSetting: {
      findMany: async ({ where } = {}) =>
        roomSettings.filter((item) => {
          if (where?.roomId && item.roomId !== where.roomId) return false;
          if (where?.userId?.in && !where.userId.in.includes(item.userId)) {
            return false;
          }
          return true;
        }),
    },
    userNotificationPreference: {
      findMany: async ({ where } = {}) =>
        userPreferences.filter((item) => {
          if (where?.userId?.in && !where.userId.in.includes(item.userId)) {
            return false;
          }
          const muteAllUntil =
            item.muteAllUntil instanceof Date ? item.muteAllUntil : null;
          if (where?.muteAllUntil?.gt) {
            return Boolean(
              muteAllUntil && muteAllUntil > where.muteAllUntil.gt,
            );
          }
          return true;
        }),
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
      {
        roomId: 'room-1',
        userId: 'u1',
        notifyMentions: false,
        muteUntil: null,
      },
      {
        roomId: 'room-1',
        userId: 'u2',
        notifyMentions: true,
        muteUntil: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        roomId: 'room-1',
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

test('filterNotificationRecipients: chat all posts scope applies room settings', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    roomSettings: [
      {
        roomId: 'room-1',
        userId: 'u1',
        notifyAllPosts: false,
        muteUntil: null,
      },
      {
        roomId: 'room-1',
        userId: 'u2',
        notifyAllPosts: true,
        muteUntil: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        roomId: 'room-1',
        userId: 'u3',
        notifyAllPosts: true,
        muteUntil: new Date('2025-12-01T00:00:00.000Z'),
      },
      {
        roomId: 'room-2',
        userId: 'u5',
        notifyAllPosts: false,
        muteUntil: null,
      },
    ],
    userPreferences: [
      { userId: 'u4', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterNotificationRecipients({
    kind: 'chat_message',
    scope: 'chat_all_posts',
    roomId: 'room-1',
    userIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    client,
    now,
  });

  assert.deepEqual(res.allowed.sort(), ['u3', 'u5'].sort());
  assert.deepEqual(res.muted.sort(), ['u1', 'u2', 'u4'].sort());
});

test('filterNotificationRecipients: normalizes duplicate user ids', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const client = createClient({
    roomSettings: [
      {
        roomId: 'room-1',
        userId: 'u1',
        notifyAllPosts: false,
        muteUntil: null,
      },
    ],
    userPreferences: [
      { userId: 'u2', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
    ],
  });

  const res = await filterNotificationRecipients({
    kind: 'chat_message',
    scope: 'chat_all_posts',
    roomId: 'room-1',
    userIds: [' u1 ', 'u1', '', 'u2', 'u2'],
    client,
    now,
  });

  assert.deepEqual(res.allowed, []);
  assert.deepEqual(res.muted, ['u1', 'u2']);
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

test('filterNotificationRecipients: empty bypass env disables defaults', async () => {
  const prev = process.env.NOTIFICATION_MUTE_BYPASS_KINDS;
  process.env.NOTIFICATION_MUTE_BYPASS_KINDS = '';
  try {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const client = createClient({
      userPreferences: [
        { userId: 'u1', muteAllUntil: new Date('2026-03-01T00:00:00.000Z') },
      ],
    });
    const res = await filterNotificationRecipients({
      kind: 'approval_pending',
      scope: 'global',
      userIds: ['u1'],
      client,
      now,
    });

    assert.deepEqual(res.allowed, []);
    assert.deepEqual(res.muted, ['u1']);
  } finally {
    if (prev === undefined) {
      delete process.env.NOTIFICATION_MUTE_BYPASS_KINDS;
    } else {
      process.env.NOTIFICATION_MUTE_BYPASS_KINDS = prev;
    }
  }
});
