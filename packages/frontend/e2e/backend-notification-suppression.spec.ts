import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  createProjectAndEstimate,
  submitAndFindApprovalInstance,
} from './approval-e2e-helpers';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';

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
  groupIds: ['mgmt'],
});

const recipientUserId = 'e2e-member-1@example.com';
const recipientHeaders = buildHeaders({
  userId: recipientUserId,
  roles: ['user'],
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function findCompanyRoomId(request: any) {
  const roomRes = await request.get(`${apiBase}/chat-rooms`, {
    headers: adminHeaders,
  });
  await ensureOk(roomRes);
  const roomPayload = await roomRes.json();
  const company = (roomPayload?.items ?? []).find(
    (item: any) => item?.type === 'company',
  );
  expect(company?.id).toBeTruthy();
  return company.id as string;
}

async function listNotificationsByMessage(
  request: any,
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

async function patchNotificationPreference(
  request: any,
  headers: Record<string, string>,
  body: {
    emailMode?: 'realtime' | 'digest';
    emailDigestIntervalMinutes?: number;
    muteAllUntil?: string | null;
  },
) {
  const res = await request.patch(`${apiBase}/notification-preferences`, {
    data: body,
    headers,
  });
  await ensureOk(res);
}

async function patchRoomNotificationSetting(
  request: any,
  headers: Record<string, string>,
  roomId: string,
  body: {
    notifyAllPosts?: boolean;
    notifyMentions?: boolean;
    muteUntil?: string | null;
  },
) {
  const res = await request.patch(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/notification-setting`,
    {
      data: body,
      headers,
    },
  );
  await ensureOk(res);
}

async function createRoomAckRequest(
  request: any,
  roomId: string,
  body: string,
  requiredUserIds: string[],
) {
  const res = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/ack-requests`,
    {
      data: {
        body,
        requiredUserIds,
        tags: ['e2e', 'notification'],
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(res);
  const payload = await res.json();
  expect(payload?.id).toBeTruthy();
  return payload.id as string;
}

async function createProjectWithMember(request: any, suffix: string, userId: string) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-NTF-${suffix}`,
      name: `E2E Notification ${suffix}`,
      status: 'active',
    },
    headers: adminHeaders,
  });
  await ensureOk(projectRes);
  const projectPayload = await projectRes.json();
  const projectId = (projectPayload?.id ?? '') as string;
  expect(projectId).toBeTruthy();

  const memberRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      data: { userId, role: 'member' },
      headers: adminHeaders,
    },
  );
  await ensureOk(memberRes);
  return projectId;
}

async function createApprovalRuleForAmount(
  request: any,
  headers: Record<string, string>,
  approverUserId: string,
  totalAmount: number,
) {
  const res = await request.post(`${apiBase}/approval-rules`, {
    data: {
      flowType: 'estimate',
      isActive: true,
      conditions: {
        amountMin: totalAmount,
        amountMax: totalAmount,
      },
      steps: [
        {
          stepOrder: 1,
          approverUserId,
        },
      ],
    },
    headers,
  });
  await ensureOk(res);
  const payload = await res.json();
  const id = (payload?.id ?? '') as string;
  expect(id).toBeTruthy();
  return id;
}

async function deactivateApprovalRule(
  request: any,
  headers: Record<string, string>,
  ruleId: string,
) {
  const res = await request.patch(
    `${apiBase}/approval-rules/${encodeURIComponent(ruleId)}`,
    {
      data: { isActive: false },
      headers,
    },
  );
  await ensureOk(res);
}

async function createProjectChatMessage(
  request: any,
  projectId: string,
  body: string,
) {
  const res = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages`,
    {
      data: { body },
      headers: adminHeaders,
    },
  );
  await ensureOk(res);
  const payload = await res.json();
  expect(payload?.id).toBeTruthy();
  return payload.id as string;
}

test('chat_ack_required notifications: global mute and room mention settings suppress delivery @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const companyRoomId = await findCompanyRoomId(request);

  await patchNotificationPreference(request, recipientHeaders, {
    muteAllUntil: null,
  });
  await patchRoomNotificationSetting(request, recipientHeaders, companyRoomId, {
    notifyMentions: true,
    muteUntil: null,
  });

  try {
    const baselineMessageId = await createRoomAckRequest(
      request,
      companyRoomId,
      `E2E ack baseline ${suffix}`,
      [recipientUserId],
    );
    expect(
      (await listNotificationsByMessage(
        request,
        recipientHeaders,
        'chat_ack_required',
        baselineMessageId,
      )).length,
    ).toBeGreaterThan(0);

    const muteAllUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await patchNotificationPreference(request, recipientHeaders, {
      muteAllUntil,
    });
    const mutedByGlobalMessageId = await createRoomAckRequest(
      request,
      companyRoomId,
      `E2E ack muted global ${suffix}`,
      [recipientUserId],
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientHeaders,
          'chat_ack_required',
          mutedByGlobalMessageId,
        )
      ).length,
    ).toBe(0);

    await patchNotificationPreference(request, recipientHeaders, {
      muteAllUntil: null,
    });
    await patchRoomNotificationSetting(request, recipientHeaders, companyRoomId, {
      notifyMentions: false,
      muteUntil: null,
    });
    const mutedByNotifyMentionsFalseMessageId = await createRoomAckRequest(
      request,
      companyRoomId,
      `E2E ack muted room notifyMentions ${suffix}`,
      [recipientUserId],
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientHeaders,
          'chat_ack_required',
          mutedByNotifyMentionsFalseMessageId,
        )
      ).length,
    ).toBe(0);

    const roomMuteUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await patchRoomNotificationSetting(request, recipientHeaders, companyRoomId, {
      notifyMentions: true,
      muteUntil: roomMuteUntil,
    });
    const mutedByRoomMuteMessageId = await createRoomAckRequest(
      request,
      companyRoomId,
      `E2E ack muted room muteUntil ${suffix}`,
      [recipientUserId],
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientHeaders,
          'chat_ack_required',
          mutedByRoomMuteMessageId,
        )
      ).length,
    ).toBe(0);

    await patchRoomNotificationSetting(request, recipientHeaders, companyRoomId, {
      notifyMentions: true,
      muteUntil: null,
    });
    const recoveredMessageId = await createRoomAckRequest(
      request,
      companyRoomId,
      `E2E ack recovered ${suffix}`,
      [recipientUserId],
    );
    expect(
      (await listNotificationsByMessage(
        request,
        recipientHeaders,
        'chat_ack_required',
        recoveredMessageId,
      )).length,
    ).toBeGreaterThan(0);
  } finally {
    await patchNotificationPreference(request, recipientHeaders, {
      muteAllUntil: null,
    });
    await patchRoomNotificationSetting(request, recipientHeaders, companyRoomId, {
      notifyMentions: true,
      muteUntil: null,
    });
  }
});

