import assert from 'node:assert/strict';
import test from 'node:test';

import { runLeaveEntitlementReminders } from '../dist/services/leaveEntitlementReminders.js';

function createClient({
  profiles = [],
  existingNotifications = [],
  userPreferences = [],
} = {}) {
  const createdNotifications = [];
  const client = {
    leaveEntitlementProfile: {
      findMany: async ({ where } = {}) =>
        profiles.filter((item) => {
          const due =
            item.nextGrantDueDate instanceof Date ? item.nextGrantDueDate : null;
          if (!due) return false;
          if (where?.nextGrantDueDate?.gte && due < where.nextGrantDueDate.gte) {
            return false;
          }
          if (where?.nextGrantDueDate?.lt && due >= where.nextGrantDueDate.lt) {
            return false;
          }
          return true;
        }),
    },
    userNotificationPreference: {
      findMany: async ({ where }) =>
        userPreferences.filter((item) => {
          if (!where?.userId?.in?.includes(item.userId)) return false;
          if (!(item.muteAllUntil instanceof Date)) return false;
          if (!(where?.muteAllUntil?.gt instanceof Date)) return false;
          return item.muteAllUntil > where.muteAllUntil.gt;
        }),
    },
    appNotification: {
      findMany: async ({ where }) =>
        existingNotifications.filter((item) => {
          if (where?.kind && item.kind !== where.kind) return false;
          if (where?.messageId && item.messageId !== where.messageId)
            return false;
          if (where?.userId?.in && !where.userId.in.includes(item.userId)) {
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

test('runLeaveEntitlementReminders: creates reminders for general affairs recipients', async () => {
  const { client, createdNotifications } = createClient({
    profiles: [
      {
        id: 'profile-1',
        userId: 'employee-1',
        paidLeaveBaseDate: new Date('2025-04-01T00:00:00.000Z'),
        nextGrantDueDate: new Date('2026-04-01T00:00:00.000Z'),
      },
    ],
  });

  const result = await runLeaveEntitlementReminders({
    targetDate: '2026-04-01',
    actorId: 'ga-admin',
    client,
    resolveRecipients: async () => ['ga-user-1', 'ga-user-2'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.matchedProfiles, 1);
  assert.equal(result.createdNotifications, 2);
  assert.equal(result.skippedExistingNotifications, 0);
  assert.equal(createdNotifications.length, 2);
  assert.equal(createdNotifications[0].kind, 'leave_grant_reminder');
  assert.equal(createdNotifications[0].payload.userId, 'employee-1');
  assert.equal(createdNotifications[0].payload.targetDate, '2026-04-01');
});

test('runLeaveEntitlementReminders: skips existing recipients and honors global mute', async () => {
  const { client, createdNotifications } = createClient({
    profiles: [
      {
        id: 'profile-2',
        userId: 'employee-2',
        paidLeaveBaseDate: new Date('2025-04-01T00:00:00.000Z'),
        nextGrantDueDate: new Date('2026-04-02T00:00:00.000Z'),
      },
    ],
    existingNotifications: [
      {
        kind: 'leave_grant_reminder',
        messageId: 'profile-2:2026-04-02',
        userId: 'ga-user-1',
      },
    ],
    userPreferences: [
      {
        userId: 'ga-user-2',
        muteAllUntil: new Date('2099-04-03T00:00:00.000Z'),
      },
    ],
  });

  const result = await runLeaveEntitlementReminders({
    targetDate: '2026-04-02',
    actorId: 'ga-admin',
    client,
    resolveRecipients: async () => ['ga-user-1', 'ga-user-2', 'ga-user-3'],
  });

  assert.equal(result.matchedProfiles, 1);
  assert.equal(result.createdNotifications, 1);
  assert.equal(result.skippedExistingNotifications, 1);
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].userId, 'ga-user-3');
});

test('runLeaveEntitlementReminders: dryRun reports count without creating records', async () => {
  const { client, createdNotifications } = createClient({
    profiles: [
      {
        id: 'profile-3',
        userId: 'employee-3',
        paidLeaveBaseDate: new Date('2025-04-01T00:00:00.000Z'),
        nextGrantDueDate: new Date('2026-04-03T00:00:00.000Z'),
      },
    ],
  });

  const result = await runLeaveEntitlementReminders({
    targetDate: '2026-04-03',
    dryRun: true,
    client,
    resolveRecipients: async () => ['ga-user-1'],
  });

  assert.equal(result.matchedProfiles, 1);
  assert.equal(result.createdNotifications, 1);
  assert.deepEqual(createdNotifications, []);
});
