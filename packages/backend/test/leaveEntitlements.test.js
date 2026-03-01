import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePaidLeaveBalance,
  resolveLeaveRequestMinutes,
} from '../dist/services/leaveEntitlements.js';

function createClient({
  leaveSetting,
  profile,
  grants = [],
  leaveRequests = [],
} = {}) {
  return {
    leaveSetting: {
      upsert: async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
        paidLeaveAdvanceMaxMinutes: 480,
        paidLeaveAdvanceRequireNextGrantWithinDays: 60,
        ...(leaveSetting || {}),
      }),
    },
    leaveEntitlementProfile: {
      findUnique: async () => profile || null,
    },
    leaveGrant: {
      findMany: async () => grants,
    },
    leaveRequest: {
      findMany: async () => leaveRequests,
    },
  };
}

test('resolveLeaveRequestMinutes: falls back to default workday for daily leave without hours/minutes', () => {
  const minutes = resolveLeaveRequestMinutes({
    leave: {
      startDate: new Date('2026-03-01T00:00:00.000Z'),
      endDate: new Date('2026-03-02T00:00:00.000Z'),
      hours: null,
      minutes: null,
      startTimeMinutes: null,
      endTimeMinutes: null,
    },
    defaultWorkdayMinutes: 480,
  });
  assert.equal(minutes, 960);
});

test('computePaidLeaveBalance: returns advance warning within policy', async () => {
  const client = createClient({
    leaveSetting: {
      paidLeaveAdvanceMaxMinutes: 480,
      paidLeaveAdvanceRequireNextGrantWithinDays: 60,
    },
    profile: {
      paidLeaveBaseDate: new Date('2025-04-01T00:00:00.000Z'),
      nextGrantDueDate: new Date('2026-04-15T00:00:00.000Z'),
    },
    grants: [{ grantedMinutes: 480 }],
    leaveRequests: [
      {
        status: 'approved',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-01T00:00:00.000Z'),
        hours: 6,
        minutes: null,
        startTimeMinutes: null,
        endTimeMinutes: null,
      },
    ],
  });

  const balance = await computePaidLeaveBalance({
    userId: 'employee-1',
    additionalRequestedMinutes: 180,
    asOfDate: new Date('2026-03-10T00:00:00.000Z'),
    client,
  });

  assert.equal(balance.totalGrantedMinutes, 480);
  assert.equal(balance.usedApprovedMinutes, 360);
  assert.equal(balance.remainingMinutes, 120);
  assert.equal(balance.projectedRemainingMinutes, -60);
  assert.equal(balance.shortageWarning?.code, 'PAID_LEAVE_ADVANCE_WARNING');
  assert.equal(balance.shortageWarning?.advanceAllowed, true);
});

test('computePaidLeaveBalance: returns shortage warning outside policy', async () => {
  const client = createClient({
    leaveSetting: {
      paidLeaveAdvanceMaxMinutes: 120,
      paidLeaveAdvanceRequireNextGrantWithinDays: 30,
    },
    profile: {
      paidLeaveBaseDate: new Date('2025-04-01T00:00:00.000Z'),
      nextGrantDueDate: new Date('2026-06-30T00:00:00.000Z'),
    },
    grants: [{ grantedMinutes: 480 }],
    leaveRequests: [
      {
        status: 'pending_manager',
        startDate: new Date('2026-03-15T00:00:00.000Z'),
        endDate: new Date('2026-03-15T00:00:00.000Z'),
        hours: 8,
        minutes: null,
        startTimeMinutes: null,
        endTimeMinutes: null,
      },
    ],
  });

  const balance = await computePaidLeaveBalance({
    userId: 'employee-2',
    additionalRequestedMinutes: 240,
    asOfDate: new Date('2026-03-10T00:00:00.000Z'),
    client,
  });

  assert.equal(balance.totalGrantedMinutes, 480);
  assert.equal(balance.reservedPendingMinutes, 480);
  assert.equal(balance.projectedRemainingMinutes, -240);
  assert.equal(balance.shortageWarning?.code, 'PAID_LEAVE_SHORTAGE_WARNING');
  assert.equal(balance.shortageWarning?.advanceAllowed, false);
});
