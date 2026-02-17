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
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

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

type VendorApprovalFixture = {
  projectId: string;
  vendorId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
};

async function seedVendorApprovalFixture(
  page: Page,
): Promise<VendorApprovalFixture> {
  const suffix = runId();
  const projectId = authState.projectIds[0];
  const vendorRes = await page.request.post(`${apiBase}/vendors`, {
    headers: buildAuthHeaders(),
    data: {
      code: `E2E-VAP-${suffix}`,
      name: `E2E Vendor Approval ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(vendorRes);
  const vendorPayload = await vendorRes.json();
  const vendorId = String(vendorPayload?.id || '');
  expect(vendorId.length).toBeGreaterThan(0);

  const poRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/purchase-orders`,
    {
      headers: buildAuthHeaders(),
      data: {
        vendorId,
        totalAmount: 12000,
        currency: 'JPY',
      },
    },
  );
  await ensureOk(poRes);
  const poPayload = await poRes.json();
  const purchaseOrderId = String(poPayload?.id || '');
  const purchaseOrderNo = String(poPayload?.poNo || '');
  expect(purchaseOrderId.length).toBeGreaterThan(0);
  expect(purchaseOrderNo.length).toBeGreaterThan(0);

  const quoteRes = await page.request.post(`${apiBase}/vendor-quotes`, {
    headers: buildAuthHeaders(),
    data: {
      projectId,
      vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      quoteNo: `VQ-${suffix}`,
    },
  });
  await ensureOk(quoteRes);

  const invoiceRes = await page.request.post(`${apiBase}/vendor-invoices`, {
    headers: buildAuthHeaders(),
    data: {
      projectId,
      vendorId,
      totalAmount: 12000,
      currency: 'JPY',
      vendorInvoiceNo: `VI-${suffix}`,
    },
  });
  await ensureOk(invoiceRes);

  return {
    projectId,
    vendorId,
    purchaseOrderId,
    purchaseOrderNo,
  };
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
  await expenseSection.locator('input[type="number"]').fill('2000');
  await expenseSection.getByRole('button', { name: '追加' }).click();
  await expect(expenseSection.getByText('経費を保存しました')).toBeVisible();
  await captureSection(expenseSection, '04-core-expenses.png');

  // 経費注釈（Drawer + EntityReferencePicker）: 保存 → 再表示で永続化を確認
  const expenseAnnotationText = `E2E経費注釈: ${runId()}`;
  await expenseSection
    .getByRole('button', { name: /注釈（経費）: .* 2000 JPY/ })
    .first()
    .click();
  const expenseAnnotationDrawer = page.getByRole('dialog', { name: /経費:/ });
  await expect(expenseAnnotationDrawer).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer
    .getByLabel('メモ（Markdown）')
    .fill(expenseAnnotationText);
  const referencePickerInput = expenseAnnotationDrawer.getByLabel('候補検索');
  await referencePickerInput.fill('PRJ-DEMO-1');
  const firstReferenceCandidate = expenseAnnotationDrawer
    .getByRole('option')
    .first();
  await expect(firstReferenceCandidate).toBeVisible({ timeout: actionTimeout });
  await firstReferenceCandidate.click();
  await expect(
    expenseAnnotationDrawer.getByRole('list', { name: 'Selected references' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible({
    timeout: actionTimeout,
  });
  await expenseAnnotationDrawer.getByRole('button', { name: '閉じる' }).click();
  await expect(expenseAnnotationDrawer).toBeHidden({ timeout: actionTimeout });

  await expenseSection
    .getByRole('button', { name: /注釈（経費）: .* 2000 JPY/ })
    .first()
    .click();
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
  await invoiceSection.getByRole('button', { name: '詳細' }).last().click();
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

test('frontend smoke approvals ack guard requires override reason @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
  const ackTargetUserId = 'e2e-member-1@example.com';
  const scopedGroupId = `e2e-approval-guard-${id}`;
  const scopedAuth = {
    groupIds: [...authState.groupIds, scopedGroupId],
  };
  const scopedHeaders = buildAuthHeaders(scopedAuth);

  const memberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      headers: scopedHeaders,
      data: { userId: ackTargetUserId, role: 'member' },
    },
  );
  if (!memberRes.ok() && memberRes.status() !== 409) {
    throw new Error(
      `Failed to ensure project member: status=${memberRes.status()}`,
    );
  }

  const ackRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-ack-requests`,
    {
      headers: scopedHeaders,
      data: {
        body: `E2E approval guard ack ${id}`,
        requiredUserIds: [ackTargetUserId],
        tags: ['e2e', 'ack', 'approval-guard'],
      },
    },
  );
  await ensureOk(ackRes);
  const ackPayload = (await ackRes.json()) as {
    id?: string;
    messageId?: string;
  };
  const ackMessageId =
    typeof ackPayload.id === 'string'
      ? ackPayload.id
      : typeof ackPayload.messageId === 'string'
        ? ackPayload.messageId
        : '';
  expect(ackMessageId).toBeTruthy();

  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      headers: scopedHeaders,
      data: {
        totalAmount: 140000,
        currency: 'JPY',
        notes: `E2E approval guard estimate ${id}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = (await estimateCreateRes.json()) as {
    estimate?: { id?: string };
  };
  const estimateId = estimateCreatePayload.estimate?.id || '';
  expect(estimateId).toBeTruthy();

  const estimateSubmitRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    {
      headers: scopedHeaders,
      data: { reasonText: `e2e approval guard submit ${id}` },
    },
  );
  await ensureOk(estimateSubmitRes);

  const approvalListRes = await page.request.get(
    `${apiBase}/approval-instances?flowType=estimate&projectId=${encodeURIComponent(projectId)}`,
    { headers: scopedHeaders },
  );
  await ensureOk(approvalListRes);
  const approvalListPayload = (await approvalListRes.json()) as {
    items?: Array<{ id?: string; targetId?: string; status?: string }>;
  };
  const approvalInstance = (approvalListPayload.items ?? []).find(
    (item) =>
      item.targetId === estimateId &&
      item.status !== 'approved' &&
      item.status !== 'rejected',
  );
  const approvalInstanceId = approvalInstance?.id || '';
  expect(approvalInstanceId).toBeTruthy();

  const linkRes = await page.request.post(`${apiBase}/chat-ack-links`, {
    headers: scopedHeaders,
    data: {
      messageId: ackMessageId,
      targetTable: 'approval_instances',
      targetId: approvalInstanceId,
      flowType: 'estimate',
      actionKey: 'approve',
    },
  });
  await ensureOk(linkRes);

  const policyRes = await page.request.post(`${apiBase}/action-policies`, {
    headers: scopedHeaders,
    data: {
      flowType: 'estimate',
      actionKey: 'approve',
      priority: 999,
      isEnabled: true,
      subjects: { groupIds: [scopedGroupId] },
      stateConstraints: { statusIn: ['pending_qa', 'pending_exec'] },
      requireReason: false,
      guards: [{ type: 'chat_ack_completed' }],
    },
  });
  await ensureOk(policyRes);

  await prepare(page, scopedAuth);
  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    approvalsSection.locator('select').first(),
    '見積',
  );
  await approvalsSection.getByRole('button', { name: '再読込' }).click();

  const approvalItem = approvalsSection
    .locator('li', { hasText: estimateId })
    .first();
  await expect(approvalItem).toBeVisible({ timeout: actionTimeout });
  const reasonInput = approvalItem.getByPlaceholder('却下理由 (任意)');

  await reasonInput.fill('');
  await approvalItem.getByRole('button', { name: '承認' }).click();
  await expect(
    approvalsSection.getByText('理由入力が必要です（管理者上書き）'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const overrideReason = `e2e approval guard override ${id}`;
  await reasonInput.fill(overrideReason);
  await approvalItem.getByRole('button', { name: '承認' }).click();
  await expect(approvalsSection.getByText('承認しました')).toBeVisible({
    timeout: actionTimeout,
  });

  const overrideAuditRes = await page.request.get(
    `${apiBase}/audit-logs?action=action_policy_override&targetTable=approval_instances&targetId=${encodeURIComponent(approvalInstanceId)}&format=json&mask=0&limit=20`,
    { headers: scopedHeaders },
  );
  await ensureOk(overrideAuditRes);
  const overrideAuditPayload = (await overrideAuditRes.json()) as {
    items?: Array<{
      reasonText?: string;
      metadata?: { guardOverride?: boolean };
    }>;
  };
  expect(
    (overrideAuditPayload.items ?? []).some(
      (item) =>
        item.reasonText === overrideReason &&
        item.metadata?.guardOverride === true,
    ),
  ).toBeTruthy();
  await captureSection(
    approvalsSection,
    '07-approvals-ack-guard-reason-required.png',
  );
});

test('frontend smoke vendor approvals @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);
  const fixture = await seedVendorApprovalFixture(page);

  await navigateToSection(page, '仕入/発注');
  const vendorSection = page
    .locator('main')
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await vendorSection.scrollIntoViewIfNeeded();

  const poBlock = vendorSection
    .locator('h3', { hasText: '発注書' })
    .locator('..');
  await poBlock.getByRole('button', { name: /再取得|再読込/ }).click();
  const poRow = poBlock
    .locator('tbody tr', { hasText: fixture.purchaseOrderNo })
    .first();
  await expect(poRow).toBeVisible({ timeout: actionTimeout });
  const poSubmitButton = poRow.getByRole('button', { name: '承認依頼' });
  await expect(poSubmitButton).toBeVisible({ timeout: actionTimeout });
  await expect(poSubmitButton).toBeEnabled({ timeout: actionTimeout });
  await poSubmitButton.click();
  await expect(page.getByText('発注書を承認依頼しますか？')).toBeVisible({
    timeout: actionTimeout,
  });
  await page.getByRole('button', { name: '実行' }).click();
  await expect(page.getByText('発注書を承認依頼しますか？')).toBeHidden({
    timeout: actionTimeout,
  });

  await captureSection(vendorSection, '06-vendor-docs.png');

  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    approvalsSection.locator('select').first(),
    '発注',
  );
  await approvalsSection.getByRole('button', { name: '再読込' }).click();
  const approvalItem = approvalsSection
    .locator('li', { hasText: `purchase_orders:${fixture.purchaseOrderId}` })
    .first();
  await expect(approvalItem).toBeVisible({ timeout: actionTimeout });
  const approveButton = approvalItem.getByRole('button', { name: '承認' });
  await expect(approveButton).toBeVisible({ timeout: actionTimeout });
  await expect(approveButton).toBeEnabled({ timeout: actionTimeout });
  await approveButton.click();
  await expect(approvalsSection.getByText('承認しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(approvalsSection, '07-approvals.png');
});

test('frontend smoke chat hr analytics @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  const mentionTarget = 'e2e-member-1@example.com';
  await prepare(page);

  await expect(page.getByText('ID: demo-user')).toBeVisible();
  await expect(page.getByText('Roles: admin, mgmt')).toBeVisible();

  // Ensure the ack-required target user can access the project room.
  const projectMemberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(authState.projectIds[0])}/members`,
    {
      headers: buildAuthHeaders(),
      data: { userId: mentionTarget, role: 'member' },
    },
  );
  await ensureOk(projectMemberRes);

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
  const mentionComposerInput = chatSection.getByPlaceholder(
    'メンション対象を検索（ユーザ/グループ）',
  );
  await mentionComposerInput.fill('e2e-member-1');
  const mentionComposerOption = chatSection
    .getByRole('option', { name: /e2e-member-1@example\.com/i })
    .first();
  await expect(mentionComposerOption).toBeVisible({ timeout: actionTimeout });
  await mentionComposerOption.click();
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
  const addFilesButton = chatSection
    .getByRole('button', {
      name: /ファイルを選択|Add files/,
    })
    .first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    addFilesButton.click(),
  ]);
  await fileChooser.setFiles(uploadPath);
  await chatSection.getByRole('button', { name: '投稿' }).click();
  await expect(chatSection.locator('li', { hasText: chatMessage })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  const chatItem = chatSection.locator('li', { hasText: chatMessage });
  await expect(chatItem.getByText(`@${mentionTarget}`)).toBeVisible();
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
  await expect(chatSection.getByRole('button', { name: '投稿' })).toBeDisabled({
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
    .fill(mentionTarget);
  await chatSection.getByRole('button', { name: '確認依頼' }).click();
  const ackItem = chatSection.locator('li', { hasText: ackMessage });
  await expect(ackItem).toBeVisible();
  await expect(ackItem.getByText('確認状況: 0/1')).toBeVisible();

  const overdueDueAt = new Date(Date.now() - 60_000).toISOString();
  const overdueAckMessage = `E2E ack overdue ${id}`;
  const overdueAckRes = await page.request.post(
    `${apiBase}/projects/${authState.projectIds[0]}/chat-ack-requests`,
    {
      data: {
        body: overdueAckMessage,
        requiredUserIds: [mentionTarget],
        dueAt: overdueDueAt,
        tags: ['e2e', 'ack'],
      },
      headers: buildAuthHeaders(),
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
  const hrRangeTo = new Date();
  const hrRangeFrom = new Date(hrRangeTo.getTime() - 14 * 24 * 60 * 60 * 1000);
  await hrSection.getByLabel('開始日').fill(toDateInputValue(hrRangeFrom));
  await hrSection.getByLabel('終了日').fill(toDateInputValue(hrRangeTo));
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

  // Ack / revoke is performed by the required user (mentionTarget).
  await navigateToSection(mentionPage, 'プロジェクトチャット');
  const mentionChatSection = mentionPage
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..');
  await mentionChatSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    mentionChatSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await mentionChatSection.getByRole('button', { name: '読み込み' }).click();
  const mentionAckItem = mentionChatSection.locator('li', {
    hasText: ackMessage,
  });
  await expect(mentionAckItem).toBeVisible({ timeout: actionTimeout });
  await expect(mentionAckItem.getByText('確認状況: 0/1')).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionAckItem.getByRole('button', { name: 'OK' }).click();
  await expect(mentionAckItem.getByText('確認状況: 1/1')).toBeVisible({
    timeout: actionTimeout,
  });
  mentionPage.once('dialog', (dialog) =>
    dialog.accept().catch(() => undefined),
  );
  await mentionAckItem.getByRole('button', { name: 'OK取消' }).click();
  await expect(mentionAckItem.getByText('確認状況: 0/1')).toBeVisible({
    timeout: actionTimeout,
  });

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

  // Cancel the ack-request as the creator/admin (demo-user).
  await navigateToSection(page, 'プロジェクトチャット');
  const chatSectionAfter = page
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..');
  await chatSectionAfter.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    chatSectionAfter.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await chatSectionAfter.getByRole('button', { name: '読み込み' }).click();
  const ackItemAfter = chatSectionAfter.locator('li', { hasText: ackMessage });
  await expect(ackItemAfter).toBeVisible({ timeout: actionTimeout });
  page.once('dialog', (dialog) =>
    dialog.accept('e2e cancel').catch(() => undefined),
  );
  await ackItemAfter.getByRole('button', { name: '撤回' }).click();
  await expect(ackItemAfter.getByText(/^撤回:/)).toBeVisible({
    timeout: actionTimeout,
  });
});
