import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

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

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function createProjectAndEstimate(request: any, headers: any, suffix: string) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-ACK-GUARD-${suffix}`,
      name: `E2E Ack Guard ${suffix}`,
      status: 'active',
    },
    headers,
  });
  await ensureOk(projectRes);
  const projectPayload = await projectRes.json();
  const projectId = (projectPayload?.id ?? projectPayload?.project?.id ?? '') as string;
  if (!projectId) {
    throw new Error(`[e2e] project id missing: ${JSON.stringify(projectPayload)}`);
  }

  const estimateRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      data: {
        totalAmount: 123456,
        currency: 'JPY',
        notes: `E2E ack guard estimate ${suffix}`,
      },
      headers,
    },
  );
  await ensureOk(estimateRes);
  const estimatePayload = await estimateRes.json();
  const estimateId = (estimatePayload?.id ??
    estimatePayload?.estimate?.id ??
    '') as string;
  if (!estimateId) {
    throw new Error(
      `[e2e] estimate id missing: ${JSON.stringify(estimatePayload)}`,
    );
  }

  return { projectId, estimateId };
}

async function submitAndFindApprovalInstance(
  request: any,
  headers: any,
  projectId: string,
  estimateId: string,
) {
  const submitRes = await request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    {
      headers,
    },
  );
  await ensureOk(submitRes);

  const instancesRes = await request.get(
    `${apiBase}/approval-instances?flowType=estimate&projectId=${encodeURIComponent(projectId)}`,
    { headers },
  );
  await ensureOk(instancesRes);
  const instancesPayload = await instancesRes.json();
  const approval = (instancesPayload?.items ?? []).find(
    (item: any) =>
      item?.targetTable === 'estimates' &&
      item?.targetId === estimateId &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected' &&
      item?.status !== 'cancelled',
  );
  expect(approval?.id).toBeTruthy();
  return approval.id as string;
}

async function findCompanyRoomId(request: any, headers: any) {
  const roomRes = await request.get(`${apiBase}/chat-rooms`, { headers });
  await ensureOk(roomRes);
  const roomPayload = await roomRes.json();
  const company = (roomPayload?.items ?? []).find(
    (item: any) => item?.type === 'company',
  );
  expect(company?.id).toBeTruthy();
  return company.id as string;
}

async function createAckRequestForRoom(
  request: any,
  headers: any,
  roomId: string,
  suffix: string,
  requiredUserId: string,
) {
  const ackRes = await request.post(
    `${apiBase}/chat-rooms/${encodeURIComponent(roomId)}/ack-requests`,
    {
      data: {
        body: `E2E ack guard request ${suffix}`,
        requiredUserIds: [requiredUserId],
        tags: ['e2e', 'ack-guard'],
      },
      headers,
    },
  );
  await ensureOk(ackRes);
  const ackPayload = await ackRes.json();
  const ackRequestId = (ackPayload?.ackRequest?.id ??
    ackPayload?.id ??
    '') as string;
  if (!ackRequestId) {
    throw new Error(`[e2e] ack request id missing: ${JSON.stringify(ackPayload)}`);
  }
  return ackRequestId;
}

async function createAckLink(
  request: any,
  headers: any,
  ackRequestId: string,
  approvalInstanceId: string,
) {
  const linkRes = await request.post(`${apiBase}/chat-ack-links`, {
    data: {
      ackRequestId,
      targetTable: 'approval_instances',
      targetId: approvalInstanceId,
      flowType: 'estimate',
      actionKey: 'approve',
    },
    headers,
  });
  await ensureOk(linkRes);
  const linkPayload = await linkRes.json();
  expect(linkPayload?.id).toBeTruthy();
}

async function createApprovePolicy(
  request: any,
  headers: any,
  actorUserId: string,
) {
  const policyRes = await request.post(`${apiBase}/action-policies`, {
    data: {
      flowType: 'estimate',
      actionKey: 'approve',
      priority: 999,
      isEnabled: true,
      subjects: { userIds: [actorUserId] },
      stateConstraints: { statusIn: ['pending_qa', 'pending_exec'] },
      requireReason: false,
      guards: ['chat_ack_completed'],
    },
    headers,
  });
  await ensureOk(policyRes);
  const policyPayload = await policyRes.json();
  expect(policyPayload?.id).toBeTruthy();
  return policyPayload.id as string;
}

test('action policy chat_ack_completed: incomplete ack requires override reason @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const actorUserId = `e2e-ack-actor-${suffix}`;
  const actorHeaders = buildHeaders({
    userId: actorUserId,
    roles: ['admin', 'mgmt'],
    groupIds: ['mgmt'],
  });

  const { projectId, estimateId } = await createProjectAndEstimate(
    request,
    actorHeaders,
    suffix,
  );
  const approvalInstanceId = await submitAndFindApprovalInstance(
    request,
    actorHeaders,
    projectId,
    estimateId,
  );
  const companyRoomId = await findCompanyRoomId(request, actorHeaders);
  const requiredUserId = 'e2e-member-1@example.com';
  const ackRequestId = await createAckRequestForRoom(
    request,
    actorHeaders,
    companyRoomId,
    suffix,
    requiredUserId,
  );
  await createAckLink(request, actorHeaders, ackRequestId, approvalInstanceId);
  await createApprovePolicy(request, actorHeaders, actorUserId);

  const evaluateRes = await request.post(`${apiBase}/action-policies/evaluate`, {
    data: {
      flowType: 'estimate',
      actionKey: 'approve',
      actor: {
        userId: actorUserId,
        roles: ['admin', 'mgmt'],
        groupIds: ['mgmt'],
      },
      state: {
        status: 'pending_qa',
        projectId,
      },
      targetTable: 'approval_instances',
      targetId: approvalInstanceId,
    },
    headers: actorHeaders,
  });
  await ensureOk(evaluateRes);
  const evaluatePayload = await evaluateRes.json();
  expect(evaluatePayload?.allowed).toBe(false);
  expect(evaluatePayload?.reason).toBe('guard_failed');
  expect(evaluatePayload?.guardFailures?.[0]?.type).toBe('chat_ack_completed');

  const approveWithoutReasonRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(approvalInstanceId)}/act`,
    {
      data: { action: 'approve' },
      headers: actorHeaders,
    },
  );
  expect(approveWithoutReasonRes.status()).toBe(400);
  const approveWithoutReasonPayload = await approveWithoutReasonRes.json();
  expect(approveWithoutReasonPayload?.error?.code).toBe('REASON_REQUIRED');
});

