import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
// If E2E_EVIDENCE_DIR is omitted, screenshots are written to a runtime
// date-stamped directory. PR evidence uses an explicit committed directory.
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

async function captureEvidence(page: Page, filename: string) {
  if (!captureEnabled) return;
  await page.screenshot({
    path: path.join(evidenceDir, filename),
    fullPage: true,
  });
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

async function expectMainSection(
  page: Page,
  options: { name: string; heading: string },
) {
  const main = page.getByRole('main', { name: options.name });
  await expect(main).toBeVisible();
  await expect(
    main.getByRole('heading', {
      name: options.heading,
      level: 2,
      exact: true,
    }),
  ).toBeVisible();
  return main;
}

test('a11y workflow landmarks, keyboard navigation, and aria relationships @core', async ({
  page,
}) => {
  await prepare(page);

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'メインコンテンツへ移動' }),
  ).toHaveAttribute('href', '#erp4-main-content');
  await expect(
    page.getByRole('navigation', { name: '主要メニュー' }),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '主要メニュー' });
  await expect(
    navigation.getByRole('button', { name: 'コマンドを開く (Ctrl/Cmd + K)' }),
  ).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  await expect(
    navigation.getByRole('button', { name: 'ホーム' }),
  ).toHaveAttribute('aria-current', 'page');

  const dailyButton = navigation.getByRole('button', {
    name: '日報 + ウェルビーイング',
  });
  await dailyButton.focus();
  await page.keyboard.press('Enter');
  const dailyMain = await expectMainSection(page, {
    name: '日次 / 日報 + ウェルビーイング',
    heading: '日報 + ウェルビーイング',
  });
  await expect(dailyMain).toBeFocused();
  await expect(dailyButton).toHaveAttribute('aria-current', 'page');
  await expect(
    dailyMain.getByRole('textbox', { name: '対象日' }),
  ).toBeVisible();
  await expect(dailyMain.getByLabel('日報本文')).toBeVisible();

  const projectsButton = navigation.getByRole('button', {
    name: '案件',
    exact: true,
  });
  await projectsButton.focus();
  await page.keyboard.press('Space');
  const projectsMain = await expectMainSection(page, {
    name: '案件 / 案件',
    heading: '案件',
  });
  await expect(projectsMain).toBeFocused();
  await expect(projectsButton).toHaveAttribute('aria-current', 'page');
  await expect(projectsMain.getByLabel('案件コード')).toBeVisible();
  await expect(projectsMain.getByLabel('案件名称')).toBeVisible();
  await expect(
    projectsMain.getByRole('region', { name: '案件管理の状態サマリー' }),
  ).toBeVisible();
  await expect(projectsMain.getByText('案件数')).toBeVisible();

  await navigation.getByRole('button', { name: '請求', exact: true }).click();
  const invoiceMain = await expectMainSection(page, {
    name: '請求・仕入 / 請求',
    heading: '請求',
  });
  await expect(invoiceMain).toBeFocused();
  await expect(
    invoiceMain.getByRole('region', { name: '請求判断サマリー' }),
  ).toBeVisible();
  await expect(invoiceMain.getByText('対象案件')).toBeVisible();
  await expect(
    invoiceMain.getByRole('region', { name: '請求作成' }),
  ).toHaveAccessibleDescription(/金額を直接指定/);
  await expect(invoiceMain.getByLabel('案件選択')).toBeVisible();
  await expect(invoiceMain.getByLabel('金額')).toBeVisible();

  await invoiceMain.getByLabel('金額').fill('0');
  await invoiceMain.getByRole('button', { name: /^作成$/ }).click();
  await expect(
    invoiceMain.getByRole('alert').filter({
      hasText: '金額は1円以上で入力してください',
    }),
  ).toBeVisible();
  await captureEvidence(page, '01-a11y-invoice-workflow.png');
});

test('command palette is keyboard reachable and escape dismisses it @core', async ({
  page,
}) => {
  await prepare(page);

  await page.bringToFront();
  await page.keyboard.press('Control+K');
  await expect(
    page.getByRole('dialog', { name: 'ERP4 コマンドパレット' }),
  ).toBeVisible();
  const commandSearch = page.getByRole('combobox', {
    name: 'コマンド検索',
  });
  await expect(commandSearch).toBeVisible();
  await page.bringToFront();
  await expect(commandSearch).toBeFocused();
  await expect(
    page.getByRole('listbox', { name: 'コマンド候補' }),
  ).toBeVisible();
  await captureEvidence(page, '02-a11y-command-palette.png');

  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'ERP4 コマンドパレット' }),
  ).toBeHidden();
});