test('chat_message notifications: notifyAllPosts and mute settings suppress delivery @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const projectId = await createProjectWithMember(request, suffix, recipientUserId);

  const recipientProjectHeaders = buildHeaders({
    userId: recipientUserId,
    roles: ['user'],
    projectIds: [projectId],
  });

  await patchNotificationPreference(request, recipientProjectHeaders, {
    muteAllUntil: null,
  });
  await patchRoomNotificationSetting(
    request,
    recipientProjectHeaders,
    projectId,
    {
      notifyAllPosts: true,
      muteUntil: null,
    },
  );

  try {
    const baselineMessageId = await createProjectChatMessage(
      request,
      projectId,
      `E2E project chat baseline ${suffix}`,
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientProjectHeaders,
          'chat_message',
          baselineMessageId,
        )
      ).length,
    ).toBeGreaterThan(0);

    await patchRoomNotificationSetting(
      request,
      recipientProjectHeaders,
      projectId,
      { notifyAllPosts: false, muteUntil: null },
    );
    const mutedByNotifyAllFalseMessageId = await createProjectChatMessage(
      request,
      projectId,
      `E2E project chat muted notifyAll ${suffix}`,
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientProjectHeaders,
          'chat_message',
          mutedByNotifyAllFalseMessageId,
        )
      ).length,
    ).toBe(0);

    const roomMuteUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await patchRoomNotificationSetting(
      request,
      recipientProjectHeaders,
      projectId,
      { notifyAllPosts: true, muteUntil: roomMuteUntil },
    );
    const mutedByRoomMuteMessageId = await createProjectChatMessage(
      request,
      projectId,
      `E2E project chat muted room ${suffix}`,
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientProjectHeaders,
          'chat_message',
          mutedByRoomMuteMessageId,
        )
      ).length,
    ).toBe(0);

    await patchRoomNotificationSetting(
      request,
      recipientProjectHeaders,
      projectId,
      { notifyAllPosts: true, muteUntil: null },
    );
    const muteAllUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await patchNotificationPreference(request, recipientProjectHeaders, {
      muteAllUntil,
    });
    const mutedByGlobalMessageId = await createProjectChatMessage(
      request,
      projectId,
      `E2E project chat muted global ${suffix}`,
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientProjectHeaders,
          'chat_message',
          mutedByGlobalMessageId,
        )
      ).length,
    ).toBe(0);

    await patchNotificationPreference(request, recipientProjectHeaders, {
      muteAllUntil: null,
    });
    const recoveredMessageId = await createProjectChatMessage(
      request,
      projectId,
      `E2E project chat recovered ${suffix}`,
    );
    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientProjectHeaders,
          'chat_message',
          recoveredMessageId,
        )
      ).length,
    ).toBeGreaterThan(0);
  } finally {
    await patchNotificationPreference(request, recipientProjectHeaders, {
      muteAllUntil: null,
    });
    await patchRoomNotificationSetting(
      request,
      recipientProjectHeaders,
      projectId,
      { notifyAllPosts: true, muteUntil: null },
    );
  }
});

