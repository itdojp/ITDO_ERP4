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
test('vendor invoice lines: summed split quantities must not exceed linked purchase order line @core', async ({
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

  const splitExceededRes = await request.put(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
    {
      headers: adminHeaders,
      data: {
        lines: [
          {
            lineNo: 1,
            description: `E2E VI split line A ${suffix}`,
            quantity: 1,
            unitPrice: 6000,
            purchaseOrderLineId: fixture.purchaseOrderLineId,
          },
          {
            lineNo: 2,
            description: `E2E VI split line B ${suffix}`,
            quantity: 1,
            unitPrice: 6000,
            purchaseOrderLineId: fixture.purchaseOrderLineId,
          },
        ],
      },
    },
  );
  expect(splitExceededRes.status()).toBe(400);
  const splitExceeded = await splitExceededRes.json();
  expect(splitExceeded?.error?.code).toBe('PO_LINE_QUANTITY_EXCEEDED');
  expect(splitExceeded?.error?.message).toBe(
    'Requested quantity exceeds purchase order line quantity',
  );
  expect(
    splitExceeded?.error?.details?.exceeded?.some(
      (item: { purchaseOrderLineId?: string }) =>
        item?.purchaseOrderLineId === fixture.purchaseOrderLineId,
    ) ?? false,
  ).toBeTruthy();
});

test('vendor invoice lines: quantity must be greater than zero @core', async ({
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

  const assertInvalidQuantity = async (quantity: number) => {
    const invalidQuantityRes = await request.put(
      `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
      {
        headers: adminHeaders,
        data: {
          lines: [
            {
              lineNo: 1,
              description: `E2E VI line invalid quantity ${suffix} (${quantity})`,
              quantity,
              unitPrice: 12000,
              purchaseOrderLineId: fixture.purchaseOrderLineId,
            },
          ],
        },
      },
    );
    expect(invalidQuantityRes.status()).toBe(400);
    const invalidQuantity = await invalidQuantityRes.json();
    expect(['INVALID_INPUT', 'VALIDATION_ERROR']).toContain(
      invalidQuantity?.error?.code,
    );
    if (invalidQuantity?.error?.code === 'INVALID_INPUT') {
      expect(String(invalidQuantity?.error?.message ?? '')).toMatch(
        /quantity/i,
      );
    }
  };

  await assertInvalidQuantity(0);
  await assertInvalidQuantity(-1);
});

test('vendor invoice lines: get lines includes poLineUsage summary @core', async ({
  request,
}) => {
  const suffix = runId();
  const fixture = await setupVendorInvoiceFixture(request, suffix, {
    withPurchaseOrderLine: true,
  });
  expect(fixture.purchaseOrderLineId).toBeTruthy();

  const siblingInvoiceRes = await request.post(`${apiBase}/vendor-invoices`, {
    headers: adminHeaders,
    data: {
      projectId: fixture.projectId,
      vendorId: fixture.vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      vendorInvoiceNo: `INV-SIB-${suffix}`,
    },
  });
  await ensureOk(siblingInvoiceRes);
  const siblingInvoice = await siblingInvoiceRes.json();
  const siblingInvoiceId = siblingInvoice.id as string;
  expect(siblingInvoiceId).toBeTruthy();

  const linkToPurchaseOrder = async (vendorInvoiceId: string) => {
    const res = await request.post(
      `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoiceId)}/link-po`,
      {
        headers: adminHeaders,
        data: { purchaseOrderId: fixture.purchaseOrderId },
      },
    );
    await ensureOk(res);
  };
  await linkToPurchaseOrder(fixture.vendorInvoiceId);
  await linkToPurchaseOrder(siblingInvoiceId);

  const updateSingleLine = async (
    vendorInvoiceId: string,
    quantity: number,
    unitPrice: number,
  ) => {
    const res = await request.put(
      `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoiceId)}/lines`,
      {
        headers: adminHeaders,
        data: {
          lines: [
            {
              lineNo: 1,
              description: `E2E VI line usage ${suffix} ${vendorInvoiceId}`,
              quantity,
              unitPrice,
              purchaseOrderLineId: fixture.purchaseOrderLineId,
            },
          ],
        },
      },
    );
    await ensureOk(res);
  };

  // sibling invoice contributes "existingQuantity" when reading fixture invoice lines.
  await updateSingleLine(siblingInvoiceId, 0.4, 30000);
  await updateSingleLine(fixture.vendorInvoiceId, 0.5, 24000);

  const linesRes = await request.get(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
    { headers: adminHeaders },
  );
  await ensureOk(linesRes);
  const linesPayload = await linesRes.json();
  const poLineUsage = (linesPayload?.poLineUsage ?? []).find(
    (entry: { purchaseOrderLineId?: string }) =>
      entry?.purchaseOrderLineId === fixture.purchaseOrderLineId,
  ) as
    | {
        purchaseOrderLineId: string;
        purchaseOrderQuantity: number;
        existingQuantity: number;
        requestedQuantity: number;
        remainingQuantity: number;
        exceeds: boolean;
      }
    | undefined;
  expect(poLineUsage).toBeTruthy();
  expect(poLineUsage?.purchaseOrderLineId).toBe(fixture.purchaseOrderLineId);
  expect(Number(poLineUsage?.purchaseOrderQuantity ?? Number.NaN)).toBeCloseTo(
    1,
    5,
  );
  expect(Number(poLineUsage?.existingQuantity ?? Number.NaN)).toBeCloseTo(
    0.4,
    5,
  );
  expect(Number(poLineUsage?.requestedQuantity ?? Number.NaN)).toBeCloseTo(
    0.5,
    5,
  );
  expect(Number(poLineUsage?.remainingQuantity ?? Number.NaN)).toBeCloseTo(
    0.1,
    5,
  );
  expect(poLineUsage?.exceeds).toBe(false);
});

test('vendor invoice lines: purchaseOrderLineId must belong to linked purchase order @core', async ({
  request,
}) => {
  const suffix = runId();
  const fixture = await setupVendorInvoiceFixture(request, suffix, {
    withPurchaseOrderLine: true,
  });
  expect(fixture.purchaseOrderLineId).toBeTruthy();

  const putLinesWithPurchaseOrderLine = async (purchaseOrderLineId: string) =>
    request.put(
      `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/lines`,
      {
        headers: adminHeaders,
        data: {
          lines: [
            {
              lineNo: 1,
              description: `E2E VI line purchase order line validation ${suffix}`,
              quantity: 1,
              unitPrice: 12000,
              purchaseOrderLineId,
            },
          ],
        },
      },
    );

  const unlinkedInvoiceRes = await putLinesWithPurchaseOrderLine(
    fixture.purchaseOrderLineId,
  );
  expect(unlinkedInvoiceRes.status()).toBe(400);
  const unlinkedInvoice = await unlinkedInvoiceRes.json();
  expect(unlinkedInvoice?.error?.code).toBe('INVALID_PURCHASE_ORDER_LINE');
  expect(unlinkedInvoice?.error?.message).toBe(
    'purchaseOrderId is not linked to the invoice',
  );

  const linkRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(fixture.vendorInvoiceId)}/link-po`,
    {
      headers: adminHeaders,
      data: { purchaseOrderId: fixture.purchaseOrderId },
    },
  );
  await ensureOk(linkRes);

  const anotherPoRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(fixture.projectId)}/purchase-orders`,
    {
      headers: adminHeaders,
      data: {
        vendorId: fixture.vendorId,
        totalAmount: 12000,
        currency: 'JPY',
        lines: [
          {
            description: `E2E PO line outside linked PO ${suffix}`,
            quantity: 1,
            unitPrice: 12000,
          },
        ],
      },
    },
  );
  await ensureOk(anotherPoRes);
  const anotherPo = await anotherPoRes.json();
  const anotherPoLineId = anotherPo?.lines?.[0]?.id as string | undefined;
  expect(anotherPoLineId).toBeTruthy();

  const outsideLinkedPoRes = await putLinesWithPurchaseOrderLine(
    anotherPoLineId as string,
  );
  expect(outsideLinkedPoRes.status()).toBe(400);
  const outsideLinkedPo = await outsideLinkedPoRes.json();
  expect(outsideLinkedPo?.error?.code).toBe('INVALID_PURCHASE_ORDER_LINE');
  expect(outsideLinkedPo?.error?.message).toBe(
    'Purchase order line does not belong to the linked PO',
  );
  expect(
    outsideLinkedPo?.error?.details?.invalidPurchaseOrderLineIds?.includes(
      anotherPoLineId,
    ) ?? false,
  ).toBeTruthy();

  const missingPurchaseOrderLineId = `missing-po-line-${suffix}`;
  const missingLineRes = await putLinesWithPurchaseOrderLine(
    missingPurchaseOrderLineId,
  );
  expect(missingLineRes.status()).toBe(404);
  const missingLine = await missingLineRes.json();
  expect(missingLine?.error?.code).toBe('NOT_FOUND');
  expect(missingLine?.error?.message).toBe('Purchase order line not found');
  expect(
    missingLine?.error?.details?.missingPurchaseOrderLineIds?.includes(
      missingPurchaseOrderLineId,
    ) ?? false,
  ).toBeTruthy();
});
