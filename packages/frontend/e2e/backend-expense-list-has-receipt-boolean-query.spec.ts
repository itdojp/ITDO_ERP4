import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

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
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('expense list hasReceipt query accepts true/false and 1/0 forms @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseUserId = `e2e-expense-receipt-query-${suffix}@example.com`;

  const createExpense = async (input: {
    withReceipt: boolean;
    withAttachment?: boolean;
  }) => {
    const createRes = await request.post(`${apiBase}/expenses`, {
      headers: adminHeaders,
      data: {
        projectId: defaultProjectId,
        userId: expenseUserId,
        category: 'travel',
        amount: 1000,
        currency: 'JPY',
        incurredOn: '2026-04-01',
        ...(input.withReceipt
          ? {
              receiptUrl: `https://example.com/e2e/receipt-query-${suffix}.pdf`,
            }
          : {}),
        ...(input.withAttachment
          ? {
              attachments: [
                {
                  fileUrl: `https://example.com/e2e/receipt-query-attachment-${suffix}.pdf`,
                  fileName: `receipt-query-attachment-${suffix}.pdf`,
                  contentType: 'application/pdf',
                  fileSizeBytes: 2048,
                },
              ],
            }
          : {}),
      },
    });
    await ensureOk(createRes);
    const created = await createRes.json();
    const expenseId = String(created?.id ?? '');
    expect(expenseId).not.toBe('');
    return expenseId;
  };

  const withReceiptId = await createExpense({ withReceipt: true });
  const withAttachmentOnlyId = await createExpense({
    withReceipt: false,
    withAttachment: true,
  });
  const withoutReceiptId = await createExpense({ withReceipt: false });

  const fetchIds = async (hasReceipt: string) => {
    const res = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(expenseUserId)}&hasReceipt=${encodeURIComponent(hasReceipt)}`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(res);
    const payload = await res.json();
    return new Set(
      (payload?.items ?? []).map((item: any) => String(item?.id ?? '')),
    );
  };

  for (const queryValue of ['true', '1']) {
    const ids = await fetchIds(queryValue);
    expect(ids.has(withReceiptId)).toBe(true);
    expect(ids.has(withAttachmentOnlyId)).toBe(true);
    expect(ids.has(withoutReceiptId)).toBe(false);
  }

  for (const queryValue of ['false', '0']) {
    const ids = await fetchIds(queryValue);
    expect(ids.has(withReceiptId)).toBe(false);
    expect(ids.has(withAttachmentOnlyId)).toBe(false);
    expect(ids.has(withoutReceiptId)).toBe(true);
  }

  for (const queryValue of ['TRUE', 'FALSE']) {
    const res = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}&userId=${encodeURIComponent(expenseUserId)}&hasReceipt=${encodeURIComponent(queryValue)}`,
      {
        headers: adminHeaders,
      },
    );
    expect(res.status()).toBe(400);
    const payload = await res.json();
    expect(
      ['VALIDATION_ERROR', 'INVALID_BOOLEAN'].includes(
        String(payload?.error?.code ?? ''),
      ),
    ).toBe(true);
  }
});
