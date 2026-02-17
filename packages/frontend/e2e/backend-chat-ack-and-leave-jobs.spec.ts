import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

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

async function listNotificationsByMessage(
  request: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
  },
  headers: Record<string, string>,
  kind: string,
  messageId: string,
) {
  const res = await request.get(`${apiBase}/notifications?unread=1&limit=200`, {
    headers,
  });
  await ensureOk(res);
  const payload = await res.json();
  return (payload?.items ?? []).filter(
    (item: any) => item?.kind === kind && item?.messageId === messageId,
  );
}

async function ensureRoleRecipientGroupMember(
  request: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
    post: (
      url: string,
      init: { headers: Record<string, string>; data: unknown },
    ) => Promise<any>;
  },
  userId: string,
) {
  for (const selector of ['admin', 'mgmt']) {
    const groupListRes = await request.get(`${apiBase}/groups`, {
      headers: adminHeaders,
    });
    await ensureOk(groupListRes);
    const groupPayload = await groupListRes.json();
    const groups = Array.isArray(groupPayload?.items) ? groupPayload.items : [];
    let targetGroup = groups.find(
      (group: any) =>
        group?.displayName === selector && group?.isScimManaged !== true,
    );
    if (!targetGroup) {
      const selectorExists = groups.some(
        (group: any) => group?.displayName === selector,
      );
      if (selectorExists) {
        continue;
      }
      const createRes = await request.post(`${apiBase}/groups`, {
        headers: adminHeaders,
        data: { displayName: selector },
      });
      await ensureOk(createRes);
      targetGroup = await createRes.json();
    }
    const groupId = String(targetGroup?.id || '').trim();
    if (!groupId) continue;
    const addMemberRes = await request.post(
      `${apiBase}/groups/${encodeURIComponent(groupId)}/members`,
      {
        headers: adminHeaders,
        data: { userIds: [userId] },
      },
    );
    await ensureOk(addMemberRes);
    return { selector, groupId };
  }
  return null;
}

async function findApprovalInstance(
  request: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
  },
  flowType: string,
  targetId: string,
  options?: { targetTable?: string },
) {
  let approvalInstanceId = '';
  let approvalStatus = '';
  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({ flowType });
        const listRes = await request.get(
          `${apiBase}/approval-instances?${query}`,
          {
            headers: adminHeaders,
          },
        );
        if (!listRes.ok()) return '';
        const payload = await listRes.json();
        const matched = (payload?.items ?? []).find((item: any) => {
          if (!item || item?.targetId !== targetId) return false;
          if (
            options?.targetTable &&
            String(item?.targetTable ?? '') !== options.targetTable
          ) {
            return false;
          }
          const status = String(item?.status ?? '');
          return !['approved', 'rejected', 'cancelled'].includes(status);
        });
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
  request: {
    post: (
      url: string,
      init: { data: { action: string }; headers: Record<string, string> },
    ) => Promise<any>;
  },
  approvalInstanceId: string,
  initialStatus: string,
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
}

async function expectAuditAction(
  request: {
    get: (
      url: string,
      init: { headers: Record<string, string> },
    ) => Promise<any>;
  },
  input: {
    action: string;
    targetTable?: string;
    targetId?: string;
    userId?: string;
    from?: string;
  },
) {
  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({
          action: input.action,
          format: 'json',
          mask: '0',
          limit: '50',
        });
        if (input.targetTable) query.set('targetTable', input.targetTable);
        if (input.targetId) query.set('targetId', input.targetId);
        if (input.userId) query.set('userId', input.userId);
        if (input.from) query.set('from', input.from);
        const res = await request.get(`${apiBase}/audit-logs?${query}`, {
          headers: adminHeaders,
        });
        if (!res.ok()) return false;
        const payload = await res.json();
        return (
          (payload?.items ?? []).some((item: any) => {
            if (!item || item?.action !== input.action) return false;
            if (input.targetTable && item?.targetTable !== input.targetTable) {
              return false;
            }
            if (input.targetId && item?.targetId !== input.targetId) {
              return false;
            }
            if (input.userId && item?.userId !== input.userId) {
              return false;
            }
            return true;
          }) ?? false
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);
}

