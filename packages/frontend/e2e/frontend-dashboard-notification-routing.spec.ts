import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const actionTimeoutEnv = process.env.E2E_ACTION_TIMEOUT_MS;
const actionTimeout =
  actionTimeoutEnv != null &&
  !Number.isNaN(Number.parseInt(actionTimeoutEnv, 10))
    ? Number.parseInt(actionTimeoutEnv, 10)
    : process.env.CI
      ? 30_000
      : 12_000;

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
  if (page.listenerCount('pageerror') === 0) {
    page.on('pageerror', (error) => {
      console.error('[dashboard-notification-routing] pageerror:', error);
    });
  }
  if (page.listenerCount('console') === 0) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(
          '[dashboard-notification-routing] console.error:',
          msg.text(),
        );
      }
    });
  }

  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
}

async function openHome(page: Page) {
  await page.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: 'Dashboard', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

function resolveAlertsUi(dashboardSection: Locator) {
  const alertsBadge = dashboardSection.getByTestId('dashboard-alerts-badge');
  const alertsList = dashboardSection.getByTestId('dashboard-alerts-list');
  return { alertsBadge, alertsList };
}

async function listUnreadNotifications(
  page: Page,
  headers: Record<string, string>,
) {
  const res = await page.request.get(
    `${apiBase}/notifications?unread=1&limit=200`,
    {
      headers,
    },
  );
  await ensureOk(res);
  const payload = (await res.json()) as { items?: AppNotification[] };
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function markNotificationRead(
  page: Page,
  headers: Record<string, string>,
  notificationId: string,
) {
  const res = await page.request.post(
    `${apiBase}/notifications/${encodeURIComponent(notificationId)}/read`,
    { headers, data: {} },
  );
  await ensureOk(res);
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
  runSeed: string,
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
      actionable.approverUserId?.trim() || `e2e-approver-${runSeed}-${attempt}`;
    const actorGroupIds = actionable.approverGroupId?.trim()
      ? [actionable.approverGroupId.trim(), 'mgmt']
      : ['mgmt'];
    const actorHeaders = buildHeaders({
      userId: actorUserId,
      roles: ['mgmt'],
      groupIds: actorGroupIds,
    });
    if (flowType === 'expense' && instance.status === 'pending_qa') {
      const checklistRes = await page.request.put(
        `${apiBase}/expenses/${encodeURIComponent(targetId)}/qa-checklist`,
        {
          headers: actorHeaders,
          data: {
            amountVerified: true,
            receiptVerified: true,
            journalPrepared: true,
            projectLinked: true,
            budgetChecked: true,
          },
        },
      );
      if (!checklistRes.ok()) {
        throw new Error(
          `[e2e] expense checklist failed: ${checklistRes.status()} ${await checklistRes.text()} (target=${targetId})`,
        );
      }
    }
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
        id:
          typeof detail?.messageId === 'string' ? detail.messageId : undefined,
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

async function waitForUnreadNotification(
  page: Page,
  headers: Record<string, string>,
  predicate: (item: AppNotification) => boolean,
): Promise<AppNotification> {
  let found: AppNotification | undefined;
  await expect
    .poll(
      async () => {
        const items = await listUnreadNotifications(page, headers);
        found = items.find(predicate);
        return Boolean(found?.id);
      },
      { timeout: actionTimeout },
    )
    .toBe(true);
  if (!found) {
    throw new Error('[e2e] notification not found');
  }
  return found;
}

test('dashboard notification cards route to chat/leave/expense targets @core', async ({
  page,
}) => {
  // This scenario executes multiple workflow transitions; keep the timeout conservative.
  test.setTimeout(actionTimeout * 6);
  const run = runId();
  const targetUserId = `e2e-dash-notify-${run}@example.com`;
  const chatTargetUserId = 'e2e-member-2@example.com';
  const runNumeric = Array.from(run).reduce(
    (sum, ch) => sum + ch.charCodeAt(0),
    0,
  );
  const leaveDate = `2099-01-${String((runNumeric % 28) + 1).padStart(2, '0')}`;
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
    run,
  );

  const leaveJobRes = await page.request.post(
    `${apiBase}/jobs/leave-upcoming/run`,
    {
      headers: adminHeaders,
      data: { targetDate: leaveDate },
    },
  );
  await ensureOk(leaveJobRes);
  const leaveNotification = await waitForUnreadNotification(
    page,
    targetHeaders,
    (item) =>
      item.kind === 'leave_upcoming' && item.messageId === leaveRequestId,
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
      receiptUrl: `https://example.com/receipts/${run}`,
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
  await approveUntilApproved(
    page,
    adminHeaders,
    'expense',
    'expenses',
    expenseId,
    run,
  );

  const markPaidRes = await page.request.post(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/mark-paid`,
    { headers: adminHeaders, data: {} },
  );
  await ensureOk(markPaidRes);
  const expenseNotification = await waitForUnreadNotification(
    page,
    targetHeaders,
    (item) => item.kind === 'expense_mark_paid' && item.messageId === expenseId,
  );
  expect(expenseNotification?.id).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  await openHome(page);
  await installOpenEventRecorder(page);
  const dashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const leaveItem = dashboardSection
    .locator('strong', { hasText: '休暇予定' })
    .locator('..')
    .locator('..');
  await expect(leaveItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(leaveItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await leaveItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'leave_request', leaveRequestId);
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '休暇', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  await markNotificationRead(page, targetHeaders, leaveNotification.id);

  await openHome(page);
  const dashboardSectionAfterHome = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const expenseItem = dashboardSectionAfterHome
    .locator('strong', {
      hasText: '経費支払完了',
    })
    .locator('..')
    .locator('..');
  await expect(expenseItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(expenseItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await expenseItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'expense', expenseId);
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '経費入力', level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
  await markNotificationRead(page, targetHeaders, expenseNotification.id);

  // chat_ack_required notification (active user account is required)
  await prepare(page, chatTargetState);
  // prepare() navigates to baseUrl and resets window context, so recorder is reinstalled later.
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
  const ackNotification = await waitForUnreadNotification(
    page,
    chatTargetHeaders,
    (item) =>
      item.kind === 'chat_ack_required' && item.messageId === ackMessageId,
  );
  expect(ackNotification?.id).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  await openHome(page);
  await installOpenEventRecorder(page);
  const chatDashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const chatItem = chatDashboardSection
    .getByText(ackBody, { exact: false })
    .locator('..')
    .locator('..');
  await expect(chatItem).toHaveCount(1, { timeout: actionTimeout });
  await expect(chatItem).toBeVisible({ timeout: actionTimeout });
  await resetOpenEventRecorder(page);
  await chatItem.getByRole('button', { name: '開く' }).click();
  await expectOpenEventRecorded(page, 'chat_message', ackMessageId);
  await expect(
    page.locator('main').getByRole('heading', {
      name: 'チャット（全社/部門/private_group/DM）',
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(page.locator('main').getByText(ackBody)).toBeVisible({
    timeout: actionTimeout,
  });
  await markNotificationRead(page, chatTargetHeaders, ackNotification.id);
});

test('dashboard alert cards show latest5 and empty placeholder @extended', async ({
  page,
}) => {
  test.setTimeout(actionTimeout * 3);
  const adminState: AuthState = {
    userId: 'demo-user',
    roles: ['admin', 'mgmt'],
    projectIds: [defaultProjectId],
    groupIds: ['mgmt', 'hr-group'],
  };
  const buildAlertItems = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `e2e-alert-${index + 1}`,
      type: 'budget_overrun',
      targetRef: `${defaultProjectId}-${index + 1}`,
      status: 'open',
      sentChannels: ['dashboard'],
      triggeredAt: new Date(Date.now() - index * 60_000).toISOString(),
    }));
  const routePattern = '**/alerts';
  const alertItems = buildAlertItems(6);

  await page.route(routePattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: alertItems }),
    });
  });
  await prepare(page, adminState);
  await openHome(page);

  const dashboardSection = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const { alertsBadge, alertsList } = resolveAlertsUi(dashboardSection);
  const alertTypeLabels = alertsList.locator('strong', {
    hasText: 'budget_overrun',
  });

  await expect(alertsBadge).toContainText('最新5件');
  await expect(alertTypeLabels).toHaveCount(5, { timeout: actionTimeout });
  const showAllButton = dashboardSection.getByRole('button', {
    name: 'すべて表示',
  });
  await expect(showAllButton).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await showAllButton.click();
  await expect(alertsBadge).toContainText('全6件');
  await expect(alertTypeLabels).toHaveCount(6, { timeout: actionTimeout });

  const latestOnlyButton = dashboardSection.getByRole('button', {
    name: '最新のみ',
  });
  await expect(latestOnlyButton).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await latestOnlyButton.click();
  await expect(alertsBadge).toContainText('最新5件');
  await expect(alertTypeLabels).toHaveCount(5, { timeout: actionTimeout });

  await page.unroute(routePattern);
  await page.route(routePattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    {
      timeout: actionTimeout,
    },
  );
  await openHome(page);

  const dashboardSectionEmpty = page
    .locator('main')
    .locator('h2', { hasText: 'Dashboard' })
    .locator('..');
  const { alertsBadge: emptyBadge, alertsList: emptyList } = resolveAlertsUi(
    dashboardSectionEmpty,
  );
  await expect(emptyBadge).toContainText('最新0件');
  await expect(emptyList.locator('strong')).toHaveCount(0, {
    timeout: actionTimeout,
  });
  await expect(emptyList.getByText('アラートなし')).toBeVisible({
    timeout: actionTimeout,
  });
});
