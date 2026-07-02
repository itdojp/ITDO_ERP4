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
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['system_admin', 'admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt'],
  groupAccountIds: ['mgmt'],
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
  } catch {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // Evidence capture should not make the smoke test flaky.
    }
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

test('phase 12 dashboard UX/UI summary renders @core', async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);

  await page.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: 'Dashboard', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });

  const section = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');

  await expect(section.locator('[aria-label="ホームサマリー"]')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByText('自分の承認待ち / 全承認待ち')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByText('未読通知とミュート状態')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    section.getByRole('heading', { name: '主要業務へのショートカット' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(section.getByRole('button', { name: '日報入力' })).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByRole('button', { name: '承認一覧' })).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    section.getByRole('heading', { name: '承認と通知' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    section.getByRole('heading', { name: 'アラート確認' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    section.getByRole('heading', { name: 'インサイト確認' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(section.getByTestId('dashboard-alerts-badge')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByTestId('dashboard-alerts-list')).toBeVisible({
    timeout: actionTimeout,
  });

  await captureSection(section, '01-uiux-dashboard.png');
});
