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

test('milestone invoice sync @core', async ({ request }) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-MILE-${suffix}`,
      name: `E2E Milestone ${suffix}`,
      status: 'active',
    },
    headers: authHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();

  const milestoneRes = await request.post(
    `${apiBase}/projects/${project.id}/milestones`,
    {
      data: {
        name: `Milestone ${suffix}`,
        amount: 1000,
        billUpon: 'date',
      },
      headers: authHeaders,
    },
  );
  await ensureOk(milestoneRes);
  const milestone = await milestoneRes.json();

  const invoiceOkRes = await request.post(
    `${apiBase}/projects/${project.id}/invoices`,
    {
      data: {
        milestoneId: milestone.id,
        totalAmount: 1000,
        currency: 'JPY',
        lines: [
          {
            description: 'Milestone sync line',
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      },
      headers: authHeaders,
    },
  );
  await ensureOk(invoiceOkRes);
  const invoiceOk = await invoiceOkRes.json();

  const invoiceManualRes = await request.post(
    `${apiBase}/projects/${project.id}/invoices`,
    {
      data: {
        milestoneId: milestone.id,
        totalAmount: 1100,
        currency: 'JPY',
        lines: [
          {
            description: 'Manual adjust line',
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      },
      headers: authHeaders,
    },
  );
  await ensureOk(invoiceManualRes);
  const invoiceManual = await invoiceManualRes.json();

  const invoiceMultiRes = await request.post(
    `${apiBase}/projects/${project.id}/invoices`,
    {
      data: {
        milestoneId: milestone.id,
        totalAmount: 2000,
        currency: 'JPY',
        lines: [
          {
            description: 'Multi line A',
            quantity: 1,
            unitPrice: 1000,
          },
          {
            description: 'Multi line B',
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      },
      headers: authHeaders,
    },
  );
  await ensureOk(invoiceMultiRes);
  const invoiceMulti = await invoiceMultiRes.json();

  const updateRes = await request.patch(
    `${apiBase}/projects/${project.id}/milestones/${milestone.id}`,
    {
      data: { amount: 2000 },
      headers: authHeaders,
    },
  );
  await ensureOk(updateRes);

  const refreshedOkRes = await request.get(
    `${apiBase}/invoices/${invoiceOk.id}`,
    { headers: authHeaders },
  );
  await ensureOk(refreshedOkRes);
  const refreshedOk = await refreshedOkRes.json();
  expect(toNumber(refreshedOk.totalAmount)).toBe(2000);
  expect(toNumber(refreshedOk.lines[0]?.unitPrice)).toBe(2000);

  const refreshedManualRes = await request.get(
    `${apiBase}/invoices/${invoiceManual.id}`,
    { headers: authHeaders },
  );
  await ensureOk(refreshedManualRes);
  const refreshedManual = await refreshedManualRes.json();
  expect(toNumber(refreshedManual.totalAmount)).toBe(1100);
  expect(toNumber(refreshedManual.lines[0]?.unitPrice)).toBe(1000);

  const refreshedMultiRes = await request.get(
    `${apiBase}/invoices/${invoiceMulti.id}`,
    { headers: authHeaders },
  );
  await ensureOk(refreshedMultiRes);
  const refreshedMulti = await refreshedMultiRes.json();
  expect(refreshedMulti.lines.length).toBe(2);
  expect(toNumber(refreshedMulti.lines[0]?.unitPrice)).toBe(1000);
  expect(toNumber(refreshedMulti.lines[1]?.unitPrice)).toBe(1000);
});
