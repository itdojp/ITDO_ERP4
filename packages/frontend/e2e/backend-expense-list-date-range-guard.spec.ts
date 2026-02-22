import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

const buildHeaders = (input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
}) => ({
  'x-user-id': input.userId,
  'x-roles': input.roles.join(','),
  'x-project-ids': (input.projectIds ?? []).join(','),
  'x-group-ids': (input.groupIds ?? []).join(','),
});

const adminHeaders = buildHeaders({
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
});

test('expense list rejects invalid date parameters @core', async ({ request }) => {
  const invalidFromRes = await request.get(`${apiBase}/expenses?from=invalid`, {
    headers: adminHeaders,
  });
  expect(invalidFromRes.status()).toBe(400);
  const invalidFrom = await invalidFromRes.json();
  expect(invalidFrom?.error?.code).toBe('INVALID_DATE');

  const invalidToRes = await request.get(`${apiBase}/expenses?to=invalid`, {
    headers: adminHeaders,
  });
  expect(invalidToRes.status()).toBe(400);
  const invalidTo = await invalidToRes.json();
  expect(invalidTo?.error?.code).toBe('INVALID_DATE');

  const invalidPaidFromRes = await request.get(
    `${apiBase}/expenses?paidFrom=invalid`,
    {
      headers: adminHeaders,
    },
  );
  expect(invalidPaidFromRes.status()).toBe(400);
  const invalidPaidFrom = await invalidPaidFromRes.json();
  expect(invalidPaidFrom?.error?.code).toBe('INVALID_DATE');

  const invalidPaidToRes = await request.get(
    `${apiBase}/expenses?paidTo=invalid`,
    {
      headers: adminHeaders,
    },
  );
  expect(invalidPaidToRes.status()).toBe(400);
  const invalidPaidTo = await invalidPaidToRes.json();
  expect(invalidPaidTo?.error?.code).toBe('INVALID_DATE');
});

test('expense list rejects inverted date ranges @core', async ({ request }) => {
  const invalidIncurredRangeRes = await request.get(
    `${apiBase}/expenses?from=2026-02-20&to=2026-02-19`,
    {
      headers: adminHeaders,
    },
  );
  expect(invalidIncurredRangeRes.status()).toBe(400);
  const invalidIncurredRange = await invalidIncurredRangeRes.json();
  expect(invalidIncurredRange?.error?.code).toBe('INVALID_DATE_RANGE');

  const invalidPaidRangeRes = await request.get(
    `${apiBase}/expenses?paidFrom=2026-02-20&paidTo=2026-02-19`,
    {
      headers: adminHeaders,
    },
  );
  expect(invalidPaidRangeRes.status()).toBe(400);
  const invalidPaidRange = await invalidPaidRangeRes.json();
  expect(invalidPaidRange?.error?.code).toBe('INVALID_DATE_RANGE');
});
