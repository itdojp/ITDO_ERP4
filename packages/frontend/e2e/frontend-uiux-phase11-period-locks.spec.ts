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
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return process.env.CI ? 30_000 : 12_000;
})();

const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const authState = {
  userId: 'demo-user',
  roles: ['system_admin', 'admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
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

async function navigateToSection(page: Page, label: string, heading: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: heading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

const pad2 = (value: number) => String(value).padStart(2, '0');

const toPeriodValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

function shiftMonth(date: Date, deltaMonths: number) {
  const shifted = new Date(date);
  shifted.setMonth(shifted.getMonth() + deltaMonths);
  return shifted;
}

async function selectByValue(select: Locator, value: string) {
  await expect(select).toHaveCount(1, { timeout: actionTimeout });
  const hasValue = await select
    .locator('option')
    .evaluateAll(
      (options, target) => options.some((option) => option.value === target),
      value,
    );
  if (!hasValue) {
    throw new Error(`selectByValue: option with value "${value}" not found`);
  }
  await select.selectOption({ value });
}

test('phase 11 period lock UX/UI summary renders @core', async ({ page }) => {
  test.setTimeout(90_000);
  const run =
    process.env.E2E_RUN_ID ||
    `${Date.now().toString().slice(-6)}-${randomUUID()}`;
  const offset = 30 + ((Number(run.replace(/\D/g, '').slice(0, 2)) || 0) % 18);
  const lockPeriod = toPeriodValue(shiftMonth(new Date(), offset));
  const reason = `e2e-uiux-phase11-${run}`;

  await prepare(page);
  await navigateToSection(page, '期間締め', '期間締め');

  const section = page
    .locator('main')
    .getByRole('heading', { name: '期間締め', level: 2, exact: true })
    .locator('..');

  await expect(section.locator('[aria-label="期間締めサマリー"]')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByRole('heading', { name: '締め登録' })).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    section.getByRole('heading', { name: '締め検索と解除' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(section.getByRole('heading', { name: '締め一覧' })).toBeVisible({
    timeout: actionTimeout,
  });

  const projectCreateSelect = section
    .getByRole('combobox', { name: 'project' })
    .filter({ hasText: '案件を選択' });
  await section
    .getByLabel('period (YYYY-MM)', { exact: true })
    .fill(lockPeriod);
  await selectByValue(projectCreateSelect, defaultProjectId);
  await section.getByLabel('reason', { exact: true }).fill(reason);
  await section.getByRole('button', { name: '締め登録' }).click();

  await section.getByLabel('period', { exact: true }).fill(lockPeriod);
  await section.getByRole('button', { name: '検索' }).click();

  const createdRows = section.locator('tbody tr', { hasText: reason });
  await expect(createdRows).toHaveCount(1, { timeout: actionTimeout });
  await expect(section.getByText('取得済み')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(section.getByText('1件を取得')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(section, '01-uiux-period-locks.png');
});
