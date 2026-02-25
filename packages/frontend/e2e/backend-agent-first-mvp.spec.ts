import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureOk } from './approval-e2e-helpers';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const e2eAuthMode = (process.env.E2E_AUTH_MODE || 'header')
  .trim()
  .toLowerCase();
const useJwtAuth = e2eAuthMode === 'jwt';
const jwtActorUsers = {
  outsider: 'e2e-agent-outsider@example.com',
  approvalRequired: 'e2e-agent-approval-required@example.com',
  evidenceRequired: 'e2e-agent-evidence-required@example.com',
  reasonRequired: 'e2e-agent-reason-required@example.com',
} as const;
const jwtTokenByUserId: Record<string, string | undefined> = {
  'demo-user': process.env.E2E_JWT_TOKEN_ADMIN,
  [jwtActorUsers.outsider]: process.env.E2E_JWT_TOKEN_OUTSIDER,
  [jwtActorUsers.approvalRequired]:
    process.env.E2E_JWT_TOKEN_APPROVAL_REQUIRED,
  [jwtActorUsers.evidenceRequired]:
    process.env.E2E_JWT_TOKEN_EVIDENCE_REQUIRED,
  [jwtActorUsers.reasonRequired]: process.env.E2E_JWT_TOKEN_REASON_REQUIRED,
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const resolveJwtToken = (userId: string): string => {
  const token = jwtTokenByUserId[userId];
  if (token && token.trim()) return token.trim();
  throw new Error(`[e2e] JWT token is not configured for userId=${userId}`);
};

const buildHeaders = (input: {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
}) => {
  const headers: Record<string, string> = {
    'x-user-id': input.userId,
    'x-roles': input.roles.join(','),
    'x-project-ids': (input.projectIds ?? []).join(','),
    'x-group-ids': (input.groupIds ?? []).join(','),
  };
  if (useJwtAuth) {
    headers.Authorization = `Bearer ${resolveJwtToken(input.userId)}`;
  }
  return headers;
};

const adminHeaders = buildHeaders({
  userId: 'demo-user',
  roles: ['admin', 'mgmt', 'exec'],
  groupIds: ['mgmt', 'exec'],
});

async function createProject(
  request: APIRequestContext,
  suffix: string,
  label: string,
) {
  const res = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-AGENT-${label}-${suffix}`.slice(0, 32),
      name: `E2E Agent ${label} ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(res);
  const payload = await res.json();
  const projectId = String(payload?.id || payload?.project?.id || '').trim();
  expect(projectId).toBeTruthy();
  return projectId;
}

async function createInvoice(
  request: APIRequestContext,
  projectId: string,
  amount: number,
) {
  const res = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/invoices`,
    {
      headers: adminHeaders,
      data: {
        totalAmount: amount,
        currency: 'JPY',
        lines: [
          {
            description: 'e2e agent invoice line',
            quantity: 1,
            unitPrice: amount,
            taxRate: 0,
          },
        ],
      },
    },
  );
  await ensureOk(res);
  const payload = await res.json();
  const invoiceId = String(payload?.id || '').trim();
  expect(invoiceId).toBeTruthy();
  return payload as { id: string; status?: string; invoiceNo?: string };
}

async function findOpenApprovalInstance(
  request: APIRequestContext,
  flowType: string,
  projectId: string,
  targetTable: string,
  targetId: string,
) {
  const res = await request.get(
    `${apiBase}/approval-instances?flowType=${encodeURIComponent(flowType)}&projectId=${encodeURIComponent(projectId)}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(res);
  const payload = await res.json();
  const matched = (payload?.items ?? []).find(
    (item: any) =>
      item?.targetTable === targetTable &&
      item?.targetId === targetId &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected' &&
      item?.status !== 'cancelled',
  );
  expect(String(matched?.id || '')).toBeTruthy();
  return matched as { id: string; status?: string };
}

async function approveUntilClosed(
  request: APIRequestContext,
  approvalInstanceId: string,
) {
  let status = '';
  for (let index = 0; index < 8; index += 1) {
    const res = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approvalInstanceId)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: 'e2e agent approve' },
      },
    );
    await ensureOk(res);
    const payload = await res.json();
    status = String(payload?.status || '');
    if (status !== 'pending_qa' && status !== 'pending_exec') break;
  }
  return status;
}

