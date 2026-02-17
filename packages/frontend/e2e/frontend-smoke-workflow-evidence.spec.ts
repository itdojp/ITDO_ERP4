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

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

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
  // Use exact matching to avoid collisions like "承認" vs "承認依頼".
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function selectByLabelOrFirst(select: Locator, label?: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  if (label) {
    await expect
      .poll(() => select.locator('option', { hasText: label }).count(), {
        timeout: actionTimeout,
      })
      .toBeGreaterThan(0);
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

const buildAuthHeaders = (override?: Partial<typeof authState>) => {
  const resolved = { ...authState, ...(override ?? {}) };
  return {
    'x-user-id': resolved.userId,
    'x-roles': resolved.roles.join(','),
    'x-project-ids': (resolved.projectIds ?? []).join(','),
    'x-group-ids': (resolved.groupIds ?? []).join(','),
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('frontend smoke workflow evidence chat references @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
  const evidenceMessage = `E2E evidence chat ${id}`;
  const evidenceNote = `E2E evidence note ${id}`;
  const evidenceUrl = `https://example.com/evidence/${id}`;
  const digits = String(id).replace(/\D/g, '').slice(-4) || '1234';
  const expenseAmount = Number(digits) + 4000;
  const expenseAmountLabel = expenseAmount.toLocaleString();
  const expenseAmountPattern = new RegExp(
    `(${expenseAmountLabel.replace(/,/g, ',?')}|${expenseAmount})\\s+JPY`,
  );
  await prepare(page);

  const chatMessageRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages`,
    {
      headers: buildAuthHeaders(),
      data: {
        body: evidenceMessage,
        tags: ['e2e', 'evidence'],
      },
    },
  );
  await ensureOk(chatMessageRes);
  const chatMessage = (await chatMessageRes.json()) as { id?: string };
  const messageId = typeof chatMessage.id === 'string' ? chatMessage.id : '';
  expect(messageId).toBeTruthy();

  await navigateToSection(page, '経費精算', '経費入力');
  const expenseSection = page
    .locator('main')
    .locator('h2', { hasText: '経費入力' })
    .locator('..');
  await expenseSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    expenseSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await expenseSection
    .locator('input[type="number"]')
    .fill(String(expenseAmount));
  await expenseSection.getByRole('button', { name: '追加' }).click();
  await expect(expenseSection.getByText('経費を保存しました')).toBeVisible();

  const createdExpenseItem = expenseSection
    .locator('li', { hasText: expenseAmountPattern })
    .first();
  await expect(createdExpenseItem).toBeVisible({ timeout: actionTimeout });
  const expenseAnnotationButton = createdExpenseItem.getByRole('button', {
    name: /注釈（経費）:/,
  });
  await expenseAnnotationButton.click();

  const expenseAnnotationDrawer = page.getByRole('dialog', { name: /経費:/ });
  await expect(expenseAnnotationDrawer).toBeVisible({ timeout: actionTimeout });
  await expenseAnnotationDrawer
    .getByRole('button', { name: 'エビデンス追加' })
    .click();

  const evidencePickerDrawer = page.getByRole('dialog', {
    name: 'エビデンス追加（チャット発言）',
  });
  await expect(evidencePickerDrawer).toBeVisible({ timeout: actionTimeout });
  await evidencePickerDrawer.getByLabel('キーワード').fill(id);
  await evidencePickerDrawer.getByRole('button', { name: '検索' }).click();
  await expect(evidencePickerDrawer.getByText(evidenceMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  const evidenceCandidateCard = evidencePickerDrawer.locator('.itdo-card', {
    hasText: evidenceMessage,
  });
  await expect(evidenceCandidateCard).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await evidenceCandidateCard.getByRole('button', { name: '追加' }).click();
  await evidenceCandidateCard
    .getByRole('button', { name: 'メモへ挿入' })
    .click();
  await evidencePickerDrawer.getByRole('button', { name: '閉じる' }).click();
  await expect(evidencePickerDrawer).toBeHidden({ timeout: actionTimeout });

  await expect(
    expenseAnnotationDrawer.getByRole('link', { name: /Chat（/ }).first(),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    expenseAnnotationDrawer
      .locator('.badge', { hasText: 'chat_message' })
      .first(),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    expenseAnnotationDrawer.getByLabel('メモ（Markdown）'),
  ).toHaveValue(new RegExp(messageId), { timeout: actionTimeout });
  await expenseAnnotationDrawer
    .getByRole('button', { name: '参照状態を確認' })
    .click();
  await expect(expenseAnnotationDrawer.getByText('参照可能')).toBeVisible({
    timeout: actionTimeout,
  });
  await expenseAnnotationDrawer.getByRole('button', { name: '保存' }).click();
  await expect(expenseAnnotationDrawer.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await expenseAnnotationDrawer.getByRole('button', { name: '閉じる' }).click();
  await expect(expenseAnnotationDrawer).toBeHidden({ timeout: actionTimeout });

  const estimateCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      headers: buildAuthHeaders(),
      data: {
        totalAmount: 120000,
        currency: 'JPY',
        notes: `E2E workflow evidence estimate ${id}`,
      },
    },
  );
  await ensureOk(estimateCreateRes);
  const estimateCreatePayload = (await estimateCreateRes.json()) as {
    estimate?: { id?: string };
  };
  const estimateId = estimateCreatePayload.estimate?.id || '';
  expect(estimateId).toBeTruthy();

  const patchAnnotationRes = await page.request.patch(
    `${apiBase}/annotations/estimate/${encodeURIComponent(estimateId)}`,
    {
      headers: buildAuthHeaders(),
      data: {
        notes: evidenceNote,
        externalUrls: [evidenceUrl],
        internalRefs: [
          {
            kind: 'chat_message',
            id: messageId,
            label: `E2E evidence ${id}`,
          },
        ],
      },
    },
  );
  await ensureOk(patchAnnotationRes);

  const estimateSubmitRes = await page.request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    {
      headers: buildAuthHeaders(),
      data: { reasonText: 'e2e workflow evidence' },
    },
  );
  await ensureOk(estimateSubmitRes);

  await navigateToSection(page, '承認', '承認一覧');
  const approvalsSection = page
    .locator('main')
    .locator('h2', { hasText: '承認一覧' })
    .locator('..');
  await approvalsSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    approvalsSection.locator('select').first(),
    '見積',
  );
  await approvalsSection.getByRole('button', { name: '再読込' }).click();

  const evidenceApprovalItem = approvalsSection
    .locator('li', { hasText: estimateId })
    .first();
  await expect(evidenceApprovalItem).toBeVisible({ timeout: actionTimeout });
  await evidenceApprovalItem.getByRole('button', { name: '表示' }).click();
  await expect(evidenceApprovalItem.getByText('状態: 生成済み')).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    evidenceApprovalItem.getByText('外部URL: 1 件 / チャット参照: 1 件'),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    evidenceApprovalItem.getByText(`メモ: ${evidenceNote}`),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    evidenceApprovalItem.getByRole('link', { name: evidenceUrl }),
  ).toBeVisible({ timeout: actionTimeout });
  const previewButton = evidenceApprovalItem.getByRole('button', {
    name: 'プレビュー',
  });
  await previewButton.click();
  await expect(evidenceApprovalItem.getByText(evidenceMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(approvalsSection, '07-approvals-evidence.png');
});
