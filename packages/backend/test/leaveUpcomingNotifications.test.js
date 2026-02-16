import assert from 'node:assert/strict';
import test from 'node:test';

import { runLeaveUpcomingNotifications } from '../dist/services/leaveUpcomingNotifications.js';

function createClient({
  leaveRequests = [],
  userPreferences = [],
  existingNotifications = [],
} = {}) {
  const createdNotifications = [];
  const client = {
    leaveRequest: {
      findMany: async () => leaveRequests,
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
    appNotification: {
      findMany: async ({ where }) =>
        existingNotifications.filter((item) => {
          if (where?.kind && item.kind !== where.kind) return false;
          if (where?.messageId && item.messageId !== where.messageId)
            return false;
          if (where?.userId?.in && !where.userId.in.includes(item.userId))
            return false;
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

test('runLeaveUpcomingNotifications: global mute suppresses leave_upcoming for non-bypass kind', async () => {
  const { client, createdNotifications } = createClient({
    leaveRequests: [
      {
        id: 'leave-1',
        userId: 'employee-1',
        leaveType: 'paid',
        startDate: new Date('2026-03-15T00:00:00.000Z'),
        endDate: new Date('2026-03-15T00:00:00.000Z'),
      },
    ],
    userPreferences: [
      {
        userId: 'employee-1',
        muteAllUntil: new Date('2026-04-01T00:00:00.000Z'),
      },
    ],
  });

  const result = await runLeaveUpcomingNotifications({
    targetDate: '2026-03-15',
    actorId: 'admin-user',
    client,
    resolveRoleRecipients: async () => [],
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.createdNotifications, 0);
  assert.equal(result.skippedExistingNotifications, 0);
  assert.deepEqual(createdNotifications, []);
});

test('runLeaveUpcomingNotifications: skips existing recipient notifications and creates for remaining recipients', async () => {
  const { client, createdNotifications } = createClient({
    leaveRequests: [
      {
        id: 'leave-2',
        userId: 'employee-2',
        leaveType: 'paid',
        startDate: new Date('2026-03-16T00:00:00.000Z'),
        endDate: new Date('2026-03-17T00:00:00.000Z'),
      },
    ],
    existingNotifications: [
      {
        kind: 'leave_upcoming',
        messageId: 'leave-2',
        userId: 'employee-2',
      },
    ],
  });

  const result = await runLeaveUpcomingNotifications({
    targetDate: '2026-03-16',
    actorId: 'admin-user',
    client,
    resolveRoleRecipients: async () => ['manager-1'],
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.createdNotifications, 1);
  assert.equal(result.skippedExistingNotifications, 1);
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].userId, 'manager-1');
  assert.equal(createdNotifications[0].kind, 'leave_upcoming');
  assert.equal(createdNotifications[0].messageId, 'leave-2');
  assert.equal(createdNotifications[0].payload.startDate, '2026-03-16');
  assert.equal(createdNotifications[0].payload.endDate, '2026-03-17');
});

test('runLeaveUpcomingNotifications: dryRun reports candidate count without creating records', async () => {
  const { client, createdNotifications } = createClient({
    leaveRequests: [
      {
        id: 'leave-3',
        userId: 'employee-3',
        leaveType: 'paid',
        startDate: new Date('2026-03-18T00:00:00.000Z'),
        endDate: new Date('2026-03-18T00:00:00.000Z'),
      },
    ],
  });

  const result = await runLeaveUpcomingNotifications({
    targetDate: '2026-03-18',
    dryRun: true,
    client,
    resolveRoleRecipients: async () => ['manager-2'],
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.createdNotifications, 2);
  assert.deepEqual(createdNotifications, []);
});
