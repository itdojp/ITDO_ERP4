import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const authHeaders = {
  'x-user-id': 'demo-user',
  'x-roles': 'admin,mgmt',
  'x-project-ids': '00000000-0000-0000-0000-000000000001',
  'x-group-ids': 'mgmt,hr-group',
};

const vendorId = '00000000-0000-0000-0000-000000000010';

const runId = () =>
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('project evm returns daily pv/ev/ac/spi/cpi @extended', async ({
  request,
}) => {
  const suffix = runId();

  const createProjectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-EVM-${suffix}`,
      name: `E2E EVM ${suffix}`,
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      planHours: 10,
      budgetCost: 900,
      currency: 'JPY',
    },
    headers: authHeaders,
  });
  await ensureOk(createProjectRes);
  const project = await createProjectRes.json();

  const rateCardRes = await request.post(`${apiBase}/rate-cards`, {
    data: {
      projectId: project.id,
      role: 'dev',
      workType: null,
      unitPrice: 100,
      currency: 'JPY',
      validFrom: '2025-01-01',
    },
    headers: authHeaders,
  });
  await ensureOk(rateCardRes);

  const createTimeEntry = async (workDate: string, minutes: number) => {
    const res = await request.post(`${apiBase}/time-entries`, {
      data: {
        projectId: project.id,
        userId: 'demo-user',
        workDate,
        minutes,
      },
      headers: authHeaders,
    });
    await ensureOk(res);
    return res.json();
  };

  await createTimeEntry('2026-01-02', 60);
  await createTimeEntry('2026-01-03', 120);

  const expenseRes = await request.post(`${apiBase}/expenses`, {
    data: {
      projectId: project.id,
      userId: 'demo-user',
      category: 'travel',
      amount: 50,
      currency: 'JPY',
      incurredOn: '2026-01-02',
      status: 'approved',
    },
    headers: authHeaders,
  });
  await ensureOk(expenseRes);

  const vendorInvoiceRes = await request.post(`${apiBase}/vendor-invoices`, {
    data: {
      projectId: project.id,
      vendorId,
      vendorInvoiceNo: `E2E-VI-${suffix}`,
      receivedDate: '2026-01-03',
      dueDate: '2026-01-31',
      currency: 'JPY',
      totalAmount: 400,
      status: 'received',
    },
    headers: authHeaders,
  });
  await ensureOk(vendorInvoiceRes);

  const reportRes = await request.get(
    `${apiBase}/reports/project-evm/${encodeURIComponent(project.id)}?from=2026-01-01&to=2026-01-03`,
    { headers: authHeaders },
  );
  await ensureOk(reportRes);
  const report = await reportRes.json();
  expect(report.planMinutes).toBe(600);
  expect(report.budgetCost).toBe(900);
  expect(report.from).toBe('2026-01-01');
  expect(report.to).toBe('2026-01-03');
  expect(report.items.map((item: any) => item.date)).toEqual([
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
  ]);

  const [day1, day2, day3] = report.items;
  expect(day1.pv).toBeCloseTo(300, 6);
  expect(day1.ev).toBeCloseTo(0, 6);
  expect(day1.ac).toBeCloseTo(0, 6);
  expect(day1.spi).toBeCloseTo(0, 6);
  expect(day1.cpi).toBeNull();

  expect(day2.pv).toBeCloseTo(600, 6);
  expect(day2.ev).toBeCloseTo(90, 6);
  expect(day2.ac).toBeCloseTo(150, 6);
  expect(day2.spi).toBeCloseTo(0.15, 6);
  expect(day2.cpi).toBeCloseTo(0.6, 6);

  expect(day3.pv).toBeCloseTo(900, 6);
  expect(day3.ev).toBeCloseTo(270, 6);
  expect(day3.ac).toBeCloseTo(750, 6);
  expect(day3.spi).toBeCloseTo(0.3, 6);
  expect(day3.cpi).toBeCloseTo(270 / 750, 6);
});
