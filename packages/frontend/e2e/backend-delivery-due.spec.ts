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

test('delivery due report @core', async ({ request }) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-DUE-${suffix}`,
      name: `E2E DeliveryDue ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() - 1);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const milestoneRes = await request.post(
    `${apiBase}/projects/${project.id}/milestones`,
    {
      data: {
        name: `Due ${suffix}`,
        amount: 1000,
        billUpon: 'date',
        dueDate: dueDateStr,
      },
      headers: authHeaders,
    },
  );
  await ensureOk(milestoneRes);
  const milestone = await milestoneRes.json();

  const reportRes = await request.get(
    `${apiBase}/reports/delivery-due?projectId=${encodeURIComponent(project.id)}&from=${dueDateStr}&to=${dueDateStr}`,
    { headers: authHeaders },
  );
  await ensureOk(reportRes);
  const report = await reportRes.json();
  const items = Array.isArray(report.items) ? report.items : [];
  expect(items.some((item: any) => item.milestoneId === milestone.id)).toBe(
    true,
  );
});

