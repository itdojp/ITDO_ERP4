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

test('project baseline can snapshot tasks @extended', async ({ request }) => {
  const suffix = runId();

  const createTask = async (data: Record<string, unknown>) => {
    const res = await request.post(
      `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/tasks`,
      {
        data,
        headers: authHeaders,
      },
    );
    await ensureOk(res);
    return res.json();
  };

  const taskA = await createTask({
    name: `E2E Baseline A ${suffix}`,
    progressPercent: 10,
    planStart: '2026-01-01',
    planEnd: '2026-01-10',
  });
  const taskB = await createTask({
    name: `E2E Baseline B ${suffix}`,
    progressPercent: 30,
    planStart: '2026-01-11',
    planEnd: '2026-01-20',
  });

  const baselineName = `E2E Baseline ${suffix}`;
  const createBaselineRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/baselines`,
    { data: { name: baselineName }, headers: authHeaders },
  );
  await ensureOk(createBaselineRes);
  const baseline = await createBaselineRes.json();
  expect(baseline.projectId).toBe(demoProjectId);
  expect(baseline.name).toBe(baselineName);
  expect(baseline.taskCount).toBeGreaterThanOrEqual(2);

  const listRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/baselines`,
    { headers: authHeaders },
  );
  await ensureOk(listRes);
  const list = await listRes.json();
  expect(Array.isArray(list.items)).toBeTruthy();
  expect(list.items.map((item: any) => item.id)).toContain(baseline.id);

  const detailRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(demoProjectId)}/baselines/${encodeURIComponent(baseline.id)}`,
    { headers: authHeaders },
  );
  await ensureOk(detailRes);
  const detail = await detailRes.json();
  expect(detail.id).toBe(baseline.id);
  expect(detail.projectId).toBe(demoProjectId);
  expect(Array.isArray(detail.tasks)).toBeTruthy();

  const findSnapshot = (taskId: string) =>
    (detail.tasks as any[]).find((item) => item.taskId === taskId);

  const snapA = findSnapshot(taskA.id);
  expect(snapA).toBeTruthy();
  expect(snapA).toMatchObject({
    taskId: taskA.id,
    name: taskA.name,
    progressPercent: 10,
  });
  expect(String(snapA.planStart)).toContain('2026-01-01');
  expect(String(snapA.planEnd)).toContain('2026-01-10');

  const snapB = findSnapshot(taskB.id);
  expect(snapB).toBeTruthy();
  expect(snapB).toMatchObject({
    taskId: taskB.id,
    name: taskB.name,
    progressPercent: 30,
  });
  expect(String(snapB.planStart)).toContain('2026-01-11');
  expect(String(snapB.planEnd)).toContain('2026-01-20');
});