async function waitAuditEvent(
  request: APIRequestContext,
  action: string,
  targetTable: string,
  targetId?: string,
  requestId?: string,
) {
  const fetchEvent = async () => {
    const params = new URLSearchParams({
      action,
      targetTable,
      format: 'json',
      mask: '0',
      limit: '20',
    });
    if (targetId) params.set('targetId', targetId);
    if (requestId) params.set('requestId', requestId);
    const res = await request.get(`${apiBase}/audit-logs?${params}`, {
      headers: adminHeaders,
    });
    await ensureOk(res);
    const payload = await res.json();
    return (payload?.items ?? []).find(
      (item: any) =>
        item?.action === action &&
        (requestId ? String(item?.requestId || '') === requestId : true) &&
        (targetId ? String(item?.targetId || '') === targetId : true),
    );
  };

  await expect
    .poll(async () => {
      const item = await fetchEvent();
      return item ? 'ok' : null;
    }, { timeout: 20_000, intervals: [250, 500, 1_000] })
    .toBe('ok');

  return fetchEvent();
}

async function fetchAuditEventsByRequestId(
  request: APIRequestContext,
  requestId: string,
) {
  const params = new URLSearchParams({
    requestId,
    format: 'json',
    mask: '0',
    limit: '50',
  });
  const res = await request.get(`${apiBase}/audit-logs?${params}`, {
    headers: adminHeaders,
  });
  await ensureOk(res);
  const payload = await res.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function createActionPolicy(
  request: APIRequestContext,
  headers: Record<string, string>,
  input: {
    actorUserId: string;
    requireReason: boolean;
    statusIn?: string[];
    guards?: Array<{ type: string }>;
  },
) {
  const policyRes = await request.post(`${apiBase}/action-policies`, {
    headers,
    data: {
      flowType: 'invoice',
      actionKey: 'send',
      priority: 999,
      isEnabled: true,
      subjects: { userIds: [input.actorUserId] },
      stateConstraints: {
        statusIn: input.statusIn ?? ['draft', 'pending_qa', 'approved'],
      },
      requireReason: input.requireReason,
      guards: input.guards ?? [],
    },
  });
  await ensureOk(policyRes);
  const payload = await policyRes.json();
  expect(payload?.id).toBeTruthy();
  return String(payload.id);
}

async function resetEvidenceSnapshots(
  request: APIRequestContext,
  headers: Record<string, string>,
  approvalInstanceId: string,
) {
  const res = await request.post(`${apiBase}/__test__/evidence-snapshots/reset`, {
    headers,
    data: { approvalInstanceId },
  });
  await ensureOk(res);
  const payload = await res.json();
  return Number(payload?.deletedCount ?? 0);
}

test('agent read api: project-360/billing-360 are UI非依存で利用でき監査可能 @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProject(request, suffix, '360');
  const invoice = await createInvoice(request, projectId, 32100);
  const project360RequestId = `e2e-project-360-${suffix}`;
  const billing360RequestId = `e2e-billing-360-${suffix}`;

  const project360Res = await request.get(
    `${apiBase}/project-360?projectId=${encodeURIComponent(projectId)}`,
    { headers: { ...adminHeaders, 'x-request-id': project360RequestId } },
  );
  await ensureOk(project360Res);
  const project360 = await project360Res.json();
  expect(project360?.scope?.projectId).toBe(projectId);
  expect(typeof project360?.projects?.total).toBe('number');
  expect(typeof project360?.billing?.totalCount).toBe('number');
  expect(project360?.billing?.byStatus?.draft?.count ?? 0).toBeGreaterThan(0);

  const billing360Res = await request.get(
    `${apiBase}/billing-360?projectId=${encodeURIComponent(projectId)}`,
    { headers: { ...adminHeaders, 'x-request-id': billing360RequestId } },
  );
  await ensureOk(billing360Res);
  const billing360 = await billing360Res.json();
  expect(billing360?.scope?.projectId).toBe(projectId);
  expect(typeof billing360?.invoices?.totalCount).toBe('number');
  expect(billing360?.invoices?.byStatus?.draft?.count ?? 0).toBeGreaterThan(0);

  const outsiderHeaders = buildHeaders({
    userId: useJwtAuth
      ? jwtActorUsers.outsider
      : `e2e-agent-outsider-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [],
  });
  const forbiddenRes = await request.get(
    `${apiBase}/project-360?projectId=${encodeURIComponent(projectId)}`,
    { headers: outsiderHeaders },
  );
  expect(forbiddenRes.status()).toBe(403);
  const forbidden = await forbiddenRes.json();
  expect(forbidden?.error?.code).toBe('forbidden_project');

  const projectAudit = await waitAuditEvent(
    request,
    'project_360_viewed',
    'project_360',
    undefined,
    project360RequestId,
  );
  expect(projectAudit?.metadata?._request?.source).toBe(
    useJwtAuth ? 'agent' : 'api',
  );
  expect(projectAudit?.metadata?._request?.id).toBeTruthy();
  expect(projectAudit?.metadata?._auth?.principalUserId).toBe('demo-user');
  expect(projectAudit?.metadata?._auth?.actorUserId).toBe(
    useJwtAuth ? 'agent-bot' : 'demo-user',
  );

  const billingAudit = await waitAuditEvent(
    request,
    'billing_360_viewed',
    'billing_360',
    undefined,
    billing360RequestId,
  );
  expect(billingAudit?.metadata?._request?.source).toBe(
    useJwtAuth ? 'agent' : 'api',
  );
  expect(billingAudit?.metadata?._auth?.principalUserId).toBe('demo-user');
  expect(billingAudit?.metadata?._auth?.actorUserId).toBe(
    useJwtAuth ? 'agent-bot' : 'demo-user',
  );
  expect(String(invoice?.id || '')).toBeTruthy();
});

test('agent mvp: 請求ドラフト生成→承認→送信の通しが成立する @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProject(request, suffix, 'invoice-flow');
  const invoice = await createInvoice(request, projectId, 45000);
  expect(invoice.status).toBe('draft');

  const draftRes = await request.post(`${apiBase}/drafts`, {
    headers: adminHeaders,
    data: {
      kind: 'invoice_send',
      targetId: invoice.id,
    },
  });
  await ensureOk(draftRes);
  const generatedDraft = await draftRes.json();
  expect(generatedDraft?.kind).toBe('invoice_send');
  expect(typeof generatedDraft?.draft?.subject).toBe('string');
  expect(typeof generatedDraft?.draft?.body).toBe('string');
  expect(String(generatedDraft?.metadata?.targetId ?? '')).toBe(invoice.id);

  const regenerateRes = await request.post(`${apiBase}/drafts/regenerate`, {
    headers: adminHeaders,
    data: {
      kind: 'invoice_send',
      targetId: invoice.id,
      instruction: `e2e regenerate ${suffix}`,
      previous: {
        subject: String(generatedDraft?.draft?.subject ?? ''),
        body: String(generatedDraft?.draft?.body ?? ''),
      },
    },
  });
  await ensureOk(regenerateRes);
  const regeneratedDraft = await regenerateRes.json();
  expect(regeneratedDraft?.kind).toBe('invoice_send');
  expect(typeof regeneratedDraft?.draft?.subject).toBe('string');
  expect(typeof regeneratedDraft?.draft?.body).toBe('string');
  expect(Number(regeneratedDraft?.diff?.changeCount ?? 0)).toBeGreaterThan(0);

  const submitRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/submit`,
    {
      headers: adminHeaders,
      data: { reasonText: `e2e submit ${suffix}` },
    },
  );
  await ensureOk(submitRes);
  const submitted = await submitRes.json();
  expect(String(submitted?.status || '')).toMatch(/^pending_/);

  const approval = await findOpenApprovalInstance(
    request,
    'invoice',
    projectId,
    'invoices',
    invoice.id,
  );
  const finalStatus = await approveUntilClosed(request, approval.id);
  expect(finalStatus).toBe('approved');

  const approvedInvoiceRes = await request.get(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}`,
    { headers: adminHeaders },
  );
  await ensureOk(approvedInvoiceRes);
  const approvedInvoice = await approvedInvoiceRes.json();
  expect(approvedInvoice?.status).toBe('approved');

  const sendRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send?reasonText=${encodeURIComponent(`e2e send ${suffix}`)}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(sendRes);

  const sendLogsRes = await request.get(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send-logs`,
    { headers: adminHeaders },
  );
  await ensureOk(sendLogsRes);
  const sendLogs = await sendLogsRes.json();
  expect(Array.isArray(sendLogs?.items)).toBeTruthy();
  expect((sendLogs?.items ?? []).length).toBeGreaterThan(0);

  const draftAudit = await waitAuditEvent(
    request,
    'draft_generated',
    'drafts',
    invoice.id,
  );
  expect(draftAudit?.metadata?._request?.id).toBeTruthy();

  const regenerateAudit = await waitAuditEvent(
    request,
    'draft_regenerated',
    'drafts',
    invoice.id,
  );
  expect(regenerateAudit?.metadata?._request?.id).toBeTruthy();

  const approvalAudit = await waitAuditEvent(
    request,
    'approval_approve',
    'approval_instances',
    approval.id,
  );
  expect(approvalAudit?.metadata?._request?.id).toBeTruthy();
});

