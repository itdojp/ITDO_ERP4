import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  // Keep CI slightly more tolerant to reduce flakiness on loaded runners.
  return process.env.CI ? 15_000 : 8000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

const authHeaders = {
  'x-user-id': authState.userId,
  'x-roles': authState.roles.join(','),
  'x-project-ids': authState.projectIds.join(','),
  'x-group-ids': authState.groupIds.join(','),
};

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page) {
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
  }, authState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label }).click();
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

test('task to time entry link @core', async ({ page, request }) => {
  const suffix = runId();
  const taskName = `E2E Task ${suffix}`;
  const projectId = authState.projectIds[0];

  await prepare(page);

  await navigateToSection(page, 'タスク');
  const taskSection = page
    .locator('main')
    .locator('h2', { hasText: 'タスク' })
    .locator('..');
  await taskSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    taskSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  await taskSection.getByLabel('タスク名').fill(taskName);
  await taskSection.getByRole('button', { name: /^作成$/ }).click();
  await expect(taskSection.getByText('作成しました')).toBeVisible();
  await expect(
    taskSection.locator('ul.list li', { hasText: taskName }).first(),
  ).toBeVisible();

  const tasksRes = await request.get(`${apiBase}/projects/${projectId}/tasks`, {
    headers: authHeaders,
  });
  await ensureOk(tasksRes);
  const tasksJson = await tasksRes.json();
  const tasks = Array.isArray(tasksJson.items) ? tasksJson.items : [];
  const createdTask = tasks.find((item: any) => item.name === taskName);
  expect(createdTask).toBeTruthy();

  await navigateToSection(page, '工数入力');
  const timeSection = page
    .locator('main')
    .locator('h2', { hasText: '工数入力' })
    .locator('..');
  await timeSection.scrollIntoViewIfNeeded();
  await selectByLabelOrFirst(
    timeSection.getByLabel('案件選択'),
    'PRJ-DEMO-1 / Demo Project 1',
  );
  const taskSelect = timeSection.getByLabel('タスク選択');
  await expect
    .poll(() => taskSelect.locator('option', { hasText: taskName }).count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await timeSection.getByLabel('タスク選択').selectOption({ label: taskName });
  await timeSection.locator('input[type="number"]').fill('75');
  await timeSection.getByRole('button', { name: '追加' }).click();
  await expect(timeSection.getByText('保存しました')).toBeVisible();

  const timeRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(authState.userId)}`,
    { headers: authHeaders },
  );
  await ensureOk(timeRes);
  const timeJson = await timeRes.json();
  const timeItems = Array.isArray(timeJson.items) ? timeJson.items : [];
  expect(
    timeItems.some(
      (item: any) =>
        item.minutes === 75 &&
        item.taskId === createdTask.id &&
        item.projectId === projectId,
    ),
  ).toBe(true);
});
