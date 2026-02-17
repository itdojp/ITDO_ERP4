import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  // CI runners vary in performance; keep default timeout conservative.
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

function ensureEvidenceDir() {
  if (!captureEnabled) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function captureSection(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  const capturePath = path.join(evidenceDir, filename);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect(locator).toBeVisible({ timeout: 5000 });
    await locator.screenshot({ path: capturePath });
  } catch {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // ignore capture failures to avoid blocking the test flow
    }
  }
}

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const resolvedAuthState = { ...authState, ...(override ?? {}) };
  ensureEvidenceDir();
  page.on('pageerror', (error) => {
    console.error('[e2e][pageerror]', error);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][console.error]', msg.text());
    }
  });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, resolvedAuthState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  // Use exact matching to avoid collisions like "承認" vs "承認依頼".
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function selectByLabelOrFirst(select: Locator, label?: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  if (label) {
    await expect
      .poll(() => select.locator('option', { hasText: label }).count(), {
        timeout: actionTimeout,
      })
      .toBeGreaterThan(0);
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

const buildAuthHeaders = (override?: Partial<typeof authState>) => {
  const resolved = { ...authState, ...(override ?? {}) };
  return {
    'x-user-id': resolved.userId,
    'x-roles': resolved.roles.join(','),
    'x-project-ids': (resolved.projectIds ?? []).join(','),
    'x-group-ids': (resolved.groupIds ?? []).join(','),
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

type InvoiceSnapshot = {
  id: string;
  invoiceNo?: string;
  totalAmount?: number;
  status: string;
  paidAt?: string | null;
  paidBy?: string | null;
  createdAt?: string;
};

async function fetchInvoiceById(page: Page, invoiceId: string) {
  const invoiceRes = await page.request.get(
    `${apiBase}/invoices/${encodeURIComponent(invoiceId)}`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(invoiceRes);
  return (await invoiceRes.json()) as InvoiceSnapshot;
}

async function waitForInvoiceByAmount(
  page: Page,
  projectId: string,
  totalAmount: number,
) {
  let matched: InvoiceSnapshot | undefined;
  await expect
    .poll(
      async () => {
        const listRes = await page.request.get(
          `${apiBase}/projects/${encodeURIComponent(projectId)}/invoices`,
          { headers: buildAuthHeaders() },
        );
        if (!listRes.ok()) return '';
        const listPayload = (await listRes.json()) as {
          items?: InvoiceSnapshot[];
        };
        const items = Array.isArray(listPayload?.items)
          ? listPayload.items
          : [];
        matched = items.find(
          (item) => Number(item.totalAmount) === totalAmount,
        );
        return matched?.id ?? '';
      },
      { timeout: actionTimeout },
    )
    .not.toBe('');
  return matched as InvoiceSnapshot;
}

test('frontend smoke invoice send and mark-paid lifecycle @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await prepare(page);

  await navigateToSection(page, '請求');
  const invoiceSection = page
    .locator('main')
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    invoiceSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );

  const uniqueAmount = Number(String(Date.now()).slice(-6)) + 200000;
  await invoiceSection.getByPlaceholder('金額').fill(String(uniqueAmount));
  await invoiceSection.getByRole('button', { name: /^作成$/ }).click();
  await expect(invoiceSection.getByText('作成しました')).toBeVisible({
    timeout: actionTimeout,
  });

  const projectId = authState.projectIds[0];
  const created = await waitForInvoiceByAmount(page, projectId, uniqueAmount);
  expect(created.id).toBeTruthy();
  expect(created.invoiceNo).toBeTruthy();
  expect(created.status).toBe('draft');

  await invoiceSection.getByLabel('請求検索').fill(String(created.invoiceNo));
  const targetRow = invoiceSection.locator('tbody tr', {
    hasText: String(created.invoiceNo),
  });
  await expect(targetRow).toBeVisible({ timeout: actionTimeout });

  await targetRow.getByRole('button', { name: '送信' }).click();
  await expect(invoiceSection.getByText('送信しました')).toBeVisible({
    timeout: actionTimeout,
  });

  await expect
    .poll(async () => (await fetchInvoiceById(page, created.id)).status, {
      timeout: actionTimeout,
    })
    .toBe('sent');

  const sendLogsRes = await page.request.get(
    `${apiBase}/invoices/${encodeURIComponent(created.id)}/send-logs`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(sendLogsRes);
  const sendLogs = (await sendLogsRes.json()) as {
    items?: Array<{ id?: string }>;
  };
  expect((sendLogs.items ?? []).length).toBeGreaterThan(0);
  expect((sendLogs.items ?? [])[0]?.id).toBeTruthy();

  await targetRow.getByRole('button', { name: '入金確認' }).click();
  const confirmDialog = page.getByRole('dialog', {
    name: '入金確認を実行しますか？',
  });
  await expect(confirmDialog).toBeVisible({ timeout: actionTimeout });
  await confirmDialog.getByRole('button', { name: '入金確認' }).click();
  await expect(invoiceSection.getByText('入金を確認しました')).toBeVisible({
    timeout: actionTimeout,
  });

  const paidInvoice = await fetchInvoiceById(page, created.id);
  expect(paidInvoice.status).toBe('paid');
  expect(typeof paidInvoice.paidAt).toBe('string');
  expect(paidInvoice.paidBy).toBe(authState.userId);
  await captureSection(
    invoiceSection,
    '06-extended-invoice-send-mark-paid.png',
  );
});

test('invoice mark-paid action is hidden for non-admin roles @core', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const projectId = authState.projectIds[0];
  const uniqueAmount = Number(String(Date.now()).slice(-6)) + 300000;

  const createRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/invoices`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: uniqueAmount,
        currency: 'JPY',
        lines: [
          {
            description: `E2E non-admin mark-paid ${uniqueAmount}`,
            quantity: 1,
            unitPrice: uniqueAmount,
          },
        ],
      },
    },
  );
  await ensureOk(createRes);
  const created = (await createRes.json()) as InvoiceSnapshot;
  expect(created.id).toBeTruthy();

  const sendRes = await page.request.post(
    `${apiBase}/invoices/${encodeURIComponent(created.id)}/send`,
    { headers: buildAuthHeaders(), data: {} },
  );
  await ensureOk(sendRes);

  await expect
    .poll(async () => (await fetchInvoiceById(page, created.id)).status, {
      timeout: actionTimeout,
    })
    .toBe('sent');
  const sentInvoice = await fetchInvoiceById(page, created.id);
  expect(sentInvoice.invoiceNo).toBeTruthy();

  await prepare(page, {
    userId: `e2e-user-${Date.now()}@example.com`,
    roles: ['user'],
    projectIds: [projectId],
    groupIds: [],
  });
  await navigateToSection(page, '請求');
  const invoiceSection = page
    .locator('main')
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    invoiceSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await invoiceSection
    .getByLabel('請求検索')
    .fill(String(sentInvoice.invoiceNo));
  const targetRow = invoiceSection.locator('tbody tr', {
    hasText: String(sentInvoice.invoiceNo),
  });
  await expect(targetRow).toBeVisible({ timeout: actionTimeout });
  await expect(
    targetRow.getByRole('button', { name: '入金確認' }),
  ).toHaveCount(0);
});