test('action policy chat_ack_completed: ack完了は理由不要、未完了は理由付きoverrideで承認可能 @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const actorUserId = `e2e-ack-actor2-${suffix}`;
  const actorHeaders = buildHeaders({
    userId: actorUserId,
    roles: ['admin', 'mgmt'],
    groupIds: ['mgmt'],
  });
  const requiredUserId = 'e2e-member-1@example.com';
  const requiredUserHeaders = buildHeaders({
    userId: requiredUserId,
    roles: ['user'],
  });

  await createApprovePolicy(request, actorHeaders, actorUserId);
  const companyRoomId = await findCompanyRoomId(request, actorHeaders);

  const setupApproval = async (label: string) => {
    const setupSuffix = `${suffix}-${label}`;
    const { projectId, estimateId } = await createProjectAndEstimate(
      request,
      actorHeaders,
      setupSuffix,
    );
    const approvalInstanceId = await submitAndFindApprovalInstance(
      request,
      actorHeaders,
      projectId,
      estimateId,
    );
    const ackRequestId = await createAckRequestForRoom(
      request,
      actorHeaders,
      companyRoomId,
      setupSuffix,
      requiredUserId,
    );
    await createAckLink(request, actorHeaders, ackRequestId, approvalInstanceId);
    return { approvalInstanceId, ackRequestId };
  };

  const completed = await setupApproval('completed');
  const ackRes = await request.post(
    `${apiBase}/chat-ack-requests/${encodeURIComponent(completed.ackRequestId)}/ack`,
    {
      headers: requiredUserHeaders,
    },
  );
  await ensureOk(ackRes);

  const approveCompletedRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(completed.approvalInstanceId)}/act`,
    {
      data: { action: 'approve' },
      headers: actorHeaders,
    },
  );
  await ensureOk(approveCompletedRes);
  const approveCompletedPayload = await approveCompletedRes.json();
  expect(typeof approveCompletedPayload?.status).toBe('string');
  expect(approveCompletedPayload?.status).not.toBe('rejected');

  const incomplete = await setupApproval('incomplete');
  const overrideReason = `e2e ack override ${suffix}`;
  const approveOverrideRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(incomplete.approvalInstanceId)}/act`,
    {
      data: { action: 'approve', reason: overrideReason },
      headers: actorHeaders,
    },
  );
  await ensureOk(approveOverrideRes);
  const approveOverridePayload = await approveOverrideRes.json();
  expect(typeof approveOverridePayload?.status).toBe('string');
  expect(approveOverridePayload?.status).not.toBe('rejected');

  const overrideAuditRes = await request.get(
    `${apiBase}/audit-logs?action=action_policy_override&targetTable=approval_instances&targetId=${encodeURIComponent(incomplete.approvalInstanceId)}&format=json&mask=0&limit=20`,
    { headers: actorHeaders },
  );
  await ensureOk(overrideAuditRes);
  const overrideAuditPayload = await overrideAuditRes.json();
  expect(
    (overrideAuditPayload?.items ?? []).some(
      (item: any) =>
        item?.action === 'action_policy_override' &&
        item?.reasonText === overrideReason &&
        item?.metadata?.guardOverride === true,
    ),
  ).toBeTruthy();
});
