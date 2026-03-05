import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolveProjectRoomId } from './chat-room-e2e-helpers';

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
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
  groupAccountIds: [] as string[],
};

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const resolvedAuthState = { ...authState, ...(override ?? {}) };
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
    'x-group-account-ids': (resolved.groupAccountIds ?? []).join(','),
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

const projectRoomLabel = 'project: PRJ-DEMO-1 / Demo Project 1';

async function openRoomChatSection(page: Page, roomLabel?: string) {
  await navigateToSection(page, 'ルームチャット', 'チャット（全社/部門/private_group/DM）');
  const chatSection = page
    .locator('main')
    .locator('h2', { hasText: 'チャット（全社/部門/private_group/DM）' })
    .locator('..');
  await chatSection.scrollIntoViewIfNeeded();
  await chatSection.getByRole('button', { name: '再読込' }).first().click();
  const roomSelect = chatSection.locator('select:has(option[value=""])').first();
  await selectByLabelOrFirst(
    roomSelect,
    roomLabel || projectRoomLabel,
  );
  const messageList = chatSection.locator('strong', { hasText: '一覧' }).locator('..');
  return { chatSection, messageList };
}

test('frontend room chat project room uses room API path @extended', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const message = `E2E room chat path ${id}`;
  const projectId = authState.projectIds[0];
  const projectChatRoutePattern = `**/projects/${projectId}/chat-**`;
  const blockedProjectUrls: string[] = [];

  await prepare(page);
  const { chatSection, messageList } = await openRoomChatSection(page);

  // roomIdが解決されるまで待ち、以降の操作がroom API経路になることを確認する。
  await expect(
    chatSection.getByRole('checkbox', { name: '全投稿通知' }),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await page.route(projectChatRoutePattern, async (route) => {
    blockedProjectUrls.push(route.request().url());
    await route.abort();
  });

  try {
    await chatSection.getByPlaceholder('Markdownで入力').fill(message);
    await chatSection.getByRole('button', { name: '送信' }).click();
    const messageItem = messageList.locator('.card', { hasText: message });
    await expect(messageItem).toHaveCount(1, { timeout: actionTimeout });
    await expect(messageItem).toBeVisible({ timeout: actionTimeout });
  } finally {
    await page.unroute(projectChatRoutePattern);
  }

  expect(blockedProjectUrls).toEqual([]);
});

test('frontend smoke room chat ack targets (user/group/role) @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
  const projectChatRoutePattern = `**/projects/${projectId}/chat-**`;
  const blockedProjectUrls: string[] = [];
  const targetUser = 'e2e-member-1@example.com';
  const ackMessage = `E2E ack target set ${id}`;

  await prepare(page);

  const addMemberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      headers: buildAuthHeaders(),
      data: { userId: targetUser, role: 'member' },
    },
  );
  await ensureOk(addMemberRes);

  const { chatSection, messageList } = await openRoomChatSection(page);
  await expect(
    chatSection.getByRole('checkbox', { name: '全投稿通知' }),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  await page.route(projectChatRoutePattern, async (route) => {
    blockedProjectUrls.push(route.request().url());
    await route.abort();
  });

  try {
    await chatSection.getByPlaceholder('Markdownで入力').fill(ackMessage);
    await chatSection.getByPlaceholder('tag1,tag2').fill('e2e,ack');
    await chatSection.getByLabel('確認対象(requiredUserIds)').fill(targetUser);
    await chatSection
      .getByLabel('確認対象グループ(requiredGroupIds)')
      .fill('mgmt');
    await chatSection.getByLabel('確認対象ロール(requiredRoles)').fill('admin');

    await chatSection.getByRole('button', { name: '対象者を確認' }).click();
    await expect(chatSection.getByText(/展開対象:\s*\d+人/)).toBeVisible({
      timeout: actionTimeout,
    });

    await chatSection.getByRole('button', { name: '確認依頼' }).click();
    const ackItem = messageList.locator('.card', { hasText: ackMessage });
    await expect(ackItem).toHaveCount(1, { timeout: actionTimeout });
    await expect(ackItem).toBeVisible({ timeout: actionTimeout });
    await expect(ackItem.getByText('確認依頼')).toBeVisible({
      timeout: actionTimeout,
    });
    await expect(ackItem.getByText(`required: ${targetUser}`)).toBeVisible({
      timeout: actionTimeout,
    });
    await expect(ackItem.getByText('acked: -')).toBeVisible({
      timeout: actionTimeout,
    });
  } finally {
    await page.unroute(projectChatRoutePattern);
  }

  expect(blockedProjectUrls).toEqual([]);
});