test('agent mvp guard: 承認未完了のsendはAPPROVAL_REQUIREDで拒否される @core', async ({
  request,
}) => {
  const suffix = runId();
  const actorUserId = useJwtAuth
    ? jwtActorUsers.approvalRequired
    : `e2e-agent-approval-required-${suffix}@example.com`;
  const actorHeaders = buildHeaders({
    userId: actorUserId,
    roles: ['admin', 'mgmt', 'exec'],
    groupIds: ['mgmt', 'exec'],
  });
  const projectId = await createProject(request, suffix, 'approval-required');
  const invoice = await createInvoice(request, projectId, 38000);
  const submitRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/submit`,
    {
      headers: actorHeaders,
      data: { reasonText: `e2e submit approval-required ${suffix}` },
    },
  );
  await ensureOk(submitRes);
  await createActionPolicy(request, actorHeaders, {
    actorUserId,
    requireReason: false,
    statusIn: ['pending_qa', 'pending_exec'],
    guards: [{ type: 'approval_open' }],
  });

  const requestId = `e2e-send-approval-required-${suffix}`;
  const sendRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send`,
    {
      headers: { ...actorHeaders, 'x-request-id': requestId },
    },
  );
  expect(sendRes.status()).toBe(403);
  const sendPayload = await sendRes.json();
  expect(sendPayload?.error?.code).toBe('APPROVAL_REQUIRED');
  expect(sendPayload?.error?.details?.reason).toBe('guard_failed');
  expect(sendPayload?.error?.details?.guardFailures?.[0]?.type).toBe(
    'approval_open',
  );

  const audits = await fetchAuditEventsByRequestId(request, requestId);
  expect(
    audits.some((item: any) => item?.action === 'action_policy_override'),
  ).toBeFalsy();
});

