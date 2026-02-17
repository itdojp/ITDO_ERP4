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
  } catch (err) {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // ignore capture failures to avoid blocking the test flow
    }
  }
}

async function safeClick(locator: Locator, label: string) {
  try {
    await locator.click({ timeout: actionTimeout });
    return true;
  } catch (err) {
    console.warn(`[e2e] click skipped: ${label}`);
    return false;
  }
}

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const effectiveState = { ...authState, ...(override ?? {}) };
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
  }, effectiveState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

// Use exact matching to avoid collisions like '承認' vs '承認依頼'
async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const shiftDateKey = (dateKey: string, deltaDays: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
};

const buildAuthHeaders = (override?: Partial<typeof authState>) => {
  const effectiveState = { ...authState, ...(override ?? {}) };
  return {
    'x-user-id': effectiveState.userId,
    'x-roles': effectiveState.roles.join(','),
    'x-project-ids': (effectiveState.projectIds ?? []).join(','),
    'x-group-ids': (effectiveState.groupIds ?? []).join(','),
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('frontend smoke admin ops @extended', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  const run = runId();
  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(authState.projectIds[0])}/estimates`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: 12345,
        currency: 'JPY',
        notes: `E2E-admin-ops-${run}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = await estimateCreateRes.json();
  const estimateId = estimateCreatePayload?.estimate?.id as string | undefined;
  expect(estimateId).toBeTruthy();

  const estimateSendRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/send`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(estimateSendRes);

  const sendLogsRes = await page.request.get(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/send-logs`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(sendLogsRes);
  const sendLogsPayload = await sendLogsRes.json();
  const sendLogId = (sendLogsPayload?.items ?? [])[0]?.id as string | undefined;

  const now = new Date();
  const lockPeriod = now.toISOString().slice(0, 7);
  const lockRes = await page.request.post(`${apiBase}/period-locks`, {
    headers: buildAuthHeaders(),
    data: { period: lockPeriod, scope: 'global', reason: `e2e-${run}` },
  });
  if (!lockRes.ok() && lockRes.status() !== 409) {
    throw new Error(`Failed to create period lock: ${lockRes.status()}`);
  }

  await navigateToSection(page, 'ジョブ管理', '運用ジョブ');
  const adminJobsSection = page
    .locator('main')
    .locator('h2', { hasText: '運用ジョブ' })
    .locator('..');
  await adminJobsSection.scrollIntoViewIfNeeded();
  await captureSection(adminJobsSection, '25-admin-jobs.png');

  await navigateToSection(page, '送信ログ', 'ドキュメント送信ログ');
  const sendLogSection = page
    .locator('main')
    .locator('h2', { hasText: 'ドキュメント送信ログ' })
    .locator('..');
  await sendLogSection.scrollIntoViewIfNeeded();
  if (sendLogId) {
    await sendLogSection.getByLabel('sendLogId').fill(sendLogId);
    await sendLogSection.getByRole('button', { name: 'まとめて取得' }).click();
    await expect(sendLogSection.getByText(estimateId)).toBeVisible({
      timeout: actionTimeout,
    });
  }
  await captureSection(sendLogSection, '26-document-send-logs.png');

  await navigateToSection(page, 'PDF管理', 'PDFファイル一覧');
  const pdfSection = page
    .locator('main')
    .locator('h2', { hasText: 'PDFファイル一覧' })
    .locator('..');
  await pdfSection.scrollIntoViewIfNeeded();
  await safeClick(
    pdfSection.getByRole('button', { name: '再読込' }),
    'pdf list',
  );
  await captureSection(pdfSection, '27-pdf-files.png');

  await navigateToSection(page, 'アクセスレビュー', 'アクセス棚卸し');
  const accessReviewSection = page
    .locator('main')
    .getByRole('heading', { name: 'アクセス棚卸し', level: 2, exact: true })
    .locator('..');
  await accessReviewSection.scrollIntoViewIfNeeded();
  await safeClick(
    accessReviewSection.getByRole('button', { name: 'スナップショット取得' }),
    'access review snapshot',
  );
  await expect(accessReviewSection.getByText('users:')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(accessReviewSection, '28-access-reviews.png');

  await navigateToSection(page, '監査ログ');
  const auditLogSection = page
    .locator('main')
    .getByRole('heading', { name: '監査ログ', level: 2, exact: true })
    .locator('..');
  await auditLogSection.scrollIntoViewIfNeeded();
  const auditRangeTo = toDateInputValue(new Date());
  const auditRangeFrom = shiftDateKey(auditRangeTo, -7);
  await auditLogSection
    .getByLabel('from', { exact: true })
    .fill(auditRangeFrom);
  await auditLogSection.getByLabel('to', { exact: true }).fill(auditRangeTo);
  await safeClick(
    auditLogSection.getByRole('button', { name: '検索' }),
    'audit logs search',
  );
  await captureSection(auditLogSection, '29-audit-logs.png');

  await navigateToSection(page, '期間締め');
  const periodLockSection = page
    .locator('main')
    .locator('h2', { hasText: '期間締め' })
    .locator('..');
  await periodLockSection.scrollIntoViewIfNeeded();
  await safeClick(
    periodLockSection.getByRole('button', { name: '検索' }),
    'period locks list',
  );
  await captureSection(periodLockSection, '30-period-locks.png');
});
