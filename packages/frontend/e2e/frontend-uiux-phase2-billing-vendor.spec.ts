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
  } catch {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
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
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

test('phase 2 billing and vendor document UX/UI summaries render @core', async ({
  page,
}) => {
  await prepare(page);

  await navigateToSection(page, '見積');
  const estimateSection = page
    .locator('main')
    .locator('h2', { hasText: '見積' })
    .locator('..');
  await expect(
    estimateSection.getByRole('region', { name: '見積判断サマリー' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    estimateSection.getByRole('heading', { name: '見積作成' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    estimateSection.getByRole('heading', { name: '見積一覧' }),
  ).toBeVisible({ timeout: actionTimeout });
  await captureSection(estimateSection, '01-uiux-estimates.png');

  await navigateToSection(page, '請求');
  const invoiceSection = page
    .locator('main')
    .locator('h2', { hasText: '請求' })
    .locator('..');
  await expect(
    invoiceSection.getByRole('region', { name: '請求判断サマリー' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    invoiceSection.getByRole('heading', { name: '請求作成' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    invoiceSection.getByRole('heading', { name: '請求一覧' }),
  ).toBeVisible({ timeout: actionTimeout });
  await captureSection(invoiceSection, '02-uiux-invoices.png');

  await navigateToSection(page, '仕入/発注');
  const vendorSection = page
    .locator('main')
    .locator('h2', { hasText: '仕入/発注' })
    .locator('..');
  await expect(
    vendorSection.getByRole('region', { name: '仕入/発注判断サマリー' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(vendorSection.getByRole('tab', { name: /発注書/ })).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(vendorSection, '03-uiux-vendor-documents-po.png');

  await vendorSection.getByRole('tab', { name: /仕入請求/ }).click();
  await expect(
    vendorSection.getByRole('heading', {
      name: '仕入請求',
      level: 3,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  await captureSection(vendorSection, '04-uiux-vendor-documents-invoices.png');
});
