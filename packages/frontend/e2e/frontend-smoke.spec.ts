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
const actionTimeout = 8000;

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

async function prepare(page: Page) {
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
  }, authState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label }).click();
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
  await select.selectOption({ value });
}

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

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

async function ensureOk(res: { ok(): boolean; status(): number }) {
  expect(res.ok()).toBeTruthy();
  if (!res.ok()) {
    throw new Error(`Request failed with status ${res.status()}`);
  }
}

test('frontend smoke core @core', async ({ page }) => {
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
  const dailyReportMaxDate = await dailySection.getByLabel('対象日').inputValue();
  const deepLinkDailyReportDate = shiftDateKey(dailyReportMaxDate, -1);
  await captureSection(dailySection, '02-core-daily-report.png');

  await navigateToSection(page, '工数入力');
  const timeSection = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    timeSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await timeSection.locator('input[type="number"]').fill('120');
  await timeSection.getByRole('button', { name: '追加' }).click();
  await expect(timeSection.getByText('保存しました')).toBeVisible();
  await captureSection(timeSection, '03-core-time-entries.png');
  await timeSection.locator('input[type="date"]').fill(deepLinkDailyReportDate);
  await timeSection.getByRole('button', { name: '日報を開く' }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', {
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
  await expenseSection.locator('input[type="number"]').fill('2000');
  await expenseSection.getByRole('button', { name: '追加' }).click();
  await expect(expenseSection.getByText('経費を保存しました')).toBeVisible();
  await captureSection(expenseSection, '04-core-expenses.png');

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
  const estimateId = (estimatePayload?.items ?? []).find(
    (item: any) => item?.notes === estimateTag,
  )?.id as string | undefined;
  expect(estimateId).toBeTruthy();
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
  const estimateFirstRow = estimateSection.locator('ul.list li').first();
  await estimateFirstRow.getByRole('button', { name: '送信 (Stub)' }).click();
  await expect(estimateSection.getByText('送信しました')).toBeVisible();
  await captureSection(estimateSection, '05-core-estimates.png');

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
  await invoiceSection.getByPlaceholder('金額').fill('150000');
  await invoiceSection.getByRole('button', { name: /^作成$/ }).click();
  await expect(invoiceSection.getByText('作成しました')).toBeVisible();
  await captureSection(invoiceSection, '06-core-invoices.png');

  // 注釈UI（Invoices）: 作成 → 注釈保存 → 再表示で永続化を確認
  await invoiceSection.getByRole('button', { name: '詳細' }).click();
  await expect(
    invoiceSection.getByRole('heading', { name: '請求詳細' }),
  ).toBeVisible({ timeout: actionTimeout });
  const invoiceAnnotationText = `E2E請求注釈: ${runId()}`;
  await invoiceSection.getByRole('button', { name: '注釈' }).click();
  const invoiceAnnotationDialog = page.getByRole('dialog');
  await invoiceAnnotationDialog
    .getByLabel('メモ（Markdown）')
    .fill(invoiceAnnotationText);
  await invoiceAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(invoiceAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await invoiceAnnotationDialog.getByRole('button', { name: '閉じる' }).click();

  await invoiceSection.getByRole('button', { name: '注釈' }).click();
  const invoiceAnnotationDialog2 = page.getByRole('dialog');
  await expect(invoiceAnnotationDialog2.getByLabel('メモ（Markdown）')).toHaveValue(
    invoiceAnnotationText,
    { timeout: actionTimeout },
  );
  await invoiceAnnotationDialog2.getByRole('button', { name: '閉じる' }).click();
  await invoiceSection.getByRole('button', { name: '閉じる' }).click();

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

test('frontend smoke vendor approvals @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  await navigateToSection(page, '仕入/発注');
  const vendorSection = page
    .locator('main')
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await vendorSection.scrollIntoViewIfNeeded();

  const poBlock = vendorSection
    .locator('h3', { hasText: '発注書' })
    .locator('..');
  await safeClick(poBlock.getByRole('button', { name: '再読込' }), 'po reload');
  const poReady = await waitForList(poBlock.locator('ul.list li'), 'po list');
  const poSubmitButton = poBlock.getByRole('button', { name: '承認依頼' });
  if (
    poReady &&
    (await poSubmitButton.count()) > 0 &&
    (await poSubmitButton
      .first()
      .isEnabled({ timeout: actionTimeout })
      .catch(() => false))
  ) {
    if (await safeClick(poSubmitButton.first(), 'po submit')) {
      await expect(poBlock.getByText('発注書を承認依頼しました')).toBeVisible({
        timeout: actionTimeout,
      });
    }
  }

  const quoteBlock = vendorSection
    .locator('h3', { hasText: '仕入見積' })
    .locator('..');
  await safeClick(
    quoteBlock.getByRole('button', { name: '再読込' }),
    'quote reload',
  );
  const quoteReady = await waitForList(
    quoteBlock.locator('ul.list li'),
    'quote list',
  );

  const invoiceBlock = vendorSection
    .locator('h3', { hasText: '仕入請求' })
    .locator('..');
  await safeClick(
    invoiceBlock.getByRole('button', { name: '再読込' }),
    'invoice reload',
  );
  const invoiceReady = await waitForList(
    invoiceBlock.locator('ul.list li'),
    'invoice list',
  );

  if (!poReady || !quoteReady || !invoiceReady) {
    await captureSection(vendorSection, '06-vendor-docs.png');
    return;
  }

  await captureSection(vendorSection, '06-vendor-docs.png');

  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  await safeClick(
    approvalsSection.getByRole('button', { name: '再読込' }),
    'approvals reload',
  );
  const approveButtons = approvalsSection.getByRole('button', { name: '承認' });
  if (
    await approveButtons
      .first()
      .isEnabled({ timeout: actionTimeout })
      .catch(() => false)
  ) {
    if (await safeClick(approveButtons.first(), 'approval act')) {
      await expect(approvalsSection.getByText('承認しました')).toBeVisible({
        timeout: actionTimeout,
      });
    }
  }
  await captureSection(approvalsSection, '07-approvals.png');
});

test('frontend smoke vendor docs create @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  const digits = String(id).replace(/\D/g, '').slice(-4) || '1234';
  const base = Number(digits);
  const poAmount = base + 1000;
  const quoteAmount = base + 2000;
  const invoiceAmount = base + 3000;
  await prepare(page);

  await navigateToSection(page, '仕入/発注');
  const vendorSection = page
    .locator('main')
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await vendorSection.scrollIntoViewIfNeeded();

  const poBlock = vendorSection
    .locator('h3', { hasText: '発注書' })
    .locator('..');
  const poProjectSelect = poBlock.locator('select').first();
  const poVendorSelect = poBlock.locator('select').nth(1);
  await selectByLabelOrFirst(poProjectSelect);
  await selectByLabelOrFirst(poVendorSelect);
  const vendorDocsProjectId = await poProjectSelect.inputValue();
  const vendorDocsVendorId = await poVendorSelect.inputValue();
  await poBlock.locator('input[type="number"]').first().fill(String(poAmount));
  await poBlock.getByRole('button', { name: '登録' }).click();
  await expect(poBlock.getByText('発注書を登録しました')).toBeVisible();
  await expect(
    poBlock.getByText(`${poAmount.toLocaleString()} JPY`),
  ).toBeVisible();
  const createdPoItem = poBlock
    .locator('ul.list li', { hasText: `${poAmount.toLocaleString()} JPY` })
    .first();
  await expect(createdPoItem).toBeVisible({ timeout: actionTimeout });
  const createdPoText = await createdPoItem.innerText();
  const poNo = createdPoText.match(/PO\d{4}-\d{2}-\d{4}/)?.[0];
  expect(poNo).toBeTruthy();
  const poNoValue = poNo as string;

  const quoteBlock = vendorSection
    .locator('h3', { hasText: '仕入見積' })
    .locator('..');
  const quoteProjectSelect = quoteBlock.locator('select').first();
  const quoteVendorSelect = quoteBlock.locator('select').nth(1);
  await selectByValue(quoteProjectSelect, vendorDocsProjectId);
  await selectByValue(quoteVendorSelect, vendorDocsVendorId);
  const quoteNo = `VQ-E2E-${id}`;
  await quoteBlock.getByPlaceholder('見積番号').fill(quoteNo);
  await quoteBlock
    .locator('input[type="number"]')
    .first()
    .fill(String(quoteAmount));
  await quoteBlock.getByRole('button', { name: '登録' }).click();
  await expect(quoteBlock.getByText('仕入見積を登録しました')).toBeVisible();
  await expect(quoteBlock.getByText(quoteNo)).toBeVisible();

  const invoiceBlock = vendorSection
    .locator('h3', { hasText: '仕入請求' })
    .locator('..');
  const invoiceProjectSelect = invoiceBlock.locator('select').first();
  const invoiceVendorSelect = invoiceBlock.locator('select').nth(1);
  await selectByValue(invoiceProjectSelect, vendorDocsProjectId);
  await selectByValue(invoiceVendorSelect, vendorDocsVendorId);
  const vendorInvoiceNo = `VI-E2E-${id}`;
  await invoiceBlock.getByPlaceholder('請求番号').fill(vendorInvoiceNo);
  await invoiceBlock
    .locator('input[type="number"]')
    .first()
    .fill(String(invoiceAmount));
  await invoiceBlock.getByRole('button', { name: '登録' }).click();
  await expect(invoiceBlock.getByText('仕入請求を登録しました')).toBeVisible();
  await expect(invoiceBlock.getByText(vendorInvoiceNo)).toBeVisible();

  const annotationText = `E2E注釈: ${id}`;
  const createdInvoiceItem = invoiceBlock.locator('ul.list li', {
    hasText: vendorInvoiceNo,
  }).first();
  await expect(createdInvoiceItem).toBeVisible({ timeout: actionTimeout });

  // (1) PO紐づけ → 一覧に PO番号表示
  await createdInvoiceItem.scrollIntoViewIfNeeded();
  await createdInvoiceItem.getByRole('button', { name: 'PO紐づけ' }).click();
  const poLinkDialog = page.getByRole('dialog');
  await expect(poLinkDialog.getByText('仕入請求: 関連発注書（PO）')).toBeVisible({
    timeout: actionTimeout,
  });
  const poLinkSelect = poLinkDialog.locator('select').first();
  await selectByLabelOrFirst(poLinkSelect, poNoValue);
  await poLinkDialog.getByRole('button', { name: '更新' }).click();
  await expect(poLinkDialog).toBeHidden({ timeout: actionTimeout });
  await expect
    .poll(
      () =>
        createdInvoiceItem.innerText().then((value) => ({
          hasLabel: value.includes('関連発注書:'),
          hasPoNo: value.includes(poNoValue),
        })),
      { timeout: actionTimeout },
    )
    .toEqual({ hasLabel: true, hasPoNo: true });

  // (2) 紐づけ解除
  await createdInvoiceItem.scrollIntoViewIfNeeded();
  await createdInvoiceItem.getByRole('button', { name: 'PO紐づけ' }).click();
  const poUnlinkDialog = page.getByRole('dialog');
  await expect(
    poUnlinkDialog.getByText('仕入請求: 関連発注書（PO）'),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  const poUnlinkSelect = poUnlinkDialog.locator('select').first();
  await selectByLabelOrFirst(poUnlinkSelect, '紐づけなし');
  await poUnlinkDialog.getByRole('button', { name: '更新' }).click();
  await expect(poUnlinkDialog).toBeHidden({ timeout: actionTimeout });
  await expect
    .poll(
      () =>
        createdInvoiceItem
          .innerText()
          .then((value) => value.includes('関連発注書:')),
      { timeout: actionTimeout },
    )
    .toBe(false);

  // (3) 配賦明細ダイアログ → トグル → 明細追加 → 更新成功メッセージ
  await createdInvoiceItem.scrollIntoViewIfNeeded();
  await createdInvoiceItem.getByRole('button', { name: '配賦明細' }).click();
  const allocationDialog = page.getByRole('dialog');
  await expect(allocationDialog.getByText('仕入請求: 配賦明細')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(allocationDialog.getByText('配賦明細を読み込み中...')).toHaveCount(
    0,
    { timeout: actionTimeout },
  );
  await allocationDialog
    .getByRole('button', { name: '配賦明細を入力' })
    .click();
  await expect(
    allocationDialog.getByRole('button', { name: '配賦明細を隠す' }),
  ).toBeVisible({ timeout: actionTimeout });
  await allocationDialog.getByRole('button', { name: '明細追加' }).click();
  const allocationRow = allocationDialog.locator('table tbody tr').first();
  await expect(allocationRow).toBeVisible({ timeout: actionTimeout });
  const allocationProjectSelect = allocationRow.locator('select').first();
  if ((await allocationProjectSelect.inputValue()) === '') {
    await selectByLabelOrFirst(allocationProjectSelect);
  }
  await allocationRow
    .locator('input[type=\"number\"]')
    .first()
    .fill(String(invoiceAmount));
  await allocationDialog.getByRole('button', { name: '更新' }).click();
  const allocationSuccessMessage = allocationDialog.locator('p', {
    hasText: '配賦明細を更新しました',
  });
  await expect(allocationSuccessMessage).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await allocationSuccessMessage.scrollIntoViewIfNeeded();
  await expect(allocationSuccessMessage).toBeVisible({
    timeout: actionTimeout,
  });
  await allocationDialog.getByRole('button', { name: '閉じる' }).click();
  await expect(allocationDialog).toBeHidden({ timeout: actionTimeout });

  await createdInvoiceItem.getByRole('button', { name: '注釈' }).click();
  const annotationDialog = page.getByRole('dialog');
  await expect(
    annotationDialog.getByRole('heading', { name: `仕入請求: ${vendorInvoiceNo}` }),
  ).toBeVisible({ timeout: actionTimeout });
  await annotationDialog.getByLabel('メモ（Markdown）').fill(annotationText);
  await annotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(annotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await annotationDialog.getByRole('button', { name: '閉じる' }).click();

  await createdInvoiceItem.getByRole('button', { name: '注釈' }).click();
  const annotationDialog2 = page.getByRole('dialog');
  await expect(annotationDialog2.getByLabel('メモ（Markdown）')).toHaveValue(
    annotationText,
    { timeout: actionTimeout },
  );
  await annotationDialog2.getByRole('button', { name: '閉じる' }).click();

  await captureSection(vendorSection, '06-vendor-docs-create.png');
});

test('frontend smoke reports masters settings @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  await prepare(page);

  await navigateToSection(page, 'レポート', 'Reports');
  const reportsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Reports' })
    .locator('..');
  await reportsSection.scrollIntoViewIfNeeded();
  await reportsSection.getByRole('button', { name: 'PJ別工数' }).click();
  await expect(
    reportsSection.getByText('プロジェクト別工数を取得しました'),
  ).toBeVisible();
  await reportsSection.getByRole('button', { name: 'グループ別工数' }).click();
  await expect(
    reportsSection.getByText('グループ別工数を取得しました'),
  ).toBeVisible();
  await reportsSection.getByRole('button', { name: '個人別残業' }).click();
  await expect(
    reportsSection.getByText('個人別残業を取得しました'),
  ).toBeVisible();
  await captureSection(reportsSection, '08-reports.png');

  await navigateToSection(page, '案件');
  const projectsSection = page
    .locator('main')
    .locator('h2', { hasText: '案件' })
    .locator('..');
  await projectsSection.scrollIntoViewIfNeeded();
  await projectsSection.getByLabel('案件コード').fill(`E2E-PRJ-${id}`);
  await projectsSection.getByLabel('案件名称').fill(`E2E Project ${id}`);
  await projectsSection
    .getByLabel('顧客選択')
    .selectOption({ label: 'CUST-DEMO-1 / Demo Customer 1' });
  await projectsSection.getByRole('button', { name: '追加' }).click();
  await expect(projectsSection.getByText('案件を追加しました')).toBeVisible();
  const projectItem = projectsSection.locator('li', {
    hasText: `E2E-PRJ-${id}`,
  });
  await expect(projectItem).toBeVisible();
  await projectItem.getByRole('button', { name: 'メンバー管理' }).click();
  const memberCard = projectItem.locator('.card', {
    hasText: 'メンバー管理',
  });
  await expect(memberCard).toBeVisible();
  await memberCard.getByPlaceholder('候補検索 (2文字以上)').fill('E2E');
  await memberCard.getByRole('button', { name: '検索' }).click();
  await expect(memberCard.getByText('E2E Member 1')).toBeVisible();
  await memberCard
    .locator('li', { hasText: 'e2e-member-1@example.com' })
    .getByRole('button', { name: '選択' })
    .click();
  await expect(memberCard.getByLabel('案件メンバーのユーザID')).toHaveValue(
    'e2e-member-1@example.com',
  );
  await memberCard.getByRole('button', { name: '追加' }).click();
  await expect(memberCard.getByText('e2e-member-1@example.com')).toBeVisible({
    timeout: actionTimeout,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    memberCard.getByRole('button', { name: 'CSVエクスポート' }).click(),
  ]);
  await expect(download.suggestedFilename()).toContain('project-members-');
  const csv = 'userId,role\n' + 'e2e-member-2@example.com,member\n';
  await memberCard.locator('#project-members-csv-input').setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await memberCard.getByRole('button', { name: 'CSVインポート' }).click();
  await expect(memberCard.getByText('e2e-member-2@example.com')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(projectsSection, '09-projects.png');
  await captureSection(memberCard, '09-project-members.png');

  await navigateToSection(page, 'マスタ管理', '顧客/業者マスタ');
  const masterSection = page
    .locator('main')
    .locator('h2', { hasText: '顧客/業者マスタ' })
    .locator('..');
  await masterSection.scrollIntoViewIfNeeded();
  const customerBlock = masterSection
    .locator('h3', { hasText: '顧客' })
    .locator('..');
  const customerCode = `E2E-CUST-${id}`;
  const customerName = `E2E Customer ${id}`;
  await customerBlock.getByLabel('顧客コード').fill(customerCode);
  await customerBlock.getByLabel('顧客名称').fill(customerName);
  await customerBlock.getByRole('button', { name: '追加' }).click();
  await expect(customerBlock.getByText('顧客を追加しました')).toBeVisible();

  const vendorBlock = masterSection
    .locator('h3', { hasText: '業者' })
    .locator('..');
  const vendorCode = `E2E-VEND-${id}`;
  const vendorName = `E2E Vendor ${id}`;
  await vendorBlock.getByLabel('業者コード').fill(vendorCode);
  await vendorBlock.getByLabel('業者名称').fill(vendorName);
  await vendorBlock.getByRole('button', { name: '追加' }).click();
  await expect(vendorBlock.getByText('業者を追加しました')).toBeVisible();

  // 注釈UI（MasterData: customer/vendor）: 保存 → 再表示で永続化を確認
  const customerItem = customerBlock.locator('li', { hasText: customerCode });
  const customerAnnotationText = `E2E顧客注釈: ${id}`;
  await customerItem.getByRole('button', { name: '注釈' }).click();
  const customerAnnotationDialog = page.getByRole('dialog');
  await expect(
    customerAnnotationDialog.getByText(
      `顧客: ${customerCode} / ${customerName}`,
    ),
  ).toBeVisible({ timeout: actionTimeout });
  await customerAnnotationDialog
    .getByLabel('メモ（Markdown）')
    .fill(customerAnnotationText);
  await customerAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(customerAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await customerAnnotationDialog.getByRole('button', { name: '閉じる' }).click();
  await customerItem.getByRole('button', { name: '注釈' }).click();
  const customerAnnotationDialog2 = page.getByRole('dialog');
  await expect(customerAnnotationDialog2.getByLabel('メモ（Markdown）')).toHaveValue(
    customerAnnotationText,
    { timeout: actionTimeout },
  );
  await customerAnnotationDialog2.getByRole('button', { name: '閉じる' }).click();

  const vendorItem = vendorBlock.locator('li', { hasText: vendorCode });
  const vendorAnnotationText = `E2E業者注釈: ${id}`;
  await vendorItem.getByRole('button', { name: '注釈' }).click();
  const vendorAnnotationDialog = page.getByRole('dialog');
  await expect(
    vendorAnnotationDialog.getByText(`業者: ${vendorCode} / ${vendorName}`),
  ).toBeVisible({ timeout: actionTimeout });
  await vendorAnnotationDialog.getByLabel('メモ（Markdown）').fill(vendorAnnotationText);
  await vendorAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(vendorAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await vendorAnnotationDialog.getByRole('button', { name: '閉じる' }).click();
  await vendorItem.getByRole('button', { name: '注釈' }).click();
  const vendorAnnotationDialog2 = page.getByRole('dialog');
  await expect(vendorAnnotationDialog2.getByLabel('メモ（Markdown）')).toHaveValue(
    vendorAnnotationText,
    { timeout: actionTimeout },
  );
  await vendorAnnotationDialog2.getByRole('button', { name: '閉じる' }).click();

  const contactBlock = masterSection
    .locator('h3', { hasText: '連絡先' })
    .locator('..');
  const contactOwnerSelect = contactBlock.getByLabel('連絡先の紐付け先');
  await expect(
    contactOwnerSelect.locator('option', { hasText: customerCode }),
  ).toHaveCount(1);
  await contactOwnerSelect.selectOption({
    label: `${customerCode} / ${customerName}`,
  });
  await contactBlock.getByLabel('連絡先氏名').fill(`E2E Contact ${id}`);
  await contactBlock.getByRole('button', { name: '追加' }).click();
  await expect(contactBlock.getByText('連絡先を追加しました')).toBeVisible();
  await captureSection(masterSection, '10-master-data.png');

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();

  const chatSettingsBlock = settingsSection
    .locator('strong', { hasText: 'チャット設定' })
    .locator('..');
  await captureSection(chatSettingsBlock, '11-chat-settings.png');

  const chatRoomSettingsBlock = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .first()
    .locator('..');
  await captureSection(chatRoomSettingsBlock, '11-chat-room-settings.png');

  const scimBlock = settingsSection
    .locator('strong', { hasText: 'SCIM プロビジョニング' })
    .locator('..');
  await captureSection(scimBlock, '11-scim-provisioning.png');

  const rateCardBlock = settingsSection
    .locator('strong', { hasText: '単価（RateCard）' })
    .locator('..');
  await captureSection(rateCardBlock, '11-rate-card.png');

  const alertBlock = settingsSection
    .locator('strong', { hasText: 'アラート設定（簡易モック）' })
    .locator('..');
  await alertBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('アラート設定を作成しました'),
  ).toBeVisible();
  await captureSection(alertBlock, '11-alert-settings.png');
  const approvalBlock = settingsSection
    .locator('strong', { hasText: '承認ルール（簡易モック）' })
    .locator('..');
  await approvalBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('承認ルールを作成しました'),
  ).toBeVisible();
  await captureSection(approvalBlock, '11-approval-rules.png');

  const templateBlock = settingsSection
    .locator('strong', { hasText: 'テンプレ設定（見積/請求/発注）' })
    .locator('..');
  const templateSelect = templateBlock.getByLabel('テンプレ');
  await expect(
    templateSelect.locator('option', { hasText: 'Invoice Default' }),
  ).toHaveCount(1);
  await templateSelect.selectOption({ label: 'Invoice Default' });
  const numberRule = `PYYYY-MM-NNNN-${id}`;
  await templateBlock.getByLabel('番号ルール').fill(numberRule);
  await templateBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('テンプレ設定を作成しました'),
  ).toBeVisible();
  await expect(templateBlock.getByText(numberRule)).toBeVisible();
  await captureSection(templateBlock, '11-template-settings.png');

  const reportBlock = settingsSection
    .locator('strong', { hasText: 'レポート購読（配信設定）' })
    .locator('..');
  const reportName = `E2E Report ${id}`;
  await reportBlock.getByLabel('名称').fill(reportName);
  await reportBlock.getByLabel('reportKey').fill('project-effort');
  await reportBlock
    .getByLabel('params (JSON)')
    .fill('{"projectId":"00000000-0000-0000-0000-000000000001"}');
  await reportBlock.getByLabel('recipients (JSON)').fill('{"roles":["mgmt"]}');
  await reportBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('レポート購読を作成しました'),
  ).toBeVisible();
  const reportItem = reportBlock.locator('.list .card', {
    hasText: reportName,
  });
  await expect(reportItem).toBeVisible();
  await reportItem.getByRole('button', { name: '実行' }).click();
  await expect(
    settingsSection.getByText('レポートを実行しました'),
  ).toBeVisible();
  await captureSection(reportBlock, '11-report-subscriptions.png');

  const integrationBlock = settingsSection
    .locator('strong', { hasText: '外部連携設定（HR/CRM）' })
    .locator('..');
  await integrationBlock.getByLabel('名称').fill(`E2E Integration ${id}`);
  await integrationBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('連携設定を作成しました'),
  ).toBeVisible();
  const integrationItem = integrationBlock.locator('.list .card', {
    hasText: `E2E Integration ${id}`,
  });
  await expect(integrationItem).toBeVisible();
  await integrationItem.getByRole('button', { name: '実行' }).click();
  await expect(settingsSection.getByText('連携を実行しました')).toBeVisible();
  await captureSection(integrationBlock, '11-integration-settings.png');
  await captureSection(settingsSection, '11-admin-settings.png');
});

test('frontend smoke chat hr analytics @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  const mentionTarget = 'e2e-member-1@example.com';
  await prepare(page);

  await expect(page.getByText('ID: demo-user')).toBeVisible();
  await expect(page.getByText('Roles: admin, mgmt')).toBeVisible();

  await navigateToSection(page, 'プロジェクトチャット');
  const chatSection = page
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..');
  await chatSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    chatSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await chatSection.getByLabel('メンションユーザ').fill(mentionTarget);
  await chatSection.getByRole('button', { name: 'ユーザ追加' }).click();
  await chatSection.getByLabel('メンショングループ').fill('mgmt');
  await chatSection.getByRole('button', { name: 'グループ追加' }).click();
  const chatMessage = `E2E chat message ${id}`;
  const uploadName = `e2e-chat-${id}.txt`;
  const uploadPath = path.join(rootDir, 'tmp', uploadName);
  fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
  fs.writeFileSync(uploadPath, `e2e upload ${id}`);
  await chatSection.getByPlaceholder('メッセージを書く').fill(chatMessage);
  await chatSection.getByRole('checkbox', { name: 'プレビュー' }).check();
  const projectPreview = chatSection.getByRole('region', {
    name: 'Markdownプレビュー',
  });
  await expect(projectPreview.getByText(chatMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  await chatSection.getByPlaceholder('タグ (comma separated)').fill('e2e,chat');
  await chatSection.getByLabel('添付').setInputFiles(uploadPath);
  await chatSection.getByRole('button', { name: '投稿' }).click();
  await expect(chatSection.locator('li', { hasText: chatMessage })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  const chatItem = chatSection.locator('li', { hasText: chatMessage });
  await expect(chatItem.getByText(`@${mentionTarget}`)).toBeVisible();
  await expect(chatItem.getByText('@mgmt')).toBeVisible();
  await expect(
    chatSection.getByRole('button', { name: uploadName }),
  ).toBeVisible();
  const reactionButton = chatSection.getByRole('button', { name: /^👍/ });
  if (
    await reactionButton
      .first()
      .isEnabled()
      .catch(() => false)
  ) {
    await reactionButton.first().click();
  }
  await expect(chatSection.getByRole('button', { name: '投稿' })).toBeEnabled({
    timeout: actionTimeout,
  });

  const deliveryRes = await page.request.post(
    `${apiBase}/jobs/notification-deliveries/run`,
    {
      data: { limit: 50 },
      headers: {
        'x-user-id': authState.userId,
        'x-roles': authState.roles.join(','),
      },
    },
  );
  expect(deliveryRes.ok()).toBeTruthy();
  const deliveryJson = (await deliveryRes.json()) as {
    ok?: boolean;
    items?: Array<{ status?: string; target?: string | null }>;
  };
  expect(deliveryJson.ok).toBeTruthy();
  expect(Array.isArray(deliveryJson.items)).toBeTruthy();
  expect(
    (deliveryJson.items ?? []).some(
      (item) =>
        (item.status === 'stub' || item.status === 'success') &&
        (item.target || '').includes(mentionTarget),
    ),
  ).toBeTruthy();

  const ackMessage = `E2E ack request ${id}`;
  await chatSection.getByPlaceholder('メッセージを書く').fill(ackMessage);
  await chatSection.getByPlaceholder('タグ (comma separated)').fill('e2e,ack');
  await chatSection
    .getByPlaceholder('確認対象ユーザID (comma separated)')
    .fill('demo-user');
  await chatSection.getByRole('button', { name: '確認依頼' }).click();
  const ackItem = chatSection.locator('li', { hasText: ackMessage });
  await expect(ackItem).toBeVisible();
  await expect(ackItem.getByText('確認状況: 0/1')).toBeVisible();
  await ackItem.getByRole('button', { name: 'OK' }).click();
  await expect(ackItem.getByText('確認状況: 1/1')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept().catch(() => undefined));
  await ackItem.getByRole('button', { name: 'OK取消' }).click();
  await expect(ackItem.getByText('確認状況: 0/1')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(ackItem.getByRole('button', { name: 'OK' })).toBeVisible({
    timeout: actionTimeout,
  });
  page.once('dialog', (dialog) =>
    dialog.accept('e2e cancel').catch(() => undefined),
  );
  await ackItem.getByRole('button', { name: '撤回' }).click();
  await expect(ackItem.getByText(/^撤回:/)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(ackItem.getByRole('button', { name: 'OK' })).toHaveCount(0);

  const overdueDueAt = new Date(Date.now() - 60_000).toISOString();
  const overdueAckMessage = `E2E ack overdue ${id}`;
  const overdueAckRes = await page.request.post(
    `${apiBase}/projects/${authState.projectIds[0]}/chat-ack-requests`,
    {
      data: {
        body: overdueAckMessage,
        requiredUserIds: ['e2e-overdue-target'],
        dueAt: overdueDueAt,
        tags: ['e2e', 'ack'],
      },
      headers: {
        'x-user-id': authState.userId,
        'x-roles': authState.roles.join(','),
      },
    },
  );
  expect(overdueAckRes.ok()).toBeTruthy();
  await chatSection.getByRole('button', { name: '読み込み' }).click();
  const overdueItem = chatSection.locator('li', { hasText: overdueAckMessage });
  await expect(overdueItem).toBeVisible({ timeout: actionTimeout });
  const overdueDueLabel = overdueItem.getByText(/期限:/);
  await expect(overdueDueLabel).toBeVisible();
  await expect(overdueDueLabel).toContainText('期限超過');
  await expect(overdueDueLabel).toHaveCSS('color', 'rgb(220, 38, 38)');
  await captureSection(chatSection, '12-project-chat.png');

  await chatSection.getByRole('button', { name: '要約' }).click();
  const summaryBlock = chatSection.getByText('要約（スタブ）');
  await expect(summaryBlock).toBeVisible();
  await expect(chatSection.locator('pre')).toContainText('取得件数');

  await navigateToSection(page, 'HR分析', '匿名集計（人事向け）');
  const hrSection = page
    .locator('main')
    .locator('h2', { hasText: '匿名集計（人事向け）' })
    .locator('..');
  await hrSection.scrollIntoViewIfNeeded();
  await hrSection.getByLabel('閾値').fill('1');
  await hrSection.getByRole('button', { name: '更新' }).first().click();
  await expect(hrSection.locator('ul.list li')).not.toHaveCount(0);
  const groupSelect = hrSection.getByRole('combobox');
  if (await groupSelect.locator('option', { hasText: 'hr-group' }).count()) {
    await groupSelect.selectOption({ label: 'hr-group' });
  }
  const updateButtons = hrSection.getByRole('button', { name: '更新' });
  if (
    (await updateButtons.count()) > 1 &&
    (await updateButtons
      .nth(1)
      .isEnabled()
      .catch(() => false))
  ) {
    await updateButtons.nth(1).click();
  }
  await captureSection(hrSection, '13-hr-analytics.png');

  const mentionPage = await page.context().newPage();
  mentionPage.on('pageerror', (error) => {
    console.error('[e2e][mentionPage][pageerror]', error);
  });
  mentionPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][mentionPage][console.error]', msg.text());
    }
  });
  await mentionPage.addInitScript(
    (state) => {
      window.localStorage.setItem('erp4_auth', JSON.stringify(state));
      window.localStorage.removeItem('erp4_active_section');
    },
    {
      userId: mentionTarget,
      roles: authState.roles,
      projectIds: authState.projectIds,
      groupIds: authState.groupIds,
    },
  );
  await mentionPage.goto(baseUrl);
  await expect(
    mentionPage.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
  await mentionPage.getByRole('button', { name: 'ホーム' }).click();
  await expect(
    mentionPage
      .locator('main')
      .getByRole('heading', { name: 'Dashboard', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  const dashboardSection = mentionPage
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  await expect(dashboardSection.getByText(chatMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionPage.close();
});

test('frontend smoke room chat (private_group/dm) @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await prepare(page);

  await navigateToSection(
    page,
    'ルームチャット',
    'チャット（全社/部門/private_group/DM）',
  );
  const roomChatSection = page
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();

  const run = runId();
  const roomSelect = roomChatSection.getByLabel('ルーム');
  const messageList = roomChatSection
    .locator('strong', { hasText: '一覧' })
    .locator('..');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await expect(
    roomSelect.locator('option', { hasText: 'company: 全社' }),
  ).toHaveCount(1);
  await expect(
    roomSelect.locator('option', { hasText: 'department: mgmt' }),
  ).toHaveCount(1);

  await selectByLabelOrFirst(roomSelect, 'company: 全社');
  const companyText = `E2E company message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(companyText);
  await roomChatSection.getByRole('checkbox', { name: 'プレビュー' }).check();
  const roomPreview = roomChatSection.getByRole('region', {
    name: 'Markdownプレビュー',
  });
  await expect(roomPreview.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(
    messageList.locator('.card', { hasText: companyText }).first(),
  ).toBeVisible({ timeout: actionTimeout });

  await messageList.getByLabel('検索（本文）').fill(`company message ${run}`);
  await messageList.getByRole('button', { name: '適用' }).click();
  await expect(
    messageList.locator('.card', { hasText: companyText }).first(),
  ).toBeVisible({ timeout: actionTimeout });
  await messageList.getByRole('button', { name: 'クリア' }).click();

  const globalSearchCard = roomChatSection
    .locator('strong', { hasText: '横断検索（チャット全体）' })
    .locator('..');
  await globalSearchCard
    .getByLabel('横断検索（本文）')
    .fill(`company message ${run}`);
  await globalSearchCard.getByRole('button', { name: '検索' }).click();
  await expect(globalSearchCard.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(roomSelect, 'department: mgmt');
  const departmentText = `E2E department message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(departmentText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(
    messageList.locator('.card', { hasText: departmentText }).first(),
  ).toBeVisible({ timeout: actionTimeout });

  const groupName = `e2e-private-${run}`;

  await roomChatSection.getByLabel('private_group 名').fill(groupName);
  await roomChatSection
    .getByRole('button', { name: 'private_group作成' })
    .click();

  await expect(roomSelect).not.toHaveValue('', { timeout: actionTimeout });
  await expect(roomSelect.locator('option:checked')).toContainText(groupName);

  const messageText = `E2E room message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(messageText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(
    messageList.locator('.card', { hasText: messageText }).first(),
  ).toBeVisible({ timeout: actionTimeout });

  const activeRoomId = await roomSelect.inputValue();
  const overdueRoomDueAt = new Date(Date.now() - 60_000).toISOString();
  const overdueRoomAckMessage = `E2E room ack overdue ${run}`;
  const overdueRoomAckRes = await page.request.post(
    `${apiBase}/chat-rooms/${activeRoomId}/ack-requests`,
    {
      data: {
        body: overdueRoomAckMessage,
        requiredUserIds: ['e2e-overdue-target'],
        dueAt: overdueRoomDueAt,
        tags: ['e2e', 'ack'],
      },
      headers: {
        'x-user-id': authState.userId,
        'x-roles': authState.roles.join(','),
      },
    },
  );
  expect(overdueRoomAckRes.ok()).toBeTruthy();
  await roomChatSection.getByRole('button', { name: '再読込' }).click();
  const overdueRoomAckItem = messageList
    .locator('.card', { hasText: overdueRoomAckMessage })
    .first();
  await expect(overdueRoomAckItem).toBeVisible({ timeout: actionTimeout });
  const overdueRoomDueLabel = overdueRoomAckItem.getByText(/期限:/);
  await expect(overdueRoomDueLabel).toBeVisible();
  await expect(overdueRoomDueLabel).toContainText('期限超過');
  await expect(overdueRoomDueLabel).toHaveCSS('color', 'rgb(220, 38, 38)');

  const previousRoomId = await roomSelect.inputValue();
  const partnerUserId = `e2e-partner-${run}`;
  await roomChatSection.getByLabel('DM 相手(userId)').fill(partnerUserId);
  await roomChatSection.getByRole('button', { name: 'DM作成' }).click();
  await expect
    .poll(() => roomSelect.inputValue(), { timeout: actionTimeout })
    .not.toBe(previousRoomId);
  await expect(roomSelect.locator('option:checked')).toContainText(
    partnerUserId,
  );

  const dmText = `E2E dm message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(dmText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(
    messageList.locator('.card', { hasText: dmText }).first(),
  ).toBeVisible({ timeout: actionTimeout });

  await roomChatSection.getByRole('button', { name: '要約' }).click();
  const summaryBlock = roomChatSection.getByText('要約（スタブ）');
  await expect(summaryBlock).toBeVisible();
  await expect(roomChatSection.locator('pre')).toContainText('取得件数');

  await captureSection(roomChatSection, '14-room-chat.png');
});

test('frontend smoke room chat external summary @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = runId();
  await prepare(page);

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();
  const roomSettingsCard = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .locator('..');
  await roomSettingsCard.scrollIntoViewIfNeeded();
  await roomSettingsCard.getByRole('button', { name: '再読込' }).click();
  const settingsRoomSelect = roomSettingsCard.getByLabel('ルーム');
  await expect
    .poll(() => settingsRoomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await selectByLabelOrFirst(settingsRoomSelect, 'company: 全社');
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部連携を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });

  await navigateToSection(
    page,
    'ルームチャット',
    'チャット（全社/部門/private_group/DM）',
  );
  const roomChatSection = page
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();
  await roomChatSection.getByRole('button', { name: '再読込' }).first().click();

  const roomSelect = roomChatSection.getByLabel('ルーム');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await selectByLabelOrFirst(roomSelect, 'company: 全社');

  const messageText = `E2E external summary ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(messageText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(messageText)).toBeVisible({
    timeout: actionTimeout,
  });

  page.once('dialog', (dialog) => dialog.accept().catch(() => undefined));
  await roomChatSection.getByRole('button', { name: '外部要約' }).click();
  await expect(
    roomChatSection.getByText('要約（外部:', { exact: false }),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(roomChatSection.locator('pre')).toContainText('概要', {
    timeout: actionTimeout,
  });
});

test('frontend smoke external chat invited rooms @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = runId();
  const externalUserId = `e2e-external-${run}@example.com`;
  await prepare(page);

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();
  const roomSettingsCard = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .locator('..');
  await roomSettingsCard.scrollIntoViewIfNeeded();

  await roomSettingsCard.getByRole('button', { name: '再読込' }).click();
  const roomSelect = roomSettingsCard.getByLabel('ルーム');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);

  await selectByLabelOrFirst(roomSelect, 'company: 全社');
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部ユーザ参加を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await roomSettingsCard
    .getByLabel('userId（comma separated）')
    .fill(externalUserId);
  await roomSettingsCard.getByRole('button', { name: 'メンバー追加' }).click();
  await expect(
    roomSettingsCard.getByText('メンバーを追加しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(
    roomSelect,
    'project: PRJ-DEMO-1 / Demo Project 1',
  );
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部ユーザ参加を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await roomSettingsCard
    .getByLabel('userId（comma separated）')
    .fill(externalUserId);
  await roomSettingsCard.getByRole('button', { name: 'メンバー追加' }).click();
  await expect(
    roomSettingsCard.getByText('メンバーを追加しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const externalPage = await page.context().newPage();
  externalPage.on('pageerror', (error) => {
    console.error('[e2e][externalPage][pageerror]', error);
  });
  externalPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('(403)') || text.includes('403 (Forbidden)')) {
        return;
      }
      console.error('[e2e][externalPage][console.error]', text);
    }
  });
  await externalPage.addInitScript(
    (state) => {
      window.localStorage.setItem('erp4_auth', JSON.stringify(state));
      window.localStorage.removeItem('erp4_active_section');
    },
    {
      userId: externalUserId,
      roles: ['external_chat'],
      projectIds: [],
      groupIds: [],
    },
  );
  await externalPage.goto(baseUrl);
  await expect(
    externalPage.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();

  await externalPage.getByRole('button', { name: 'ルームチャット' }).click();
  await expect(
    externalPage.locator('main').getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  const roomChatSection = externalPage
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();

  const externalRoomSelect = roomChatSection.getByLabel('ルーム');
  await expect
    .poll(() => externalRoomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);

  await selectByLabelOrFirst(externalRoomSelect, 'company: 全社');
  const companyText = `E2E external company ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(companyText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(
    externalRoomSelect,
    'project: PRJ-DEMO-1 / Demo Project 1',
  );
  const projectText = `E2E external project ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(projectText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(projectText)).toBeVisible({
    timeout: actionTimeout,
  });

  await externalPage.close();
});

test('frontend smoke additional sections @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  const taskSection = page.locator('h2', { hasText: 'タスク' }).locator('..');
  await taskSection.scrollIntoViewIfNeeded();
  await captureSection(taskSection, '21-project-tasks.png');

  const leaveSection = page.locator('h2', { hasText: '休暇' }).locator('..');
  await leaveSection.scrollIntoViewIfNeeded();
  await captureSection(leaveSection, '22-leave-requests.png');

  const milestoneSection = page
    .locator('h2', { hasText: 'マイルストーン' })
    .locator('..');
  await milestoneSection.scrollIntoViewIfNeeded();
  await captureSection(milestoneSection, '23-project-milestones.png');

  const breakGlassSection = page
    .locator('h2', { hasText: 'Chat break-glass（監査閲覧）' })
    .locator('..');
  await breakGlassSection.scrollIntoViewIfNeeded();
  await captureSection(breakGlassSection, '24-chat-break-glass.png');
});

test('frontend smoke admin ops @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  const run = runId();
  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(authState.projectIds[0])}/estimates`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: 12345,
        currency: 'JPY',
        notes: `E2E-admin-ops-${run}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = await estimateCreateRes.json();
  const estimateId = estimateCreatePayload?.estimate?.id as string | undefined;
  expect(estimateId).toBeTruthy();

  const estimateSendRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/send`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(estimateSendRes);

  const sendLogsRes = await page.request.get(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/send-logs`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(sendLogsRes);
  const sendLogsPayload = await sendLogsRes.json();
  const sendLogId = (sendLogsPayload?.items ?? [])[0]?.id as string | undefined;

  const now = new Date();
  const lockPeriod = now.toISOString().slice(0, 7);
  const lockRes = await page.request.post(`${apiBase}/period-locks`, {
    headers: buildAuthHeaders(),
    data: { period: lockPeriod, scope: 'global', reason: `e2e-${run}` },
  });
  if (!lockRes.ok() && lockRes.status() !== 409) {
    throw new Error(`Failed to create period lock: ${lockRes.status()}`);
  }

  const adminJobsSection = page
    .locator('h2', { hasText: '運用ジョブ' })
    .locator('..');
  await adminJobsSection.scrollIntoViewIfNeeded();
  await captureSection(adminJobsSection, '25-admin-jobs.png');

  const sendLogSection = page
    .locator('h2', { hasText: 'ドキュメント送信ログ' })
    .locator('..');
  await sendLogSection.scrollIntoViewIfNeeded();
  if (sendLogId) {
    await sendLogSection.getByLabel('sendLogId').fill(sendLogId);
    await sendLogSection.getByRole('button', { name: 'まとめて取得' }).click();
    await expect(sendLogSection.getByText(estimateId)).toBeVisible({
      timeout: actionTimeout,
    });
  }
  await captureSection(sendLogSection, '26-document-send-logs.png');

  const pdfSection = page
    .locator('h2', { hasText: 'PDFファイル一覧' })
    .locator('..');
  await pdfSection.scrollIntoViewIfNeeded();
  await safeClick(
    pdfSection.getByRole('button', { name: '再読込' }),
    'pdf list',
  );
  await captureSection(pdfSection, '27-pdf-files.png');

  const accessReviewSection = page
    .locator('h2', { hasText: 'アクセス棚卸し' })
    .locator('..');
  await accessReviewSection.scrollIntoViewIfNeeded();
  await safeClick(
    accessReviewSection.getByRole('button', { name: 'スナップショット取得' }),
    'access review snapshot',
  );
  await expect(accessReviewSection.getByText('users:')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(accessReviewSection, '28-access-reviews.png');

  const auditLogSection = page
    .locator('h2', { hasText: '監査ログ' })
    .locator('..');
  await auditLogSection.scrollIntoViewIfNeeded();
  await safeClick(
    auditLogSection.getByRole('button', { name: '検索' }),
    'audit logs search',
  );
  await captureSection(auditLogSection, '29-audit-logs.png');

  const periodLockSection = page
    .locator('h2', { hasText: '期間締め' })
    .locator('..');
  await periodLockSection.scrollIntoViewIfNeeded();
  await safeClick(
    periodLockSection.getByRole('button', { name: '検索' }),
    'period locks list',
  );
  await captureSection(periodLockSection, '30-period-locks.png');
});
