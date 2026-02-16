import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';

const runId = () => randomUUID().slice(0, 12);

const buildHeaders = (input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
}) => ({
  'x-user-id': input.userId,
  'x-roles': input.roles.join(','),
  'x-project-ids': (input.projectIds ?? []).join(','),
  'x-group-ids': (input.groupIds ?? []).join(','),
});

const adminHeaders = buildHeaders({
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  groupIds: ['mgmt'],
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function setupVendorInvoiceFixture(
  request: APIRequestContext,
  suffix: string,
  options?: { withPurchaseOrderLine?: boolean },
) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-VI-${suffix}`,
      name: `E2E Vendor Invoice ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectId = project.id as string;
  expect(projectId).toBeTruthy();

  const vendorRes = await request.post(`${apiBase}/vendors`, {
    headers: adminHeaders,
    data: {
      code: `E2E-VND-${suffix}`,
      name: `E2E Vendor ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(vendorRes);
  const vendor = await vendorRes.json();
  const vendorId = vendor.id as string;
  expect(vendorId).toBeTruthy();

  const poRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/purchase-orders`,
    {
      headers: adminHeaders,
      data: {
        vendorId,
        totalAmount: 12000,
        currency: 'JPY',
        lines: options?.withPurchaseOrderLine
          ? [
              {
                description: `E2E PO line ${suffix}`,
                quantity: 1,
                unitPrice: 12000,
              },
            ]
          : [],
      },
    },
  );
  await ensureOk(poRes);
  const po = await poRes.json();
  const purchaseOrderId = po.id as string;
  expect(purchaseOrderId).toBeTruthy();
  const purchaseOrderLineId = options?.withPurchaseOrderLine
    ? ((po.lines?.[0]?.id ?? '') as string)
    : '';
  if (options?.withPurchaseOrderLine) {
    expect(purchaseOrderLineId).toBeTruthy();
  }

  const viRes = await request.post(`${apiBase}/vendor-invoices`, {
    headers: adminHeaders,
    data: {
      projectId,
      vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      vendorInvoiceNo: `INV-${suffix}`,
    },
  });
  await ensureOk(viRes);
  const vi = await viRes.json();
  const vendorInvoiceId = vi.id as string;
  expect(vendorInvoiceId).toBeTruthy();

  return {
    projectId,
    vendorId,
    purchaseOrderId,
    vendorInvoiceId,
    purchaseOrderLineId,
  };
}

test('vendor invoice po linking: post-submit unlink requires reason @core', async ({
  request,
}) => {
  const suffix = runId();
  const fixture = await setupVendorInvoiceFixture(request, suffix);

  const linkRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/link-po`,
    {
      headers: adminHeaders,
      data: { purchaseOrderId: fixture.purchaseOrderId },
    },
  );
  await ensureOk(linkRes);
  const linked = await linkRes.json();
  expect(linked.purchaseOrder?.id).toBe(fixture.purchaseOrderId);

  const unlinkPreSubmitRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/unlink-po`,
    {
      headers: adminHeaders,
      data: {},
    },
  );
  await ensureOk(unlinkPreSubmitRes);
  const unlinkedPreSubmit = await unlinkPreSubmitRes.json();
  expect(unlinkedPreSubmit.purchaseOrder).toBeNull();

  const relinkRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/link-po`,
    {
      headers: adminHeaders,
      data: { purchaseOrderId: fixture.purchaseOrderId },
    },
  );
  await ensureOk(relinkRes);

  const submitRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/submit`,
    {
      headers: adminHeaders,
      data: { reasonText: 'e2e submit vendor invoice' },
    },
  );
  await ensureOk(submitRes);
  const submitted = await submitRes.json();
  expect(submitted.status).toBe('pending_qa');

  const unlinkNoReasonRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/unlink-po`,
    {
      headers: adminHeaders,
      data: {},
    },
  );
  expect(unlinkNoReasonRes.status()).toBe(400);
  const unlinkNoReason = await unlinkNoReasonRes.json();
  expect(unlinkNoReason?.error?.code).toBe('REASON_REQUIRED');

  const unlinkWithReasonRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/unlink-po`,
    {
      headers: adminHeaders,
      data: { reasonText: 'e2e override unlink after submit' },
    },
  );
  await ensureOk(unlinkWithReasonRes);
  const unlinkWithReason = await unlinkWithReasonRes.json();
  expect(unlinkWithReason.purchaseOrder).toBeNull();
});

test('vendor invoice po linking: link/unlink is forbidden for non-admin roles @core', async ({
  request,
}) => {
  const suffix = runId();
  const fixture = await setupVendorInvoiceFixture(request, suffix);

  const outsiderHeaders = buildHeaders({
    userId: `e2e-outsider-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [fixture.projectId],
  });

  const linkForbiddenRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/link-po`,
    {
      headers: outsiderHeaders,
      data: { purchaseOrderId: fixture.purchaseOrderId },
    },
  );
  expect(linkForbiddenRes.status()).toBe(403);
  const linkForbidden = await linkForbiddenRes.json();
  expect(linkForbidden?.error?.code).toBe('forbidden');

  const unlinkForbiddenRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/unlink-po`,
    {
      headers: outsiderHeaders,
      data: {},
    },
  );
  expect(unlinkForbiddenRes.status()).toBe(403);
  const unlinkForbidden = await unlinkForbiddenRes.json();
  expect(unlinkForbidden?.error?.code).toBe('forbidden');
});

test('vendor invoice lines: quantity must not exceed linked purchase order line @core', async ({
  request,
}) => {
  const suffix = runId();
  const fixture = await setupVendorInvoiceFixture(request, suffix, {
    withPurchaseOrderLine: true,
  });
  expect(fixture.purchaseOrderLineId).toBeTruthy();

  const linkRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/link-po`,
    {
      headers: adminHeaders,
      data: { purchaseOrderId: fixture.purchaseOrderId },
    },
  );
  await ensureOk(linkRes);

  const normalUpdateRes = await request.put(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
    {
      headers: adminHeaders,
      data: {
        lines: [
          {
            lineNo: 1,
            description: `E2E VI line ${suffix}`,
            quantity: 1,
            unitPrice: 12000,
            purchaseOrderLineId: fixture.purchaseOrderLineId,
          },
        ],
      },
    },
  );
  await ensureOk(normalUpdateRes);
  const normalUpdate = await normalUpdateRes.json();
  expect(Array.isArray(normalUpdate?.items)).toBeTruthy();
  expect(normalUpdate?.items?.length).toBe(1);
  expect(Number(normalUpdate?.totals?.diff ?? Number.NaN)).toBe(0);

  const exceededRes = await request.put(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
    {
      headers: adminHeaders,
      data: {
        lines: [
          {
            lineNo: 1,
            description: `E2E VI line exceeded ${suffix}`,
            quantity: 2,
            unitPrice: 6000,
            purchaseOrderLineId: fixture.purchaseOrderLineId,
          },
        ],
      },
    },
  );
  expect(exceededRes.status()).toBe(400);
  const exceeded = await exceededRes.json();
  expect(exceeded?.error?.code).toBe('PO_LINE_QUANTITY_EXCEEDED');
  expect(exceeded?.error?.message).toBe(
    'Requested quantity exceeds purchase order line quantity',
  );
  expect(
    exceeded?.error?.details?.exceeded?.some(
      (item: { purchaseOrderLineId?: string }) =>
        item?.purchaseOrderLineId === fixture.purchaseOrderLineId,
    ) ?? false,
  ).toBeTruthy();
});
