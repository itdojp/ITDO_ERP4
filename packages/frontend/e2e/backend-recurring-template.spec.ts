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

test('recurring template generates draft invoice @core', async ({ request }) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-REC-${suffix}`,
      name: `E2E Recurring ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const templateRes = await request.post(
    `${apiBase}/projects/${project.id}/recurring-template`,
    {
      data: {
        frequency: 'monthly',
        defaultAmount: 1000,
        defaultCurrency: 'JPY',
        shouldGenerateInvoice: true,
        shouldGenerateEstimate: false,
        isActive: true,
        dueDateRule: null,
      },
      headers: authHeaders,
    },
  );
  await ensureOk(templateRes);
  const template = await templateRes.json();
  expect(template.dueDateRule).toBeNull();

  const loadedRes = await request.get(
    `${apiBase}/projects/${project.id}/recurring-template`,
    { headers: authHeaders },
  );
  await ensureOk(loadedRes);
  const loaded = await loadedRes.json();
  expect(loaded).toBeTruthy();
  expect(loaded.id).toBe(template.id);
  expect(loaded.dueDateRule).toBeNull();

  const jobRes = await request.post(`${apiBase}/jobs/recurring-projects/run`, {
    data: {},
    headers: authHeaders,
  });
  await ensureOk(jobRes);
  const job = await jobRes.json();
  const result = Array.isArray(job.results)
    ? job.results.find((item: any) => item.templateId === template.id)
    : null;
  expect(result).toBeTruthy();
  expect(result.status).toBe('created');
  expect(result.invoiceId).toBeTruthy();

  const invoiceRes = await request.get(
    `${apiBase}/invoices/${encodeURIComponent(result.invoiceId)}`,
    {
      headers: authHeaders,
    },
  );
  await ensureOk(invoiceRes);
  const invoice = await invoiceRes.json();
  expect(invoice.status).toBe('draft');
  expect(invoice.createdBy).toBe('recurring-job');

  const logsRes = await request.get(
    `${apiBase}/projects/${project.id}/recurring-generation-logs?limit=10`,
    { headers: authHeaders },
  );
  await ensureOk(logsRes);
  const logs = await logsRes.json();
  const items = Array.isArray(logs.items) ? logs.items : [];
  expect(items.some((item: any) => item.invoiceId === result.invoiceId)).toBe(
    true,
  );
});
