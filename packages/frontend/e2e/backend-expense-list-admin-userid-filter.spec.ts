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

test('expense list applies userId filter for privileged users @core', async ({
  request,
}) => {
  const suffix = runId();
  const userA = `e2e-expense-admin-filter-a-${suffix}@example.com`;
  const userB = `e2e-expense-admin-filter-b-${suffix}@example.com`;

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
    const expenseId = String(created?.id ?? '');
    expect(expenseId).not.toBe('');
    return expenseId;
  };

  const expenseA = await createExpense(userA, '2026-04-10');
  const expenseB = await createExpense(userB, '2026-04-11');

  const fetchIds = async (userId: string) => {
    const res = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(userId)}&from=2026-04-01&to=2026-04-30`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(res);
    const payload = await res.json();
    return new Set((payload?.items ?? []).map((item: any) => String(item?.id ?? '')));
  };

  const userAIds = await fetchIds(userA);
  expect(userAIds.has(expenseA)).toBe(true);
  expect(userAIds.has(expenseB)).toBe(false);

  const userBIds = await fetchIds(userB);
  expect(userBIds.has(expenseA)).toBe(false);
  expect(userBIds.has(expenseB)).toBe(true);
});
