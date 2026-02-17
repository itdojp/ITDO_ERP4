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
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

const pad2 = (value: number) => String(value).padStart(2, '0');
const toDateTimeLocalInputValue = (date: Date) => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

test('frontend smoke additional sections @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  await navigateToSection(page, 'タスク');
  const taskSection = page
    .locator('main')
    .locator('h2', { hasText: 'タスク' })
    .locator('..');
  await taskSection.scrollIntoViewIfNeeded();
  await captureSection(taskSection, '21-project-tasks.png');

  await navigateToSection(page, '休暇申請', '休暇');
  const leaveSection = page
    .locator('main')
    .locator('h2', { hasText: '休暇' })
    .locator('..');
  await leaveSection.scrollIntoViewIfNeeded();
  await captureSection(leaveSection, '22-leave-requests.png');

  await navigateToSection(page, 'マイルストーン');
  const milestoneSection = page
    .locator('main')
    .locator('h2', { hasText: 'マイルストーン' })
    .locator('..');
  await milestoneSection.scrollIntoViewIfNeeded();
  await captureSection(milestoneSection, '23-project-milestones.png');

  await navigateToSection(page, '監査閲覧', 'Chat break-glass（監査閲覧）');
  const breakGlassSection = page
    .locator('main')
    .locator('h2', { hasText: 'Chat break-glass（監査閲覧）' })
    .locator('..');
  await breakGlassSection.scrollIntoViewIfNeeded();
  await captureSection(breakGlassSection, '24-chat-break-glass.png');

  // DateTimeRangePicker regression: break-glass form is available for mgmt without admin role.
  const breakGlassMgmtPage = await page.context().newPage();
  breakGlassMgmtPage.on('pageerror', (error) => {
    console.error('[e2e][breakGlassMgmtPage][pageerror]', error);
  });
  breakGlassMgmtPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][breakGlassMgmtPage][console.error]', msg.text());
    }
  });
  await breakGlassMgmtPage.addInitScript(
    (state) => {
      window.localStorage.setItem('erp4_auth', JSON.stringify(state));
      window.localStorage.removeItem('erp4_active_section');
    },
    {
      ...authState,
      roles: ['mgmt'],
    },
  );
  await breakGlassMgmtPage.goto(baseUrl);
  await navigateToSection(
    breakGlassMgmtPage,
    '監査閲覧',
    'Chat break-glass（監査閲覧）',
  );
  const breakGlassMgmtSection = breakGlassMgmtPage
    .locator('main')
    .locator('h2', { hasText: 'Chat break-glass（監査閲覧）' })
    .locator('..');
  const breakGlassTo = new Date();
  const breakGlassFrom = new Date(breakGlassTo.getTime() - 2 * 60 * 60 * 1000);
  const breakGlassFromInput = toDateTimeLocalInputValue(breakGlassFrom);
  const breakGlassToInput = toDateTimeLocalInputValue(breakGlassTo);
  await breakGlassMgmtSection
    .getByLabel('targetFrom')
    .fill(breakGlassFromInput);
  await breakGlassMgmtSection.getByLabel('targetUntil').fill(breakGlassToInput);
  await expect(breakGlassMgmtSection.getByLabel('targetFrom')).toHaveValue(
    breakGlassFromInput,
  );
  await expect(breakGlassMgmtSection.getByLabel('targetUntil')).toHaveValue(
    breakGlassToInput,
  );
  await breakGlassMgmtPage.close();
});
