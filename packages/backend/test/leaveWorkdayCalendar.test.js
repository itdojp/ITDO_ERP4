import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUserWorkdayMinutes } from '../dist/services/leaveWorkdayCalendar.js';

function buildClient({ override = null, holiday = null } = {}) {
  return {
    leaveWorkdayOverride: {
      findFirst: async () => override,
    },
    leaveCompanyHoliday: {
      findFirst: async () => holiday,
    },
  };
}

test('resolveUserWorkdayMinutes prefers per-user override over holiday/default', async () => {
  const client = buildClient({
    override: { workMinutes: 360 },
    holiday: { id: 'holiday-1' },
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
    override: null,
    holiday: { id: 'holiday-1' },
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
