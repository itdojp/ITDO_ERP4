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

test('project burndown returns daily remaining minutes @extended', async ({
  request,
}) => {
  const suffix = runId();

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-BD-${suffix}`,
      name: `E2E Burndown ${suffix}`,
      status: 'active',
      planHours: 10,
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectHeaders = {
    ...authHeaders,
    'x-project-ids': `${authHeaders['x-project-ids']},${project.id}`,
  };

  const baselineName = `E2E Burndown ${suffix}`;
  const baselineRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(project.id)}/baselines`,
    { data: { name: baselineName }, headers: projectHeaders },
  );
  await ensureOk(baselineRes);
  const baseline = await baselineRes.json();

  const createTimeEntry = async (workDate: string, minutes: number) => {
    const res = await request.post(`${apiBase}/time-entries`, {
      data: {
        projectId: project.id,
        userId: 'demo-user',
        workDate,
        minutes,
      },
      headers: projectHeaders,
    });
    await ensureOk(res);
    return res.json();
  };

  await createTimeEntry('2026-01-02', 60);
  await createTimeEntry('2026-01-03', 120);

  const reportRes = await request.get(
    `${apiBase}/reports/burndown/${encodeURIComponent(project.id)}?baselineId=${encodeURIComponent(baseline.id)}&from=2026-01-01&to=2026-01-03`,
    { headers: projectHeaders },
  );
  await ensureOk(reportRes);
  const report = await reportRes.json();
  expect(report.planMinutes).toBe(600);
  expect(Array.isArray(report.items)).toBeTruthy();
  expect(report.items.map((item: any) => item.date)).toEqual([
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
  ]);

  const day1 = report.items[0];
  expect(day1).toMatchObject({
    date: '2026-01-01',
    burnedMinutes: 0,
    cumulativeBurnedMinutes: 0,
    remainingMinutes: 600,
  });
  const day2 = report.items[1];
  expect(day2).toMatchObject({
    date: '2026-01-02',
    burnedMinutes: 60,
    cumulativeBurnedMinutes: 60,
    remainingMinutes: 540,
  });
  const day3 = report.items[2];
  expect(day3).toMatchObject({
    date: '2026-01-03',
    burnedMinutes: 120,
    cumulativeBurnedMinutes: 180,
    remainingMinutes: 420,
  });
});
