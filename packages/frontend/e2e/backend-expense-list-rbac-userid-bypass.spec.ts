import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

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

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('expense list ignores userId filter for non-privileged users @core', async ({
  request,
}) => {
  const suffix = runId();
  const ownUserId = `e2e-expense-scope-owner-${suffix}@example.com`;
  const otherUserId = `e2e-expense-scope-other-${suffix}@example.com`;

  const createExpense = async (userId: string, incurredOn: string) => {
    const createRes = await request.post(`${apiBase}/expenses`, {
      headers: adminHeaders,
      data: {
        projectId: defaultProjectId,
        userId,
        category: 'travel',
        amount: 1000,
        currency: 'JPY',
        incurredOn,
      },
    });
    await ensureOk(createRes);
    const created = await createRes.json();
    return String(created?.id ?? '');
  };

  const ownExpenseId = await createExpense(ownUserId, '2026-03-15');
  const otherExpenseId = await createExpense(otherUserId, '2026-03-15');
  expect(ownExpenseId).not.toBe('');
  expect(otherExpenseId).not.toBe('');

  const ownHeaders = buildHeaders({
    userId: ownUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });

  const listRes = await request.get(
    `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(otherUserId)}`,
    {
      headers: ownHeaders,
    },
  );
  await ensureOk(listRes);
  const listPayload = await listRes.json();
  const listItems = Array.isArray(listPayload?.items) ? listPayload.items : [];
  const listIds = new Set(listItems.map((item: any) => String(item?.id ?? '')));
  const listUserIds = new Set(
    listItems.map((item: any) => String(item?.userId ?? '')),
  );

  expect(listIds.has(ownExpenseId)).toBe(true);
  expect(listIds.has(otherExpenseId)).toBe(false);
  expect(listUserIds.size).toBe(1);
  expect(listUserIds.has(ownUserId)).toBe(true);

  const listWithDateRes = await request.get(
    `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(otherUserId)}&from=2026-03-01&to=2026-03-31`,
    {
      headers: ownHeaders,
    },
  );
  await ensureOk(listWithDateRes);
  const listWithDatePayload = await listWithDateRes.json();
  const listWithDateItems = Array.isArray(listWithDatePayload?.items)
    ? listWithDatePayload.items
    : [];
  const listWithDateIds = new Set(
    listWithDateItems.map((item: any) => String(item?.id ?? '')),
  );
  const listWithDateUserIds = new Set(
    listWithDateItems.map((item: any) => String(item?.userId ?? '')),
  );

  expect(listWithDateIds.has(ownExpenseId)).toBe(true);
  expect(listWithDateIds.has(otherExpenseId)).toBe(false);
  expect(listWithDateUserIds.size).toBe(1);
  expect(listWithDateUserIds.has(ownUserId)).toBe(true);
});
