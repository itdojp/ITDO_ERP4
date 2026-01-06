import fs from 'fs';
import path from 'path';
import { expect, test, type Locator } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);

function ensureEvidenceDir() {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function captureSection(locator: Locator, filename: string) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

test('frontend smoke with evidence', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
  ensureEvidenceDir();
  const authState = {
    userId: 'demo-user',
    roles: ['admin', 'mgmt'],
    projectIds: ['00000000-0000-0000-0000-000000000001'],
    groupIds: ['hr-group'],
  };
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
  }, authState);

  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible();

  const dashboardSection = page.locator('h2', { hasText: 'Dashboard' }).locator('..');
  await captureSection(dashboardSection, '01-dashboard.png');

  const dailySection = page
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await dailySection.scrollIntoViewIfNeeded();
  await dailySection.getByRole('button', { name: 'Not Good' }).click();
  await dailySection.getByRole('button', { name: '仕事量が多い' }).click();
  await dailySection
    .getByPlaceholder('共有してもよければ、今日しんどかったことを書いてください（空欄可）')
    .fill('E2Eテスト: 相談したい状況');
  await dailySection
    .getByRole('checkbox', { name: '相談したい（人事/相談窓口へ）' })
    .check();
  await dailySection.getByRole('button', { name: '送信' }).click();
  await expect(dailySection.getByText('送信しました')).toBeVisible();
  await captureSection(dailySection, '02-daily-report.png');

  const timeSection = page.locator('h2', { hasText: '工数入力' }).locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  const timeProjectSelect = timeSection.getByLabel('案件選択');
  if ((await timeProjectSelect.locator('option', { hasText: 'PRJ-DEMO-1' }).count()) > 0) {
    await timeProjectSelect.selectOption({ label: 'PRJ-DEMO-1 / Demo Project 1' });
  } else {
    await timeProjectSelect.selectOption({ index: 1 });
  }
  await timeSection.locator('input[type="number"]').fill('120');
  await timeSection.getByRole('button', { name: '追加' }).click();
  await expect(timeSection.getByText('保存しました')).toBeVisible();
  await captureSection(timeSection, '03-time-entries.png');

  const expenseSection = page.locator('h2', { hasText: '経費入力' }).locator('..');
  await expenseSection.scrollIntoViewIfNeeded();
  const expenseProjectSelect = expenseSection.getByLabel('案件選択');
  if ((await expenseProjectSelect.locator('option', { hasText: 'PRJ-DEMO-1' }).count()) > 0) {
    await expenseProjectSelect.selectOption({ label: 'PRJ-DEMO-1 / Demo Project 1' });
  } else {
    await expenseProjectSelect.selectOption({ index: 1 });
  }
  await expenseSection.locator('input[type="number"]').fill('2000');
  await expenseSection.getByRole('button', { name: '追加' }).click();
  await expect(expenseSection.getByText('経費を保存しました')).toBeVisible();
  await captureSection(expenseSection, '04-expenses.png');

  const invoiceSection = page.locator('h2', { hasText: '請求' }).locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  const invoiceProjectSelect = invoiceSection.getByLabel('案件選択');
  if ((await invoiceProjectSelect.locator('option', { hasText: 'PRJ-DEMO-1' }).count()) > 0) {
    await invoiceProjectSelect.selectOption({ label: 'PRJ-DEMO-1 / Demo Project 1' });
  } else {
    await invoiceProjectSelect.selectOption({ index: 1 });
  }
  await invoiceSection.locator('input[type="number"]').fill('150000');
  await invoiceSection.getByRole('button', { name: '作成' }).click();
  await expect(invoiceSection.getByText('作成しました')).toBeVisible();
  await captureSection(invoiceSection, '05-invoices.png');
});
