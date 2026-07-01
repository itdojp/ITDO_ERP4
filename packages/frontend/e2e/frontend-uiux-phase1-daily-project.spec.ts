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

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

test('phase 1 daily and project UX/UI summaries render @core', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await prepare(page);

  const cases = [
    {
      label: '日報 + ウェルビーイング',
      heading: '日報 + ウェルビーイング',
      summaryLabel: '日報とウェルビーイングの状態サマリー',
      screenshot: '01-uiux-daily-report.png',
    },
    {
      label: '工数入力',
      heading: '工数入力',
      summaryLabel: '工数入力の状態サマリー',
      screenshot: '02-uiux-time-entries.png',
    },
    {
      label: '案件',
      heading: '案件',
      summaryLabel: '案件管理の状態サマリー',
      screenshot: '03-uiux-projects.png',
    },
    {
      label: 'タスク',
      heading: 'タスク',
      summaryLabel: 'タスク管理の状態サマリー',
      screenshot: '04-uiux-project-tasks.png',
    },
    {
      label: 'マイルストーン',
      heading: 'マイルストーン',
      summaryLabel: 'マイルストーン管理の状態サマリー',
      screenshot: '05-uiux-project-milestones.png',
    },
  ];

  for (const item of cases) {
    await navigateToSection(page, item.label, item.heading);
    const section = page
      .locator('main')
      .locator('h2', { hasText: item.heading })
      .locator('..');
    await expect(
      section.locator(`[aria-label="${item.summaryLabel}"]`),
    ).toBeVisible({ timeout: actionTimeout });
    await captureSection(section, item.screenshot);
  }
});
