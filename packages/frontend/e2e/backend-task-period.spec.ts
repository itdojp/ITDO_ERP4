import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const demoProjectId = '00000000-0000-0000-0000-000000000001';

const runId = () =>
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

const toDateString = (value: any) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

test('task plan/actual dates can be set, cleared, validated @extended', async ({
  request,
}) => {
  const suffix = runId();

  const createRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
    {
      data: { name: `E2E Task Period ${suffix}` },
      headers: authHeaders,
    },
  );
  await ensureOk(createRes);
  const task = await createRes.json();

  const setPlanRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { planStart: '2026-01-01', planEnd: '2026-01-10' },
      headers: authHeaders,
    },
  );
  await ensureOk(setPlanRes);
  const planned = await setPlanRes.json();
  expect(toDateString(planned.planStart)).toBe('2026-01-01');
  expect(toDateString(planned.planEnd)).toBe('2026-01-10');

  const clearEndRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { planEnd: null },
      headers: authHeaders,
    },
  );
  await ensureOk(clearEndRes);
  const clearedEnd = await clearEndRes.json();
  expect(clearedEnd.planEnd).toBeNull();

  const invalidPlanRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { planStart: '2026-02-01', planEnd: '2026-01-01' },
      headers: authHeaders,
    },
  );
  expect(invalidPlanRes.ok()).toBeFalsy();
  expect(invalidPlanRes.status()).toBe(400);

  const setActualRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { actualStart: '2026-01-02', actualEnd: '2026-01-03' },
      headers: authHeaders,
    },
  );
  await ensureOk(setActualRes);
  const actual = await setActualRes.json();
  expect(toDateString(actual.actualStart)).toBe('2026-01-02');
  expect(toDateString(actual.actualEnd)).toBe('2026-01-03');

  const invalidActualRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { actualStart: '2026-01-05', actualEnd: '2026-01-04' },
      headers: authHeaders,
    },
  );
  expect(invalidActualRes.ok()).toBeFalsy();
  expect(invalidActualRes.status()).toBe(400);
});
