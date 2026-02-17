import { randomUUID } from 'node:crypto';
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
  } catch (err) {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // ignore capture failures to avoid blocking the test flow
    }
  }
}

async function safeClick(locator: Locator, label: string) {
  try {
    await locator.click({ timeout: actionTimeout });
    return true;
  } catch (err) {
    console.warn(`[e2e] click skipped: ${label}`);
    return false;
  }
}

async function waitForList(locator: Locator, label: string) {
  try {
    await expect
      .poll(() => locator.count(), { timeout: actionTimeout })
      .toBeGreaterThan(0);
    return true;
  } catch {
    console.warn(`[e2e] list not ready: ${label}`);
    return false;
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

async function selectByValue(select: Locator, value: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  await expect
    .poll(
      () =>
        select
          .locator('option')
          .evaluateAll(
            (options, expected) =>
              options.some((option) => (option as any).value === expected),
            value,
          ),
      { timeout: actionTimeout },
    )
    .toBe(true);
  await select.selectOption({ value });
}

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const toDateTimeLocalInputValue = (date: Date) => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const shiftDateKey = (dateKey: string, deltaDays: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
};

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

test('frontend smoke core @core', async ({ page, request }) => {
  const timeTaskName = `E2Eタスク-${runId().slice(0, 8)}`;
  const timeTaskCreateRes = await request.post(
    `${apiBase}/projects/${authState.projectIds[0]}/tasks`,
    {
      headers: buildAuthHeaders(),
      data: {
        name: timeTaskName,
      },
    },
  );
  await ensureOk(timeTaskCreateRes);
  const timeTask = (await timeTaskCreateRes.json()) as { id?: string };
  const timeTaskId = String(timeTask.id || '');
  expect(timeTaskId.length).toBeGreaterThan(0);

  await prepare(page);

  const currentUserSection = page.locator('.card', {
    has: page.locator('strong', { hasText: '現在のユーザー' }),
  });
  await captureSection(currentUserSection, '00-current-user.png');

  await navigateToSection(page, 'ホーム', 'Dashboard');
  const dashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  await captureSection(dashboardSection, '01-core-dashboard.png');

  await navigateToSection(page, '日報 + ウェルビーイング');
  const dailySection = page
    .locator('main')
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await dailySection.scrollIntoViewIfNeeded();
  const dailyReportText = `E2E日報: ${runId()}`;
  await dailySection.getByPlaceholder('日報本文（任意）').fill(dailyReportText);
  await dailySection.getByRole('button', { name: 'Not Good' }).click();
  await dailySection.getByRole('button', { name: '仕事量が多い' }).click();
  await dailySection
    .getByPlaceholder(
      '共有してもよければ、今日しんどかったことを書いてください（空欄可）',
    )
    .fill('E2Eテスト: 相談したい状況');
  await dailySection
    .getByRole('checkbox', { name: '相談したい（人事/相談窓口へ）' })
    .check();
  await dailySection.getByRole('button', { name: '送信' }).click();
  await expect(dailySection.getByText('送信しました')).toBeVisible();
  const historySection = dailySection
    .locator('h3', { hasText: '日報履歴' })
    .locator('..');
  await historySection
    .getByRole('button', { name: /^履歴を読み込み$/ })
    .click();
  const historyList = dailySection.locator('[data-e2e="daily-history-list"]');
  const dailyHistoryItem = historyList.getByText(dailyReportText);
  await dailyHistoryItem.scrollIntoViewIfNeeded();
  await expect(dailyHistoryItem).toBeVisible();
  const dailyReportMaxDate = await dailySection
    .getByLabel('対象日')
    .inputValue();
  const deepLinkDailyReportDate = shiftDateKey(dailyReportMaxDate, -1);
  await captureSection(dailySection, '02-core-daily-report.png');

  await navigateToSection(page, '工数入力');
  const timeSection = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  const timeMinutes = 135;
  const timeWorkType = 'レビュー';
  const timeLocation = 'remote';
  const timeNote = `E2E工数メモ: ${runId()}`;
  await selectByLabelOrFirst(
    timeSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  const timeTaskSelect = timeSection.getByLabel('タスク選択');
  await expect
    .poll(() => timeTaskSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(
      () => timeTaskSelect.locator('option', { hasText: timeTaskName }).count(),
      { timeout: actionTimeout },
    )
    .toBeGreaterThan(0);
  await timeTaskSelect.selectOption({ label: timeTaskName });
  await timeSection.getByLabel('日付').fill(deepLinkDailyReportDate);
  await timeSection.getByLabel('工数 (分)').fill(String(timeMinutes));
  await timeSection.getByLabel('作業種別').fill(timeWorkType);
  await timeSection.getByLabel('場所').fill(timeLocation);
  await timeSection.getByLabel('作業メモ').fill(timeNote);
  await timeSection.getByRole('button', { name: '追加' }).click();
  await expect(timeSection.getByText('保存しました')).toBeVisible();
  await expect(timeSection.getByText(timeNote)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(timeSection.getByText(deepLinkDailyReportDate)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(timeSection.getByText(`${timeMinutes}分`)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(timeSection.getByText(timeWorkType)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(timeSection.getByText(timeLocation)).toBeVisible({
    timeout: actionTimeout,
  });
  const timeListRes = await page.request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(authState.projectIds[0])}`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(timeListRes);
  const timeListPayload = (await timeListRes.json()) as {
    items?: Array<{
      taskId?: string | null;
      notes?: string | null;
      minutes?: number | null;
      workType?: string | null;
      location?: string | null;
      workDate?: string | null;
    }>;
  };
  const createdTimeEntry = (timeListPayload.items || []).find(
    (item) => item.notes === timeNote,
  );
  expect(createdTimeEntry).toBeTruthy();
  expect(createdTimeEntry?.taskId || '').toBe(timeTaskId);
  expect(Number(createdTimeEntry?.minutes)).toBe(timeMinutes);
  expect(createdTimeEntry?.workType || '').toBe(timeWorkType);
  expect(createdTimeEntry?.location || '').toBe(timeLocation);
  expect((createdTimeEntry?.workDate || '').slice(0, 10)).toBe(
    deepLinkDailyReportDate,
  );
  await captureSection(timeSection, '03-core-time-entries.png');
  await timeSection.getByLabel('日付').fill(deepLinkDailyReportDate);
  await timeSection.getByRole('button', { name: '日報を開く' }).click();
  await expect(
    page.locator('main').getByRole('heading', {
      name: '日報 + ウェルビーイング',
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  const dailySectionAfterOpen = page
    .locator('main')
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await expect(dailySectionAfterOpen.getByLabel('対象日')).toHaveValue(
    deepLinkDailyReportDate,
  );

  await navigateToSection(page, '経費精算', '経費入力');
  const expenseSection = page
    .locator('main')
    .locator('h2', { hasText: '経費入力' })
    .locator('..');
  await expenseSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    expenseSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  const expenseRunTag = runId().slice(0, 6);
  const expenseCategory = `通信費-${expenseRunTag}`;
  const expenseAmount = 2345;
  const expenseCurrency = 'USD';
  const expenseDate = shiftDateKey(new Date().toISOString().slice(0, 10), -2);
  const expenseReceiptUrl = `https://example.com/receipt/${expenseRunTag}`;
  await expenseSection.getByPlaceholder('区分').fill(expenseCategory);
  await expenseSection
    .locator('input[type="number"]')
    .fill(String(expenseAmount));
  await expenseSection.getByPlaceholder('通貨').fill(expenseCurrency);
  await expenseSection.locator('input[type="date"]').fill(expenseDate);
  await expenseSection.getByLabel('共通経費').check();
  await expenseSection
    .getByPlaceholder('領収書URL (任意)')
    .fill(expenseReceiptUrl);
  await expenseSection.getByRole('button', { name: '追加' }).click();
  await expect(expenseSection.getByText('経費を保存しました')).toBeVisible();
  const createdExpenseItem = expenseSection.locator('li', {
    hasText: expenseCategory,
  });
  await expect(createdExpenseItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(createdExpenseItem).toContainText(expenseDate, {
    timeout: actionTimeout,
  });
  await expect(createdExpenseItem).toContainText(
    `${expenseAmount} ${expenseCurrency}`,
    { timeout: actionTimeout },
  );
  await expect(createdExpenseItem).toContainText('共通', {
    timeout: actionTimeout,
  });
  await expect(
    createdExpenseItem.getByRole('link', { name: '領収書' }),
  ).toHaveAttribute('href', expenseReceiptUrl);
  await captureSection(expenseSection, '04-core-expenses.png');

  // 経費注釈（Drawer + EntityReferencePicker）: 保存 → 再表示で永続化を確認
  const expenseAnnotationText = `E2E経費注釈: ${runId()}`;
  const expenseAnnotationButtons = expenseSection.getByRole('button', {
    name: new RegExp(
      `注釈（経費）: .* ${expenseCategory} ${expenseAmount} ${expenseCurrency}`,
    ),
  });
  await expect(expenseAnnotationButtons).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await expenseAnnotationButtons.click();
  const expenseAnnotationDrawer = page.getByRole('dialog', { name: /経費:/ });
  await expect(expenseAnnotationDrawer).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer
    .getByLabel('メモ（Markdown）')
    .fill(expenseAnnotationText);
  const referencePickerInput = expenseAnnotationDrawer.getByLabel('候補検索');
  await referencePickerInput.fill('PRJ-DEMO-1');
  const referenceCandidate = expenseAnnotationDrawer.getByRole('option', {
    name: /PRJ-DEMO-1/,
  });
  await expect(referenceCandidate).toHaveCount(1, { timeout: actionTimeout });
  await referenceCandidate.click();
  await expect(
    expenseAnnotationDrawer.getByRole('list', { name: 'Selected references' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible({
    timeout: actionTimeout,
  });
  await expenseAnnotationDrawer.getByRole('button', { name: '閉じる' }).click();
  await expect(expenseAnnotationDrawer).toBeHidden({ timeout: actionTimeout });

  await expenseAnnotationButtons.click();
  const expenseAnnotationDrawer2 = page.getByRole('dialog', { name: /経費:/ });
  await expect(
    expenseAnnotationDrawer2.getByLabel('メモ（Markdown）'),
  ).toHaveValue(expenseAnnotationText, { timeout: actionTimeout });
  await expect(
    expenseAnnotationDrawer2.getByRole('list', { name: 'Selected references' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer2
    .getByRole('button', { name: '閉じる' })
    .click();
  await expect(expenseAnnotationDrawer2).toBeHidden({ timeout: actionTimeout });

  await navigateToSection(page, '見積');
  const estimateSection = page
    .locator('main')
    .locator('h2', { hasText: '見積' })
    .locator('..');
  await estimateSection.scrollIntoViewIfNeeded();
  const estimateTag = `E2E-${runId()}`;
  await selectByLabelOrFirst(
    estimateSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await estimateSection.locator('input[type="number"]').fill('90000');
  await estimateSection.getByLabel('備考').fill(estimateTag);
  await estimateSection.getByRole('button', { name: '作成' }).click();
  await expect(estimateSection.getByText('作成しました')).toBeVisible();
  await estimateSection.getByRole('button', { name: '承認依頼' }).click();
  await expect(estimateSection.getByText('承認依頼しました')).toBeVisible();
  const estimateRes = await page.request.get(
    `${apiBase}/projects/${authState.projectIds[0]}/estimates`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(estimateRes);
  const estimatePayload = await estimateRes.json();
  const createdEstimate = (estimatePayload?.items ?? []).find(
    (item: any) => item?.notes === estimateTag,
  ) as { id?: string; estimateNo?: string } | undefined;
  const estimateId = createdEstimate?.id as string | undefined;
  const createdEstimateNo = createdEstimate?.estimateNo || '';
  expect(estimateId).toBeTruthy();
  expect(createdEstimateNo.length).toBeGreaterThan(0);
  const instanceRes = await page.request.get(
    `${apiBase}/approval-instances?flowType=estimate&projectId=${encodeURIComponent(
      authState.projectIds[0],
    )}`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(instanceRes);
  const instancePayload = await instanceRes.json();
  const instance = (instancePayload?.items ?? []).find(
    (item: any) =>
      item?.targetTable === 'estimates' &&
      item?.targetId === estimateId &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected',
  ) as any;
  expect(instance?.id).toBeTruthy();
  const actRes = await page.request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(instance.id)}/act`,
    {
      headers: buildAuthHeaders(),
      data: { action: 'approve', reason: 'e2e-smoke' },
    },
  );
  await ensureOk(actRes);
  await estimateSection.getByRole('button', { name: '読み込み' }).click();
  await expect(estimateSection.getByText('読み込みました')).toBeVisible();
  const estimateRows = estimateSection.locator('ul.list li', {
    hasText: createdEstimateNo,
  });
  await expect(estimateRows).toHaveCount(1, { timeout: actionTimeout });
  await estimateRows.getByRole('button', { name: '送信 (Stub)' }).click();
  await expect(estimateSection.getByText('送信しました')).toBeVisible();
  await captureSection(estimateSection, '05-core-estimates.png');

  await navigateToSection(page, '請求');
  const invoiceSection = page
    .locator('main')
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  const invoiceAmount =
    150000 + (Number(String(runId()).replace(/\D/g, '').slice(-4)) || 1234);
  await selectByLabelOrFirst(
    invoiceSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await invoiceSection.getByPlaceholder('金額').fill(String(invoiceAmount));
  await invoiceSection.getByRole('button', { name: /^作成$/ }).click();
  await expect(invoiceSection.getByText('作成しました')).toBeVisible();
  await invoiceSection.getByLabel('請求検索').fill(String(invoiceAmount));
  await captureSection(invoiceSection, '06-core-invoices.png');

  // 注釈UI（Invoices）: 作成 → 注釈保存 → 再表示で永続化を確認
  const invoiceAmountPattern = new RegExp(
    `¥${invoiceAmount.toLocaleString().replace(/,/g, ',?')}`,
  );
  const createdInvoiceRows = invoiceSection.locator('tbody tr', {
    hasText: invoiceAmountPattern,
  });
  await expect(createdInvoiceRows).toHaveCount(1, { timeout: actionTimeout });
  await createdInvoiceRows.getByRole('button', { name: '詳細' }).click();
  const invoiceDetailDrawer = page.getByRole('dialog', { name: /請求詳細/ });
  await expect(invoiceDetailDrawer).toBeVisible({ timeout: actionTimeout });
  await expect(
    invoiceDetailDrawer.getByRole('heading', { name: /請求詳細:/ }),
  ).toBeVisible({ timeout: actionTimeout });
  const invoiceAnnotationText = `E2E請求注釈: ${runId()}`;
  await invoiceDetailDrawer.getByRole('button', { name: '注釈' }).click();
  const invoiceAnnotationDialog = page.getByRole('dialog', { name: /請求:/ });
  await invoiceAnnotationDialog
    .getByLabel('メモ（Markdown）')
    .fill(invoiceAnnotationText);
  await invoiceAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(invoiceAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await invoiceAnnotationDialog.getByRole('button', { name: '閉じる' }).click();

  await invoiceDetailDrawer.getByRole('button', { name: '注釈' }).click();
  const invoiceAnnotationDialog2 = page.getByRole('dialog', { name: /請求:/ });
  await expect(
    invoiceAnnotationDialog2.getByLabel('メモ（Markdown）'),
  ).toHaveValue(invoiceAnnotationText, { timeout: actionTimeout });
  await invoiceAnnotationDialog2
    .getByRole('button', { name: '閉じる' })
    .click();
  await invoiceDetailDrawer.getByRole('button', { name: '閉じる' }).click();
  await expect(invoiceDetailDrawer).toBeHidden({ timeout: actionTimeout });

  await navigateToSection(page, 'ホーム', '検索（ERP横断）');
  const searchSection = page
    .locator('main')
    .locator('h2', { hasText: '検索（ERP横断）' })
    .locator('..');
  await searchSection.scrollIntoViewIfNeeded();
  await searchSection.getByLabel('検索語').fill('PRJ-DEMO-1');
  await searchSection.getByRole('button', { name: '検索' }).click();
  await expect(searchSection.getByText('PRJ-DEMO-1')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(searchSection, '06-core-global-search.png');
});
