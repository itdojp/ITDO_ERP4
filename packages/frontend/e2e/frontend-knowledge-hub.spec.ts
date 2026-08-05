import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const actionTimeout = process.env.CI ? 30_000 : 12_000;

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: ['mgmt'],
};

const snapshotTitle = 'E2E Knowledge Hub 手動保存';
const snapshotText = 'Issue #2012 E2E sanitized manual snapshot.';

async function prepare(page: Page) {
  if (captureEnabled) fs.mkdirSync(evidenceDir, { recursive: true });
  page.on('pageerror', (error) => {
    console.error('[e2e][pageerror]', error);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[e2e][console.error]', message.text());
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

async function captureSection(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

test('Knowledge Hub manual capture, provenance, and authorized download @core @knowledge-hub', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await prepare(page);

  await page
    .getByRole('button', { name: 'Knowledge Hub', exact: true })
    .click();
  const hub = page.locator('main .knowledge-hub');
  await expect(
    hub.getByRole('heading', { name: 'Knowledge Hub', level: 2 }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(hub.getByLabel('保存先')).toHaveValue('new');
  await expect(hub.getByLabel('scope')).toHaveValue('personal');

  await hub.getByLabel('タイトル（任意）').fill(snapshotTitle);
  await hub.getByLabel('保存するテキスト').fill(snapshotText);
  await hub.getByRole('button', { name: 'Inboxへ保存' }).click();

  await expect(
    hub.getByText('スナップショット version 1 を保存しました。'),
  ).toBeVisible({ timeout: actionTimeout });
  const selectedItem = hub.locator('.knowledge-hub-selected-summary');
  await expect(selectedItem).toContainText(snapshotTitle);
  await expect(selectedItem).toContainText('personal');

  const version = hub.getByRole('article', { name: 'version 1' });
  await expect(version).toContainText('保存済み');
  await expect(version).toContainText('text');
  await expect(version).toContainText('text/plain');
  await expect(version.locator('.knowledge-hub-hash')).toHaveText(
    /^[a-f0-9]{64}$/,
  );

  const downloadPromise = page.waitForEvent('download');
  await version
    .getByRole('button', { name: '認可済みファイルをダウンロード' })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('manual-note.txt');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(fs.readFileSync(downloadPath!, 'utf8')).toBe(snapshotText);
  await expect(
    hub.getByText('version 1 をダウンロードしました。'),
  ).toBeVisible();

  await captureSection(hub, '01-knowledge-hub-manual-capture.png');
});
