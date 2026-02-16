import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const actionTimeout = process.env.CI ? 30_000 : 12_000;

type AuthState = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
};

type ApprovalStep = {
  id: string;
  stepOrder: number;
  status: string;
  approverUserId?: string | null;
  approverGroupId?: string | null;
};

type ApprovalInstance = {
  id: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  status: string;
  currentStep?: number | null;
  steps?: ApprovalStep[];
};

type AppNotification = {
  id: string;
  kind: string;
  messageId?: string | null;
  payload?: unknown;
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const buildHeaders = (state: AuthState) => ({
  'x-user-id': state.userId,
  'x-roles': state.roles.join(','),
  'x-project-ids': (state.projectIds ?? []).join(','),
  'x-group-ids': (state.groupIds ?? []).join(','),
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page, authState: AuthState) {
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible({
    timeout: actionTimeout,
  });
}

async function openHome(page: Page) {
  await page.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: 'Dashboard', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function listUnreadNotifications(
  page: Page,
  headers: Record<string, string>,
) {
  const res = await page.request.get(`${apiBase}/notifications?unread=1&limit=200`, {
    headers,
  });
  await ensureOk(res);
  const payload = (await res.json()) as { items?: AppNotification[] };
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function findCompanyRoomId(page: Page, headers: Record<string, string>) {
  const roomRes = await page.request.get(`${apiBase}/chat-rooms`, { headers });
  await ensureOk(roomRes);
  const roomPayload = (await roomRes.json()) as {
    items?: Array<{ id?: string; type?: string }>;
  };
  const companyRoom = (roomPayload.items ?? []).find(
    (item) => item?.type === 'company' && item?.id,
  );
  if (!companyRoom?.id) {
    throw new Error('[e2e] company room not found');
  }
  return companyRoom.id;
}

async function findApprovalInstance(
  page: Page,
  adminHeaders: Record<string, string>,
  flowType: string,
  targetTable: string,
  targetId: string,
) {
  const res = await page.request.get(
    `${apiBase}/approval-instances?flowType=${encodeURIComponent(flowType)}`,
    { headers: adminHeaders },
  );
  await ensureOk(res);
  const payload = (await res.json()) as { items?: ApprovalInstance[] };
  const item = (payload.items ?? []).find(
    (instance) =>
      instance?.targetTable === targetTable &&
      instance?.targetId === targetId &&
      instance?.status !== 'cancelled' &&
      instance?.status !== 'rejected',
  );
  if (!item?.id) {
    throw new Error(
      `[e2e] approval instance missing: ${flowType}/${targetTable}/${targetId}`,
    );
  }
  return item;
}

function isPendingStatus(value: string | null | undefined) {
  return value === 'pending_qa' || value === 'pending_exec';
}

async function approveUntilApproved(
  page: Page,
  adminHeaders: Record<string, string>,
  flowType: string,
  targetTable: string,
  targetId: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const instance = await findApprovalInstance(
      page,
      adminHeaders,
      flowType,
      targetTable,
      targetId,
    );
    if (instance.status === 'approved') return;
    if (!instance.currentStep || !Array.isArray(instance.steps)) {
      throw new Error(
        `[e2e] approval has no actionable step: ${JSON.stringify(instance)}`,
      );
    }
    const actionable = instance.steps.find(
      (step) =>
        step.stepOrder === instance.currentStep && isPendingStatus(step.status),
    );
    if (!actionable) {
      throw new Error(
        `[e2e] actionable step not found: ${JSON.stringify(instance)}`,
      );
    }

    const actorUserId =
      actionable.approverUserId?.trim() || `e2e-approver-${runId()}-${attempt}`;
    const actorGroupIds = actionable.approverGroupId?.trim()
      ? [actionable.approverGroupId.trim(), 'mgmt']
      : ['mgmt'];
    const actorHeaders = buildHeaders({
      userId: actorUserId,
      roles: ['mgmt'],
      groupIds: actorGroupIds,
    });
    const actRes = await page.request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(instance.id)}/act`,
      {
        headers: actorHeaders,
        data: { action: 'approve' as const },
      },
    );
    if (!actRes.ok()) {
      const body = await actRes.text();
      throw new Error(
        `[e2e] approval act failed: ${actRes.status()} ${body} (instance=${instance.id})`,
      );
    }
  }
  throw new Error(
    `[e2e] approval did not complete: ${flowType}/${targetTable}/${targetId}`,
  );
}

async function installOpenEventRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as typeof window & {
      __e2eOpenEvents?: Array<{ kind?: string; id?: string }>;
      __e2eOpenEventsInstalled?: boolean;
    };
    if (w.__e2eOpenEventsInstalled) return;
    w.__e2eOpenEventsInstalled = true;
    w.__e2eOpenEvents = [];
    window.addEventListener('erp4_open_entity', (event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: string }>)
        .detail;
      w.__e2eOpenEvents?.push({
        kind: typeof detail?.kind === 'string' ? detail.kind : undefined,
        id: typeof detail?.id === 'string' ? detail.id : undefined,
      });
    });
    window.addEventListener('erp4_open_chat_message', (event) => {
      const detail = (event as CustomEvent<{ messageId?: string }>).detail;
      w.__e2eOpenEvents?.push({
        kind: 'chat_message',
        id: typeof detail?.messageId === 'string' ? detail.messageId : undefined,
      });
    });
  });
}

async function resetOpenEventRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as typeof window & {
      __e2eOpenEvents?: Array<{ kind?: string; id?: string }>;
    };
    w.__e2eOpenEvents = [];
  });
}

async function expectOpenEventRecorded(page: Page, kind: string, id: string) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          ([expectedKind, expectedId]) => {
            const w = window as typeof window & {
              __e2eOpenEvents?: Array<{ kind?: string; id?: string }>;
            };
            const events = Array.isArray(w.__e2eOpenEvents)
              ? w.__e2eOpenEvents
              : [];
            return events.some(
              (entry) =>
                entry?.kind === expectedKind && entry?.id === expectedId,
            );
          },
          [kind, id],
        ),
      { timeout: actionTimeout },
    )
    .toBe(true);
}

test('dashboard notification cards route to chat/leave/expense targets @core', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = runId();
  const targetUserId = `e2e-dash-notify-${run}@example.com`;
  const chatTargetUserId = 'e2e-member-2@example.com';
  const leaveDate = `2099-01-${String((Number(run.slice(0, 2)) % 20) + 1).padStart(2, '0')}`;
  const expenseAmount = 50_000 + (Number(run.slice(0, 3)) % 9_000);
  const ackBody = `E2E dashboard ack ${run}`;

  const adminState: AuthState = {
    userId: 'demo-user',
    roles: ['admin', 'mgmt'],
    projectIds: [defaultProjectId],
    groupIds: ['mgmt', 'hr-group'],
  };
  const targetState: AuthState = {
    userId: targetUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
    groupIds: [],
  };
  const chatTargetState: AuthState = {
    userId: chatTargetUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
    groupIds: [],
  };
  const adminHeaders = buildHeaders(adminState);
  const targetHeaders = buildHeaders(targetState);
  const chatTargetHeaders = buildHeaders(chatTargetState);

  await prepare(page, targetState);

  // leave_upcoming notification
  const leaveCreateRes = await page.request.post(`${apiBase}/leave-requests`, {
    headers: targetHeaders,
    data: {
      userId: targetUserId,
      leaveType: 'paid',
      startDate: leaveDate,
      endDate: leaveDate,
      notes: `e2e leave ${run}`,
    },
  });
  await ensureOk(leaveCreateRes);
  const leavePayload = (await leaveCreateRes.json()) as { id?: string };
  const leaveRequestId = String(leavePayload?.id || '');
  expect(leaveRequestId.length).toBeGreaterThan(0);

  const leaveSubmitRes = await page.request.post(
    `${apiBase}/leave-requests/${encodeURIComponent(leaveRequestId)}/submit`,
    { headers: targetHeaders, data: {} },
  );
  await ensureOk(leaveSubmitRes);
  await approveUntilApproved(
    page,
    adminHeaders,
    'leave',
    'leave_requests',
    leaveRequestId,
  );

  const leaveJobRes = await page.request.post(`${apiBase}/jobs/leave-upcoming/run`, {
    headers: adminHeaders,
    data: { targetDate: leaveDate },
  });
  await ensureOk(leaveJobRes);
  const leaveNotification = (
    await listUnreadNotifications(page, targetHeaders)
  ).find(
    (item) => item.kind === 'leave_upcoming' && item.messageId === leaveRequestId,
  );
  expect(leaveNotification?.id).toBeTruthy();

  // expense_mark_paid notification
  const expenseCreateRes = await page.request.post(`${apiBase}/expenses`, {
    headers: targetHeaders,
    data: {
      projectId: defaultProjectId,
      userId: targetUserId,
      category: 'travel',
      amount: expenseAmount,
      currency: 'JPY',
      incurredOn: '2099-02-01',
      isShared: false,
    },
  });
  await ensureOk(expenseCreateRes);
  const expensePayload = (await expenseCreateRes.json()) as { id?: string };
  const expenseId = String(expensePayload?.id || '');
  expect(expenseId.length).toBeGreaterThan(0);

  const expenseSubmitRes = await page.request.post(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/submit`,
    { headers: targetHeaders, data: {} },
  );
  await ensureOk(expenseSubmitRes);
  await approveUntilApproved(page, adminHeaders, 'expense', 'expenses', expenseId);

  const markPaidRes = await page.request.post(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/mark-paid`,
    { headers: adminHeaders, data: {} },
  );
  await ensureOk(markPaidRes);
  const expenseNotification = (
    await listUnreadNotifications(page, targetHeaders)
  ).find(
    (item) => item.kind === 'expense_mark_paid' && item.messageId === expenseId,
  );
  expect(expenseNotification?.id).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible({
    timeout: actionTimeout,
  });
  await openHome(page);
  await installOpenEventRecorder(page);
  const dashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const leaveItem = dashboardSection
    .locator('strong', { hasText: '休暇予定' })
    .locator('xpath=ancestor::div[2]')
    .first();
  await expect(leaveItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await leaveItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'leave_request', leaveRequestId);
  await expect(
    page.locator('main').getByRole('heading', { name: '休暇', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });

  await openHome(page);
  const expenseItem = dashboardSection
    .locator('strong', { hasText: '経費支払完了' })
    .locator('xpath=ancestor::div[2]')
    .first();
  await expect(expenseItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await expenseItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'expense', expenseId);
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '経費入力', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });

  // chat_ack_required notification (active user account is required)
  await prepare(page, chatTargetState);
  const companyRoomId = await findCompanyRoomId(page, adminHeaders);
  const ackRes = await page.request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(companyRoomId)}/ack-requests`,
    {
      headers: adminHeaders,
      data: {
        body: ackBody,
        requiredUserIds: [chatTargetUserId],
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        tags: ['e2e', 'dashboard', 'notification-card'],
      },
    },
  );
  await ensureOk(ackRes);
  const ackPayload = (await ackRes.json()) as { id?: string };
  const ackMessageId = String(ackPayload?.id || '');
  expect(ackMessageId.length).toBeGreaterThan(0);
  const ackNotification = (
    await listUnreadNotifications(page, chatTargetHeaders)
  ).find(
    (item) => item.kind === 'chat_ack_required' && item.messageId === ackMessageId,
  );
  expect(ackNotification?.id).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible({
    timeout: actionTimeout,
  });
  await openHome(page);
  await installOpenEventRecorder(page);
  const chatDashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const chatItem = chatDashboardSection
    .getByText(ackBody, { exact: false })
    .locator('xpath=ancestor::div[2]')
    .first();
  await expect(chatItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await chatItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'chat_message', ackMessageId);
  await expect(
    page
      .locator('main')
      .getByRole('heading', {
        name: 'チャット（全社/部門/private_group/DM）',
        level: 2,
        exact: true,
      }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(page.locator('main').getByText(ackBody)).toBeVisible({
    timeout: actionTimeout,
  });
});
