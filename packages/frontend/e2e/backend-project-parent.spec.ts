import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const runId = () =>
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('project parent can be updated with reason @extended', async ({
  request,
}) => {
  const suffix = runId();

  const parentRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-PARENT-${suffix}`,
      name: `E2E Parent ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(parentRes);
  const parent = await parentRes.json();

  const childRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-CHILD-${suffix}`,
      name: `E2E Child ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(childRes);
  const child = await childRes.json();

  const patchRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(child.id)}`,
    {
      data: {
        parentId: parent.id,
        reasonText: 'e2e: link parent',
      },
      headers: authHeaders,
    },
  );
  await ensureOk(patchRes);
  const patched = await patchRes.json();
  expect(patched.parentId).toBe(parent.id);

  const missingReasonRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(child.id)}`,
    {
      data: {
        parentId: '',
      },
      headers: authHeaders,
    },
  );
  expect(missingReasonRes.ok()).toBeFalsy();
  expect(missingReasonRes.status()).toBe(400);
  const missingReasonBody = await missingReasonRes.json();
  expect(missingReasonBody?.error?.code).toBe('INVALID_REASON');

  const circularRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(parent.id)}`,
    {
      data: {
        parentId: child.id,
        reasonText: 'e2e: circular',
      },
      headers: authHeaders,
    },
  );
  expect(circularRes.ok()).toBeFalsy();
  expect(circularRes.status()).toBe(400);
});

