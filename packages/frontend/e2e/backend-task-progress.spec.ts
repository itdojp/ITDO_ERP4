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

test('task progress percent can be set, cleared, validated @extended', async ({
  request,
}) => {
  const suffix = runId();

  const createRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
    {
      data: { name: `E2E Task Progress ${suffix}`, progressPercent: 10 },
      headers: authHeaders,
    },
  );
  await ensureOk(createRes);
  const task = await createRes.json();
  expect(task.progressPercent).toBe(10);

  const setRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { progressPercent: 55 },
      headers: authHeaders,
    },
  );
  await ensureOk(setRes);
  const updated = await setRes.json();
  expect(updated.progressPercent).toBe(55);

  const clearRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { progressPercent: null },
      headers: authHeaders,
    },
  );
  await ensureOk(clearRes);
  const cleared = await clearRes.json();
  expect(cleared.progressPercent).toBeNull();

  const tooHighRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { progressPercent: 101 },
      headers: authHeaders,
    },
  );
  expect(tooHighRes.ok()).toBeFalsy();
  expect(tooHighRes.status()).toBe(400);

  const negativeRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      data: { progressPercent: -1 },
      headers: authHeaders,
    },
  );
  expect(negativeRes.ok()).toBeFalsy();
  expect(negativeRes.status()).toBe(400);
});
