import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureOk } from './approval-e2e-helpers';

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
    const res = await request.get(`${apiBase}/audit-logs?${params}`, {
      headers: adminHeaders,
    });
    if (!res.ok()) return null;
    const payload = await res.json();
    return (payload?.items ?? []).find(
      (item: any) =>
        item?.action === action &&
        (targetId ? String(item?.targetId || '') === targetId : true),
    );
  };

  await expect
    .poll(async () => {
      const item = await fetchEvent();
      return item ? 'ok' : null;
    })
    .toBe('ok');

  return fetchEvent();
}

test('agent read api: project-360/billing-360 are UI非依存で利用でき監査可能 @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProject(request, suffix, '360');
  const invoice = await createInvoice(request, projectId, 32100);

  const project360Res = await request.get(
    `${apiBase}/project-360?projectId=${encodeURIComponent(projectId)}`,
    { headers: adminHeaders },
  );
  await ensureOk(project360Res);
  const project360 = await project360Res.json();
  expect(project360?.scope?.projectId).toBe(projectId);
  expect(typeof project360?.projects?.total).toBe('number');
  expect(typeof project360?.billing?.totalCount).toBe('number');
  expect(project360?.billing?.byStatus?.draft?.count ?? 0).toBeGreaterThan(0);

  const billing360Res = await request.get(
    `${apiBase}/billing-360?projectId=${encodeURIComponent(projectId)}`,
    { headers: adminHeaders },
  );
  await ensureOk(billing360Res);
  const billing360 = await billing360Res.json();
  expect(billing360?.scope?.projectId).toBe(projectId);
  expect(typeof billing360?.invoices?.totalCount).toBe('number');
  expect(billing360?.invoices?.byStatus?.draft?.count ?? 0).toBeGreaterThan(0);

  const outsiderHeaders = buildHeaders({
    userId: `e2e-agent-outsider-${suffix}@example.com`,
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
  );
  expect(projectAudit?.metadata?._request?.source).toBe('api');
  expect(projectAudit?.metadata?._request?.id).toBeTruthy();
  expect(projectAudit?.metadata?._auth?.principalUserId).toBe('demo-user');
  expect(projectAudit?.metadata?._auth?.actorUserId).toBe('demo-user');

  const billingAudit = await waitAuditEvent(
    request,
    'billing_360_viewed',
    'billing_360',
  );
  expect(billingAudit?.metadata?._request?.source).toBe('api');
  expect(billingAudit?.metadata?._auth?.principalUserId).toBe('demo-user');
  expect(String(invoice?.id || '')).toBeTruthy();
});

test('agent mvp: 請求ドラフト生成→承認→送信の通しが成立する @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProject(request, suffix, 'invoice-flow');
  const invoice = await createInvoice(request, projectId, 45000);
  expect(invoice.status).toBe('draft');

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

  const approvalAudit = await waitAuditEvent(
    request,
    'approval_approve',
    'approval_instances',
    approval.id,
  );
  expect(approvalAudit?.metadata?._request?.id).toBeTruthy();
});
