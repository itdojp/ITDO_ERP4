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

test('task parent can be updated and cleared @extended', async ({ request }) => {
  const suffix = runId();

  const parentRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
    {
      data: { name: `E2E Task Parent ${suffix}` },
      headers: authHeaders,
    },
  );
  await ensureOk(parentRes);
  const parent = await parentRes.json();

  const childRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
    {
      data: { name: `E2E Task Child ${suffix}` },
      headers: authHeaders,
    },
  );
  await ensureOk(childRes);
  const child = await childRes.json();

  const patchRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(
      child.id,
    )}`,
    {
      data: { parentTaskId: parent.id },
      headers: authHeaders,
    },
  );
  await ensureOk(patchRes);
  const patched = await patchRes.json();
  expect(patched.parentTaskId).toBe(parent.id);

  const clearRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(
      child.id,
    )}`,
    {
      data: { parentTaskId: '' },
      headers: authHeaders,
    },
  );
  await ensureOk(clearRes);
  const cleared = await clearRes.json();
  expect(cleared.parentTaskId).toBeNull();

  const selfRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(
      child.id,
    )}`,
    {
      data: { parentTaskId: child.id },
      headers: authHeaders,
    },
  );
  expect(selfRes.ok()).toBeFalsy();
  expect(selfRes.status()).toBe(400);

  const relinkRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(
      child.id,
    )}`,
    {
      data: { parentTaskId: parent.id },
      headers: authHeaders,
    },
  );
  await ensureOk(relinkRes);
  const circularRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(
      parent.id,
    )}`,
    {
      data: { parentTaskId: child.id },
      headers: authHeaders,
    },
  );
  expect(circularRes.ok()).toBeFalsy();
  expect(circularRes.status()).toBe(400);
});
