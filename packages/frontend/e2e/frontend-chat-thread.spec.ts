import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = process.env.CI ? 30_000 : 12_000;
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_ISSUE2014_EVIDENCE_DIR ||
  path.join(
    rootDir,
    'docs',
    'test-results',
    '2026-08-09-issue2014-chat-thread-ui',
  );

const adminAuth = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: ['mgmt'],
};
const recipientUserId = 'e2e-member-1@example.com';

function headers(input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
}) {
  return {
    'x-user-id': input.userId,
    'x-roles': input.roles.join(','),
    'x-project-ids': (input.projectIds ?? []).join(','),
    'x-group-ids': (input.groupIds ?? []).join(','),
    'x-group-account-ids': (input.groupAccountIds ?? []).join(','),
  };
}

async function ensureOk(response: { ok(): boolean; status(): number }) {
  if (response.ok()) return;
  throw new Error(`[issue2014-e2e] API failed: ${response.status()}`);
}

async function prepare(page: Page) {
  page.on('pageerror', () => console.error('[issue2014][pageerror]'));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[issue2014][console.error]');
    }
  });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, adminAuth);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
}

async function openRoomChat(page: Page, roomName: string) {
  await page
    .getByRole('button', { name: 'ルームチャット', exact: true })
    .click();
  const section = page
    .locator('main')
    .getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      level: 2,
      exact: true,
    })
    .locator('..');
  await expect(section).toBeVisible({ timeout: actionTimeout });
  const roomSelect = section.locator('select:has(option[value=""])').first();
  await expect
    .poll(() => roomSelect.locator('option', { hasText: roomName }).count(), {
      timeout: actionTimeout,
    })
    .toBe(1);
  await roomSelect.selectOption({ label: `private_group: ${roomName}` });
  const messageList = section
    .locator('strong', { hasText: '一覧' })
    .locator('..');
  return { section, messageList };
}

