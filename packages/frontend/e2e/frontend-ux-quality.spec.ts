import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

async function prepare(page: Page) {
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
  ).toBeVisible();
}

async function expectIfVisible(locator: Locator) {
  const count = await locator.count();
  if (count === 0) {
    return;
  }
  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
}

test('ux-quality baseline (labels/errors/keyboard) @core', async ({ page }) => {
  await prepare(page);

  await navigateToSection(page, '日報 + ウェルビーイング');
  const dailySection = page
    .locator('main')
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await dailySection.scrollIntoViewIfNeeded();
  await expect(dailySection.getByLabel('日報本文')).toBeVisible();

  await navigateToSection(page, '工数入力');
  const timeSection = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  await expect(timeSection.getByLabel('案件選択')).toBeVisible();
  await expectIfVisible(timeSection.getByLabel('工数検索'));
  await expectIfVisible(timeSection.getByLabel('工数状態'));

  await navigateToSection(page, '請求');
  const invoiceSection = page
    .locator('main')
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await invoiceSection.scrollIntoViewIfNeeded();
  const projectSelect = invoiceSection.getByLabel('案件選択');
  const amountInput = invoiceSection.getByLabel('金額');
  await expect(projectSelect).toBeVisible();
  await expect(amountInput).toBeVisible();
  await expectIfVisible(invoiceSection.getByLabel('請求検索'));
  await expectIfVisible(invoiceSection.getByLabel('請求状態'));

  await projectSelect.focus();
  await page.keyboard.press('Tab');
  await expect(amountInput).toBeFocused();

  await amountInput.fill('0');
  await invoiceSection.getByRole('button', { name: /^作成$/ }).click();
  await expect(
    invoiceSection.getByText('金額は1円以上で入力してください'),
  ).toBeVisible();
});
