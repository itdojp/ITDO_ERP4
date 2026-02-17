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
  // CI runners vary in performance; keep default timeout conservative.
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

test('frontend smoke current-user notification settings @extended', async ({
  page,
}) => {
  await prepare(page);

  const currentUserSection = page.locator('.card', {
    has: page.locator('strong', { hasText: '現在のユーザー' }),
  });
  await expect(currentUserSection.getByText('ID: demo-user')).toBeVisible({
    timeout: actionTimeout,
  });

  const notificationSettingsSection = currentUserSection
    .locator('strong', { hasText: '通知設定' })
    .locator('..');
  const emailModeSelect = notificationSettingsSection.getByLabel('メール通知');
  const digestIntervalInput =
    notificationSettingsSection.getByLabel('集約間隔（分）');
  const muteUntilInput = notificationSettingsSection.getByLabel('期限（任意）');
  const saveButton = notificationSettingsSection.getByRole('button', {
    name: '保存',
  });
  const reloadButton = notificationSettingsSection.getByRole('button', {
    name: '再読込',
  });

  const initialMode = await emailModeSelect.inputValue();
  const initialInterval = await digestIntervalInput.inputValue();

  await emailModeSelect.selectOption('digest');
  await expect(digestIntervalInput).toBeEnabled({ timeout: actionTimeout });
  await digestIntervalInput.fill('15');
  await notificationSettingsSection.getByRole('button', { name: '10分' }).click();
  expect(await muteUntilInput.inputValue()).not.toBe('');

  await saveButton.click();
  await expect(
    notificationSettingsSection.getByText('通知設定を保存しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await reloadButton.click();
  await expect(emailModeSelect).toHaveValue('digest', {
    timeout: actionTimeout,
  });
  await expect(digestIntervalInput).toHaveValue('15', {
    timeout: actionTimeout,
  });

  await emailModeSelect.selectOption('realtime');
  await expect(digestIntervalInput).toBeDisabled({ timeout: actionTimeout });
  await saveButton.click();
  await expect(
    notificationSettingsSection.getByText('通知設定を保存しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const restoreMode = initialMode === 'realtime' ? 'realtime' : 'digest';
  await emailModeSelect.selectOption(restoreMode);
  if (restoreMode === 'digest') {
    await expect(digestIntervalInput).toBeEnabled({ timeout: actionTimeout });
    await digestIntervalInput.fill(initialInterval || '10');
  }
  await currentUserSection
    .getByRole('button', { name: '解除', exact: true })
    .click();
  await saveButton.click();
  await expect(
    notificationSettingsSection.getByText('通知設定を保存しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await captureSection(
    currentUserSection,
    '00-current-user-notification-settings.png',
  );
});
