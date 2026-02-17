import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const demoProjectId = '00000000-0000-0000-0000-000000000001';

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('task dependencies can be set/cleared and prevents cycles @extended', async ({
  request,
}) => {
  const suffix = runId();

  const createTask = async (name: string) => {
    const res = await request.post(
      `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
      { data: { name }, headers: authHeaders },
    );
    await ensureOk(res);
    return res.json();
  };

  const taskA = await createTask(`E2E Dep A ${suffix}`);
  const taskB = await createTask(`E2E Dep B ${suffix}`);
  const taskC = await createTask(`E2E Dep C ${suffix}`);

  const setBRes = await request.put(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskB.id)}/dependencies`,
    {
      data: { predecessorIds: [taskA.id] },
      headers: authHeaders,
    },
  );
  await ensureOk(setBRes);
  const setB = await setBRes.json();
  expect(setB.predecessorIds).toEqual([taskA.id]);

  const getBRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskB.id)}/dependencies`,
    { headers: authHeaders },
  );
  await ensureOk(getBRes);
  const depsB = await getBRes.json();
  expect(depsB.predecessorIds).toEqual([taskA.id]);

  const setCRes = await request.put(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskC.id)}/dependencies`,
    {
      data: { predecessorIds: [taskB.id] },
      headers: authHeaders,
    },
  );
  await ensureOk(setCRes);

  const cycleRes = await request.put(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskA.id)}/dependencies`,
    {
      data: { predecessorIds: [taskC.id] },
      headers: authHeaders,
    },
  );
  expect(cycleRes.ok()).toBeFalsy();
  expect(cycleRes.status()).toBe(400);
  const cycleBody = await cycleRes.json();
  expect(cycleBody).toMatchObject({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Task dependency creates circular reference',
    },
  });

  const clearBRes = await request.put(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskB.id)}/dependencies`,
    { data: { predecessorIds: [] }, headers: authHeaders },
  );
  await ensureOk(clearBRes);

  const getBClearedRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks/${encodeURIComponent(taskB.id)}/dependencies`,
    { headers: authHeaders },
  );
  await ensureOk(getBClearedRes);
  const depsBCleared = await getBClearedRes.json();
  expect(depsBCleared.predecessorIds).toEqual([]);
});
