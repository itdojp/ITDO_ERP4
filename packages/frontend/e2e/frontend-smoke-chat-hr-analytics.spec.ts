import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolveProjectRoomId } from './chat-room-e2e-helpers';

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

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

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
    .poll(() => select.count(), { timeout: actionTimeout })
    .toBeGreaterThan(0);
  const targetSelect = select.first();
  await expect(targetSelect).toBeVisible({ timeout: actionTimeout });
  await expect
    .poll(() => targetSelect.locator('option').count(), {
      timeout: actionTimeout,
    })
    .toBeGreaterThan(1);
  if (label) {
    await expect
      .poll(() => targetSelect.locator('option', { hasText: label }).count(), {
        timeout: actionTimeout,
      })
      .toBeGreaterThan(0);
    await targetSelect.selectOption({ label });
    return;
  }
  await targetSelect.selectOption({ index: 1 });
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

test('frontend smoke chat hr analytics @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  const mentionTarget = 'e2e-member-1@example.com';
  const projectId = authState.projectIds[0];
  const projectChatRoutePattern = `**/projects/${projectId}/chat-**`;
  const blockedProjectUrls: string[] = [];
  await prepare(page);
  const roomId = await resolveProjectRoomId({ projectId });

  await expect(page.getByText('ID: demo-user')).toBeVisible();
  await expect(page.getByText('Roles: admin, mgmt')).toBeVisible();

  // Ensure the ack-required target user can access the project room.
  const projectMemberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      headers: buildAuthHeaders(),
      data: { userId: mentionTarget, role: 'member' },
    },
  );
  await ensureOk(projectMemberRes);

  await page.route(projectChatRoutePattern, async (route) => {
    blockedProjectUrls.push(route.request().url());
    await route.abort();
  });
  await navigateToSection(page, 'プロジェクトチャット');
  const chatSection = page
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..')
    .first();
  await chatSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    chatSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await expect(
    chatSection.getByRole('checkbox', { name: '全投稿通知' }),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  const mentionComposerInput = chatSection.getByPlaceholder(
    'メンション対象を検索（ユーザ/グループ）',
  );
  await mentionComposerInput.fill('e2e-member-1');
  const mentionComposerOption = chatSection.getByRole('option', {
    name: /e2e-member-1@example\.com/i,
  });
  await expect(mentionComposerOption).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await expect(mentionComposerOption).toBeVisible({ timeout: actionTimeout });
  await mentionComposerOption.click();
  const chatMessage = `E2E chat message ${id}`;
  const uploadName = `e2e-chat-${id}.txt`;
  const uploadPath = path.join(rootDir, 'tmp', uploadName);
  fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
  fs.writeFileSync(uploadPath, `e2e upload ${id}`);
  await chatSection.getByPlaceholder('メッセージを書く').fill(chatMessage);
  await chatSection.getByRole('checkbox', { name: 'プレビュー' }).check();
  const projectPreview = chatSection.getByRole('region', {
    name: 'Markdownプレビュー',
  });
  await expect(projectPreview.getByText(chatMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  await chatSection.getByPlaceholder('タグ (comma separated)').fill('e2e,chat');
  const addFilesButton = chatSection
    .getByRole('button', { name: /ファイルを選択|Add files/ })
    .first();
  await expect(addFilesButton).toBeVisible({ timeout: actionTimeout });
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    addFilesButton.click(),
  ]);
  await fileChooser.setFiles(uploadPath);
  await chatSection.getByRole('button', { name: '投稿' }).click();
  await expect(chatSection.locator('li', { hasText: chatMessage })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  const chatItem = chatSection.locator('li', { hasText: chatMessage });
  await expect(chatItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(chatItem.getByText(`@${mentionTarget}`)).toBeVisible();
  await expect(
    chatSection.getByRole('button', { name: uploadName }),
  ).toBeVisible();
  const reactionButton = chatItem.getByRole('button', { name: /^👍/ });
  if (await reactionButton.isEnabled().catch(() => false)) {
    await reactionButton.click();
  }
  await expect(chatSection.getByRole('button', { name: '投稿' })).toBeDisabled({
    timeout: actionTimeout,
  });

  const deliveryRes = await page.request.post(
    `${apiBase}/jobs/notification-deliveries/run`,
    {
      data: { limit: 50 },
      headers: {
        'x-user-id': authState.userId,
        'x-roles': authState.roles.join(','),
      },
    },
  );
  expect(deliveryRes.ok()).toBeTruthy();
  const deliveryJson = (await deliveryRes.json()) as {
    ok?: boolean;
    items?: Array<{ status?: string; target?: string | null }>;
  };
  expect(deliveryJson.ok).toBeTruthy();
  expect(Array.isArray(deliveryJson.items)).toBeTruthy();
  expect(
    (deliveryJson.items ?? []).some(
      (item) =>
        (item.status === 'stub' || item.status === 'success') &&
        (item.target || '').includes(mentionTarget),
    ),
  ).toBeTruthy();

  const ackMessage = `E2E ack request ${id}`;
  await chatSection.getByPlaceholder('メッセージを書く').fill(ackMessage);
  await chatSection.getByPlaceholder('タグ (comma separated)').fill('e2e,ack');
  await chatSection
    .getByPlaceholder('確認対象ユーザID (comma separated)')
    .fill(mentionTarget);
  await chatSection.getByRole('button', { name: '確認依頼' }).click();
  const ackItem = chatSection.locator('li', { hasText: ackMessage });
  await expect(ackItem).toBeVisible();
  await expect(ackItem.getByText('確認状況: 0/1')).toBeVisible();

  const overdueDueAt = new Date(Date.now() - 60_000).toISOString();
  const overdueAckMessage = `E2E ack overdue ${id}`;
  const overdueAckRes = await page.request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/ack-requests`,
    {
      data: {
        body: overdueAckMessage,
        requiredUserIds: [mentionTarget],
        dueAt: overdueDueAt,
        tags: ['e2e', 'ack'],
      },
      headers: buildAuthHeaders(),
    },
  );
  expect(overdueAckRes.ok()).toBeTruthy();
  await chatSection.getByRole('button', { name: '読み込み' }).click();
  const overdueItem = chatSection.locator('li', { hasText: overdueAckMessage });
  await expect(overdueItem).toBeVisible({ timeout: actionTimeout });
  const overdueDueLabel = overdueItem.getByText(/期限:/);
  await expect(overdueDueLabel).toBeVisible();
  await expect(overdueDueLabel).toContainText('期限超過');
  await expect(overdueDueLabel).toHaveCSS('color', 'rgb(220, 38, 38)');
  await captureSection(chatSection, '12-project-chat.png');

  await chatSection.getByRole('button', { name: '要約' }).click();
  const summaryBlock = chatSection.getByText('要約（スタブ）');
  await expect(summaryBlock).toBeVisible();
  await expect(chatSection.locator('pre')).toContainText('取得件数');
  await page.unroute(projectChatRoutePattern);
  expect(blockedProjectUrls).toEqual([]);

  await navigateToSection(page, 'HR分析', '匿名集計（人事向け）');
  const hrSection = page
    .locator('main')
    .locator('h2', { hasText: '匿名集計（人事向け）' })
    .locator('..')
    .first();
  await hrSection.scrollIntoViewIfNeeded();
  const hrRangeTo = new Date();
  const hrRangeFrom = new Date(hrRangeTo.getTime() - 14 * 24 * 60 * 60 * 1000);
  await hrSection.getByLabel('開始日').fill(toDateInputValue(hrRangeFrom));
  await hrSection.getByLabel('終了日').fill(toDateInputValue(hrRangeTo));
  await hrSection.getByLabel('閾値').fill('1');
  const groupUpdateButton = hrSection
    .getByRole('button', {
      name: '更新',
    })
    .first();
  await expect(groupUpdateButton).toBeVisible({ timeout: actionTimeout });
  await groupUpdateButton.click();
  await expect(hrSection.locator('ul.list li')).not.toHaveCount(0);
  const groupSelect = hrSection.getByRole('combobox');
  if (await groupSelect.locator('option', { hasText: 'hr-group' }).count()) {
    await groupSelect.selectOption({ label: 'hr-group' });
  }
  const monthlyUpdateButton = hrSection
    .locator('.row', {
      has: hrSection.locator('strong', { hasText: '時系列' }),
    })
    .getByRole('button', { name: '更新' })
    .first();
  if (
    (await monthlyUpdateButton.isVisible().catch(() => false)) &&
    (await monthlyUpdateButton.isEnabled().catch(() => false))
  ) {
    await monthlyUpdateButton.click();
  }
  await captureSection(hrSection, '13-hr-analytics.png');

  const mentionPage = await page.context().newPage();
  mentionPage.on('pageerror', (error) => {
    console.error('[e2e][mentionPage][pageerror]', error);
  });
  mentionPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][mentionPage][console.error]', msg.text());
    }
  });
  const mentionBlockedProjectUrls: string[] = [];
  await mentionPage.route(projectChatRoutePattern, async (route) => {
    mentionBlockedProjectUrls.push(route.request().url());
    await route.abort();
  });
  await mentionPage.addInitScript(
    (state) => {
      window.localStorage.setItem('erp4_auth', JSON.stringify(state));
      window.localStorage.removeItem('erp4_active_section');
    },
    {
      userId: mentionTarget,
      roles: authState.roles,
      projectIds: authState.projectIds,
      groupIds: authState.groupIds,
    },
  );
  await mentionPage.goto(baseUrl);
  await expect(
    mentionPage.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();

  // Ack / revoke is performed by the required user (mentionTarget).
  await navigateToSection(mentionPage, 'プロジェクトチャット');
  const mentionChatSection = mentionPage
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..')
    .first();
  await mentionChatSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    mentionChatSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await expect(
    mentionChatSection.getByRole('checkbox', { name: '全投稿通知' }),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionChatSection.getByRole('button', { name: '読み込み' }).click();
  const mentionAckItem = mentionChatSection.locator('li', {
    hasText: ackMessage,
  });
  await expect(mentionAckItem).toBeVisible({ timeout: actionTimeout });
  await expect(mentionAckItem.getByText('確認状況: 0/1')).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionAckItem.getByRole('button', { name: 'OK' }).click();
  await expect(mentionAckItem.getByText('確認状況: 1/1')).toBeVisible({
    timeout: actionTimeout,
  });
  mentionPage.once('dialog', (dialog) =>
    dialog.accept().catch(() => undefined),
  );
  await mentionAckItem.getByRole('button', { name: 'OK取消' }).click();
  await expect(mentionAckItem.getByText('確認状況: 0/1')).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionPage.unroute(projectChatRoutePattern);
  expect(mentionBlockedProjectUrls).toEqual([]);

  await mentionPage.getByRole('button', { name: 'ホーム' }).click();
  await expect(
    mentionPage
      .locator('main')
      .getByRole('heading', { name: 'Dashboard', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  const dashboardSection = mentionPage
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..')
    .first();
  await expect(dashboardSection.getByText(chatMessage)).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionPage.close();

  // Cancel the ack-request as the creator/admin (demo-user).
  await navigateToSection(page, 'プロジェクトチャット');
  const chatSectionAfter = page
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..')
    .first();
  await chatSectionAfter.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    chatSectionAfter.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await chatSectionAfter.getByRole('button', { name: '読み込み' }).click();
  const ackItemAfter = chatSectionAfter.locator('li', { hasText: ackMessage });
  await expect(ackItemAfter).toBeVisible({ timeout: actionTimeout });
  page.once('dialog', (dialog) =>
    dialog.accept('e2e cancel').catch(() => undefined),
  );
  await ackItemAfter.getByRole('button', { name: '撤回' }).click();
  await expect(ackItemAfter.getByText(/^撤回:/)).toBeVisible({
    timeout: actionTimeout,
  });
});
