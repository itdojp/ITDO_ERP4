import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const actionTimeoutEnv = process.env.E2E_ACTION_TIMEOUT_MS;
const actionTimeout =
  actionTimeoutEnv != null &&
  !Number.isNaN(Number.parseInt(actionTimeoutEnv, 10))
    ? Number.parseInt(actionTimeoutEnv, 10)
    : process.env.CI
      ? 30_000
      : 12_000;

const runId = () => randomUUID().slice(0, 10);

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const toPeriodValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

const shiftDate = (date: Date, deltaDays: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + deltaDays);
  return next;
};

const shiftMonth = (date: Date, deltaMonths: number) => {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + deltaMonths);
  const lastDayOfTargetMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
};

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
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page.locator('main').getByRole('heading', {
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
      (options, target) => options.some((option) => option.value === target),
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
  const select = options.locator('..');
  await expect(select).toHaveCount(1, { timeout: actionTimeout });
  await expect(select).toHaveJSProperty('tagName', 'SELECT');
  return select;
}

test.describe('mobile smoke 375x667 @core', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('invoices / vendor-documents / admin-jobs / audit-logs / period-locks operate on mobile viewport', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const id = runId();
    const invoiceAmount =
      12000 + (Number(id.replace(/\D/g, '').slice(0, 3)) || 123);
    const vendorInvoiceNo = `VI-MOB-${id}`;
    const lockPeriod = toPeriodValue(new Date());
    const lockPeriodOffset =
      6 + ((Number(id.replace(/\D/g, '').slice(0, 2)) || 0) % 12);
    const mobileLockPeriod = toPeriodValue(
      shiftMonth(new Date(), lockPeriodOffset),
    );
    const mobileLockReason = `e2e-mobile-lock-${id}`;

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

    const vendorInvoiceRes = await page.request.post(
      `${apiBase}/vendor-invoices`,
      {
        headers: adminHeaders,
        data: {
          projectId: defaultProjectId,
          vendorId,
          totalAmount: invoiceAmount,
          currency: 'JPY',
          vendorInvoiceNo,
        },
      },
    );
    await ensureOk(vendorInvoiceRes);

    // Seed period lock for list/filter actions.
    const lockRes = await page.request.post(`${apiBase}/period-locks`, {
      headers: adminHeaders,
      data: { period: lockPeriod, scope: 'global', reason: `e2e-mobile-${id}` },
    });
    if (!lockRes.ok() && lockRes.status() !== 409) {
      throw new Error(`Failed to create period lock: ${lockRes.status()}`);
    }

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
    await expect(poDialog.getByText('仕入請求: 関連発注書（PO）')).toBeVisible({
      timeout: actionTimeout,
    });
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

    // VendorDocuments: allocation input + PDF stub warning
    await vendorInvoiceRow.getByRole('button', { name: '配賦明細' }).click();
    const allocationDialog = page.getByRole('dialog');
    await expect(allocationDialog.getByText('仕入請求: 配賦明細')).toBeVisible({
      timeout: actionTimeout,
    });
    await expect(allocationDialog.getByText('PDF未登録')).toBeVisible({
      timeout: actionTimeout,
    });
    await expect(
      allocationDialog.getByText('配賦明細を読み込み中...'),
    ).toHaveCount(0, { timeout: actionTimeout });
    const allocationExpandButton = allocationDialog.getByRole('button', {
      name: '配賦明細を入力',
    });
    if ((await allocationExpandButton.count()) > 0) {
      await allocationExpandButton.click();
    }
    await expect(
      allocationDialog.getByRole('button', { name: '配賦明細を隠す' }),
    ).toBeVisible({ timeout: actionTimeout });
    const allocationRows = allocationDialog.locator('table tbody tr');
    const allocationRowCountBefore = await allocationRows.count();
    await allocationDialog.getByRole('button', { name: '明細追加' }).click();
    await expect(allocationRows).toHaveCount(allocationRowCountBefore + 1, {
      timeout: actionTimeout,
    });
    const allocationRow = allocationDialog.locator('table tbody tr:last-child');
    await expect(allocationRow).toBeVisible({ timeout: actionTimeout });
    const allocationProjectSelect = await findSelectByOptionText(
      allocationRow,
      '案件を選択',
    );
    if ((await allocationProjectSelect.inputValue()) === '') {
      await selectByValue(allocationProjectSelect, defaultProjectId);
    }
    await allocationRow
      .locator('td:nth-child(2) input[type="number"]')
      .fill(String(invoiceAmount));
    await allocationDialog.getByRole('button', { name: '更新' }).click();
    await expect(
      allocationDialog.getByText('配賦明細を更新しました'),
    ).toBeVisible({
      timeout: actionTimeout,
    });
    await allocationDialog.getByRole('button', { name: '閉じる' }).click();
    await expect(allocationDialog).toBeHidden({ timeout: actionTimeout });

    // AdminJobs: run + result detail
    await navigateToSection(page, 'ジョブ管理', '運用ジョブ');
    const jobsSection = page
      .locator('main')
      .locator('h2', { hasText: '運用ジョブ' })
      .locator('..');
    await jobsSection.scrollIntoViewIfNeeded();
    await jobsSection
      .getByRole('checkbox', { name: '通知配信 dryRun' })
      .check();
    await jobsSection.getByLabel('通知 limit').fill('5');
    await jobsSection.getByLabel('ジョブ検索').fill('通知配信');
    const notificationJobRows = jobsSection.locator('tbody tr', {
      hasText: '通知配信',
    });
    await expect(notificationJobRows).toHaveCount(1, {
      timeout: actionTimeout,
    });
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
    await expect
      .poll(
        () =>
          notificationJobRow
            .innerText()
            .then(
              (value) =>
                value.includes('dryRun=true') && value.includes('limit=5'),
            )
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

    // AuditLogs: filter + search
    await navigateToSection(page, '監査ログ');
    const auditLogSection = page
      .locator('main')
      .getByRole('heading', { name: '監査ログ', level: 2, exact: true })
      .locator('..');
    await auditLogSection.scrollIntoViewIfNeeded();
    const auditToDate = new Date();
    const auditFromDate = shiftDate(auditToDate, -7);
    const auditTo = toDateInputValue(auditToDate);
    const auditFrom = toDateInputValue(auditFromDate);
    await auditLogSection.getByLabel('from', { exact: true }).fill(auditFrom);
    await auditLogSection.getByLabel('to', { exact: true }).fill(auditTo);
    await auditLogSection.getByRole('button', { name: '検索' }).click();
    await expect
      .poll(
        async () => {
          const loadingVisible = await auditLogSection
            .getByText('監査ログを取得中')
            .isVisible()
            .catch(() => false);
          if (loadingVisible) return 'loading';
          const rowCount = await auditLogSection.locator('tbody tr').count();
          if (rowCount > 0) return 'rows';
          const emptyVisible = await auditLogSection
            .getByText('監査ログなし')
            .isVisible()
            .catch(() => false);
          if (emptyVisible) return 'empty';
          const errorVisible = await auditLogSection
            .getByText('監査ログの取得に失敗しました')
            .isVisible()
            .catch(() => false);
          if (errorVisible) return 'error';
          return 'waiting';
        },
        { timeout: actionTimeout },
      )
      .toMatch(/rows|empty/);
    const [auditCsvDownload] = await Promise.all([
      page.waitForEvent('download'),
      auditLogSection.getByRole('button', { name: 'CSV出力' }).click(),
    ]);
    expect(auditCsvDownload.suggestedFilename().toLowerCase()).toContain(
      'audit',
    );

    // PeriodLocks: create + unlock + filter/search
    await navigateToSection(page, '期間締め');
    const periodLockSection = page
      .locator('main')
      .locator('h2', { hasText: '期間締め' })
      .locator('..');
    await periodLockSection.scrollIntoViewIfNeeded();
    const periodCreatePeriodInput = periodLockSection.getByLabel(
      'period (YYYY-MM)',
      { exact: true },
    );
    await expect(periodCreatePeriodInput).toBeVisible({
      timeout: actionTimeout,
    });
    const periodCreatePanel = periodCreatePeriodInput.locator('..').locator('..');
    await periodCreatePeriodInput.fill(mobileLockPeriod);
    await periodCreatePanel
      .getByLabel('scope', { exact: true })
      .selectOption({ value: 'project' });
    await selectByValue(
      periodCreatePanel.getByLabel('project', { exact: true }),
      defaultProjectId,
    );
    await periodCreatePanel.getByLabel('reason', { exact: true }).fill(
      mobileLockReason,
    );
    await periodLockSection.getByRole('button', { name: '締め登録' }).click();
    await periodLockSection
      .getByLabel('period', { exact: true })
      .fill(mobileLockPeriod);
    await periodLockSection.getByRole('button', { name: '検索' }).click();
    const createdLockRows = periodLockSection.locator('tbody tr', {
      hasText: mobileLockReason,
    });
    await expect(createdLockRows).toHaveCount(1, { timeout: actionTimeout });
    await createdLockRows.getByRole('button', { name: '解除' }).click();
    const unlockDialog = page.getByRole('dialog', {
      name: '期間締めを解除しますか？',
    });
    await expect(unlockDialog).toBeVisible({ timeout: actionTimeout });
    await unlockDialog.getByRole('button', { name: '解除' }).click();
    await expect(unlockDialog).toBeHidden({ timeout: actionTimeout });
    await expect
      .poll(() => createdLockRows.count(), { timeout: actionTimeout })
      .toBe(0);

    await periodLockSection
      .getByLabel('period', { exact: true })
      .fill(lockPeriod);
    await periodLockSection.getByRole('button', { name: '検索' }).click();
    const periodRows = periodLockSection.locator('tbody tr', {
      hasText: lockPeriod,
    });
    await expect
      .poll(() => periodRows.count(), { timeout: actionTimeout })
      .toBeGreaterThan(0);
  });
});
