import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LeaveCompBalanceShortageError,
  computeCompLeaveBalance,
  consumeCompLeaveForRequest,
} from '../dist/services/leaveCompGrants.js';

function createCalendarClient({
  defaultWorkdayMinutes = 480,
  workdayOverrides = [],
  companyHolidays = [],
} = {}) {
  const toMillis = (value) =>
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return {
    leaveSetting: {
      upsert: async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes,
        paidLeaveAdvanceMaxMinutes: 480,
        paidLeaveAdvanceRequireNextGrantWithinDays: 60,
      }),
    },
    leaveWorkdayOverride: {
      findMany: async ({ where }) => {
        const range = where?.workDate || {};
        const gte = range.gte ? toMillis(range.gte) : Number.NEGATIVE_INFINITY;
        const lt = range.lt ? toMillis(range.lt) : Number.POSITIVE_INFINITY;
        return workdayOverrides
          .filter((item) => {
            if (where?.userId && item.userId !== where.userId) return false;
            const target = toMillis(item.workDate);
            return target >= gte && target < lt;
          })
          .map((item) => ({
            workDate: item.workDate,
            workMinutes: item.workMinutes,
            createdAt: item.createdAt || item.workDate,
          }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      },
    },
    leaveCompanyHoliday: {
      findMany: async ({ where }) => {
        const range = where?.holidayDate || {};
        const gte = range.gte ? toMillis(range.gte) : Number.NEGATIVE_INFINITY;
        const lt = range.lt ? toMillis(range.lt) : Number.POSITIVE_INFINITY;
        return companyHolidays
          .filter((item) => {
            const target = toMillis(item.holidayDate);
            return target >= gte && target < lt;
          })
          .map((item) => ({ holidayDate: item.holidayDate }));
      },
    },
  };
}

test('computeCompLeaveBalance: subtracts pending reservations and requested minutes', async () => {
  const client = {
    ...createCalendarClient(),
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        { grantedMinutes: 120, remainingMinutes: 120 },
        { grantedMinutes: 60, remainingMinutes: 60 },
      ],
    },
    leaveRequest: {
      findMany: async () => [
        {
          id: 'pending-1',
          startDate: new Date('2026-03-11T00:00:00.000Z'),
          endDate: new Date('2026-03-11T00:00:00.000Z'),
          hours: null,
          minutes: 30,
          startTimeMinutes: null,
          endTimeMinutes: null,
        },
        {
          id: 'pending-before',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: new Date('2026-03-01T00:00:00.000Z'),
          hours: null,
          minutes: 20,
          startTimeMinutes: null,
          endTimeMinutes: null,
        },
      ],
    },
  };

  const balance = await computeCompLeaveBalance({
    userId: 'user-1',
    leaveType: 'compensatory',
    additionalRequestedMinutes: 90,
    asOfDate: new Date('2026-03-10T00:00:00.000Z'),
    client,
  });

  assert.equal(balance.totalGrantedMinutes, 180);
  assert.equal(balance.remainingMinutes, 180);
  assert.equal(balance.reservedPendingMinutes, 30);
  assert.equal(balance.requestedMinutes, 90);
  assert.equal(balance.projectedRemainingMinutes, 60);
  assert.equal(balance.shortage, false);
});

test('computeCompLeaveBalance: uses workday calendar minutes for daily pending leave', async () => {
  const client = {
    ...createCalendarClient({
      defaultWorkdayMinutes: 420,
      workdayOverrides: [
        {
          userId: 'user-2',
          workDate: new Date('2026-03-11T00:00:00.000Z'),
          workMinutes: 300,
        },
      ],
    }),
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [{ grantedMinutes: 600, remainingMinutes: 600 }],
    },
    leaveRequest: {
      findMany: async () => [
        {
          id: 'pending-daily',
          startDate: new Date('2026-03-11T00:00:00.000Z'),
          endDate: new Date('2026-03-11T00:00:00.000Z'),
          hours: null,
          minutes: null,
          startTimeMinutes: null,
          endTimeMinutes: null,
        },
      ],
    },
  };

  const balance = await computeCompLeaveBalance({
    userId: 'user-2',
    leaveType: 'substitute',
    asOfDate: new Date('2026-03-10T00:00:00.000Z'),
    client,
  });

  assert.equal(balance.reservedPendingMinutes, 300);
  assert.equal(balance.projectedRemainingMinutes, 300);
});

