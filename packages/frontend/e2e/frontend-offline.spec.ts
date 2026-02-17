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
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible();
}

test('frontend offline queue @extended', async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page);

  await page
    .getByRole('button', { name: '日報 + ウェルビーイング', exact: true })
    .click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', {
        name: '日報 + ウェルビーイング',
        level: 2,
        exact: true,
      }),
  ).toBeVisible();

  await context.setOffline(true);

  const dailySection = page
    .locator('main')
    .locator('h2', { hasText: '日報 + ウェルビーイング' })
    .locator('..');
  await dailySection.scrollIntoViewIfNeeded();
  await dailySection.getByRole('button', { name: 'Good', exact: true }).click();
  await dailySection.getByRole('button', { name: '送信' }).click();
  await expect(
    dailySection.getByText('オフラインのため送信待ちに保存しました'),
  ).toBeVisible();
  await captureSection(dailySection, '14-offline-daily-queue.png');

  const currentSection = page.locator('.card', {
    has: page.locator('strong', { hasText: '現在のユーザー' }),
  });
  await currentSection.scrollIntoViewIfNeeded();
  const offlineQueueSection = currentSection
    .locator('strong', { hasText: 'オフライン送信キュー' })
    .locator('..');
  await offlineQueueSection.getByRole('button', { name: '再読込' }).click();

  const statusLine = offlineQueueSection.getByText(/件数:/);
  await expect
    .poll(
      async () => {
        const statusText = await statusLine.textContent();
        const match = statusText?.match(/件数:\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  await context.setOffline(false);
  await expect(
    offlineQueueSection.getByText('送信待ちを処理しました'),
  ).toBeVisible();
  await captureSection(offlineQueueSection, '15-offline-queue-retry.png');
});
