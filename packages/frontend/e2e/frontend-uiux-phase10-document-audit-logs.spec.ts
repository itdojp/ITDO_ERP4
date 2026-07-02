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
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
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

const buildAuthHeaders = () => ({
  'x-user-id': authState.userId,
  'x-roles': authState.roles.join(','),
  'x-project-ids': authState.projectIds.join(','),
  'x-group-ids': authState.groupIds.join(','),
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function createDocumentSendLog(page: Page) {
  const run =
    process.env.E2E_RUN_ID ||
    `${Date.now().toString().slice(-6)}-${randomUUID()}`;
  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(authState.projectIds[0])}/estimates`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: 12345,
        currency: 'JPY',
        notes: `E2E-uiux-phase10-${run}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = await estimateCreateRes.json();
  const estimateId = estimateCreatePayload?.estimate?.id as string | undefined;
  expect(estimateId).toBeTruthy();

  const estimateSendRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId!)}/send`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(estimateSendRes);

  const sendLogsRes = await page.request.get(
    `${apiBase}/estimates/${encodeURIComponent(estimateId!)}/send-logs`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(sendLogsRes);
  const sendLogsPayload = await sendLogsRes.json();
  const sendLogId = (sendLogsPayload?.items ?? [])[0]?.id as string | undefined;
  expect(sendLogId).toBeTruthy();

  return { estimateId: estimateId!, sendLogId: sendLogId! };
}

test('phase 10 document send and audit logs UX/UI summary renders @core', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepare(page);
  const { estimateId, sendLogId } = await createDocumentSendLog(page);

  await navigateToSection(page, '送信ログ', 'ドキュメント送信ログ');
  const sendLogSection = page
    .locator('main')
    .getByRole('heading', {
      name: 'ドキュメント送信ログ',
      level: 2,
      exact: true,
    })
    .locator('..');

  await expect(
    sendLogSection.locator('[aria-label="送信ログ監査サマリー"]'),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    sendLogSection.getByRole('heading', { name: '送信ログ検索と監査追跡' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    sendLogSection.getByRole('heading', { name: '送信ログ詳細' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    sendLogSection.getByRole('heading', { name: '配信イベント履歴' }),
  ).toBeVisible({ timeout: actionTimeout });

  await sendLogSection.getByLabel('sendLogId').fill(sendLogId);
  await sendLogSection.getByRole('button', { name: 'まとめて取得' }).click();
  await expect(
    sendLogSection
      .getByRole('gridcell')
      .filter({ hasText: estimateId })
      .first(),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(sendLogSection.getByText('取得済み').first()).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(sendLogSection.getByText('利用可')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(sendLogSection, '01-uiux-document-send-logs.png');

  await sendLogSection
    .getByLabel('Filters')
    .getByRole('button', { name: '監査ログで開く' })
    .click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '監査ログ', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  const auditLogSection = page
    .locator('main')
    .getByRole('heading', { name: '監査ログ', level: 2, exact: true })
    .locator('..');

  await expect(
    auditLogSection.locator('[aria-label="監査ログサマリー"]'),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    auditLogSection.getByRole('heading', { name: '監査ログ検索と証跡確認' }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(auditLogSection.getByLabel('sendLogId')).toHaveValue(sendLogId, {
    timeout: actionTimeout,
  });
  await expect(auditLogSection.getByText('取得済み')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    auditLogSection
      .getByRole('gridcell')
      .filter({ hasText: sendLogId })
      .first(),
  ).toBeVisible({ timeout: actionTimeout });
  await captureSection(auditLogSection, '02-uiux-audit-logs.png');
});