test('agent mvp guard: 承認済みでも証跡欠落時はEVIDENCE_REQUIREDで拒否される @core', async ({
  request,
}) => {
  const suffix = runId();
  const actorUserId = useJwtAuth
    ? jwtActorUsers.evidenceRequired
    : `e2e-agent-evidence-required-${suffix}@example.com`;
  const actorHeaders = buildHeaders({
    userId: actorUserId,
    roles: ['admin', 'mgmt', 'exec'],
    groupIds: ['mgmt', 'exec'],
  });
  const projectId = await createProject(request, suffix, 'evidence-required');
  const invoice = await createInvoice(request, projectId, 47000);
  await createActionPolicy(request, actorHeaders, {
    actorUserId,
    requireReason: false,
    statusIn: ['approved'],
  });

  const submitRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/submit`,
    {
      headers: actorHeaders,
      data: { reasonText: `e2e submit evidence-required ${suffix}` },
    },
  );
  await ensureOk(submitRes);
  const approval = await findOpenApprovalInstance(
    request,
    'invoice',
    projectId,
    'invoices',
    invoice.id,
  );
  const finalStatus = await approveUntilClosed(request, approval.id);
  expect(finalStatus).toBe('approved');

  const deletedCount = await resetEvidenceSnapshots(
    request,
    actorHeaders,
    approval.id,
  );
  expect(deletedCount).toBeGreaterThan(0);

  const requestId = `e2e-send-evidence-required-${suffix}`;
  const sendRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send`,
    {
      headers: {
        ...actorHeaders,
        'x-request-id': requestId,
        'x-e2e-approval-evidence-required-actions': 'invoice:send',
      },
    },
  );
  expect(sendRes.status()).toBe(403);
  const sendPayload = await sendRes.json();
  expect(sendPayload?.error?.code).toBe('EVIDENCE_REQUIRED');
  expect(sendPayload?.error?.details?.approvalInstanceId).toBe(approval.id);

  const audits = await fetchAuditEventsByRequestId(request, requestId);
  expect(
    audits.some((item: any) => item?.action === 'action_policy_override'),
  ).toBeFalsy();
});

