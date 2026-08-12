import fs from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';

const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_ISSUE2016_EVIDENCE_DIR ||
  path.join(
    rootDir,
    'docs',
    'test-results',
    '2026-08-13-issue2016-knowledge-llm-ui',
  );
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = process.env.CI ? 30_000 : 15_000;
const suffix = Date.now().toString(36);
const useJwtAuth =
  (process.env.E2E_AUTH_MODE || 'header').trim().toLowerCase() === 'jwt';
const adminJwtToken = (process.env.E2E_JWT_TOKEN_ADMIN || '').trim();
const outsiderJwtToken = (process.env.E2E_JWT_TOKEN_OUTSIDER || '').trim();

type E2eAuthState = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
  token?: string;
};

const authState: E2eAuthState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: ['mgmt'],
  token: useJwtAuth ? adminJwtToken : undefined,
};

function headers(state: E2eAuthState = authState) {
  const result: Record<string, string> = {
    'x-user-id': state.userId,
    'x-roles': state.roles.join(','),
    'x-project-ids': state.projectIds.join(','),
    'x-group-ids': state.groupIds.join(','),
    'x-group-account-ids': state.groupAccountIds.join(','),
  };
  if (useJwtAuth) {
    const token = state.userId === authState.userId ? adminJwtToken : outsiderJwtToken;
    if (!token) {
      throw new Error('[e2e] Knowledge LLM JWT fixture token is not configured');
    }
    result.Authorization = `Bearer ${token}`;
  }
  return result;
}

async function json<T>(response: APIResponse): Promise<T> {
  const body = (await response.json()) as T;
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}

async function post<T>(
  request: APIRequestContext,
  route: string,
  data: unknown,
): Promise<T> {
  return json<T>(
    await request.post(`${apiBase}${route}`, {
      headers: headers(),
      data,
    }),
  );
}

