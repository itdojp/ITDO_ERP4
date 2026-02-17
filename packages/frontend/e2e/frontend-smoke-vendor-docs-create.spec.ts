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

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

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
    } catch (err) {
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
    .locator('tbody tr', { hasText: `${poAmount.toLocaleString()} JPY` })
    .first();
  await expect(createdPoItem).toBeVisible({ timeout: actionTimeout });
  const createdPoText = await createdPoItem.innerText();
  const poNo = createdPoText.match(/PO\d{4}-\d{2}-\d{4}/)?.[0];
  expect(poNo).toBeTruthy();
  const poNoValue = poNo as string;

  await vendorSection.getByRole('tab', { name: /仕入見積/ }).click();
  const quoteBlock = vendorSection
    .locator('h3', { hasText: '仕入見積' })
    .locator('..');
  const quoteProjectSelect = quoteBlock.locator('select').first();
  const quoteVendorSelect = quoteBlock.locator('select').nth(1);
  await selectByValue(quoteProjectSelect, vendorDocsProjectId);
  await selectByValue(quoteVendorSelect, vendorDocsVendorId);
  const quoteNo = `VQ-E2E-${id}`;
  await quoteBlock.getByPlaceholder('見積番号', { exact: true }).fill(quoteNo);
  await quoteBlock
    .locator('input[type="number"]')
    .first()
    .fill(String(quoteAmount));
  await quoteBlock.getByRole('button', { name: '登録' }).click();
  await expect(quoteBlock.getByText('仕入見積を登録しました')).toBeVisible();
  await expect(quoteBlock.getByText(quoteNo)).toBeVisible();

  await vendorSection.getByRole('tab', { name: /仕入請求/ }).click();
  const invoiceBlock = vendorSection
    .locator('h3', { hasText: '仕入請求' })
    .locator('..');
  const invoiceProjectSelect = invoiceBlock.locator('select').first();
  const invoiceVendorSelect = invoiceBlock.locator('select').nth(1);
  await selectByValue(invoiceProjectSelect, vendorDocsProjectId);
  await selectByValue(invoiceVendorSelect, vendorDocsVendorId);
  const vendorInvoiceNo = `VI-E2E-${id}`;
  await invoiceBlock
    .getByPlaceholder('請求番号', { exact: true })
    .fill(vendorInvoiceNo);
  await invoiceBlock
    .locator('input[type="number"]')
    .first()
    .fill(String(invoiceAmount));
  await invoiceBlock.getByRole('button', { name: '登録' }).click();
  await expect(invoiceBlock.getByText('仕入請求を登録しました')).toBeVisible();
  await expect(invoiceBlock.getByText(vendorInvoiceNo)).toBeVisible();

  const annotationText = `E2E注釈: ${id}`;
  const createdInvoiceItem = invoiceBlock
    .locator('tbody tr', {
      hasText: vendorInvoiceNo,
    })
    .first();
  await expect(createdInvoiceItem).toBeVisible({ timeout: actionTimeout });

  // (1) PO紐づけ → 一覧に PO番号表示
  await createdInvoiceItem.scrollIntoViewIfNeeded();
  await createdInvoiceItem.getByRole('button', { name: 'PO紐づけ' }).click();
  const poLinkDialog = page.getByRole('dialog');
  await expect(
    poLinkDialog.getByText('仕入請求: 関連発注書（PO）'),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  const poLinkSelect = poLinkDialog.locator('select').first();
  await selectByLabelOrFirst(poLinkSelect, poNoValue);
  await poLinkDialog.getByRole('button', { name: '更新' }).click();
  await expect(poLinkDialog).toBeHidden({ timeout: actionTimeout });
  await expect
    .poll(
      () =>
        createdInvoiceItem
          .innerText()
          .then((value) => value.includes(poNoValue)),
      { timeout: actionTimeout },
    )
    .toBe(true);

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
          .then((value) => value.includes(poNoValue)),
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
  await expect(
    allocationDialog.getByText('配賦明細を読み込み中...'),
  ).toHaveCount(0, { timeout: actionTimeout });
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
    .locator('input[type="number"]')
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
    annotationDialog.getByRole('heading', {
      name: `仕入請求: ${vendorInvoiceNo}`,
    }),
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