test('agent mvp guard: reason未指定はREASON_REQUIRED、理由ありは監査付きで評価される @core', async ({
  request,
}) => {
  const suffix = runId();
  const actorUserId = useJwtAuth
    ? jwtActorUsers.reasonRequired
    : `e2e-agent-reason-required-${suffix}@example.com`;
  const actorHeaders = buildHeaders({
    userId: actorUserId,
    roles: ['admin', 'mgmt', 'exec'],
    groupIds: ['mgmt', 'exec'],
  });
  const projectId = await createProject(request, suffix, 'reason-required');
  const invoice = await createInvoice(request, projectId, 46000);
  const policyId = await createActionPolicy(request, actorHeaders, {
    actorUserId,
    requireReason: true,
  });

  const missingReasonRequestId = `e2e-send-reason-missing-${suffix}`;
  const missingReasonRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send`,
    {
      headers: { ...actorHeaders, 'x-request-id': missingReasonRequestId },
    },
  );
  expect(missingReasonRes.status()).toBe(400);
  const missingReasonPayload = await missingReasonRes.json();
  expect(missingReasonPayload?.error?.code).toBe('REASON_REQUIRED');
  expect(missingReasonPayload?.error?.details?.matchedPolicyId).toBe(policyId);
  const missingReasonAudits = await fetchAuditEventsByRequestId(
    request,
    missingReasonRequestId,
  );
  expect(
    missingReasonAudits.some(
      (item: any) => item?.action === 'action_policy_override',
    ),
  ).toBeFalsy();

  const submitRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/submit`,
    {
      headers: actorHeaders,
      data: { reasonText: `e2e submit reason-required ${suffix}` },
    },
  );
  await ensureOk(submitRes);
  const approval = await findOpenApprovalInstance(
    request,
    'invoice',
    projectId,
    'invoices',
    invoice.id,
  );
  const finalStatus = await approveUntilClosed(request, approval.id);
  expect(finalStatus).toBe('approved');

  const withReasonRequestId = `e2e-send-reason-ok-${suffix}`;
  const withReasonRes = await request.post(
    `${apiBase}/invoices/${encodeURIComponent(invoice.id)}/send?templateId=missing-template&reasonText=${encodeURIComponent(`e2e override ${suffix}`)}`,
    {
      headers: { ...actorHeaders, 'x-request-id': withReasonRequestId },
    },
  );
  expect(withReasonRes.status()).toBe(404);
  const withReasonPayload = await withReasonRes.json();
  expect(withReasonPayload?.error?.code).toBe('template_not_found');

  const overrideAudit = await waitAuditEvent(
    request,
    'action_policy_override',
    'invoices',
    invoice.id,
    withReasonRequestId,
  );
  expect(overrideAudit?.reasonText).toBe(`e2e override ${suffix}`);
  expect(overrideAudit?.metadata?.matchedPolicyId).toBe(policyId);
  expect(overrideAudit?.metadata?._request?.id).toBe(withReasonRequestId);
});
