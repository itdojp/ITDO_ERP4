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

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number(value ?? 0);
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('time entries to invoice draft @core', async ({ request }) => {
  const suffix = runId();
  const today = new Date().toISOString().slice(0, 10);

  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-TI-${suffix}`,
      name: `E2E Time Invoice ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const taskRes = await request.post(`${apiBase}/projects/${project.id}/tasks`, {
    data: { name: `Task ${suffix}` },
    headers: authHeaders,
  });
  await ensureOk(taskRes);
  const task = await taskRes.json();

  const entryRes1 = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      taskId: task.id,
      userId: 'demo-user',
      workDate: today,
      minutes: 60,
      workType: 'dev',
    },
    headers: authHeaders,
  });
  await ensureOk(entryRes1);
  const entry1 = await entryRes1.json();

  const entryRes2 = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      taskId: task.id,
      userId: 'demo-user',
      workDate: today,
      minutes: 30,
      workType: 'dev',
    },
    headers: authHeaders,
  });
  await ensureOk(entryRes2);

  const entryRes3 = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: project.id,
      userId: 'demo-user',
      workDate: today,
      minutes: 15,
    },
    headers: authHeaders,
  });
  await ensureOk(entryRes3);

  const generateRes = await request.post(
    `${apiBase}/projects/${project.id}/invoices/from-time-entries`,
    {
      data: { from: today, to: today, unitPrice: 10000, currency: 'JPY' },
      headers: authHeaders,
    },
  );
  await ensureOk(generateRes);
  const generateJson = await generateRes.json();
  expect(generateJson.meta?.timeEntryCount).toBe(3);

  const invoice = generateJson.invoice;
  expect(invoice).toBeTruthy();
  expect(Array.isArray(invoice.lines)).toBe(true);
  expect(invoice.lines.length).toBe(2);
  expect(toNumber(invoice.totalAmount)).toBe(17500);

  const taskLine = invoice.lines.find((line: any) => line.taskId === task.id);
  expect(taskLine).toBeTruthy();
  expect(taskLine.description).toContain('dev');
  expect(toNumber(taskLine.unitPrice)).toBe(10000);
  expect(toNumber(taskLine.quantity)).toBeCloseTo(1.5, 3);

  const timeListRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(project.id)}`,
    { headers: authHeaders },
  );
  await ensureOk(timeListRes);
  const timeList = await timeListRes.json();
  const timeItems = Array.isArray(timeList.items) ? timeList.items : [];
  expect(timeItems.filter((item: any) => item.billedInvoiceId === invoice.id))
    .toHaveLength(3);

  const patchRes = await request.patch(`${apiBase}/time-entries/${entry1.id}`, {
    data: { minutes: 90 },
    headers: authHeaders,
  });
  expect(patchRes.status()).toBe(400);
  const patchText = await patchRes.text();
  expect(patchText).toContain('BILLED');

  const releaseRes = await request.post(
    `${apiBase}/invoices/${invoice.id}/release-time-entries`,
    { headers: authHeaders },
  );
  await ensureOk(releaseRes);
  const releaseJson = await releaseRes.json();
  expect(releaseJson.released).toBe(3);

  const timeListAfterRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(project.id)}`,
    { headers: authHeaders },
  );
  await ensureOk(timeListAfterRes);
  const timeListAfter = await timeListAfterRes.json();
  const timeItemsAfter = Array.isArray(timeListAfter.items)
    ? timeListAfter.items
    : [];
  expect(
    timeItemsAfter.some((item: any) => item.billedInvoiceId === invoice.id),
  ).toBe(false);
});

