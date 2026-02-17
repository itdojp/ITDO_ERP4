import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return process.env.CI ? 30_000 : 12_000;
})();

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const adminAuthState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
};

const buildHeaders = (input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
}) => ({
  'x-user-id': input.userId,
  'x-roles': input.roles.join(','),
  'x-project-ids': (input.projectIds ?? []).join(','),
  'x-group-ids': (input.groupIds ?? []).join(','),
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page, authState = adminAuthState) {
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
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function findApprovalInstance(
  page: Page,
  flowType: string,
  targetId: string,
  headers: Record<string, string>,
) {
  let approvalInstanceId = '';
  let approvalStatus = '';
  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({ flowType });
        const listRes = await page.request.get(
          `${apiBase}/approval-instances?${query}`,
          { headers },
        );
        if (!listRes.ok()) return '';
        const payload = await listRes.json();
        const matched = (payload?.items ?? []).find(
          (item: any) => item?.targetId === targetId,
        );
        approvalInstanceId = typeof matched?.id === 'string' ? matched.id : '';
        approvalStatus = String(matched?.status ?? '');
        return approvalInstanceId;
      },
      { timeout: 5000 },
    )
    .not.toBe('');
  return { approvalInstanceId, approvalStatus };
}

async function approveInstanceUntilClosed(
  page: Page,
  approvalInstanceId: string,
  initialStatus: string,
  headers: Record<string, string>,
) {
  let approvalStatus = initialStatus;
  for (
    let i = 0;
    i < 5 &&
    (approvalStatus === 'pending_qa' ||
      approvalStatus === 'pending_exec' ||
      approvalStatus === 'pending_manager');
    i += 1
  ) {
    const actRes = await page.request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approvalInstanceId)}/act`,
      {
        data: { action: 'approve' },
        headers,
      },
    );
    await ensureOk(actRes);
    const acted = await actRes.json();
    approvalStatus = String(acted?.status ?? '');
  }
  return approvalStatus;
}

test('frontend admin jobs: chat ack reminder / leave upcoming run and dashboard reflection @extended', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await prepare(page);

  const suffix = runId();
  const leaveUserId = 'e2e-member-1@example.com';
  const leaveUserAuth = {
    userId: leaveUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  };
  const adminHeaders = buildHeaders(adminAuthState);
  const leaveUserHeaders = buildHeaders(leaveUserAuth);

  const ensureMemberRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members`,
    {
      headers: adminHeaders,
      data: { userId: leaveUserId, role: 'member' },
    },
  );
  await ensureOk(ensureMemberRes);

  const clearMuteRes = await page.request.patch(
    `${apiBase}/notification-preferences`,
    {
      headers: leaveUserHeaders,
      data: { muteAllUntil: null },
    },
  );
  await ensureOk(clearMuteRes);

  const unreadBeforeRes = await page.request.get(
    `${apiBase}/notifications?unread=1&limit=200`,
    { headers: leaveUserHeaders },
  );
  await ensureOk(unreadBeforeRes);
  const unreadBefore = await unreadBeforeRes.json();
  for (const item of unreadBefore?.items ?? []) {
    if (!item?.id) continue;
    const markReadRes = await page.request.post(
      `${apiBase}/notifications/${encodeURIComponent(item.id)}/read`,
      {
        headers: leaveUserHeaders,
        data: {},
      },
    );
    await ensureOk(markReadRes);
  }

  const overdueDueAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const ackCreateRes = await page.request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-requests`,
    {
      headers: adminHeaders,
      data: {
        body: `e2e admin-jobs ack reminder ${suffix}`,
        requiredUserIds: [leaveUserId],
        dueAt: overdueDueAt,
      },
    },
  );
  await ensureOk(ackCreateRes);

  const leaveDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const leaveCreateRes = await page.request.post(`${apiBase}/leave-requests`, {
    headers: leaveUserHeaders,
    data: {
      userId: leaveUserId,
      leaveType: 'paid',
      startDate: leaveDate,
      endDate: leaveDate,
      notes: `e2e leave upcoming ${suffix}`,
    },
  });
  await ensureOk(leaveCreateRes);
  const leave = await leaveCreateRes.json();
  const leaveId = String(leave?.id || '');
  expect(leaveId.length).toBeGreaterThan(0);

  const leaveSubmitRes = await page.request.post(
    `${apiBase}/leave-requests/${encodeURIComponent(leaveId)}/submit`,
    {
      headers: leaveUserHeaders,
      data: {},
    },
  );
  await ensureOk(leaveSubmitRes);

  const leaveApproval = await findApprovalInstance(
    page,
    'leave',
    leaveId,
    adminHeaders,
  );
  const leaveApprovalStatus = await approveInstanceUntilClosed(
    page,
    leaveApproval.approvalInstanceId,
    leaveApproval.approvalStatus,
    adminHeaders,
  );
  expect(leaveApprovalStatus).toBe('approved');

  await navigateToSection(page, 'ジョブ管理', '運用ジョブ');
  const jobsSection = page
    .locator('main')
    .locator('h2', { hasText: '運用ジョブ' })
    .locator('..');
  await jobsSection.scrollIntoViewIfNeeded();

  const chatAckDryRunCheckbox = jobsSection
    .locator('label', { hasText: '確認依頼リマインド dryRun' })
    .locator('input[type="checkbox"]');
  await chatAckDryRunCheckbox.check();

  await jobsSection.getByLabel('ジョブ検索').fill('確認依頼リマインド');
  const chatAckRow = jobsSection.locator('tbody tr', {
    hasText: '確認依頼リマインド',
  });
  await expect(chatAckRow).toHaveCount(1, { timeout: actionTimeout });
  await chatAckRow.getByRole('button', { name: '実行' }).click();
  await expect
    .poll(
      () =>
        chatAckRow
          .innerText()
          .then((text) => /完了|実行中/.test(text))
          .catch(() => false),
      { timeout: actionTimeout },
    )
    .toBe(true);
  await chatAckRow.getByRole('button', { name: '詳細' }).click();

  const resultDialog = page.getByRole('dialog');
  await expect(
    resultDialog.getByRole('heading', {
      name: /ジョブ結果: 確認依頼リマインド/,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  const chatAckResultText = await resultDialog.locator('pre').innerText();
  const chatAckResult = JSON.parse(chatAckResultText) as {
    ok?: boolean;
    dryRun?: boolean;
    candidateNotifications?: number;
  };
  expect(chatAckResult.ok).toBe(true);
  expect(chatAckResult.dryRun).toBe(true);
  expect(Number(chatAckResult.candidateNotifications ?? 0)).toBeGreaterThan(0);
  await resultDialog.getByRole('button', { name: '閉じる' }).click();
  await expect(resultDialog).toBeHidden({ timeout: actionTimeout });

  const leaveDryRunCheckbox = jobsSection
    .locator('label', { hasText: '休暇予定通知 dryRun' })
    .locator('input[type="checkbox"]');
  await leaveDryRunCheckbox.uncheck();
  await jobsSection.getByPlaceholder('休暇対象日 YYYY-MM-DD').fill(leaveDate);
  await jobsSection.getByLabel('ジョブ検索').fill('休暇予定通知');
  const leaveRow = jobsSection.locator('tbody tr', { hasText: '休暇予定通知' });
  await expect(leaveRow).toHaveCount(1, { timeout: actionTimeout });
  await leaveRow.getByRole('button', { name: '実行' }).click();
  await expect
    .poll(
      () =>
        leaveRow
          .innerText()
          .then((text) => /完了|実行中/.test(text))
          .catch(() => false),
      { timeout: actionTimeout },
    )
    .toBe(true);
  await leaveRow.getByRole('button', { name: '詳細' }).click();

  await expect(
    resultDialog.getByRole('heading', { name: /ジョブ結果: 休暇予定通知/ }),
  ).toBeVisible({ timeout: actionTimeout });
  const leaveResultText = await resultDialog.locator('pre').innerText();
  const leaveResult = JSON.parse(leaveResultText) as {
    ok?: boolean;
    dryRun?: boolean;
    targetDate?: string;
    matchedCount?: number;
    createdNotifications?: number;
  };
  expect(leaveResult.ok).toBe(true);
  expect(leaveResult.dryRun).toBe(false);
  expect(leaveResult.targetDate).toBe(leaveDate);
  expect(Number(leaveResult.matchedCount ?? 0)).toBeGreaterThan(0);
  expect(Number(leaveResult.createdNotifications ?? 0)).toBeGreaterThan(0);
  await resultDialog.getByRole('button', { name: '閉じる' }).click();
  await expect(resultDialog).toBeHidden({ timeout: actionTimeout });

  await expect
    .poll(
      async () => {
        const listRes = await page.request.get(
          `${apiBase}/notifications?unread=1&limit=50`,
          {
            headers: leaveUserHeaders,
          },
        );
        if (!listRes.ok()) return false;
        const payload = await listRes.json();
        return (payload?.items ?? []).some(
          (item: any) =>
            item?.kind === 'leave_upcoming' && item?.messageId === leaveId,
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);

  const leaveUserPage = await context.newPage();
  await prepare(leaveUserPage, leaveUserAuth);
  await expect(
    leaveUserPage.getByText('休暇予定', { exact: false }),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await leaveUserPage.close();
});
