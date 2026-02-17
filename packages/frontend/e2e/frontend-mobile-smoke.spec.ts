import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const actionTimeoutEnv = process.env.E2E_ACTION_TIMEOUT_MS;
const actionTimeout =
  actionTimeoutEnv != null && !Number.isNaN(Number.parseInt(actionTimeoutEnv, 10))
    ? Number.parseInt(actionTimeoutEnv, 10)
    : process.env.CI
      ? 30_000
      : 12_000;

const runId = () => randomUUID().slice(0, 10);

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
};

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

const adminHeaders = buildHeaders(authState);

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page) {
  if (page.listenerCount('pageerror') === 0) {
    page.on('pageerror', (error) => {
      console.error('[mobile-smoke] pageerror:', error);
    });
  }
  if (page.listenerCount('console') === 0) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[mobile-smoke] console.error:', msg.text());
      }
    });
  }

  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible({
    timeout: actionTimeout,
  });
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', {
        name: heading || label,
        level: 2,
        exact: true,
      }),
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

async function selectByValue(select: Locator, value: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  const hasValue = await select
    .locator('option')
    .evaluateAll(
      (options, target) =>
        options.some((option) => option.value === target),
      value,
    );
  if (!hasValue) {
    throw new Error(`selectByValue: option with value "${value}" not found`);
  }
  await select.selectOption({ value });
}

async function findSelectByOptionText(scope: Locator, optionText: string) {
  const options = scope.locator('option', { hasText: optionText });
  await expect(options).toHaveCount(1, { timeout: actionTimeout });
  const select = options.locator('xpath=ancestor::select[1]');
  await expect(select).toHaveCount(1, { timeout: actionTimeout });
  return select;
}

