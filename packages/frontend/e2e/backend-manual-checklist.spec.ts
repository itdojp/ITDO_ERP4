import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';
const defaultVendorId = '00000000-0000-0000-0000-000000000010';

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

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

const adminHeaders = buildHeaders({
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: [defaultProjectId],
  groupIds: ['mgmt', 'hr-group'],
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('backend manual checklist: documents & send logs @extended', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-API-${suffix}`,
      name: `E2E API Project ${suffix}`,
      status: 'active',
    },
    headers: adminHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectId = project.id as string;

  const estimateRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      data: { totalAmount: 120000, notes: `E2E estimate ${suffix}` },
      headers: adminHeaders,
    },
  );
  await ensureOk(estimateRes);

  const invoiceRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/invoices`,
    {
      data: { totalAmount: 150000 },
      headers: adminHeaders,
    },
  );
  await ensureOk(invoiceRes);
  const invoice = await invoiceRes.json();
  const invoiceId = invoice.id as string;

  const sendRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoiceId)}/send`,
    { headers: adminHeaders },
  );
  await ensureOk(sendRes);

  const sendLogsRes = await request.get(
    `${apiBase}/invoices/${encodeURIComponent(invoiceId)}/send-logs`,
    { headers: adminHeaders },
  );
  await ensureOk(sendLogsRes);
  const sendLogsPayload = await sendLogsRes.json();
  const sendLogId = (sendLogsPayload?.items ?? [])[0]?.id as string | undefined;
  expect(sendLogId).toBeTruthy();

  const docLogRes = await request.get(
    `${apiBase}/document-send-logs/${encodeURIComponent(sendLogId!)}`,
    { headers: adminHeaders },
  );
  await ensureOk(docLogRes);

  const docEventsRes = await request.get(
    `${apiBase}/document-send-logs/${encodeURIComponent(sendLogId!)}/events`,
    { headers: adminHeaders },
  );
  await ensureOk(docEventsRes);

  const retryRes = await request.post(
    `${apiBase}/document-send-logs/${encodeURIComponent(sendLogId!)}/retry`,
    { headers: adminHeaders },
  );
  if (!retryRes.ok()) {
    expect([400, 429]).toContain(retryRes.status());
  }
});

test('backend manual checklist: alerts/templates/reports jobs @extended', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();

  const templatesRes = await request.get(`${apiBase}/pdf-templates`, {
    headers: adminHeaders,
  });
  await ensureOk(templatesRes);
  const templatesPayload = await templatesRes.json();
  const invoiceTemplate = (templatesPayload?.items ?? []).find(
    (item: any) => item?.kind === 'invoice',
  );
  expect(invoiceTemplate?.id).toBeTruthy();
  const templateDetailRes = await request.get(
    `${apiBase}/pdf-templates/${encodeURIComponent(invoiceTemplate.id)}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(templateDetailRes);
  const templateDetail = await templateDetailRes.json();
  expect(templateDetail?.id).toBe(invoiceTemplate.id);

  const templateSettingRes = await request.post(
    `${apiBase}/template-settings`,
    {
      data: {
        kind: 'invoice',
        templateId: invoiceTemplate.id,
        numberRule: `PYYYY-MM-NNNN-${suffix}`,
        isDefault: true,
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(templateSettingRes);
  const templateSetting = await templateSettingRes.json();
  expect(templateSetting?.id).toBeTruthy();

  const templateListRes = await request.get(
    `${apiBase}/template-settings?kind=invoice`,
    { headers: adminHeaders },
  );
  await ensureOk(templateListRes);
  const templateListPayload = await templateListRes.json();
  const templateExists = (templateListPayload?.items ?? []).some(
    (item: any) => item?.id === templateSetting.id,
  );
  expect(templateExists).toBeTruthy();
  const updatedNumberRule = `PYYYY-MM-NNNN-${suffix.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const templatePatchRes = await request.patch(
    `${apiBase}/template-settings/${encodeURIComponent(templateSetting.id)}`,
    {
      data: { numberRule: updatedNumberRule },
      headers: adminHeaders,
    },
  );
  await ensureOk(templatePatchRes);
  const patchedTemplate = await templatePatchRes.json();
  expect(String(patchedTemplate?.numberRule ?? '')).toContain(
    updatedNumberRule,
  );

  const alertRes = await request.post(`${apiBase}/alert-settings`, {
    data: {
      type: 'budget_overrun',
      threshold: 10,
      period: 'monthly',
      recipients: { roles: ['mgmt'] },
      channels: ['dashboard'],
      remindAfterHours: 24,
      remindMaxCount: 2,
    },
    headers: adminHeaders,
  });
  await ensureOk(alertRes);
  const alertSetting = await alertRes.json();
  expect(alertSetting?.id).toBeTruthy();

  const alertPatchRes = await request.patch(
    `${apiBase}/alert-settings/${encodeURIComponent(alertSetting.id)}`,
    {
      data: { threshold: 20 },
      headers: adminHeaders,
    },
  );
  await ensureOk(alertPatchRes);

  const alertJobRes = await request.post(`${apiBase}/jobs/alerts/run`, {
    headers: adminHeaders,
  });
  await ensureOk(alertJobRes);
  const alertJobPayload = await alertJobRes.json();
  expect(alertJobPayload.ok).toBeTruthy();

  const approvalJobRes = await request.post(
    `${apiBase}/jobs/approval-escalations/run`,
    { headers: adminHeaders },
  );
  await ensureOk(approvalJobRes);
  const approvalJobPayload = await approvalJobRes.json();
  expect(approvalJobPayload.ok).toBeTruthy();

  const reportRes = await request.post(`${apiBase}/report-subscriptions`, {
    data: {
      name: `E2E report ${suffix}`,
      reportKey: 'project-effort',
      params: { projectId: defaultProjectId },
      recipients: { roles: ['mgmt'] },
      channels: ['dashboard'],
    },
    headers: adminHeaders,
  });
  await ensureOk(reportRes);
  const reportSubscription = await reportRes.json();
  expect(reportSubscription?.id).toBeTruthy();
  const reportListRes = await request.get(`${apiBase}/report-subscriptions`, {
    headers: adminHeaders,
  });
  await ensureOk(reportListRes);
  const reportListPayload = await reportListRes.json();
  const reportExists = (reportListPayload?.items ?? []).some(
    (item: any) => item?.id === reportSubscription.id,
  );
  expect(reportExists).toBeTruthy();
  const reportPatchRes = await request.patch(
    `${apiBase}/report-subscriptions/${encodeURIComponent(reportSubscription.id)}`,
    {
      data: { name: `E2E report patched ${suffix}` },
      headers: adminHeaders,
    },
  );
  await ensureOk(reportPatchRes);
  const patchedReport = await reportPatchRes.json();
  expect(String(patchedReport?.name ?? '')).toContain(`patched ${suffix}`);

  const reportRunRes = await request.post(
    `${apiBase}/report-subscriptions/${encodeURIComponent(
      reportSubscription.id,
    )}/run`,
    {
      data: { dryRun: false },
      headers: adminHeaders,
    },
  );
  await ensureOk(reportRunRes);
  const reportRunPayload = await reportRunRes.json();
  expect(Array.isArray(reportRunPayload.deliveries)).toBeTruthy();
  expect(reportRunPayload.deliveries.length).toBeGreaterThan(0);
  const reportDeliveryListRes = await request.get(
    `${apiBase}/report-deliveries?subscriptionId=${encodeURIComponent(
      reportSubscription.id,
    )}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(reportDeliveryListRes);
  const reportDeliveryPayload = await reportDeliveryListRes.json();
  const hasReportDelivery = (reportDeliveryPayload?.items ?? []).some(
    (item: any) => item?.subscriptionId === reportSubscription.id,
  );
  expect(hasReportDelivery).toBeTruthy();

  const reportJobRes = await request.post(
    `${apiBase}/jobs/report-subscriptions/run`,
    { data: { dryRun: true }, headers: adminHeaders },
  );
  await ensureOk(reportJobRes);
  const reportJobPayload = await reportJobRes.json();
  expect(reportJobPayload.ok).toBeTruthy();

  const reportRetryRes = await request.post(
    `${apiBase}/jobs/report-deliveries/retry`,
    { data: { dryRun: true }, headers: adminHeaders },
  );
  await ensureOk(reportRetryRes);
  const reportRetryPayload = await reportRetryRes.json();
  expect(reportRetryPayload.ok).toBeTruthy();
});

test('backend manual checklist: members/vendors/time/expenses/wellbeing @extended', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const findApprovalInstance = async (flowType: string, targetId: string) => {
    let approvalInstanceId = '';
    let approvalStatus = '';
    await expect
      .poll(
        async () => {
          const listRes = await request.get(
            `${apiBase}/approval-instances?flowType=${encodeURIComponent(flowType)}&projectId=${encodeURIComponent(defaultProjectId)}`,
            { headers: adminHeaders },
          );
          if (!listRes.ok()) return '';
          const payload = await listRes.json();
          const matched = (payload?.items ?? []).find(
            (item: any) => item?.targetId === targetId,
          );
          approvalInstanceId =
            typeof matched?.id === 'string' ? matched.id : '';
          approvalStatus = String(matched?.status ?? '');
          return approvalInstanceId;
        },
        { timeout: 5000 },
      )
      .not.toBe('');
    expect(approvalInstanceId).toBeTruthy();
    expect(approvalStatus.length).toBeGreaterThan(0);
    return { approvalInstanceId, approvalStatus };
  };
  const approveInstanceUntilClosed = async (
    approvalInstanceId: string,
    initialStatus: string,
  ) => {
    const maxApprovalTransitions = 8;
    let approvalStatus = initialStatus;
    for (
      let i = 0;
      i < maxApprovalTransitions &&
      (approvalStatus === 'pending_qa' || approvalStatus === 'pending_exec');
      i += 1
    ) {
      const actRes = await request.post(
        `${apiBase}/approval-instances/${encodeURIComponent(approvalInstanceId)}/act`,
        {
          data: { action: 'approve' },
          headers: adminHeaders,
        },
      );
      await ensureOk(actRes);
      const acted = await actRes.json();
      approvalStatus = String(acted?.status ?? '');
    }
    return approvalStatus;
  };
  const expectAuditAction = async (input: {
    action: string;
    targetTable?: string;
    targetId?: string;
  }) => {
    await expect
      .poll(
        async () => {
          const params = new URLSearchParams({
            action: input.action,
            format: 'json',
            mask: '0',
            limit: '50',
          });
          if (input.targetTable) params.set('targetTable', input.targetTable);
          if (input.targetId) params.set('targetId', input.targetId);
          const res = await request.get(`${apiBase}/audit-logs?${params}`, {
            headers: adminHeaders,
          });
          if (!res.ok()) return false;
          const payload = await res.json();
          return (
            (payload?.items ?? []).some(
              (item: any) =>
                item?.action === input.action &&
                (input.targetId ? item?.targetId === input.targetId : true),
            ) ?? false
          );
        },
        { timeout: 5000 },
      )
      .toBe(true);
  };

  const candidatesRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(
      defaultProjectId,
    )}/member-candidates?q=E2E`,
    { headers: adminHeaders },
  );
  await ensureOk(candidatesRes);
  const candidatesPayload = await candidatesRes.json();
  expect(Array.isArray(candidatesPayload.items)).toBeTruthy();

  const memberUserId = `e2e-member-${suffix}@example.com`;
  const memberRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members`,
    { data: { userId: memberUserId, role: 'member' }, headers: adminHeaders },
  );
  await ensureOk(memberRes);
  const memberHeaders = buildHeaders({
    userId: memberUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });

  const membersRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members`,
    { headers: adminHeaders },
  );
  await ensureOk(membersRes);
  const membersPayload = await membersRes.json();
  const memberExists = (membersPayload?.items ?? []).some(
    (item: any) => item?.userId === memberUserId,
  );
  expect(memberExists).toBeTruthy();

  const bulkRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members/bulk`,
    {
      data: {
        items: [
          { userId: `e2e-bulk-${suffix}-1@example.com`, role: 'member' },
          { userId: `e2e-bulk-${suffix}-2@example.com`, role: 'member' },
        ],
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(bulkRes);

  await expect
    .poll(
      async () => {
        const unreadCountRes = await request.get(
          `${apiBase}/notifications/unread-count`,
          { headers: memberHeaders },
        );
        if (!unreadCountRes.ok()) return 0;
        const payload = await unreadCountRes.json();
        return Number(payload?.unreadCount ?? 0);
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);

  const memberNotificationsRes = await request.get(
    `${apiBase}/notifications?unread=1&limit=200`,
    { headers: memberHeaders },
  );
  await ensureOk(memberNotificationsRes);
  const memberNotifications = await memberNotificationsRes.json();
  const memberAddedNotification = (memberNotifications?.items ?? []).find(
    (item: any) =>
      item?.kind === 'project_member_added' &&
      item?.projectId === defaultProjectId,
  );
  expect(memberAddedNotification?.id).toBeTruthy();

  const readNotificationRes = await request.post(
    `${apiBase}/notifications/${encodeURIComponent(memberAddedNotification.id)}/read`,
    { headers: memberHeaders },
  );
  await ensureOk(readNotificationRes);

  const memberNotificationsAfterReadRes = await request.get(
    `${apiBase}/notifications?unread=1&limit=200`,
    { headers: memberHeaders },
  );
  await ensureOk(memberNotificationsAfterReadRes);
  const memberNotificationsAfterRead =
    await memberNotificationsAfterReadRes.json();
  const isStillUnread = (memberNotificationsAfterRead?.items ?? []).some(
    (item: any) => item?.id === memberAddedNotification.id,
  );
  expect(isStillUnread).toBeFalsy();

  const deleteRes = await request.delete(
    `${apiBase}/projects/${encodeURIComponent(
      defaultProjectId,
    )}/members/${encodeURIComponent(memberUserId)}`,
    { headers: adminHeaders },
  );
  await ensureOk(deleteRes);

  const vendorQuoteRes = await request.post(`${apiBase}/vendor-quotes`, {
    data: {
      projectId: defaultProjectId,
      vendorId: defaultVendorId,
      quoteNo: `VQ-${suffix}`,
      totalAmount: 12000,
      currency: 'JPY',
      issueDate: '2026-01-02',
    },
    headers: adminHeaders,
  });
  await ensureOk(vendorQuoteRes);

  const vendorInvoiceRes = await request.post(`${apiBase}/vendor-invoices`, {
    data: {
      projectId: defaultProjectId,
      vendorId: defaultVendorId,
      vendorInvoiceNo: `VI-${suffix}`,
      totalAmount: 34000,
      currency: 'JPY',
      receivedDate: '2026-01-03',
      dueDate: '2026-01-31',
    },
    headers: adminHeaders,
  });
  await ensureOk(vendorInvoiceRes);
  const vendorInvoice = await vendorInvoiceRes.json();

  const purchaseOrderRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/purchase-orders`,
    {
      data: {
        vendorId: defaultVendorId,
        totalAmount: 12000,
        currency: 'JPY',
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(purchaseOrderRes);
  const purchaseOrder = await purchaseOrderRes.json();
  const purchaseOrderId = String(purchaseOrder?.id || '');
  expect(purchaseOrderId.length).toBeGreaterThan(0);

  const linkPoRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoice.id)}/link-po`,
    { data: { purchaseOrderId }, headers: adminHeaders },
  );
  await ensureOk(linkPoRes);

  const unlinkPoRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoice.id)}/unlink-po`,
    { headers: adminHeaders, data: {} },
  );
  await ensureOk(unlinkPoRes);

  const submitRes = await request.post(
    `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoice.id)}/submit`,
    { headers: adminHeaders },
  );
  await ensureOk(submitRes);
  const submittedVendorInvoice = await submitRes.json();
  expect(submittedVendorInvoice?.status).toBe('pending_qa');

  const vendorApproval = await findApprovalInstance(
    'vendor_invoice',
    vendorInvoice.id as string,
  );
  const vendorApprovalStatus = await approveInstanceUntilClosed(
    vendorApproval.approvalInstanceId,
    vendorApproval.approvalStatus,
  );
  expect(vendorApprovalStatus).toBe('approved');

  const approvedVendorInvoiceRes = await request.get(
    `${apiBase}/vendor-invoices/${encodeURIComponent(vendorInvoice.id)}`,
    { headers: adminHeaders },
  );
  await ensureOk(approvedVendorInvoiceRes);
  const approvedVendorInvoice = await approvedVendorInvoiceRes.json();
  expect(approvedVendorInvoice?.status).toBe('approved');

  const userId = `e2e-user-${suffix}`;
  const userHeaders = buildHeaders({
    userId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });
  const otherUserId = `e2e-user-${suffix}-other`;
  const otherUserHeaders = buildHeaders({
    userId: otherUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });

  const timeRes = await request.post(`${apiBase}/time-entries`, {
    data: {
      projectId: defaultProjectId,
      userId,
      workDate: '2026-01-02',
      minutes: 60,
    },
    headers: userHeaders,
  });
  await ensureOk(timeRes);
  const timeEntry = await timeRes.json();

  const timeListRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(defaultProjectId)}`,
    { headers: userHeaders },
  );
  await ensureOk(timeListRes);
  const timeListPayload = await timeListRes.json();
  const timeVisible = (timeListPayload?.items ?? []).some(
    (item: any) => item?.id === timeEntry.id,
  );
  expect(timeVisible).toBeTruthy();

  const timeListOtherRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(defaultProjectId)}`,
    { headers: otherUserHeaders },
  );
  await ensureOk(timeListOtherRes);
  const timeOtherPayload = await timeListOtherRes.json();
  const timeVisibleOther = (timeOtherPayload?.items ?? []).some(
    (item: any) => item?.id === timeEntry.id,
  );
  expect(timeVisibleOther).toBeFalsy();

  const expenseRes = await request.post(`${apiBase}/expenses`, {
    data: {
      projectId: defaultProjectId,
      userId,
      category: 'travel',
      amount: 500,
      currency: 'JPY',
      incurredOn: '2026-01-02',
    },
    headers: userHeaders,
  });
  await ensureOk(expenseRes);
  const expense = await expenseRes.json();

  const expenseListRes = await request.get(
    `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}`,
    { headers: userHeaders },
  );
  await ensureOk(expenseListRes);
  const expenseListPayload = await expenseListRes.json();
  const expenseVisible = (expenseListPayload?.items ?? []).some(
    (item: any) => item?.id === expense.id,
  );
  expect(expenseVisible).toBeTruthy();

  const expenseOtherRes = await request.get(
    `${apiBase}/expenses?projectId=${encodeURIComponent(defaultProjectId)}`,
    { headers: otherUserHeaders },
  );
  await ensureOk(expenseOtherRes);
  const expenseOtherPayload = await expenseOtherRes.json();
  const expenseVisibleOther = (expenseOtherPayload?.items ?? []).some(
    (item: any) => item?.id === expense.id,
  );
  expect(expenseVisibleOther).toBeFalsy();

  const expenseSubmitRes = await request.post(
    `${apiBase}/expenses/${encodeURIComponent(expense.id)}/submit`,
    { headers: userHeaders, data: {} },
  );
  await ensureOk(expenseSubmitRes);
  const submittedExpense = await expenseSubmitRes.json();
  expect(submittedExpense?.status).toBe('pending_qa');

  const expenseApproval = await findApprovalInstance(
    'expense',
    expense.id as string,
  );
  const expenseApprovalStatus = await approveInstanceUntilClosed(
    expenseApproval.approvalInstanceId,
    expenseApproval.approvalStatus,
  );
  expect(expenseApprovalStatus).toBe('approved');

  const markPaidRes = await request.post(
    `${apiBase}/expenses/${encodeURIComponent(expense.id)}/mark-paid`,
    { headers: adminHeaders, data: {} },
  );
  await ensureOk(markPaidRes);
  const paidExpense = await markPaidRes.json();
  expect(paidExpense?.settlementStatus).toBe('paid');

  const unmarkPaidRes = await request.post(
    `${apiBase}/expenses/${encodeURIComponent(expense.id)}/unmark-paid`,
    {
      headers: adminHeaders,
      data: { reasonText: `e2e unmark ${suffix}` },
    },
  );
  await ensureOk(unmarkPaidRes);
  const unpaidExpense = await unmarkPaidRes.json();
  expect(unpaidExpense?.settlementStatus).toBe('unpaid');

  const wellbeingRes = await request.post(`${apiBase}/wellbeing-entries`, {
    data: {
      entryDate: '2026-01-02',
      status: 'good',
      userId,
      notes: 'e2e wellbeing',
      helpRequested: false,
      visibilityGroupId: 'hr-group',
    },
    headers: userHeaders,
  });
  await ensureOk(wellbeingRes);
  const wellbeingEntry = await wellbeingRes.json();

  const hrHeaders = buildHeaders({
    userId: 'hr-user',
    roles: ['hr'],
    groupIds: ['hr-group'],
  });
  const wellbeingListRes = await request.get(`${apiBase}/wellbeing-entries`, {
    headers: hrHeaders,
  });
  await ensureOk(wellbeingListRes);
  const wellbeingPayload = await wellbeingListRes.json();
  const wellbeingVisible = (wellbeingPayload?.items ?? []).some(
    (item: any) => item?.id === wellbeingEntry.id,
  );
  expect(wellbeingVisible).toBeTruthy();

  const approvalRuleRes = await request.post(`${apiBase}/approval-rules`, {
    data: {
      flowType: 'invoice',
      steps: [{ stepOrder: 1, approverGroupId: 'mgmt' }],
    },
    headers: adminHeaders,
  });
  await ensureOk(approvalRuleRes);
  const approvalRule = await approvalRuleRes.json();
  expect(approvalRule?.id).toBeTruthy();

  const approvalListRes = await request.get(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
  });
  await ensureOk(approvalListRes);
  const approvalListPayload = await approvalListRes.json();
  const approvalExists = (approvalListPayload?.items ?? []).some(
    (item: any) => item?.id === approvalRule.id,
  );
  expect(approvalExists).toBeTruthy();

  const approvalPatchRes = await request.patch(
    `${apiBase}/approval-rules/${encodeURIComponent(approvalRule.id)}`,
    {
      data: { conditions: { amountMin: 0 } },
      headers: adminHeaders,
    },
  );
  await ensureOk(approvalPatchRes);
  const approvalPatched = await approvalPatchRes.json();
  const amountMin = Number(approvalPatched?.conditions?.amountMin ?? NaN);
  expect(Number.isFinite(amountMin)).toBeTruthy();
  expect(amountMin).toBe(0);

  const ackRequiredUserId = 'e2e-member-1@example.com';
  const ensureAckMemberRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members`,
    {
      data: { userId: ackRequiredUserId, role: 'member' },
      headers: adminHeaders,
    },
  );
  await ensureOk(ensureAckMemberRes);
  const ackRequiredUserHeaders = buildHeaders({
    userId: ackRequiredUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });
  const recentPastDueAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const chatAckRequestRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-requests`,
    {
      headers: adminHeaders,
      data: {
        body: `e2e ack request ${suffix}`,
        requiredUserIds: [ackRequiredUserId],
        dueAt: recentPastDueAt,
      },
    },
  );
  await ensureOk(chatAckRequestRes);
  const chatAckMessage = await chatAckRequestRes.json();
  const chatAckRequestId = String(chatAckMessage?.ackRequest?.id || '');
  expect(chatAckRequestId.length).toBeGreaterThan(0);

  const chatAckRes = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(chatAckRequestId)}/ack`,
    { headers: ackRequiredUserHeaders, data: {} },
  );
  await ensureOk(chatAckRes);
  const chatAck = await chatAckRes.json();
  const ackByRequiredUser = (chatAck?.acks ?? []).some(
    (item: any) => item?.userId === ackRequiredUserId,
  );
  expect(ackByRequiredUser).toBeTruthy();

  const pendingChatAckRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-requests`,
    {
      headers: adminHeaders,
      data: {
        body: `e2e pending ack request ${suffix}`,
        requiredUserIds: [ackRequiredUserId],
        dueAt: recentPastDueAt,
      },
    },
  );
  await ensureOk(pendingChatAckRes);

  const chatAckReminderJobRes = await request.post(
    `${apiBase}/jobs/chat-ack-reminders/run`,
    { headers: adminHeaders, data: { dryRun: true, limit: 20 } },
  );
  await ensureOk(chatAckReminderJobRes);
  const chatAckReminderJob = await chatAckReminderJobRes.json();
  expect(chatAckReminderJob?.ok).toBe(true);
  expect(Number(chatAckReminderJob?.scannedRequests ?? 0)).toBeGreaterThan(0);
  expect(
    Number(chatAckReminderJob?.candidateNotifications ?? 0),
  ).toBeGreaterThan(0);

  await expectAuditAction({
    action: 'vendor_invoice_link_po',
    targetTable: 'vendor_invoices',
    targetId: vendorInvoice.id,
  });
  await expectAuditAction({
    action: 'vendor_invoice_unlink_po',
    targetTable: 'vendor_invoices',
    targetId: vendorInvoice.id,
  });
  await expectAuditAction({
    action: 'expense_mark_paid',
    targetTable: 'Expense',
    targetId: expense.id,
  });
  await expectAuditAction({
    action: 'expense_unmark_paid',
    targetTable: 'Expense',
    targetId: expense.id,
  });
  await expectAuditAction({
    action: 'chat_ack_request_created',
    targetTable: 'chat_ack_requests',
    targetId: chatAckRequestId,
  });
  await expectAuditAction({
    action: 'chat_ack_added',
    targetTable: 'chat_ack_requests',
    targetId: chatAckRequestId,
  });
  await expectAuditAction({
    action: 'chat_ack_reminders_run',
    targetTable: 'app_notifications',
  });
});