test('consumeCompLeaveForRequest: allocates grants by earliest expiration', async () => {
  const grants = [
    {
      id: 'g1',
      remainingMinutes: 60,
      status: 'active',
      expiresAt: new Date('2026-03-15T00:00:00.000Z'),
      sourceDate: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-03-01T01:00:00.000Z'),
    },
    {
      id: 'g2',
      remainingMinutes: 90,
      status: 'active',
      expiresAt: new Date('2026-03-20T00:00:00.000Z'),
      sourceDate: new Date('2026-03-02T00:00:00.000Z'),
      createdAt: new Date('2026-03-02T01:00:00.000Z'),
    },
  ];
  const consumptions = [];

  const client = {
    ...createCalendarClient(),
    leaveCompGrant: {
      updateMany: async ({ where, data }) => {
        if (where?.id) {
          const row = grants.find((grant) => grant.id === where.id);
          if (!row) return { count: 0 };
          if (row.status !== where.status) return { count: 0 };
          if (row.expiresAt.getTime() < where.expiresAt.gte.getTime()) {
            return { count: 0 };
          }
          if (row.remainingMinutes < where.remainingMinutes.gte) {
            return { count: 0 };
          }
          const dec = data?.remainingMinutes?.decrement || 0;
          row.remainingMinutes -= dec;
          row.updatedBy = data.updatedBy;
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async () => grants,
      findUnique: async ({ where }) => {
        const row = grants.find((grant) => grant.id === where.id);
        return row
          ? { remainingMinutes: row.remainingMinutes, status: row.status }
          : null;
      },
      update: async ({ where, data }) => {
        const row = grants.find((grant) => grant.id === where.id);
        if (!row) throw new Error('grant not found');
        if (data.status !== undefined) row.status = data.status;
        if (data.consumedAt !== undefined) row.consumedAt = data.consumedAt;
        if (data.updatedBy !== undefined) row.updatedBy = data.updatedBy;
        return row;
      },
    },
    leaveCompConsumption: {
      findMany: async () => [],
      create: async ({ data }) => {
        consumptions.push(data);
        return data;
      },
    },
    leaveRequest: {
      findMany: async () => [],
    },
  };

  const result = await consumeCompLeaveForRequest({
    leaveRequestId: 'leave-1',
    userId: 'user-1',
    leaveType: 'compensatory',
    requestedMinutes: 100,
    leaveStartDate: new Date('2026-03-10T00:00:00.000Z'),
    actorId: 'approver-1',
    client,
  });

  assert.equal(result.consumedMinutes, 100);
  assert.deepEqual(result.items, [
    { grantId: 'g1', consumedMinutes: 60 },
    { grantId: 'g2', consumedMinutes: 40 },
  ]);
  assert.equal(grants[0].remainingMinutes, 0);
  assert.equal(grants[0].status, 'consumed');
  assert.equal(grants[1].remainingMinutes, 50);
  assert.equal(grants[1].status, 'active');
  assert.equal(consumptions.length, 2);
});

test('consumeCompLeaveForRequest: throws shortage error when grants are insufficient', async () => {
  const client = {
    ...createCalendarClient(),
    leaveCompGrant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        {
          id: 'g1',
          remainingMinutes: 30,
          status: 'active',
          expiresAt: new Date('2026-03-15T00:00:00.000Z'),
          sourceDate: new Date('2026-03-01T00:00:00.000Z'),
          createdAt: new Date('2026-03-01T01:00:00.000Z'),
          grantedMinutes: 30,
        },
      ],
      findUnique: async ({ where }) =>
        where.id === 'g1' ? { remainingMinutes: 30, status: 'active' } : null,
      update: async () => {
        throw new Error('should not update on shortage');
      },
    },
    leaveCompConsumption: {
      findMany: async () => [],
      create: async () => {
        throw new Error('should not create on shortage');
      },
    },
    leaveRequest: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    () =>
      consumeCompLeaveForRequest({
        leaveRequestId: 'leave-shortage',
        userId: 'user-1',
        leaveType: 'compensatory',
        requestedMinutes: 90,
        leaveStartDate: new Date('2026-03-10T00:00:00.000Z'),
        actorId: 'approver-1',
        client,
      }),
    (error) => {
      assert.equal(error instanceof LeaveCompBalanceShortageError, true);
      assert.equal(error.details.leaveType, 'compensatory');
      assert.equal(error.details.shortageMinutes > 0, true);
      return true;
    },
  );
});
