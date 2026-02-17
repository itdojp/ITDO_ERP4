import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('project can set and clear period dates @extended', async ({
  request,
}) => {
  const suffix = runId();

  const createRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-PERIOD-${suffix}`,
      name: `E2E Period ${suffix}`,
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    },
    headers: authHeaders,
  });
  await ensureOk(createRes);
  const created = await createRes.json();
  expect(new Date(created.startDate).toISOString().slice(0, 10)).toBe(
    '2026-01-01',
  );
  expect(new Date(created.endDate).toISOString().slice(0, 10)).toBe(
    '2026-01-31',
  );

  const clearRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(created.id)}`,
    { data: { startDate: null, endDate: null }, headers: authHeaders },
  );
  await ensureOk(clearRes);
  const cleared = await clearRes.json();
  expect(cleared.startDate).toBeNull();
  expect(cleared.endDate).toBeNull();

  const invalidRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(created.id)}`,
    {
      data: { startDate: '2026-02-01', endDate: '2026-01-01' },
      headers: authHeaders,
    },
  );
  expect(invalidRes.ok()).toBeFalsy();
  expect(invalidRes.status()).toBe(400);
});
