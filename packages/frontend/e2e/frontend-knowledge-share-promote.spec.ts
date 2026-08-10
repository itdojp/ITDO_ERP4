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
  process.env.E2E_ISSUE2015_EVIDENCE_DIR ||
  path.join(
    rootDir,
    'docs',
    'test-results',
    '2026-08-10-issue2015-knowledge-share-promote-ui',
  );

const ownerAuth = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: ['mgmt'],
};
const roomViewerAuth = {
  userId: 'e2e-member-1@example.com',
  roles: ['user'],
  projectIds: [] as string[],
  groupIds: [] as string[],
  groupAccountIds: [] as string[],
};
const outsiderAuth = {
  userId: 'e2e-outsider@example.com',
  roles: ['user'],
  projectIds: [] as string[],
  groupIds: [] as string[],
  groupAccountIds: [] as string[],
};

type E2eAuthState = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

function headers(state: E2eAuthState) {
  return {
    'x-user-id': state.userId,
    'x-roles': state.roles.join(','),
    'x-project-ids': state.projectIds.join(','),
    'x-group-ids': state.groupIds.join(','),
    'x-group-account-ids': state.groupAccountIds.join(','),
  };
}

async function ensureOk(response: { ok(): boolean; status(): number }) {
  expect(response.ok(), `API status ${response.status()}`).toBeTruthy();
}

async function prepare(page: Page) {
  if (captureEnabled) fs.mkdirSync(evidenceDir, { recursive: true });
  page.on('pageerror', () => console.error('[issue2015][pageerror]'));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('[issue2015][console.error]');
    }
  });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, ownerAuth);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    { timeout: actionTimeout },
  );
}