async function prepare(page: Page) {
  if (captureEnabled) fs.mkdirSync(evidenceDir, { recursive: true });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function screenshot(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await locator.screenshot({ path: path.join(evidenceDir, filename) });
}

async function createSyntheticContext(request: APIRequestContext) {
  const title = 'Issue 2016 synthetic LLM evidence';
  const item = await post<{ id: string }>(request, '/knowledge/items', {
    scope: 'personal',
    sourceType: 'manual',
    status: 'inbox',
    title,
  });
  const olderSnapshot = await post<{ id: string }>(
    request,
    `/knowledge/items/${encodeURIComponent(item.id)}/snapshots`,
    {
      captureMethod: 'text',
      requestKey: `llm-old-${suffix}`,
      originalName: 'synthetic-old.txt',
      text: 'UNSELECTED-SNAPSHOT-CANARY',
    },
  );
  const selectedSnapshot = await post<{ id: string }>(
    request,
    `/knowledge/items/${encodeURIComponent(item.id)}/snapshots`,
    {
      captureMethod: 'text',
      requestKey: `llm-selected-${suffix}`,
      originalName: 'synthetic-selected.txt',
      text: 'SELECTED-SNAPSHOT-CONTEXT',
    },
  );
  const annotation = await post<{ id: string; revision: { id: string } }>(
    request,
    `/knowledge/items/${encodeURIComponent(item.id)}/annotations`,
    {
      kind: 'note',
      origin: 'user',
      content: 'UNSELECTED-ANNOTATION-CANARY',
    },
  );
  const conversation = await post<{ id: string; version: number }>(
    request,
    '/knowledge/conversations',
    {
      title: 'Issue 2016 synthetic conversation',
      sourceType: 'manual',
      capturedAt: null,
    },
  );
  const linked = await post<{ id: string; version: number }>(
    request,
    `/knowledge/conversations/${encodeURIComponent(conversation.id)}/items`,
    {
      itemId: item.id,
      relationType: 'primary',
      ordinal: 0,
      expectedVersion: conversation.version,
    },
  );
  const assistant = await post<{
    conversation: { version: number };
    turn: { id: string };
  }>(
    request,
    `/knowledge/conversations/${encodeURIComponent(conversation.id)}/turns`,
    {
      expectedVersion: linked.version,
      role: 'assistant',
      origin: 'ai',
      content: 'SELECTED-AI-TURN-CONTEXT',
      occurredAt: null,
    },
  );
  const system = await post<{
    conversation: { version: number };
    turn: { id: string };
  }>(
    request,
    `/knowledge/conversations/${encodeURIComponent(conversation.id)}/turns`,
    {
      expectedVersion: assistant.conversation.version,
      role: 'system',
      origin: 'system',
      content: 'UNSELECTED-SYSTEM-CANARY',
      occurredAt: null,
    },
  );
  const tool = await post<{
    conversation: { version: number };
    turn: { id: string };
  }>(
    request,
    `/knowledge/conversations/${encodeURIComponent(conversation.id)}/turns`,
    {
      expectedVersion: system.conversation.version,
      role: 'tool',
      origin: 'tool',
      content: 'UNSELECTED-TOOL-CANARY',
      occurredAt: null,
    },
  );
  const synthesis = await post<{
    synthesis: { id: string };
    currentVersion: { id: string };
  }>(request, '/knowledge/syntheses', {
    scope: 'personal',
    title: 'Issue 2016 synthetic synthesis',
    content: 'UNSELECTED-SYNTHESIS-CANARY',
    unresolvedQuestions: ['UNSELECTED-QUESTION-CANARY'],
    confidenceBasisPoints: 8000,
    sources: [{ kind: 'item', sourceId: item.id, relationType: 'primary' }],
  });
  return {
    title,
    item,
    olderSnapshot,
    selectedSnapshot,
    annotation,
    conversation,
    assistant,
    system,
    tool,
    synthesis,
  };
}

async function configure(
  request: APIRequestContext,
  softLimitMicros: string,
  hardLimitMicros: string,
) {
  return post<{ budgetConfigured: boolean }>(
    request,
    '/__test__/knowledge-llm/configure',
    {
      softLimitMicros,
      hardLimitMicros,
      requestsPerHour: 100,
    },
  );
}

async function preview(panel: Locator, prompt: string) {
  await panel.getByLabel('外部LLMへの指示').fill(prompt);
  const responsePromise = panel.page().waitForResponse(
    (value) =>
      value.request().method() === 'POST' &&
      new URL(value.url()).pathname === '/knowledge/llm/runs/preview',
  );
  await panel.getByRole('button', { name: '外部送信内容をプレビュー' }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    const posted = response.request().postDataJSON() as {
      scope?: unknown;
      organizationId?: unknown;
      provider?: unknown;
      model?: unknown;
      catalogVersion?: unknown;
      userPrompt?: unknown;
      maxOutputTokens?: unknown;
      sources?: { sourceType?: unknown; sourceId?: unknown }[];
    };
    throw new Error(
      JSON.stringify({
        status: response.status(),
        scope: posted.scope,
        organizationIdType:
          posted.organizationId === null ? 'null' : typeof posted.organizationId,
        provider: posted.provider,
        model: posted.model,
        catalogVersion: posted.catalogVersion,
        promptBytes:
          typeof posted.userPrompt === 'string'
            ? new TextEncoder().encode(posted.userPrompt).byteLength
            : null,
        maxOutputTokens: posted.maxOutputTokens,
        sources: Array.isArray(posted.sources)
          ? posted.sources.map((source) => ({
              sourceType: source.sourceType,
              sourceIdType: typeof source.sourceId,
              sourceIdLength:
                typeof source.sourceId === 'string'
                  ? [...source.sourceId].length
                  : null,
            }))
          : null,
        responseBodyRecorded: false,
      }),
    );
  }
  await expect(
    panel.getByRole('heading', { name: '3. Exact preview・明示confirm' }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function confirmAndRun(panel: Locator, page: Page) {
  await panel
    .getByRole('checkbox', {
      name: /上記のexact contentだけを外部providerへ送信/,
    })
    .check();
  const requestPromise = page.waitForRequest(
    (value) =>
      value.method() === 'POST' &&
      new URL(value.url()).pathname === '/knowledge/llm/runs',
  );
  await panel
    .getByRole('button', { name: '明示confirmして1回だけ実行' })
    .click();
  return requestPromise;
}

test('Knowledge external LLM selected context, budget, unknown states, and no-retry flow @core @knowledge-llm', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const context = await createSyntheticContext(request);
  const catalog = await json<{ enabled: boolean }>(
    await request.get(`${apiBase}/knowledge/llm/catalog`, {
      headers: headers(),
    }),
  );
  if (catalog.enabled) {
    await configure(request, '1', '9000000000000000000');
  }
  await prepare(page);
  await page
    .getByRole('button', { name: 'Knowledge Hub', exact: true })
    .click();
  const hub = page.locator('main .knowledge-hub');
  const itemButton = hub
    .locator('button.knowledge-hub-item-button')
    .filter({ hasText: context.title });
  await expect(itemButton).toBeVisible({ timeout: actionTimeout });
  await itemButton.click();
  await hub.getByRole('tab', { name: '外部LLM対話' }).click();
  const panel = hub.locator('.knowledge-llm-panel');

  const disabled = panel.getByText(/外部LLMは無効です/);
  if (!catalog.enabled) {
    await expect(disabled).toBeVisible();
    await expect(panel).toContainText('既定ではprovider requestを作成しません');
    await screenshot(panel, '01-provider-disabled.png');
    return;
  }

  const latestSnapshot = panel.getByRole('checkbox', {
    name: /Snapshot version 2/,
  });
  await expect(latestSnapshot).toBeChecked({ timeout: actionTimeout });
  await expect(
    panel.getByRole('checkbox', { name: /Snapshot version 1/ }),
  ).not.toBeChecked();
  const assistantTurn = panel.getByRole('checkbox', {
    name: /assistant turn 1/,
  });
  const systemTurn = panel.getByRole('checkbox', { name: /system turn 2/ });
  const toolTurn = panel.getByRole('checkbox', { name: /tool turn 3/ });
  await expect(assistantTurn).not.toBeChecked();
  await expect(systemTurn).not.toBeChecked();
  await expect(systemTurn).toBeDisabled();
  await expect(toolTurn).not.toBeChecked();
  await expect(toolTurn).toBeDisabled();

  await preview(panel, '選択したsnapshotだけを検討してください。');
  await expect(panel).toContainText('SELECTED-SNAPSHOT-CONTEXT');
  for (const canary of [
    'SELECTED-AI-TURN-CONTEXT',
    'UNSELECTED-SNAPSHOT-CANARY',
    'UNSELECTED-ANNOTATION-CANARY',
    'UNSELECTED-SYSTEM-CANARY',
    'UNSELECTED-TOOL-CANARY',
    'UNSELECTED-SYNTHESIS-CANARY',
    'UNSELECTED-QUESTION-CANARY',
  ]) {
    await expect(panel).not.toContainText(canary);
  }
  await expect(panel).toContainText('soft limitを超える見込みです');
  await expect(panel).toContainText('最大予約額');
  await screenshot(panel, '02-selected-context-preview.png');

  const firstExecutionRequest = await confirmAndRun(panel, page);
  await expect(panel.getByLabel('外部LLM結果')).toContainText('Synthetic ex', {
    timeout: actionTimeout,
  });
  await expect(panel).toContainText('実績精算済み');
  const replayPayload = firstExecutionRequest.postDataJSON() as Record<
    string,
    unknown
  >;
  const replay = await request.post(`${apiBase}/knowledge/llm/runs`, {
    headers: headers(),
    data: replayPayload,
  });
  const replayBody = await json<{
    created: boolean;
    reused: boolean;
    run: { id: string };
  }>(replay);
  expect(replayBody).toMatchObject({ created: false, reused: true });
  const outsider = await request.get(
    `${apiBase}/knowledge/llm/runs/${encodeURIComponent(replayBody.run.id)}`,
    {
      headers: headers({
        userId: useJwtAuth
          ? 'e2e-outsider@example.com'
          : `synthetic-outsider-${suffix}`,
        roles: ['user'],
        projectIds: [],
        groupIds: [],
        groupAccountIds: [],
      }),
    },
  );
  expect(outsider.status()).toBe(404);

  await configure(request, '0', '9000000000000000000');
  await panel
    .getByLabel('許可されたmodel')
    .selectOption({ label: 'stub / stub-usage-missing-v1' });
  await preview(panel, 'usage unknown fixtureを1回だけ実行します。');
  await confirmAndRun(panel, page);
  await expect(panel).toContainText('最大予約額を保持しています', {
    timeout: actionTimeout,
  });
  await expect(panel).toContainText('actual cost -');
  await screenshot(panel, '03-budget-usage-unknown.png');
  await panel.getByRole('button', { name: '保存済み証跡で再照合' }).click();
  await expect(panel).toContainText('providerへ再送していません');

  await configure(request, '0', '9000000000000000000');
  await panel
    .getByLabel('許可されたmodel')
    .selectOption({ label: 'stub / stub-outcome-unknown-v1' });
  await preview(panel, 'result unknown fixtureを1回だけ実行します。');
  await confirmAndRun(panel, page);
  await expect(panel).toContainText('provider結果は不明です', {
    timeout: actionTimeout,
  });
  await expect(panel).toContainText(
    '自動retryや別provider fallbackは行いません',
  );
  await expect(
    panel.getByRole('button', { name: '明示confirmして1回だけ実行' }),
  ).toBeDisabled();

  await configure(request, '0', '0');
  await panel
    .getByLabel('許可されたmodel')
    .selectOption({ label: 'stub / stub-v1' });
  await preview(panel, 'hard limit fixtureでは送信しません。');
  await expect(panel).toContainText('providerへ送信できません');
  await panel
    .getByRole('checkbox', {
      name: /上記のexact contentだけを外部providerへ送信/,
    })
    .check();
  await expect(
    panel.getByRole('button', { name: '明示confirmして1回だけ実行' }),
  ).toBeDisabled();

  const visibleText = await panel.innerText();
  for (const hidden of [
    context.item.id,
    context.olderSnapshot.id,
    context.selectedSnapshot.id,
    context.annotation.id,
    context.conversation.id,
    context.synthesis.synthesis.id,
    'opaque-preview-token',
    'providerRequestId',
    'apiKey',
    'baseUrl',
  ]) {
    expect(visibleText).not.toContain(hidden);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await panel.scrollIntoViewIfNeeded();
  const dimensions = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await screenshot(panel, '04-hard-limit-mobile-375.png');
});
