import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

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
  };
};

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('frontend smoke project chat ack targets (user/group/role) @extended', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const id = runId();
  const projectId = authState.projectIds[0];
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

  await navigateToSection(page, 'プロジェクトチャット');
  const chatSection = page
    .locator('main')
    .locator('h2', { hasText: 'プロジェクトチャット' })
    .locator('..');
  await chatSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    chatSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );

  await chatSection.getByPlaceholder('メッセージを書く').fill(ackMessage);
  await chatSection.getByPlaceholder('タグ (comma separated)').fill('e2e,ack');
  await chatSection
    .getByPlaceholder('確認対象ユーザID (comma separated)')
    .fill(targetUser);
  await chatSection
    .getByPlaceholder('確認対象グループID (comma separated)')
    .fill('mgmt');
  await chatSection
    .getByPlaceholder('確認対象ロール (comma separated)')
    .fill('admin');

  await chatSection.getByRole('button', { name: '対象者を確認' }).click();
  await expect(chatSection.getByText(/展開対象:\s*\d+人/)).toBeVisible({
    timeout: actionTimeout,
  });

  await chatSection.getByRole('button', { name: '確認依頼' }).click();
  const ackItem = chatSection.locator('li', { hasText: ackMessage });
  await expect(ackItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(ackItem).toBeVisible({ timeout: actionTimeout });
  await expect(ackItem.getByText('確認状況:')).toBeVisible({
    timeout: actionTimeout,
  });
});
