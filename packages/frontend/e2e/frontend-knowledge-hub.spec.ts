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
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = process.env.CI ? 30_000 : 12_000;

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: ['mgmt'],
};

const syntheticSuffix = Date.now().toString(36);
const snapshotTitle = `Issue 2013 synthetic knowledge ${syntheticSuffix}`;
const snapshotText = 'Synthetic immutable source text for Issue 2013.';
const conversationTitle = `Synthetic provenance conversation ${syntheticSuffix}`;
const synthesisTitle = `Synthetic verified conclusion ${syntheticSuffix}`;

function requestHeaders(state = authState) {
  return {
    'x-user-id': state.userId,
    'x-roles': state.roles.join(','),
    'x-project-ids': state.projectIds.join(','),
    'x-group-ids': state.groupIds.join(','),
    'x-group-account-ids': state.groupAccountIds.join(','),
  };
}

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

test('Knowledge Hub snapshot, annotation, conversation import, and synthesis provenance @core @knowledge-hub', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
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
  const selectedItem = hub
    .locator('.knowledge-hub-selected-summary')
    .filter({ hasText: snapshotTitle });
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

  const itemListResponse = await request.get(
    `${apiBase}/knowledge/items?status=inbox&limit=100`,
    { headers: requestHeaders() },
  );
  expect(itemListResponse.ok()).toBeTruthy();
  const itemList = (await itemListResponse.json()) as {
    items: { id: string; title: string | null }[];
  };
  const item = itemList.items.find((entry) => entry.title === snapshotTitle);
  expect(item?.id).toBeTruthy();

  await hub.getByRole('tab', { name: '本人annotation' }).click();
  const annotationForm = hub.getByRole('form', {
    name: 'アノテーションを作成',
  });
  await annotationForm
    .getByLabel('新規アノテーションの内容')
    .fill('Synthetic owner annotation version one.');
  await annotationForm
    .getByRole('button', { name: 'アノテーションを作成' })
    .click();
  const annotation = hub.getByRole('article', { name: 'アノテーション 1' });
  await expect(annotation).toContainText('本人メモ', {
    timeout: actionTimeout,
  });
  await expect(annotation).toContainText('本人');
  await annotation.getByRole('button', { name: '改訂', exact: true }).click();
  await annotation
    .getByLabel('改訂後の内容')
    .fill('Synthetic owner annotation version two.');
  await annotation.getByRole('button', { name: '改訂を保存' }).click();
  await expect(annotation).toContainText('現在の改訂: 2', {
    timeout: actionTimeout,
  });
  await annotation.getByRole('button', { name: '改訂履歴' }).click();
  await expect(
    annotation.getByRole('article', { name: '改訂 1' }),
  ).toContainText('version one');
  await expect(
    annotation.getByRole('article', { name: '改訂 2' }),
  ).toContainText('version two');
  await captureSection(
    hub.locator('.knowledge-provenance-workspace-panel'),
    '01-annotation-revision-history.png',
  );

  await hub.getByRole('tab', { name: '会話・取込' }).click();
  await hub.getByRole('tab', { name: 'JSON' }).click();
  const conversationInput = JSON.stringify({
    title: conversationTitle,
    provider: null,
    model: null,
    turns: [
      {
        role: 'user',
        origin: 'user',
        content: 'Synthetic user question.',
        name: null,
        occurredAt: null,
      },
      {
        role: 'assistant',
        origin: 'ai',
        content: 'Synthetic AI answer.',
        name: null,
        occurredAt: null,
      },
      {
        role: 'system',
        origin: 'system',
        content: 'Synthetic system context.',
        name: null,
        occurredAt: null,
      },
      {
        role: 'tool',
        origin: 'tool',
        content: 'Synthetic tool result.',
        name: 'other',
        occurredAt: null,
      },
    ],
  });
  await hub.getByLabel('JSON本文').fill(conversationInput);
  await hub.getByRole('button', { name: '取込内容をプレビュー' }).click();
  const preview = hub
    .getByRole('heading', { name: '取込プレビュー' })
    .locator('..');
  await expect(preview).toContainText(conversationTitle, {
    timeout: actionTimeout,
  });
  await expect(preview).toContainText('4');
  await expect(preview).toContainText('AI Assistant');
  await hub.getByRole('button', { name: '取込を確定' }).click();
  await expect(hub.getByText(/会話を取り込みました。4ターン/)).toBeVisible({
    timeout: actionTimeout,
  });
  const conversationButton = hub.getByRole('button', {
    name: new RegExp(conversationTitle),
  });
  await expect(conversationButton).toBeVisible({ timeout: actionTimeout });
  await conversationButton.click();
  const timeline = hub.getByRole('list', { name: '会話タイムライン' });
  await expect(timeline.getByRole('article')).toHaveCount(4, {
    timeout: actionTimeout,
  });
  await expect(timeline).toContainText('User');
  await expect(timeline).toContainText('AI Assistant');
  await expect(timeline).toContainText('System');
  await expect(timeline).toContainText('Tool');
  await captureSection(
    hub.locator('.knowledge-provenance-workspace-panel'),
    '02-conversation-role-timeline.png',
  );

  const firstConversationListResponse = await request.get(
    `${apiBase}/knowledge/conversations?limit=100`,
    { headers: requestHeaders() },
  );
  expect(firstConversationListResponse.ok()).toBeTruthy();
  const firstMatchingConversations = (
    (await firstConversationListResponse.json()) as {
      items: { id: string; title: string }[];
    }
  ).items.filter((entry) => entry.title === conversationTitle);
  expect(firstMatchingConversations).toHaveLength(1);
  const firstConversationId = firstMatchingConversations[0].id;

  await hub.getByRole('button', { name: '取込内容をプレビュー' }).click();
  await expect(
    hub.getByRole('heading', { name: '取込プレビュー' }),
  ).toBeVisible();
  await hub.getByRole('button', { name: '取込を確定' }).click();
  await expect(hub.getByText(/既存会話を再利用しました/)).toBeVisible({
    timeout: actionTimeout,
  });

  const conversationListResponse = await request.get(
    `${apiBase}/knowledge/conversations?limit=100`,
    { headers: requestHeaders() },
  );
  expect(conversationListResponse.ok()).toBeTruthy();
  const conversationList = (await conversationListResponse.json()) as {
    items: { id: string; title: string }[];
  };
  const matchingConversations = conversationList.items.filter(
    (entry) => entry.title === conversationTitle,
  );
  expect(matchingConversations).toHaveLength(1);
  expect(matchingConversations[0].id).toBe(firstConversationId);
  const importedConversation = matchingConversations[0];
  const turnResponse = await request.get(
    `${apiBase}/knowledge/conversations/${encodeURIComponent(importedConversation!.id)}/turns?limit=100`,
    { headers: requestHeaders() },
  );
  expect(turnResponse.ok()).toBeTruthy();
  expect(
    ((await turnResponse.json()) as { items: unknown[] }).items,
  ).toHaveLength(4);

  await hub.getByRole('tab', { name: 'Synthesis・結論' }).click();
  const synthesisPanel = hub.locator(
    'section[aria-labelledby="knowledge-synthesis-panel-heading"]',
  );
  await synthesisPanel
    .getByLabel('タイトル', { exact: true })
    .fill(synthesisTitle);
  await synthesisPanel
    .getByLabel('本文', { exact: true })
    .fill('Synthetic conclusion version one.');
  await synthesisPanel.getByLabel('確信度（%）').fill('82.5');
  await synthesisPanel
    .getByLabel('未解決の質問', { exact: true })
    .fill('Synthetic unresolved question.');
  await synthesisPanel.getByRole('button', { name: '統合知を作成' }).click();
  await expect(
    synthesisPanel.getByRole('heading', { name: synthesisTitle }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(
    synthesisPanel.getByText('82.50%', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    synthesisPanel.getByRole('list', { name: '現在の版の根拠' }),
  ).toContainText('主根拠');
  await synthesisPanel
    .getByLabel('追加する本文')
    .fill('Synthetic conclusion version two.');
  await synthesisPanel.getByLabel('追加版の確信度（%）').fill('90');
  await synthesisPanel
    .getByLabel('追加版の未解決の質問')
    .fill('Second synthetic unresolved question.');
  await synthesisPanel
    .getByRole('button', { name: '新しいversionを追加' })
    .click();
  await expect(
    synthesisPanel.getByText('現在のversion').locator('..'),
  ).toContainText('2', { timeout: actionTimeout });
  await expect(
    synthesisPanel.getByRole('article', { name: 'version 1' }),
  ).toBeVisible();
  await expect(
    synthesisPanel.getByRole('article', { name: 'version 2' }),
  ).toBeVisible();
  await captureSection(
    hub.locator('.knowledge-provenance-workspace-panel'),
    '03-synthesis-version-provenance.png',
  );

  await page.setViewportSize({ width: 375, height: 667 });
  const provenanceWorkspace = hub
    .locator('.knowledge-provenance-workspace-panel')
    .locator('..');
  const workspaceBox = await provenanceWorkspace.boundingBox();
  expect(workspaceBox).not.toBeNull();
  expect(workspaceBox!.width).toBeLessThanOrEqual(375);
  const workspaceWidth = await provenanceWorkspace.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client);

  const synthesisListResponse = await request.get(
    `${apiBase}/knowledge/syntheses?limit=100`,
    { headers: requestHeaders() },
  );
  expect(synthesisListResponse.ok()).toBeTruthy();
  const synthesisList = (await synthesisListResponse.json()) as {
    items: { id: string; title: string }[];
  };
  const synthesis = synthesisList.items.find(
    (entry) => entry.title === synthesisTitle,
  );
  expect(synthesis?.id).toBeTruthy();

  const outsiderHeaders = requestHeaders({
    userId: `synthetic-outsider-${syntheticSuffix}`,
    roles: ['user'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: [],
  });
  const outsiderResponses = await Promise.all([
    request.get(
      `${apiBase}/knowledge/items/${encodeURIComponent(item!.id)}/annotations?limit=100`,
      { headers: outsiderHeaders },
    ),
    request.get(
      `${apiBase}/knowledge/conversations/${encodeURIComponent(importedConversation!.id)}`,
      { headers: outsiderHeaders },
    ),
    request.get(
      `${apiBase}/knowledge/syntheses/${encodeURIComponent(synthesis!.id)}`,
      { headers: outsiderHeaders },
    ),
  ]);
  expect(outsiderResponses.map((response) => response.status())).toEqual([
    404, 404, 404,
  ]);

  await expect(hub).not.toContainText('private-provider.invalid');
  await expect(hub).not.toContainText('provider-key');
  await expect(hub).not.toContainText('raw backend error');
});