test.describe('mobile smoke 375x667 @core', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('invoices / vendor-documents / admin-jobs operate on mobile viewport', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const id = runId();
    const invoiceAmount = 12000 + (Number(id.replace(/\D/g, '').slice(0, 3)) || 123);
    const vendorInvoiceNo = `VI-MOB-${id}`;

    await prepare(page);

    // Seed invoice for list/filter/detail actions.
    const createInvoiceRes = await page.request.post(
      `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/invoices`,
      {
        headers: adminHeaders,
        data: {
          totalAmount: invoiceAmount,
          currency: 'JPY',
          lines: [
            {
              description: `E2E mobile invoice ${id}`,
              quantity: 1,
              unitPrice: invoiceAmount,
            },
          ],
        },
      },
    );
    await ensureOk(createInvoiceRes);

    // Seed vendor-docs data for PO link/unlink actions.
    const vendorRes = await page.request.post(`${apiBase}/vendors`, {
      headers: adminHeaders,
      data: {
        code: `E2E-MOB-${id}`,
        name: `E2E Mobile Vendor ${id}`,
        status: 'active',
      },
    });
    await ensureOk(vendorRes);
    const vendorPayload = await vendorRes.json();
    const vendorId = String(vendorPayload?.id || '');
    expect(vendorId.length).toBeGreaterThan(0);

    const poRes = await page.request.post(
      `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/purchase-orders`,
      {
        headers: adminHeaders,
        data: {
          vendorId,
          totalAmount: invoiceAmount,
          currency: 'JPY',
          lines: [
            {
              description: `E2E PO line ${id}`,
              quantity: 1,
              unitPrice: invoiceAmount,
            },
          ],
        },
      },
    );
    await ensureOk(poRes);
    const poPayload = await poRes.json();
    const poNo = String(poPayload?.poNo || '');
    expect(poNo.length).toBeGreaterThan(0);

    const vendorInvoiceRes = await page.request.post(`${apiBase}/vendor-invoices`, {
      headers: adminHeaders,
      data: {
        projectId: defaultProjectId,
        vendorId,
        totalAmount: invoiceAmount,
        currency: 'JPY',
        vendorInvoiceNo,
      },
    });
    await ensureOk(vendorInvoiceRes);

    // Invoices: list / filter / row action (detail)
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
    await invoiceSection.getByRole('button', { name: '再取得' }).click();

    const invoiceAmountPattern = new RegExp(
      `¥${invoiceAmount.toLocaleString().replace(/,/g, ',?')}`,
    );
    const invoiceRows = invoiceSection.locator('tbody tr', {
      hasText: invoiceAmountPattern,
    });
    await expect(invoiceRows).toHaveCount(1, { timeout: actionTimeout });
    const invoiceRow = invoiceRows;
    await expect(invoiceRow).toBeVisible({ timeout: actionTimeout });
    await invoiceSection.getByLabel('請求検索').fill(String(invoiceAmount));
    await expect(invoiceRow).toBeVisible({ timeout: actionTimeout });

    await invoiceRow.getByRole('button', { name: '詳細' }).click();
    const invoiceDialog = page.getByRole('dialog');
    await expect(
      invoiceDialog.getByRole('heading', { name: /請求詳細:/ }),
    ).toBeVisible({ timeout: actionTimeout });
    await invoiceDialog.getByRole('button', { name: '閉じる' }).click();
    await expect(invoiceDialog).toBeHidden({ timeout: actionTimeout });

    // VendorDocuments: PO link/unlink
    await navigateToSection(page, '仕入/発注');
    const vendorSection = page
      .locator('main')
      .locator('h2', { hasText: '仕入/発注' })
      .locator('..');
    await vendorSection.scrollIntoViewIfNeeded();
    await vendorSection.getByRole('tab', { name: /仕入請求/ }).click();
    const invoiceBlock = vendorSection
      .locator('h3', { hasText: '仕入請求' })
      .locator('..');
    const invoiceProjectSelect = await findSelectByOptionText(
      invoiceBlock,
      '案件を選択',
    );
    const invoiceVendorSelect = await findSelectByOptionText(
      invoiceBlock,
      '業者を選択',
    );
    await selectByValue(invoiceProjectSelect, defaultProjectId);
    await selectByValue(invoiceVendorSelect, vendorId);
    await invoiceBlock.getByRole('button', { name: '再取得' }).click();

    const vendorInvoiceRows = invoiceBlock.locator('tbody tr', {
      hasText: vendorInvoiceNo,
    });
    await expect(vendorInvoiceRows).toHaveCount(1, { timeout: actionTimeout });
    const vendorInvoiceRow = vendorInvoiceRows;
    await expect(vendorInvoiceRow).toBeVisible({ timeout: actionTimeout });

    await vendorInvoiceRow.getByRole('button', { name: 'PO紐づけ' }).click();
    const poDialog = page.getByRole('dialog');
    await expect(
      poDialog.getByText('仕入請求: 関連発注書（PO）'),
    ).toBeVisible({ timeout: actionTimeout });
    const poLinkSelect = await findSelectByOptionText(poDialog, '紐づけなし');
    await selectByLabelOrFirst(poLinkSelect, poNo);
    await poDialog.getByRole('button', { name: '更新' }).click();
    await expect(poDialog).toBeHidden({ timeout: actionTimeout });
    await expect
      .poll(
        () =>
          vendorInvoiceRow
            .innerText()
            .then((value) => value.includes(poNo))
            .catch(() => false),
        { timeout: actionTimeout },
      )
      .toBe(true);

    await vendorInvoiceRow.getByRole('button', { name: 'PO紐づけ' }).click();
    const poUnlinkDialog = page.getByRole('dialog');
    const poUnlinkSelect = await findSelectByOptionText(
      poUnlinkDialog,
      '紐づけなし',
    );
    await selectByLabelOrFirst(poUnlinkSelect, '紐づけなし');
    await poUnlinkDialog.getByRole('button', { name: '更新' }).click();
    await expect(poUnlinkDialog).toBeHidden({ timeout: actionTimeout });
    await expect
      .poll(
        () =>
          vendorInvoiceRow
            .innerText()
            .then((value) => value.includes(poNo))
            .catch(() => false),
        { timeout: actionTimeout },
      )
      .toBe(false);

    // AdminJobs: run + result detail
    await navigateToSection(page, 'ジョブ管理', '運用ジョブ');
    const jobsSection = page
      .locator('main')
      .locator('h2', { hasText: '運用ジョブ' })
      .locator('..');
    await jobsSection.scrollIntoViewIfNeeded();
    await jobsSection.getByLabel('ジョブ検索').fill('通知配信');
    const notificationJobRows = jobsSection.locator('tbody tr', {
      hasText: '通知配信',
    });
    await expect(notificationJobRows).toHaveCount(1, { timeout: actionTimeout });
    const notificationJobRow = notificationJobRows;
    await expect(notificationJobRow).toBeVisible({ timeout: actionTimeout });
    await notificationJobRow.getByRole('button', { name: '実行' }).click();
    await expect
      .poll(
        () =>
          notificationJobRow
            .innerText()
            .then((value) => /完了|実行中/.test(value))
            .catch(() => false),
        { timeout: actionTimeout },
      )
      .toBe(true);
    await notificationJobRow.getByRole('button', { name: '詳細' }).click();
    const resultDialog = page.getByRole('dialog');
    await expect(
      resultDialog.getByRole('heading', { name: /ジョブ結果: 通知配信/ }),
    ).toBeVisible({ timeout: actionTimeout });
    await expect(resultDialog.locator('pre')).toBeVisible({
      timeout: actionTimeout,
    });
    await resultDialog.getByRole('button', { name: '閉じる' }).click();
    await expect(resultDialog).toBeHidden({ timeout: actionTimeout });
  });
});
