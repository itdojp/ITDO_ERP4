import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

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

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function createEstimateFixture(
  request: APIRequestContext,
  suffix: string,
  label: string,
) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-APR-${label}-${suffix}`,
      name: `E2E Approval ${label} ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectId = project.id as string;
  expect(projectId).toBeTruthy();

  const estimateRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      headers: adminHeaders,
      data: {
        totalAmount: 100000,
        notes: `E2E estimate ${label} ${suffix}`,
      },
    },
  );
  await ensureOk(estimateRes);
  const estimatePayload = await estimateRes.json();
  const estimateId = estimatePayload?.estimate?.id as string;
  expect(estimateId).toBeTruthy();

  return { projectId, estimateId };
}

async function submitEstimate(
  request: APIRequestContext,
  estimateId: string,
  reasonText: string,
) {
  const submitRes = await request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    {
      headers: adminHeaders,
      data: { reasonText },
    },
  );
  await ensureOk(submitRes);
  const submitted = await submitRes.json();
  expect(submitted?.status).toBe('pending_qa');
}

async function findApprovalInstance(
  request: APIRequestContext,
  projectId: string,
  targetId: string,
) {
  let approvalInstanceId = '';
  await expect
    .poll(
      async () => {
        const listRes = await request.get(
          `${apiBase}/approval-instances?flowType=estimate&projectId=${encodeURIComponent(projectId)}`,
          {
            headers: adminHeaders,
          },
        );
        if (!listRes.ok()) return '';
        const payload = await listRes.json();
        const matched = (payload?.items ?? []).find(
          (item: any) =>
            item?.targetId === targetId &&
            item?.status !== 'approved' &&
            item?.status !== 'rejected',
        );
        approvalInstanceId = String(matched?.id ?? '');
        return approvalInstanceId;
      },
      { timeout: 5000 },
    )
    .not.toBe('');
  return approvalInstanceId;
}

async function approveUntilClosed(
  request: APIRequestContext,
  approvalInstanceId: string,
) {
  const maxTransitions = 8;
  let status = '';
  for (let index = 0; index < maxTransitions; index += 1) {
    const actRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approvalInstanceId)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: 'e2e approve' },
      },
    );
    await ensureOk(actRes);
    const acted = await actRes.json();
    status = String(acted?.status ?? '');
    if (status !== 'pending_qa' && status !== 'pending_exec') break;
  }
  return status;
}

async function expectAuditAction(
  request: APIRequestContext,
  action: string,
  targetId: string,
) {
  await expect
    .poll(
      async () => {
        const params = new URLSearchParams({
          action,
          targetTable: 'approval_instances',
          targetId,
          format: 'json',
          mask: '0',
          limit: '20',
        });
        const res = await request.get(`${apiBase}/audit-logs?${params}`, {
          headers: adminHeaders,
        });
        if (!res.ok()) return false;
        const payload = await res.json();
        return (
          (payload?.items ?? []).some((item: any) => item?.action === action) ??
          false
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);
}

test('approval flow: submit -> approve/reject with guard and audit @core', async ({
  request,
}) => {
  const suffix = runId();

  const approveFixture = await createEstimateFixture(
    request,
    suffix,
    'approve',
  );
  await submitEstimate(
    request,
    approveFixture.estimateId,
    `e2e submit approve ${suffix}`,
  );
  const approveApprovalId = await findApprovalInstance(
    request,
    approveFixture.projectId,
    approveFixture.estimateId,
  );
  expect(approveApprovalId).toBeTruthy();

  const nonApproverHeaders = buildHeaders({
    userId: `e2e-approval-non-approver-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [approveFixture.projectId],
  });
  const forbiddenActRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(approveApprovalId)}/act`,
    {
      headers: nonApproverHeaders,
      data: { action: 'approve', reason: 'e2e forbidden approve' },
    },
  );
  expect(forbiddenActRes.status()).toBe(403);
  const forbiddenAct = await forbiddenActRes.json();
  expect(forbiddenAct?.error?.code).toBe('forbidden');
  expect(forbiddenAct?.error?.category).toBe('permission');

  const approvedStatus = await approveUntilClosed(request, approveApprovalId);
  expect(approvedStatus).toBe('approved');

  const approvedEstimateRes = await request.get(
    `${apiBase}/estimates/${encodeURIComponent(approveFixture.estimateId)}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(approvedEstimateRes);
  const approvedEstimate = await approvedEstimateRes.json();
  expect(approvedEstimate?.status).toBe('approved');
  await expectAuditAction(request, 'approval_approve', approveApprovalId);

  const rejectFixture = await createEstimateFixture(request, suffix, 'reject');
  await submitEstimate(
    request,
    rejectFixture.estimateId,
    `e2e submit reject ${suffix}`,
  );
  const rejectApprovalId = await findApprovalInstance(
    request,
    rejectFixture.projectId,
    rejectFixture.estimateId,
  );
  expect(rejectApprovalId).toBeTruthy();

  const rejectRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(rejectApprovalId)}/act`,
    {
      headers: adminHeaders,
      data: { action: 'reject', reason: `e2e reject ${suffix}` },
    },
  );
  await ensureOk(rejectRes);
  const rejected = await rejectRes.json();
  expect(rejected?.status).toBe('rejected');

  const rejectedEstimateRes = await request.get(
    `${apiBase}/estimates/${encodeURIComponent(rejectFixture.estimateId)}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(rejectedEstimateRes);
  const rejectedEstimate = await rejectedEstimateRes.json();
  expect(rejectedEstimate?.status).toBe('rejected');
  await expectAuditAction(request, 'approval_reject', rejectApprovalId);
});
