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
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  if (!captureEnabled) return;
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

async function prepare(page: Page) {
  ensureEvidenceDir();
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible();
}

async function selectByLabelOrFirst(select: Locator, label: string) {
  if (await select.locator('option', { hasText: label }).count()) {
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

test('frontend smoke core', async ({ page }) => {
  await prepare(page);

  const dashboardSection = page
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  await captureSection(dashboardSection, '01-core-dashboard.png');

  const dailySection = page
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await dailySection.scrollIntoViewIfNeeded();
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
  await captureSection(dailySection, '02-core-daily-report.png');

  const timeSection = page
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

  const expenseSection = page
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

  const invoiceSection = page
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    invoiceSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await invoiceSection.locator('input[type="number"]').fill('150000');
  await invoiceSection.getByRole('button', { name: '作成' }).click();
  await expect(invoiceSection.getByText('作成しました')).toBeVisible();
  await captureSection(invoiceSection, '05-core-invoices.png');
});

test('frontend smoke vendor approvals', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  const vendorSection = page
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await vendorSection.scrollIntoViewIfNeeded();

  const poBlock = vendorSection
    .locator('h3', { hasText: '発注書' })
    .locator('..');
  await poBlock.getByRole('button', { name: '再読込' }).click();
  await expect(poBlock.locator('ul.list li')).not.toHaveCount(0);
  const poSubmitButton = poBlock.getByRole('button', { name: '承認依頼' });
  if (
    (await poSubmitButton.count()) > 0 &&
    (await poSubmitButton.first().isEnabled().catch(() => false))
  ) {
    await poSubmitButton.first().click();
    await expect(poBlock.getByText('発注書を承認依頼しました')).toBeVisible();
  }

  const quoteBlock = vendorSection
    .locator('h3', { hasText: '仕入見積' })
    .locator('..');
  await quoteBlock.getByRole('button', { name: '再読込' }).click();
  await expect(quoteBlock.locator('ul.list li')).not.toHaveCount(0);

  const invoiceBlock = vendorSection
    .locator('h3', { hasText: '仕入請求' })
    .locator('..');
  await invoiceBlock.getByRole('button', { name: '再読込' }).click();
  await expect(invoiceBlock.locator('ul.list li')).not.toHaveCount(0);

  await captureSection(vendorSection, '06-vendor-docs.png');

  const approvalsSection = page
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  await approvalsSection.getByRole('button', { name: '再読込' }).click();
  const approveButtons = approvalsSection.getByRole('button', { name: '承認' });
  if (await approveButtons.first().isEnabled().catch(() => false)) {
    await approveButtons.first().click();
    await expect(approvalsSection.getByText('承認しました')).toBeVisible();
  }
  await captureSection(approvalsSection, '07-approvals.png');
});

test('frontend smoke reports masters settings', async ({ page }) => {
  const id = runId();
  await prepare(page);

  const reportsSection = page
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

  const projectsSection = page.locator('h2', { hasText: '案件' }).locator('..');
  await projectsSection.scrollIntoViewIfNeeded();
  await projectsSection.getByLabel('案件コード').fill(`E2E-PRJ-${id}`);
  await projectsSection.getByLabel('案件名称').fill(`E2E Project ${id}`);
  await projectsSection
    .getByLabel('顧客選択')
    .selectOption({ label: 'CUST-DEMO-1 / Demo Customer 1' });
  await projectsSection.getByRole('button', { name: '追加' }).click();
  await expect(projectsSection.getByText('案件を追加しました')).toBeVisible();
  await captureSection(projectsSection, '09-projects.png');

  const masterSection = page
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

  const settingsSection = page
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();
  const alertBlock = settingsSection
    .locator('strong', { hasText: 'アラート設定（簡易モック）' })
    .locator('..');
  await alertBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('アラート設定を作成しました'),
  ).toBeVisible();
  await captureSection(settingsSection, '11-admin-settings.png');
});
