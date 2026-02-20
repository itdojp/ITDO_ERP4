import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createProjectAndEstimate,
  ensureOk,
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
  roles: ['admin', 'mgmt', 'exec'],
  groupIds: ['mgmt', 'exec'],
});

async function createEstimateFixture(
  request: APIRequestContext,
  suffix: string,
  label: string,
) {
  const fixture = await createProjectAndEstimate({
    request,
    apiBase,
    headers: adminHeaders,
    project: {
      code: `E2E-APR-${label}-${suffix}`,
      name: `E2E Approval ${label} ${suffix}`,
      status: 'active',
    },
    estimate: {
      totalAmount: 100000,
      notes: `E2E estimate ${label} ${suffix}`,
    },
  });
  expect(fixture.projectId).toBeTruthy();
  expect(fixture.estimateId).toBeTruthy();
  return fixture;
}

const MAX_APPROVAL_TRANSITIONS = 8;

async function approveUntilClosed(
  request: APIRequestContext,
  approvalInstanceId: string,
) {
  let status = '';
  for (let index = 0; index < MAX_APPROVAL_TRANSITIONS; index += 1) {
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
        return (payload?.items ?? []).some(
          (item: any) => item?.action === action,
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);
}

test('approval flow: submit -> approve with guard and audit @core', async ({
  request,
}) => {
  const suffix = runId();
  const approveFixture = await createEstimateFixture(
    request,
    suffix,
    'approve',
  );
  const approveApproval = await submitAndFindApprovalInstance({
    request,
    apiBase,
    headers: adminHeaders,
    flowType: 'estimate',
    projectId: approveFixture.projectId,
    targetTable: 'estimates',
    targetId: approveFixture.estimateId,
    submitData: { reasonText: `e2e submit approve ${suffix}` },
  });
  const approveApprovalId = approveApproval.id;
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
});

test('approval flow: submit -> reject with audit @core', async ({
  request,
}) => {
  const suffix = runId();
  const rejectFixture = await createEstimateFixture(request, suffix, 'reject');
  const rejectApproval = await submitAndFindApprovalInstance({
    request,
    apiBase,
    headers: adminHeaders,
    flowType: 'estimate',
    projectId: rejectFixture.projectId,
    targetTable: 'estimates',
    targetId: rejectFixture.estimateId,
    submitData: { reasonText: `e2e submit reject ${suffix}` },
  });
  const rejectApprovalId = rejectApproval.id;
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

test('approval flow: expense requires qa stage before exec stage @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createEstimateFixture(
    request,
    suffix,
    'expense',
  );
  const requesterHeaders = buildHeaders({
    userId: `e2e-expense-requester-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });

  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 110000,
        amountMax: 130000,
      },
      steps: [
        { stepOrder: 1, approverGroupId: 'mgmt' },
        { stepOrder: 2, approverGroupId: 'exec' },
      ],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();

  try {
    const expenseRes = await request.post(`${apiBase}/expenses`, {
      headers: requesterHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: requesterHeaders['x-user-id'],
        category: 'travel',
        amount: 120000,
        currency: 'JPY',
        incurredOn: '2026-01-02',
        receiptUrl: `https://example.com/e2e-expense-receipt-${suffix}.pdf`,
      },
    });
    await ensureOk(expenseRes);
    const expense = await expenseRes.json();

    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId: expenseFixture.projectId,
      targetTable: 'expenses',
      targetId: expense.id as string,
      submitData: {},
    });
    expect(approval.status).toBe('pending_qa');

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e expense qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes);
    const qaApproved = await qaApproveRes.json();
    expect(qaApproved?.status).toBe('pending_exec');

    const execApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: {
          action: 'approve',
          reason: `e2e expense exec approve ${suffix}`,
        },
      },
    );
    await ensureOk(execApproveRes);
    const execApproved = await execApproveRes.json();
    expect(execApproved?.status).toBe('approved');

    const approvedExpenseRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expense.id)}`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(approvedExpenseRes);
    const approvedExpense = await approvedExpenseRes.json();
    expect(approvedExpense?.status).toBe('approved');
  } finally {
    if (createdRule?.id) {
      const deactivateRes = await request.patch(
        `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
        {
          headers: adminHeaders,
          data: { isActive: false },
        },
      );
      await ensureOk(deactivateRes);
    }
  }
});
