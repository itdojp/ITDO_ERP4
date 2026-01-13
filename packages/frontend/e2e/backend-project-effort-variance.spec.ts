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

test('project effort includes plan variance @core', async ({ request }) => {
  const suffix = runId();
  const today = new Date().toISOString().slice(0, 10);

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-VAR-${suffix}`,
      name: `E2E Variance ${suffix}`,
      status: 'active',
      planHours: 2,
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const timeRes = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      userId: 'demo-user',
      workDate: today,
      minutes: 180,
      workType: '通常',
    },
    headers: authHeaders,
  });
  await ensureOk(timeRes);

  const reportRes = await request.get(
    `${apiBase}/reports/project-effort/${encodeURIComponent(project.id)}`,
    { headers: authHeaders },
  );
  await ensureOk(reportRes);
  const report = await reportRes.json();

  expect(Number(report.planHours)).toBeCloseTo(2, 5);
  expect(Number(report.planMinutes)).toBeCloseTo(120, 5);
  expect(Number(report.totalMinutes)).toBe(180);
  expect(Number(report.varianceMinutes)).toBeCloseTo(60, 5);

  const csvRes = await request.get(
    `${apiBase}/reports/project-effort/${encodeURIComponent(project.id)}?format=csv`,
    { headers: authHeaders },
  );
  await ensureOk(csvRes);
  const csvText = await csvRes.text();
  const [csvHeader] = csvText.trim().split('\n');
  expect(csvHeader).toContain('planHours');
  expect(csvHeader).toContain('planMinutes');
  expect(csvHeader).toContain('varianceMinutes');
});

test('project effort variance handles null planHours @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-VAR-NO-PLAN-${suffix}`,
      name: `E2E Variance No Plan ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const reportRes = await request.get(
    `${apiBase}/reports/project-effort/${encodeURIComponent(project.id)}`,
    { headers: authHeaders },
  );
  await ensureOk(reportRes);
  const report = await reportRes.json();

  expect(report.planHours).toBeNull();
  expect(report.planMinutes).toBeNull();
  expect(Number(report.totalMinutes)).toBe(0);
  expect(report.varianceMinutes).toBeNull();
});
