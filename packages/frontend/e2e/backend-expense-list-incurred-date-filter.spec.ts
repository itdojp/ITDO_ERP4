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

test('expense list filters incurredOn by from/to boundaries @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseUserId = `e2e-expense-incurred-filter-${suffix}@example.com`;
  const createExpense = async (incurredOn: string) => {
    const createRes = await request.post(`${apiBase}/expenses`, {
      headers: adminHeaders,
      data: {
        projectId: defaultProjectId,
        userId: expenseUserId,
        category: 'travel',
        amount: 1000,
        currency: 'JPY',
        incurredOn,
      },
    });
    await ensureOk(createRes);
    const created = await createRes.json();
    const expenseId = String(created?.id ?? '');
    expect(expenseId).not.toBe('');
    return expenseId;
  };

  const earliestId = await createExpense('2026-03-01');
  const middleId = await createExpense('2026-03-05');
  const latestId = await createExpense('2026-03-10');

  const fetchExpenseIds = async (query: string) => {
    const res = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(expenseUserId)}&${query}`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(res);
    const payload = await res.json();
    return new Set((payload?.items ?? []).map((item: any) => String(item?.id ?? '')));
  };

  const fromOnlyIds = await fetchExpenseIds('from=2026-03-05');
  expect(fromOnlyIds.has(earliestId)).toBe(false);
  expect(fromOnlyIds.has(middleId)).toBe(true);
  expect(fromOnlyIds.has(latestId)).toBe(true);

  const toOnlyIds = await fetchExpenseIds('to=2026-03-05');
  expect(toOnlyIds.has(earliestId)).toBe(true);
  expect(toOnlyIds.has(middleId)).toBe(true);
  expect(toOnlyIds.has(latestId)).toBe(false);

  const boundaryOnlyIds = await fetchExpenseIds('from=2026-03-05&to=2026-03-05');
  expect(boundaryOnlyIds.has(earliestId)).toBe(false);
  expect(boundaryOnlyIds.has(middleId)).toBe(true);
  expect(boundaryOnlyIds.has(latestId)).toBe(false);

  const rangeIds = await fetchExpenseIds('from=2026-03-02&to=2026-03-09');
  expect(rangeIds.has(earliestId)).toBe(false);
  expect(rangeIds.has(middleId)).toBe(true);
  expect(rangeIds.has(latestId)).toBe(false);
});