test('frontend smoke room chat mention composer selects user targets @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
  const projectChatRoutePattern = `**/projects/${projectId}/chat-**`;
  const blockedProjectUrls: string[] = [];
  const targetUser = 'e2e-member-1@example.com';
  const messageBody = `E2E mention composer ${id}`;
  const mentionGroupDisplayName = `e2e-mention-${id}`;
  let mentionGroupId = '';

  try {
    const createGroupRes = await page.request.post(`${apiBase}/groups`, {
      headers: buildAuthHeaders(),
      data: { displayName: mentionGroupDisplayName },
    });
    await ensureOk(createGroupRes);
    const createdGroup = (await createGroupRes.json()) as {
      id?: string;
      displayName?: string;
    };
    mentionGroupId = String(createdGroup.id || '').trim();
    expect(mentionGroupId.length).toBeGreaterThan(0);

    const mentionAuthState: Partial<typeof authState> = {
      groupIds: Array.from(
        new Set([...authState.groupIds, mentionGroupDisplayName]),
      ),
      groupAccountIds: Array.from(
        new Set([...(authState.groupAccountIds ?? []), mentionGroupId]),
      ),
    };

    await prepare(page, mentionAuthState);

    const addMemberRes = await page.request.post(
      `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
      {
        headers: buildAuthHeaders(mentionAuthState),
        data: { userId: targetUser, role: 'member' },
      },
    );
    await ensureOk(addMemberRes);
    const projectRoomId = await resolveProjectRoomId({
      request: page.request,
      apiBase,
      projectId,
      headers: buildAuthHeaders(mentionAuthState),
    });

    const mentionCandidatesRes = await page.request.get(
      `${apiBase}/chat-rooms/${encodeURIComponent(projectRoomId)}/mention-candidates`,
      {
        headers: buildAuthHeaders(mentionAuthState),
      },
    );
    await ensureOk(mentionCandidatesRes);
    const mentionCandidates = (await mentionCandidatesRes.json()) as {
      groups?: Array<{ groupId?: string | null }>;
    };
    expect(
      mentionCandidates.groups?.some(
        (group) => group.groupId === mentionGroupId,
      ),
    ).toBeTruthy();

    const { chatSection, messageList } = await openRoomChatSection(page);
    await expect(
      chatSection.getByRole('checkbox', { name: '全投稿通知' }),
    ).toBeVisible({
      timeout: actionTimeout,
    });
    await page.route(projectChatRoutePattern, async (route) => {
      blockedProjectUrls.push(route.request().url());
      await route.abort();
    });

    try {
      const mentionInput = chatSection.getByPlaceholder(
        'メンション対象を検索（ユーザ/グループ）',
      );
      await mentionInput.fill('e2e-member-1');
      const userOption = chatSection.getByRole('option', {
        name: /e2e-member-1@example\.com/i,
      });
      await expect(userOption).toHaveCount(1, { timeout: actionTimeout });
      await userOption.click();

      await mentionInput.fill(mentionGroupDisplayName);
      const groupOption = chatSection.getByRole('option', {
        name: new RegExp(mentionGroupDisplayName, 'i'),
      });
      await expect(groupOption).toHaveCount(1, { timeout: actionTimeout });

      await chatSection.getByPlaceholder('Markdownで入力').fill(messageBody);
      await chatSection.getByRole('button', { name: '送信' }).click();

      const messageItem = messageList.locator('.card', { hasText: messageBody });
      await expect(messageItem).toHaveCount(1, { timeout: actionTimeout });
      await expect(messageItem).toBeVisible({ timeout: actionTimeout });
      await expect(
        messageItem.getByLabel(`メンション対象ユーザ: ${targetUser}`),
      ).toBeVisible({ timeout: actionTimeout });
    } finally {
      await page.unroute(projectChatRoutePattern);
    }

    expect(blockedProjectUrls).toEqual([]);
  } finally {
    if (mentionGroupId) {
      const deactivateRes = await page.request.patch(
        `${apiBase}/groups/${encodeURIComponent(mentionGroupId)}`,
        {
          headers: buildAuthHeaders(),
          data: { active: false },
          timeout: 10_000,
        },
      );
      await ensureOk(deactivateRes);
    }
  }
});
