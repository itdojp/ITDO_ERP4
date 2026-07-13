import assert from 'node:assert/strict';
import test from 'node:test';

import { notifyDailyReportChanged } from '../dist/application/dailyReports/sideEffects.js';

test('notifyDailyReportChanged delegates daily report notification payload through injectable port', async () => {
  const calls = [];
  const result = await notifyDailyReportChanged(
    {
      userId: 'user-1',
      reportDate: '2026-07-13',
      actorUserId: 'actor-1',
      kind: 'daily_report_updated',
    },
    {
      createDailyReportNotifications: async (input) => {
        calls.push(input);
        return { created: 1 };
      },
    },
  );

  assert.deepEqual(result, { created: 1 });
  assert.deepEqual(calls, [
    {
      userId: 'user-1',
      reportDate: '2026-07-13',
      actorUserId: 'actor-1',
      kind: 'daily_report_updated',
    },
  ]);
});
