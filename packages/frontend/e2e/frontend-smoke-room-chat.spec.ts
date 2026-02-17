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
  } catch (err) {
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

test('frontend smoke room chat (private_group/dm) @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await prepare(page);

  await navigateToSection(
    page,
    'ルームチャット',
    'チャット（全社/部門/private_group/DM）',
  );
  const roomChatSection = page
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();

  const run = runId();
  const roomSelect = roomChatSection.getByLabel('ルーム');
  const messageList = roomChatSection
    .locator('strong', { hasText: '一覧' })
    .locator('..');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await expect(
    roomSelect.locator('option', { hasText: 'company: 全社' }),
  ).toHaveCount(1);
  await expect(
    roomSelect.locator('option', { hasText: 'department: mgmt' }),
  ).toHaveCount(1);

  await selectByLabelOrFirst(roomSelect, 'company: 全社');
  const companyRoomId = await roomSelect.inputValue();

  const companyText = `E2E company message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(companyText);
  await roomChatSection.getByRole('checkbox', { name: 'プレビュー' }).check();
  const roomPreview = roomChatSection.getByRole('region', {
    name: 'Markdownプレビュー',
  });
  await expect(roomPreview.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  const companyMessageCard = messageList.locator('.card', {
    hasText: companyText,
  });
  await expect(companyMessageCard).toHaveCount(1, { timeout: actionTimeout });
  await expect(companyMessageCard).toBeVisible({ timeout: actionTimeout });

  // Ack-required (overdue) on company room so that membership checks do not block.
  const overdueRoomDueAt = new Date(Date.now() - 60_000).toISOString();
  const overdueRoomAckMessage = `E2E room ack overdue ${run}`;
  const overdueRoomAckRes = await page.request.post(
    `${apiBase}/chat-rooms/${companyRoomId}/ack-requests`,
    {
      data: {
        body: overdueRoomAckMessage,
        requiredUserIds: ['e2e-member-1@example.com'],
        dueAt: overdueRoomDueAt,
        tags: ['e2e', 'ack'],
      },
      headers: buildAuthHeaders(),
    },
  );
  await ensureOk(overdueRoomAckRes);
  const postCard = roomChatSection
    .locator('strong', { hasText: '投稿' })
    .locator('..');
  await postCard.getByRole('button', { name: '再読込' }).click();
  const overdueRoomAckItem = messageList.locator('.card', {
    hasText: overdueRoomAckMessage,
  });
  await expect(overdueRoomAckItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(overdueRoomAckItem).toBeVisible({ timeout: actionTimeout });
  const overdueRoomDueLabel = overdueRoomAckItem.getByText(/期限:/);
  await expect(overdueRoomDueLabel).toBeVisible();
  await expect(overdueRoomDueLabel).toContainText('期限超過');
  await expect(overdueRoomDueLabel).toHaveCSS('color', 'rgb(220, 38, 38)');

  await messageList.getByLabel('検索（本文）').fill(`company message ${run}`);
  await messageList.getByRole('button', { name: '適用' }).click();
  await expect(companyMessageCard).toBeVisible({ timeout: actionTimeout });
  await messageList.getByRole('button', { name: 'クリア' }).click();

  const globalSearchCard = roomChatSection
    .locator('strong', { hasText: '横断検索（チャット全体）' })
    .locator('..');
  await globalSearchCard
    .getByLabel('横断検索（本文）')
    .fill(`company message ${run}`);
  await globalSearchCard.getByRole('button', { name: '検索' }).click();
  await expect(globalSearchCard.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(roomSelect, 'department: mgmt');
  const departmentText = `E2E department message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(departmentText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  const departmentMessageCard = messageList.locator('.card', {
    hasText: departmentText,
  });
  await expect(departmentMessageCard).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await expect(departmentMessageCard).toBeVisible({ timeout: actionTimeout });

  const groupName = `e2e-private-${run}`;

  await roomChatSection.getByLabel('private_group 名').fill(groupName);
  await roomChatSection
    .getByRole('button', { name: 'private_group作成' })
    .click();

  await expect(roomSelect).not.toHaveValue('', { timeout: actionTimeout });
  await expect(roomSelect.locator('option:checked')).toContainText(groupName);

  const messageText = `E2E room message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(messageText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  const privateGroupMessageCard = messageList.locator('.card', {
    hasText: messageText,
  });
  await expect(privateGroupMessageCard).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await expect(privateGroupMessageCard).toBeVisible({ timeout: actionTimeout });

  const previousRoomId = await roomSelect.inputValue();
  const partnerUserId = `e2e-partner-${run}`;
  await roomChatSection.getByLabel('DM 相手(userId)').fill(partnerUserId);
  await roomChatSection.getByRole('button', { name: 'DM作成' }).click();
  await expect
    .poll(() => roomSelect.inputValue(), { timeout: actionTimeout })
    .not.toBe(previousRoomId);
  await expect(roomSelect.locator('option:checked')).toContainText(
    partnerUserId,
  );

  const dmText = `E2E dm message ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(dmText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  const dmMessageCard = messageList.locator('.card', { hasText: dmText });
  await expect(dmMessageCard).toHaveCount(1, { timeout: actionTimeout });
  await expect(dmMessageCard).toBeVisible({ timeout: actionTimeout });

  await roomChatSection.getByRole('button', { name: '要約' }).click();
  const summaryBlock = roomChatSection.getByText('要約（スタブ）');
  await expect(summaryBlock).toBeVisible();
  await expect(roomChatSection.locator('pre')).toContainText('取得件数');

  await captureSection(roomChatSection, '14-room-chat.png');
});

test('frontend smoke room chat external summary @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = runId();
  await prepare(page);

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();
  const roomSettingsCard = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .locator('..');
  await roomSettingsCard.scrollIntoViewIfNeeded();
  await roomSettingsCard.getByRole('button', { name: '再読込' }).click();
  const settingsRoomSelect = roomSettingsCard.getByLabel('ルーム');
  await expect
    .poll(() => settingsRoomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await selectByLabelOrFirst(settingsRoomSelect, 'company: 全社');
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部連携を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });

  await navigateToSection(
    page,
    'ルームチャット',
    'チャット（全社/部門/private_group/DM）',
  );
  const roomChatSection = page
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();
  const roomReloadButton = roomChatSection.getByRole('button', {
    name: '再読込',
  });
  await expect(roomReloadButton).toHaveCount(1, { timeout: actionTimeout });
  await roomReloadButton.click();

  const roomSelect = roomChatSection.getByLabel('ルーム');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  await selectByLabelOrFirst(roomSelect, 'company: 全社');

  const messageText = `E2E external summary ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(messageText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(messageText)).toBeVisible({
    timeout: actionTimeout,
  });

  page.once('dialog', (dialog) => dialog.accept().catch(() => undefined));
  await roomChatSection.getByRole('button', { name: '外部要約' }).click();
  await expect(
    roomChatSection.getByText('要約（外部:', { exact: false }),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(roomChatSection.locator('pre')).toContainText('概要', {
    timeout: actionTimeout,
  });
});

test('frontend smoke external chat invited rooms @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = runId();
  const externalUserId = `e2e-external-${run}@example.com`;
  await prepare(page);

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();
  const roomSettingsCard = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .locator('..');
  await roomSettingsCard.scrollIntoViewIfNeeded();

  await roomSettingsCard.getByRole('button', { name: '再読込' }).click();
  const roomSelect = roomSettingsCard.getByLabel('ルーム');
  await expect
    .poll(() => roomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);

  await selectByLabelOrFirst(roomSelect, 'company: 全社');
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部ユーザ参加を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await roomSettingsCard
    .getByLabel('userId（comma separated）')
    .fill(externalUserId);
  await roomSettingsCard.getByRole('button', { name: 'メンバー追加' }).click();
  await expect(
    roomSettingsCard.getByText('メンバーを追加しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(
    roomSelect,
    'project: PRJ-DEMO-1 / Demo Project 1',
  );
  await roomSettingsCard
    .getByRole('checkbox', { name: '外部ユーザ参加を許可' })
    .check();
  await roomSettingsCard.getByRole('button', { name: '保存' }).click();
  await expect(roomSettingsCard.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await roomSettingsCard
    .getByLabel('userId（comma separated）')
    .fill(externalUserId);
  await roomSettingsCard.getByRole('button', { name: 'メンバー追加' }).click();
  await expect(
    roomSettingsCard.getByText('メンバーを追加しました'),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const externalPage = await page.context().newPage();
  externalPage.on('pageerror', (error) => {
    console.error('[e2e][externalPage][pageerror]', error);
  });
  externalPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('(403)') || text.includes('403 (Forbidden)')) {
        return;
      }
      console.error('[e2e][externalPage][console.error]', text);
    }
  });
  await externalPage.addInitScript(
    (state) => {
      window.localStorage.setItem('erp4_auth', JSON.stringify(state));
      window.localStorage.removeItem('erp4_active_section');
    },
    {
      userId: externalUserId,
      roles: ['external_chat'],
      projectIds: [],
      groupIds: [],
    },
  );
  await externalPage.goto(baseUrl);
  await expect(
    externalPage.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();

  await externalPage.getByRole('button', { name: 'ルームチャット' }).click();
  await expect(
    externalPage.locator('main').getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  const roomChatSection = externalPage
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await roomChatSection.scrollIntoViewIfNeeded();

  const externalRoomSelect = roomChatSection.getByLabel('ルーム');
  await expect
    .poll(() => externalRoomSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);

  await selectByLabelOrFirst(externalRoomSelect, 'company: 全社');
  const companyText = `E2E external company ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(companyText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(companyText)).toBeVisible({
    timeout: actionTimeout,
  });

  await selectByLabelOrFirst(
    externalRoomSelect,
    'project: PRJ-DEMO-1 / Demo Project 1',
  );
  const projectText = `E2E external project ${run}`;
  await roomChatSection.getByPlaceholder('Markdownで入力').fill(projectText);
  await roomChatSection.getByRole('button', { name: '送信' }).click();
  await expect(roomChatSection.getByText(projectText)).toBeVisible({
    timeout: actionTimeout,
  });

  await externalPage.close();
});