test('approval_pending notifications: global mute bypass delivers notification @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const recipientUserIdForApproval = `e2e-approval-muted-${suffix}@example.com`;
  const recipientApprovalHeaders = buildHeaders({
    userId: recipientUserIdForApproval,
    roles: ['user'],
  });
  const totalAmount = Number(`9${Date.now().toString().slice(-5)}`);

  let approvalRuleId: string | null = null;

  await patchNotificationPreference(request, recipientApprovalHeaders, {
    muteAllUntil: null,
  });
  try {
    const muteAllUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await patchNotificationPreference(request, recipientApprovalHeaders, {
      muteAllUntil,
    });

    const { projectId, estimateId } = await createProjectAndEstimate({
      request,
      apiBase,
      headers: adminHeaders,
      project: {
        code: `E2E-NTF-APR-${suffix}`,
        name: `E2E Notification Approval ${suffix}`,
      },
      estimate: {
        totalAmount,
        currency: 'JPY',
        notes: `E2E notification approval ${suffix}`,
      },
    });
    approvalRuleId = await createApprovalRuleForAmount(
      request,
      adminHeaders,
      recipientUserIdForApproval,
      totalAmount,
    );
    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: adminHeaders,
      flowType: 'estimate',
      projectId,
      targetTable: 'estimates',
      targetId: estimateId,
    });
    const messageId = `${approval.id}:${approval.currentStep ?? 1}`;

    expect(
      (
        await listNotificationsByMessage(
          request,
          recipientApprovalHeaders,
          'approval_pending',
          messageId,
        )
      ).length,
    ).toBeGreaterThan(0);
  } finally {
    await patchNotificationPreference(request, recipientApprovalHeaders, {
      muteAllUntil: null,
    });
    if (approvalRuleId) {
      await deactivateApprovalRule(request, adminHeaders, approvalRuleId);
    }
  }
});