test('backend e2e: chat ack lifecycle endpoints @extended', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const testStartedAt = new Date().toISOString();
  const suffix = runId();

  const ackUserId = 'e2e-member-1@example.com';
  const ensureMemberRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/members`,
    {
      data: { userId: ackUserId, role: 'member' },
      headers: adminHeaders,
    },
  );
  await ensureOk(ensureMemberRes);

  const ackUserHeaders = buildHeaders({
    userId: ackUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });

  const shortCandidatesRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-candidates?q=e`,
    { headers: adminHeaders },
  );
  await ensureOk(shortCandidatesRes);
  const shortCandidates = await shortCandidatesRes.json();
  expect(shortCandidates?.users ?? []).toEqual([]);
  expect(shortCandidates?.groups ?? []).toEqual([]);

  const candidatesRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-candidates?q=e2e`,
    { headers: adminHeaders },
  );
  await ensureOk(candidatesRes);
  const candidates = await candidatesRes.json();
  const hasAckUser = (candidates?.users ?? []).some(
    (item: any) => item?.userId === ackUserId,
  );
  expect(hasAckUser).toBeTruthy();
  expect(Array.isArray(candidates?.groups)).toBeTruthy();

  const previewRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-requests/preview`,
    {
      headers: adminHeaders,
      data: {
        requiredUserIds: [ackUserId],
        requiredRoles: ['admin'],
      },
    },
  );
  await ensureOk(previewRes);
  const preview = await previewRes.json();
  expect(Array.isArray(preview?.resolvedUserIds)).toBeTruthy();
  expect(preview?.resolvedUserIds ?? []).toContain(ackUserId);
  expect(Number(preview?.resolvedCount ?? 0)).toBeGreaterThan(0);

  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const createRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(defaultProjectId)}/chat-ack-requests`,
    {
      headers: adminHeaders,
      data: {
        body: `e2e ack lifecycle ${suffix}`,
        requiredUserIds: [ackUserId],
        dueAt,
      },
    },
  );
  await ensureOk(createRes);
  const createdMessage = await createRes.json();
  const ackRequestId = String(createdMessage?.ackRequest?.id || '');
  expect(ackRequestId.length).toBeGreaterThan(0);

  const getRes = await request.get(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}`,
    { headers: adminHeaders },
  );
  await ensureOk(getRes);
  const getPayload = await getRes.json();
  expect(getPayload?.id).toBe(ackRequestId);
  expect(getPayload?.dueAt).toBeTruthy();
  expect(getPayload?.canceledAt).toBeNull();
  expect(Array.isArray(getPayload?.acks)).toBeTruthy();

  const ackRes1 = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/ack`,
    {
      headers: ackUserHeaders,
      data: {},
    },
  );
  await ensureOk(ackRes1);
  const acked1 = await ackRes1.json();
  const ackCount1 = (acked1?.acks ?? []).filter(
    (item: any) => item?.userId === ackUserId,
  ).length;
  expect(ackCount1).toBe(1);

  const ackRes2 = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/ack`,
    {
      headers: ackUserHeaders,
      data: {},
    },
  );
  await ensureOk(ackRes2);
  const acked2 = await ackRes2.json();
  const ackCount2 = (acked2?.acks ?? []).filter(
    (item: any) => item?.userId === ackUserId,
  ).length;
  expect(ackCount2).toBe(1);

  const revokeRes = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/revoke`,
    {
      headers: ackUserHeaders,
      data: {},
    },
  );
  await ensureOk(revokeRes);
  const revoked = await revokeRes.json();
  const ackCountAfterRevoke = (revoked?.acks ?? []).filter(
    (item: any) => item?.userId === ackUserId,
  ).length;
  expect(ackCountAfterRevoke).toBe(0);

  const cancelRes = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/cancel`,
    {
      headers: adminHeaders,
      data: { reason: `e2e cancel ${suffix}` },
    },
  );
  await ensureOk(cancelRes);
  const canceled = await cancelRes.json();
  expect(canceled?.canceledAt).toBeTruthy();
  expect(canceled?.canceledBy).toBe('demo-user');

  const ackAfterCancelRes = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(ackRequestId)}/ack`,
    {
      headers: ackUserHeaders,
      data: {},
    },
  );
  expect(ackAfterCancelRes.status()).toBe(409);

  await expectAuditAction(request, {
    action: 'chat_ack_request_created',
    targetTable: 'chat_ack_requests',
    targetId: ackRequestId,
    from: testStartedAt,
  });
  await expectAuditAction(request, {
    action: 'chat_ack_added',
    targetTable: 'chat_ack_requests',
    targetId: ackRequestId,
    from: testStartedAt,
  });
  await expectAuditAction(request, {
    action: 'chat_ack_revoked',
    targetTable: 'chat_ack_requests',
    targetId: ackRequestId,
    from: testStartedAt,
  });
  await expectAuditAction(request, {
    action: 'chat_ack_request_canceled',
    targetTable: 'chat_ack_requests',
    targetId: ackRequestId,
    from: testStartedAt,
  });
});

test('backend e2e: leave-upcoming notification job dry-run @extended', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const testStartedAt = new Date().toISOString();
  const suffix = runId();

  const leaveUserId = 'e2e-member-1@example.com';
  const roleRecipientUserId = 'e2e-member-2@example.com';
  const leaveUserHeaders = buildHeaders({
    userId: leaveUserId,
    roles: ['user'],
    projectIds: [defaultProjectId],
  });
  const roleRecipientHeaders = buildHeaders({
    userId: roleRecipientUserId,
    roles: ['user'],
  });

  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);

  const roleRecipientBinding = await ensureRoleRecipientGroupMember(
    request,
    roleRecipientUserId,
  );
  expect(roleRecipientBinding).not.toBeNull();

  const leaveCreateRes = await request.post(`${apiBase}/leave-requests`, {
    headers: leaveUserHeaders,
    data: {
      userId: leaveUserId,
      leaveType: 'paid',
      startDate,
      endDate: startDate,
      notes: `e2e leave upcoming ${suffix}`,
    },
  });
  await ensureOk(leaveCreateRes);
  const leave = await leaveCreateRes.json();
  const leaveId = String(leave?.id || '');
  expect(leaveId.length).toBeGreaterThan(0);

  const submitRes = await request.post(
    `${apiBase}/leave-requests/${encodeURIComponent(leaveId)}/submit`,
    {
      headers: leaveUserHeaders,
      data: {},
    },
  );
  await ensureOk(submitRes);

  const leaveApproval = await findApprovalInstance(request, 'leave', leaveId, {
    targetTable: 'leave_requests',
  });
  const leaveApprovalStatus = await approveInstanceUntilClosed(
    request,
    leaveApproval.approvalInstanceId,
    leaveApproval.approvalStatus,
  );
  expect(leaveApprovalStatus).toBe('approved');

  const leaveUpcomingRes = await request.post(
    `${apiBase}/jobs/leave-upcoming/run`,
    {
      headers: adminHeaders,
      data: { targetDate: startDate, dryRun: true },
    },
  );
  await ensureOk(leaveUpcomingRes);
  const leaveUpcoming = await leaveUpcomingRes.json();
  expect(leaveUpcoming?.ok).toBe(true);
  expect(leaveUpcoming?.targetDate).toBe(startDate);
  expect(Number(leaveUpcoming?.matchedCount ?? 0)).toBeGreaterThan(0);
  expect(Number(leaveUpcoming?.createdNotifications ?? 0)).toBeGreaterThan(0);
  expect(Array.isArray(leaveUpcoming?.sampleLeaveRequestIds)).toBeTruthy();
  expect(leaveUpcoming?.sampleLeaveRequestIds ?? []).toContain(leaveId);

  const leaveUpcomingExecuteRes = await request.post(
    `${apiBase}/jobs/leave-upcoming/run`,
    {
      headers: adminHeaders,
      data: { targetDate: startDate, dryRun: false },
    },
  );
  await ensureOk(leaveUpcomingExecuteRes);
  const leaveUpcomingExecute = await leaveUpcomingExecuteRes.json();
  expect(leaveUpcomingExecute?.ok).toBe(true);
  expect(
    Number(leaveUpcomingExecute?.createdNotifications ?? 0),
  ).toBeGreaterThan(0);

  await expect
    .poll(
      async () =>
        (
          await listNotificationsByMessage(
            request,
            leaveUserHeaders,
            'leave_upcoming',
            leaveId,
          )
        ).length,
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () =>
        (
          await listNotificationsByMessage(
            request,
            roleRecipientHeaders,
            'leave_upcoming',
            leaveId,
          )
        ).length,
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);

  await expectAuditAction(request, {
    action: 'leave_upcoming_run',
    targetTable: 'app_notifications',
    userId: 'demo-user',
    from: testStartedAt,
  });
});
