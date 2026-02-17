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

test('rate card affects profit report @core', async ({ request }) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-RATE-${suffix}`,
      name: `E2E RateCard ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const today = new Date().toISOString().slice(0, 10);

  const rateRes = await request.post(`${apiBase}/rate-cards`, {
    data: {
      projectId: project.id,
      role: 'default',
      workType: '通常',
      unitPrice: 6000,
      currency: 'JPY',
      validFrom: today,
      validTo: null,
    },
    headers: authHeaders,
  });
  await ensureOk(rateRes);

  const timeRes = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      userId: 'demo-user',
      workDate: today,
      minutes: 60,
      workType: '通常',
    },
    headers: authHeaders,
  });
  await ensureOk(timeRes);

  const profitRes = await request.get(
    `${apiBase}/reports/project-profit/${encodeURIComponent(project.id)}?from=${today}&to=${today}`,
    {
      headers: authHeaders,
    },
  );
  await ensureOk(profitRes);
  const profit = await profitRes.json();
  expect(Number(profit?.costBreakdown?.laborCost ?? 0)).toBeGreaterThan(0);
});