async function createRoomAndRoot(request: APIRequestContext, suffix: string) {
  const roomName = `E2E Thread ${suffix}`;
  const roomResponse = await request.post(`${apiBase}/chat-rooms`, {
    headers: headers(adminAuth),
    data: {
      type: 'private_group',
      name: roomName,
      memberUserIds: [recipientUserId],
    },
  });
  await ensureOk(roomResponse);
  const room = await roomResponse.json();
  const roomId = String(room?.id || '');
  expect(roomId).not.toBe('');

  const rootBody = `Synthetic thread root ${suffix}`;
  const rootResponse = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/messages`,
    {
      headers: headers(adminAuth),
      data: { body: rootBody, tags: ['e2e', 'thread'] },
    },
  );
  await ensureOk(rootResponse);
  const root = await rootResponse.json();
  const rootId = String(root?.id || '');
  expect(rootId).not.toBe('');
  return { roomName, roomId, rootBody, rootId };
}

async function findNotification(request: APIRequestContext, messageId: string) {
  const response = await request.get(
    `${apiBase}/notifications?unread=1&limit=200`,
    {
      headers: headers({ userId: recipientUserId, roles: ['user'] }),
    },
  );
  await ensureOk(response);
  const payload = await response.json();
  return (payload?.items ?? []).find(
    (item: { kind?: unknown; messageId?: unknown }) =>
      item?.kind === 'chat_mention' && item?.messageId === messageId,
  );
}

async function screenshot(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

async function sanitizeEvidenceText(
  locator: Locator,
  replacements: Array<{ from: string; to: string }>,
) {
  await locator.evaluate((element, values) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      let value = node.nodeValue ?? '';
      for (const replacement of values) {
        value = value.replaceAll(replacement.from, replacement.to);
      }
      node.nodeValue = value;
      node = walker.nextNode();
    }
  }, replacements);
}

test('chat thread UI preserves reply behavior, ACL, search, unread, ack, and deletion @core', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 10);
  const fixture = await createRoomAndRoot(request, suffix);
  const normalReplyBody = `Synthetic normal reply ${suffix}`;
  const mentionReplyBody = `Synthetic mention reply ${suffix}`;
  const ackReplyBody = `Synthetic ack reply ${suffix}`;

  await prepare(page);
  const { section, messageList } = await openRoomChat(page, fixture.roomName);
  const rootCard = messageList.locator('.card', { hasText: fixture.rootBody });
  await expect(rootCard).toHaveCount(1, { timeout: actionTimeout });
  await expect(rootCard.getByText('返信 0件')).toBeVisible();
  await expect(rootCard.getByText(/最終返信/)).toHaveCount(0);
  await rootCard.getByRole('button', { name: /スレッドを開く/ }).click();

  const dialog = page.getByRole('dialog', { name: 'スレッド' });
  await expect(dialog).toBeVisible({ timeout: actionTimeout });
  await dialog.getByPlaceholder('返信を入力').fill(normalReplyBody);
  const mentionSearch = dialog.getByPlaceholder('メンション対象を検索');
  await mentionSearch.fill(`no-candidate-${suffix}`);
  await expect(dialog.getByText('No candidate found.')).toBeVisible({
    timeout: actionTimeout,
  });
  await mentionSearch.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('返信を入力')).toHaveValue(
    normalReplyBody,
  );
  await mentionSearch.fill('');
  await dialog.getByRole('button', { name: '返信', exact: true }).click();
  await expect(dialog.getByText(normalReplyBody)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(dialog.getByText(/返信 1件/).first()).toBeVisible();
  await expect(dialog.getByText(/最終更新/)).toBeVisible();
  await expect(rootCard.getByText(/最終返信/)).toBeVisible();

  const mentionResponse = await request.post(
    `${apiBase}/chat-messages/${encodeURIComponent(fixture.rootId)}/replies`,
    {
      headers: headers(adminAuth),
      data: {
        body: mentionReplyBody,
        mentions: { userIds: [recipientUserId] },
      },
    },
  );
  await ensureOk(mentionResponse);
  const mentionReply = await mentionResponse.json();
  const mentionReplyId = String(mentionReply?.id || '');
  expect(mentionReplyId).not.toBe('');
  await expect
    .poll(() => findNotification(request, mentionReplyId), {
      timeout: actionTimeout,
    })
    .not.toBeUndefined();

  await dialog.getByRole('button', { name: 'スレッドを閉じる' }).click();
  await page.goto(
    `${baseUrl}/#/open?kind=chat_message&id=${encodeURIComponent(mentionReplyId)}`,
  );
  await expect(dialog).toBeVisible({ timeout: actionTimeout });
  await expect(dialog.getByText(mentionReplyBody)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(dialog.getByText(`@${recipientUserId}`)).toBeVisible();

  await dialog.getByPlaceholder('返信を入力').fill(ackReplyBody);
  await dialog.getByLabel('確認依頼として返信').check();
  await dialog
    .getByLabel('確認対象ユーザーID（カンマ区切り）')
    .fill(recipientUserId);
  await dialog.getByRole('button', { name: '確認依頼として返信' }).click();
  const ackReplyCard = dialog.locator('article', { hasText: ackReplyBody });
  await expect(ackReplyCard).toBeVisible({ timeout: actionTimeout });
  await expect(ackReplyCard.getByText(/確認済み 0\/1/)).toBeVisible();
  const threadResponse = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(fixture.rootId)}/thread?limit=50`,
    { headers: headers(adminAuth) },
  );
  await ensureOk(threadResponse);
  const threadPayload = await threadResponse.json();
  const ackReply = (threadPayload?.replies ?? []).find(
    (reply: { body?: unknown }) => reply?.body === ackReplyBody,
  );
  const ackRequestId = String(ackReply?.ackRequest?.id || '');
  expect(ackRequestId).not.toBe('');
  const ackResponse = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/ack`,
    { headers: headers({ userId: recipientUserId, roles: ['user'] }) },
  );
  await ensureOk(ackResponse);
  await dialog.getByRole('button', { name: 'スレッドを閉じる' }).click();
  await rootCard.getByRole('button', { name: /スレッドを開く/ }).click();
  const acknowledgedReplyCard = dialog.locator('article', {
    hasText: ackReplyBody,
  });
  await expect(acknowledgedReplyCard.getByText(/確認済み 1\/1/)).toBeVisible({
    timeout: actionTimeout,
  });

  const normalReplyCard = dialog.locator('article', {
    hasText: normalReplyBody,
  });
  await normalReplyCard
    .getByRole('button', { name: 'replyへ👍リアクション' })
    .click();
  await expect(
    normalReplyCard.getByRole('button', { name: /replyへ👍リアクション/ }),
  ).toContainText('1', { timeout: actionTimeout });

  await dialog.getByRole('button', { name: 'スレッドを閉じる' }).click();
  const searchCard = section
    .locator('strong', { hasText: '横断検索（チャット全体）' })
    .locator('..');
  await searchCard.getByLabel('横断検索（本文）').fill(mentionReplyBody);
  await searchCard.getByRole('button', { name: '検索' }).click();
  const searchResult = searchCard.locator('.card', {
    hasText: mentionReplyBody,
  });
  await expect(searchResult).toBeVisible({ timeout: actionTimeout });
  await expect(searchResult.getByText('返信')).toBeVisible();
  await searchResult.getByRole('button', { name: 'スレッドを開く' }).click();
  await expect(dialog.getByText(mentionReplyBody)).toBeVisible({
    timeout: actionTimeout,
  });

  const recipientHeaders = headers({
    userId: recipientUserId,
    roles: ['user'],
  });
  const unreadResponse = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(fixture.roomId)}/unread`,
    { headers: recipientHeaders },
  );
  await ensureOk(unreadResponse);
  const unread = await unreadResponse.json();
  expect(Number(unread?.unreadCount ?? 0)).toBeGreaterThan(0);

  const outsiderResponse = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(fixture.rootId)}/thread`,
    {
      headers: headers({
        userId: `synthetic-outsider-${suffix}`,
        roles: ['user'],
      }),
    },
  );
  expect(outsiderResponse.status()).toBe(404);

  const deleteTarget = dialog.locator('article', { hasText: normalReplyBody });
  page.once('dialog', (confirmation) => confirmation.accept());
  await deleteTarget.getByRole('button', { name: '返信を削除' }).click();
  await expect(dialog.getByText(normalReplyBody)).toHaveCount(0, {
    timeout: actionTimeout,
  });
  await expect(
    dialog.getByRole('status', { name: '削除済みの返信' }).first(),
  ).toBeVisible();

  expect(await dialog.textContent()).not.toContain('providerUrl');
  expect(await dialog.textContent()).not.toContain('providerKey');
  expect(await dialog.textContent()).not.toContain('rawError');

  await page.setViewportSize({ width: 375, height: 667 });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await sanitizeEvidenceText(dialog, [
    { from: adminAuth.userId, to: '検証担当者' },
    { from: recipientUserId, to: '検証メンバー' },
    { from: suffix, to: '検証ケース' },
  ]);
  await screenshot(dialog, '01-chat-thread-mobile.png');

  await dialog.getByRole('button', { name: 'スレッドを閉じる' }).click();
  await expect(rootCard).toBeVisible();
  await expect(messageList.getByText(mentionReplyBody)).toHaveCount(0);
  await expect(messageList.getByText(ackReplyBody)).toHaveCount(0);
  // PR A fixed replyCount as the immutable thread topology count; logically
  // deleted replies remain represented by a content-free placeholder.
  await expect(rootCard.getByText(/返信 3件/)).toBeVisible();
});