async function screenshot(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

async function createRoom(request: APIRequestContext, suffix: string) {
  const name = `Synthetic knowledge share ${suffix}`;
  const response = await request.post(`${apiBase}/chat-rooms`, {
    headers: headers(ownerAuth),
    data: {
      type: 'private_group',
      name,
      memberUserIds: [roomViewerAuth.userId],
    },
  });
  await ensureOk(response);
  const payload = (await response.json()) as { id?: unknown };
  expect(typeof payload.id).toBe('string');
  return { id: String(payload.id), name };
}

test('selective share card and selected-reply promotion preserve ACL and omitted fields @core @knowledge-share', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 10);
  const room = await createRoom(request, suffix);
  const itemTitle = `Synthetic selective share ${suffix}`;
  const selectedAnnotation = `Selected annotation ${suffix}`;
  const privateAnnotationCanary = `Private annotation canary ${suffix}`;
  const selectedAiTurn = `Selected AI turn ${suffix}`;
  const systemTurnCanary = `Unselected system turn canary ${suffix}`;
  const toolTurnCanary = `Unselected tool turn canary ${suffix}`;
  const privateLabelCanary = `Private label canary ${suffix}`;
  const synthesisTitle = `Selected synthesis ${suffix}`;
  const synthesisContent = `Selected synthesis content ${suffix}`;
  const selectedReply = `Selected reply ${suffix}`;
  const unselectedReplyCanary = `Unselected reply canary ${suffix}`;
  const promotedTitle = `Promoted synthesis ${suffix}`;

  await prepare(page);
  await page
    .getByRole('button', { name: 'Knowledge Hub', exact: true })
    .click();
  const hub = page.locator('main .knowledge-hub');
  await hub.getByLabel('タイトル（任意）').fill(itemTitle);
  await hub
    .getByLabel('保存するテキスト')
    .fill(`Synthetic immutable snapshot ${suffix}`);
  await hub.getByRole('button', { name: 'Inboxへ保存' }).click();
  await expect(
    hub.getByText('スナップショット version 1 を保存しました。'),
  ).toBeVisible({ timeout: actionTimeout });

  const itemListResponse = await request.get(
    `${apiBase}/knowledge/items?status=inbox&limit=100`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(itemListResponse);
  const item = (
    (await itemListResponse.json()) as {
      items: Array<{ id: string; title: string | null; version: number }>;
    }
  ).items.find((entry) => entry.title === itemTitle);
  expect(item).toBeTruthy();

  const labelResponse = await request.post(`${apiBase}/knowledge/labels`, {
    headers: headers(ownerAuth),
    data: {
      scope: 'personal',
      displayName: privateLabelCanary,
      slug: `private-canary-${suffix.toLowerCase()}`,
    },
  });
  await ensureOk(labelResponse);
  const label = (await labelResponse.json()) as { id: string };
  const attachResponse = await request.post(
    `${apiBase}/knowledge/items/${encodeURIComponent(item!.id)}/labels`,
    {
      headers: headers(ownerAuth),
      data: { expectedVersion: item!.version, labelId: label.id },
    },
  );
  await ensureOk(attachResponse);

  await hub.getByRole('tab', { name: '本人annotation' }).click();
  const annotationForm = hub.getByRole('form', {
    name: 'アノテーションを作成',
  });
  await annotationForm
    .getByLabel('新規アノテーションの内容')
    .fill(selectedAnnotation);
  await annotationForm
    .getByRole('button', { name: 'アノテーションを作成' })
    .click();
  await expect(hub.getByText(selectedAnnotation)).toBeVisible({
    timeout: actionTimeout,
  });
  await annotationForm
    .getByLabel('新規アノテーションの内容')
    .fill(privateAnnotationCanary);
  await annotationForm
    .getByRole('button', { name: 'アノテーションを作成' })
    .click();
  await expect(hub.getByText(privateAnnotationCanary)).toBeVisible({
    timeout: actionTimeout,
  });

  await hub.getByRole('tab', { name: '会話・取込' }).click();
  await hub.getByRole('tab', { name: 'JSON入力', exact: true }).click();
  await hub.getByLabel('JSON本文').fill(
    JSON.stringify({
      title: `Synthetic conversation ${suffix}`,
      provider: null,
      model: null,
      turns: [
        {
          role: 'user',
          origin: 'user',
          content: `Synthetic user turn ${suffix}`,
          name: null,
          occurredAt: null,
        },
        {
          role: 'assistant',
          origin: 'ai',
          content: selectedAiTurn,
          name: null,
          occurredAt: null,
        },
        {
          role: 'system',
          origin: 'system',
          content: systemTurnCanary,
          name: null,
          occurredAt: null,
        },
        {
          role: 'tool',
          origin: 'tool',
          content: toolTurnCanary,
          name: 'other',
          occurredAt: null,
        },
      ],
    }),
  );
  await hub.getByRole('button', { name: '取込内容をプレビュー' }).click();
  await expect(
    hub.getByRole('heading', { name: '取込プレビュー' }),
  ).toBeVisible({ timeout: actionTimeout });
  await hub.getByRole('button', { name: '取込を確定' }).click();
  await expect(hub.getByText(/会話を取り込みました。4ターン/)).toBeVisible({
    timeout: actionTimeout,
  });

  await hub.getByRole('tab', { name: 'Synthesis・結論' }).click();
  const synthesisPanel = hub.locator(
    'section[aria-labelledby="knowledge-synthesis-panel-heading"]',
  );
  await synthesisPanel
    .getByLabel('タイトル', { exact: true })
    .fill(synthesisTitle);
  await synthesisPanel
    .getByLabel('本文', { exact: true })
    .fill(synthesisContent);
  await synthesisPanel.getByLabel('確信度（%）').fill('82.5');
  await synthesisPanel.getByRole('button', { name: '統合知を作成' }).click();
  await expect(
    synthesisPanel.getByRole('heading', { name: synthesisTitle }),
  ).toBeVisible({ timeout: actionTimeout });

  await hub.getByRole('tab', { name: 'Chatへ共有' }).click();
  const sharePanel = hub
    .getByRole('heading', { name: 'Chatへ選択共有' })
    .locator('..');
  await expect(sharePanel.getByLabel('共有先Chatルーム')).toBeEnabled({
    timeout: actionTimeout,
  });
  await sharePanel.getByLabel('共有先Chatルーム').selectOption(room.id);
  await sharePanel
    .getByRole('list', { name: '共有候補annotation' })
    .getByRole('listitem')
    .filter({ hasText: selectedAnnotation })
    .getByRole('checkbox')
    .check();
  await sharePanel
    .getByText(selectedAiTurn, { exact: true })
    .locator('..')
    .getByRole('checkbox')
    .check();
  await sharePanel
    .getByRole('checkbox', { name: new RegExp(synthesisTitle) })
    .check();
  await sharePanel
    .getByRole('button', { name: '共有内容をプレビュー' })
    .click();

  const sharePreview = sharePanel.getByRole('region', {
    name: '共有内容の最終確認',
  });
  await expect(sharePreview).toContainText(selectedAnnotation, {
    timeout: actionTimeout,
  });
  await expect(sharePreview).toContainText(selectedAiTurn);
  await expect(sharePreview).toContainText(synthesisContent);
  for (const canary of [
    privateLabelCanary,
    privateAnnotationCanary,
    systemTurnCanary,
    toolTurnCanary,
  ]) {
    await expect(sharePreview).not.toContainText(canary);
  }
  await screenshot(sharePreview, '01-selective-share-preview.png');
  await sharePanel
    .getByRole('checkbox', {
      name: '上記の共有先と共有内容が完全に一致することを確認しました',
    })
    .check();
  await sharePanel
    .getByRole('button', { name: '確認した内容をChatへ共有' })
    .click();
  await expect(
    sharePanel.getByRole('heading', { name: '投稿済み', exact: true }),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const timelineResponse = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(room.id)}/messages`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(timelineResponse);
  const root = (
    (await timelineResponse.json()) as {
      items: Array<{ id: string; body: string; parentMessageId: null }>;
    }
  ).items.find((entry) => entry.body === 'Knowledge was shared.');
  expect(root).toBeTruthy();
  const summariesResponse = await request.get(
    `${apiBase}/chat-rooms/${encodeURIComponent(room.id)}/knowledge-share-messages?messageIds=${encodeURIComponent(root!.id)}`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(summariesResponse);
  const summary = (
    (await summariesResponse.json()) as {
      items: Array<{ messageId: string; shareId: string }>;
    }
  ).items[0];
  expect(summary?.messageId).toBe(root!.id);

  const roomViewerCard = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/knowledge-share`,
    { headers: headers(roomViewerAuth) },
  );
  await ensureOk(roomViewerCard);
  const cardText = JSON.stringify(await roomViewerCard.json());
  expect(cardText).toContain(selectedAnnotation);
  expect(cardText).toContain(selectedAiTurn);
  for (const canary of [
    privateLabelCanary,
    privateAnnotationCanary,
    systemTurnCanary,
    toolTurnCanary,
  ]) {
    expect(cardText).not.toContain(canary);
  }
  const roomViewerSource = await request.get(
    `${apiBase}/knowledge/shares/${encodeURIComponent(summary!.shareId)}/source`,
    { headers: headers(roomViewerAuth) },
  );
  expect(roomViewerSource.status()).toBe(404);
  const outsiderCard = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/knowledge-share`,
    { headers: headers(outsiderAuth) },
  );
  expect(outsiderCard.status()).toBe(404);

  await page
    .getByRole('button', { name: 'ルームチャット', exact: true })
    .click();
  const roomChat = page
    .locator('main')
    .getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      exact: true,
    })
    .locator('..');
  await roomChat
    .getByRole('combobox', { name: 'ルーム' })
    .selectOption(room.id);
  const rootCard = page.locator(`#chat-message-${root!.id}`);
  await expect(rootCard.getByText(itemTitle)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(rootCard).not.toContainText('Knowledge was shared.');
  for (const canary of [
    privateLabelCanary,
    privateAnnotationCanary,
    systemTurnCanary,
    toolTurnCanary,
  ]) {
    await expect(rootCard).not.toContainText(canary);
  }
  await screenshot(rootCard, '02-chat-share-card.png');

  for (const body of [selectedReply, unselectedReplyCanary]) {
    const response = await request.post(
      `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/replies`,
      { headers: headers(ownerAuth), data: { body, tags: ['synthetic'] } },
    );
    await ensureOk(response);
  }
  await rootCard.getByRole('button', { name: /スレッドを開く/ }).click();
  const thread = page.getByRole('dialog', { name: 'スレッド' });
  await expect(thread.getByText(selectedReply)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(thread.getByText(unselectedReplyCanary)).toBeVisible();
  await thread
    .getByRole('button', { name: '選択した返信をナレッジへ' })
    .click();
  const promoteDialog = page.getByRole('dialog', {
    name: 'スレッドをナレッジ化',
  });
  await promoteDialog.getByRole('checkbox', { name: '返信 1を選択' }).check();
  await promoteDialog.getByLabel('ナレッジ化タイトル').fill(promotedTitle);
  await promoteDialog
    .getByLabel('ナレッジ化内容')
    .fill(`Promoted conclusion ${suffix}`);
  await promoteDialog.getByLabel('確信度').fill('84');
  await promoteDialog
    .getByLabel('未解決の質問')
    .fill(`Promoted unresolved question ${suffix}`);
  await promoteDialog
    .getByRole('button', { name: 'ナレッジ化内容をプレビュー' })
    .click();
  const promotionPreview = promoteDialog.getByRole('region', {
    name: 'ナレッジ化プレビュー',
  });
  await expect(promotionPreview).toContainText(selectedReply, {
    timeout: actionTimeout,
  });
  await expect(promotionPreview).not.toContainText(unselectedReplyCanary);
  await screenshot(promotionPreview, '03-selected-reply-promotion.png');
  await promotionPreview
    .getByRole('checkbox', {
      name: '選択・省略・保存内容を確認しました',
    })
    .check();
  await promotionPreview
    .getByRole('button', { name: 'ナレッジ化を確定' })
    .click();
  await expect(
    promoteDialog.getByText('新しいナレッジ統合を作成しました。'),
  ).toBeVisible({ timeout: actionTimeout });

  const promotedList = await request.get(
    `${apiBase}/knowledge/syntheses?limit=100`,
    {
      headers: headers(ownerAuth),
    },
  );
  await ensureOk(promotedList);
  const promoted = (
    (await promotedList.json()) as {
      items: Array<{ id: string; title: string }>;
    }
  ).items.find((entry) => entry.title === promotedTitle);
  expect(promoted).toBeTruthy();
  const promotedDetail = await request.get(
    `${apiBase}/knowledge/syntheses/${encodeURIComponent(promoted!.id)}`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(promotedDetail);
  expect(JSON.stringify(await promotedDetail.json())).not.toContain(
    unselectedReplyCanary,
  );

  const currentItemResponse = await request.get(
    `${apiBase}/knowledge/items/${encodeURIComponent(item!.id)}`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(currentItemResponse);
  const currentItem = (await currentItemResponse.json()) as { version: number };
  const deleteResponse = await request.delete(
    `${apiBase}/knowledge/items/${encodeURIComponent(item!.id)}`,
    {
      headers: headers(ownerAuth),
      data: {
        expectedVersion: currentItem.version,
        reasonCode: 'owner_request',
      },
    },
  );
  await ensureOk(deleteResponse);
  const cardAfterSourceDelete = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/knowledge-share`,
    { headers: headers(roomViewerAuth) },
  );
  await ensureOk(cardAfterSourceDelete);
  expect(JSON.stringify(await cardAfterSourceDelete.json())).toContain(
    itemTitle,
  );

  const revokeResponse = await request.post(
    `${apiBase}/knowledge/shares/${encodeURIComponent(summary!.shareId)}/revoke`,
    { headers: headers(ownerAuth) },
  );
  await ensureOk(revokeResponse);
  const revokedCard = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/knowledge-share`,
    { headers: headers(roomViewerAuth) },
  );
  await ensureOk(revokedCard);
  const revokedText = JSON.stringify(await revokedCard.json());
  expect(revokedText).toContain('revoked');
  expect(revokedText).not.toContain(itemTitle);
  const threadAfterRevoke = await request.get(
    `${apiBase}/chat-messages/${encodeURIComponent(root!.id)}/thread`,
    { headers: headers(roomViewerAuth) },
  );
  await ensureOk(threadAfterRevoke);
  expect(
    ((await threadAfterRevoke.json()) as { replies: unknown[] }).replies,
  ).toHaveLength(2);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    { timeout: actionTimeout },
  );
  await page
    .getByRole('button', { name: 'ルームチャット', exact: true })
    .click();
  const reloadedRoomChat = page
    .locator('main')
    .getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      exact: true,
    })
    .locator('..');
  await reloadedRoomChat
    .getByRole('combobox', { name: 'ルーム' })
    .selectOption(room.id);
  const revokedRootCard = page.locator(`#chat-message-${root!.id}`);
  await expect(
    revokedRootCard.getByText(
      'このナレッジ共有は取り消されました。共有内容は表示されません。',
    ),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(revokedRootCard).not.toContainText(itemTitle);
  await revokedRootCard.getByRole('button', { name: /スレッドを開く/ }).click();
  const retainedThread = page.getByRole('dialog', { name: 'スレッド' });
  await expect(retainedThread.getByText(selectedReply)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(retainedThread.getByText(unselectedReplyCanary)).toBeVisible();
});
