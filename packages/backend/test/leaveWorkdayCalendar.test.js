import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveUserWorkdayMinutes,
  resolveUserWorkdayMinutesForDates,
} from '../dist/services/leaveWorkdayCalendar.js';

function buildClient({ overrides = [], holidays = [] } = {}) {
  const toMillis = (value) =>
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return {
    leaveWorkdayOverride: {
      findMany: async ({ where }) => {
        const range = where?.workDate || {};
        const gte = range.gte ? toMillis(range.gte) : Number.NEGATIVE_INFINITY;
        const lt = range.lt ? toMillis(range.lt) : Number.POSITIVE_INFINITY;
        return overrides
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
        return holidays
          .filter((item) => {
            const target = toMillis(item.holidayDate);
            return target >= gte && target < lt;
          })
          .map((item) => ({ holidayDate: item.holidayDate }));
      },
    },
  };
}

test('resolveUserWorkdayMinutes prefers per-user override over holiday/default', async () => {
  const client = buildClient({
    overrides: [
      {
        userId: 'employee-1',
        workDate: new Date('2026-03-10T00:00:00.000Z'),
        workMinutes: 360,
      },
    ],
    holidays: [{ holidayDate: new Date('2026-03-10T00:00:00.000Z') }],
  });
  const resolved = await resolveUserWorkdayMinutes({
    userId: 'employee-1',
    targetDate: new Date('2026-03-10T00:00:00.000Z'),
    defaultWorkdayMinutes: 480,
    client,
  });
  assert.equal(resolved.workMinutes, 360);
  assert.equal(resolved.source, 'user_override');
});

test('resolveUserWorkdayMinutes returns zero minutes for company holiday', async () => {
  const client = buildClient({
    holidays: [{ holidayDate: new Date('2026-03-10T00:00:00.000Z') }],
  });
  const resolved = await resolveUserWorkdayMinutes({
    userId: 'employee-1',
    targetDate: new Date('2026-03-10T00:00:00.000Z'),
    defaultWorkdayMinutes: 480,
    client,
  });
  assert.equal(resolved.workMinutes, 0);
  assert.equal(resolved.source, 'company_holiday');
});

test('resolveUserWorkdayMinutes falls back to leave setting default', async () => {
  const client = buildClient();
  const resolved = await resolveUserWorkdayMinutes({
    userId: 'employee-1',
    targetDate: new Date('2026-03-10T00:00:00.000Z'),
    defaultWorkdayMinutes: 420,
    client,
  });
  assert.equal(resolved.workMinutes, 420);
  assert.equal(resolved.source, 'default_setting');
});

test('resolveUserWorkdayMinutesForDates resolves requested dates in bulk', async () => {
  const client = buildClient({
    overrides: [
      {
        userId: 'employee-1',
        workDate: new Date('2026-03-12T00:00:00.000Z'),
        workMinutes: 420,
      },
    ],
    holidays: [{ holidayDate: new Date('2026-03-11T00:00:00.000Z') }],
  });
  const resolved = await resolveUserWorkdayMinutesForDates({
    userId: 'employee-1',
    targetDates: [
      new Date('2026-03-10T00:00:00.000Z'),
      new Date('2026-03-11T00:00:00.000Z'),
      new Date('2026-03-12T00:00:00.000Z'),
    ],
    defaultWorkdayMinutes: 480,
    client,
  });
  assert.equal(resolved.get('2026-03-10')?.workMinutes, 480);
  assert.equal(resolved.get('2026-03-10')?.source, 'default_setting');
  assert.equal(resolved.get('2026-03-11')?.workMinutes, 0);
  assert.equal(resolved.get('2026-03-11')?.source, 'company_holiday');
  assert.equal(resolved.get('2026-03-12')?.workMinutes, 420);
  assert.equal(resolved.get('2026-03-12')?.source, 'user_override');
});
