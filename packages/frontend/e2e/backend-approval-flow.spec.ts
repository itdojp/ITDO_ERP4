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

async function createProjectFixture(
  request: APIRequestContext,
  suffix: string,
  label: string,
  options?: {
    budgetCost?: number;
    currency?: string;
  },
) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-APR-${label}-${suffix}`,
      name: `E2E Approval ${label} ${suffix}`,
      status: 'active',
      ...(options?.budgetCost !== undefined
        ? { budgetCost: options.budgetCost }
        : {}),
      ...(options?.currency ? { currency: options.currency } : {}),
    },
  });
  await ensureOk(projectRes);
  const projectPayload = await projectRes.json();
  const projectId = (projectPayload?.id ?? projectPayload?.project?.id ?? '')
    .toString()
    .trim();
  expect(projectId).toBeTruthy();
  return { projectId };
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
  const expenseFixture = await createProjectFixture(request, suffix, 'expense');
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
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const deactivateRes = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(deactivateRes);
  };

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
    expect(String(approval?.id ?? '')).not.toBe('');
    expect(String(approval?.status ?? '')).toBe('pending_qa');
    // Approval instance has already persisted steps; deactivate early to reduce test cross-impact.
    await deactivateRule();

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e expense qa approve ${suffix}` },
      },
    );
    expect(qaApproveRes.status()).toBe(409);
    const qaApproveBlocked = await qaApproveRes.json();
    expect(qaApproveBlocked?.error?.code).toBe('EXPENSE_QA_CHECKLIST_REQUIRED');

    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(expense.id)}/qa-checklist`,
      {
        headers: adminHeaders,
        data: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
          notes: `e2e checklist ${suffix}`,
        },
      },
    );
    await ensureOk(checklistRes);
    const checklist = await checklistRes.json();
    expect(checklist?.isComplete).toBe(true);

    const qaApproveRes2 = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e expense qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes2);
    const qaApproved = await qaApproveRes2.json();
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
    await deactivateRule();
  }
});

test('approval flow: expense over budget requires escalation details @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createProjectFixture(
    request,
    suffix,
    'expense-budget',
    {
      budgetCost: 50000,
      currency: 'JPY',
    },
  );
  const requesterHeaders = buildHeaders({
    userId: `e2e-expense-budget-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });
  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 70000,
        amountMax: 90000,
      },
      steps: [
        { stepOrder: 1, approverGroupId: 'mgmt' },
        { stepOrder: 2, approverGroupId: 'exec' },
      ],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const deactivateRes = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(deactivateRes);
  };
  try {
    const expenseRes = await request.post(`${apiBase}/expenses`, {
      headers: requesterHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: requesterHeaders['x-user-id'],
        category: 'travel',
        amount: 80000,
        currency: 'JPY',
        incurredOn: '2026-02-02',
        receiptUrl: `https://example.com/e2e-expense-budget-${suffix}.pdf`,
      },
    });
    await ensureOk(expenseRes);
    const expense = await expenseRes.json();

    const submitWithoutEscalationRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expense.id)}/submit`,
      {
        headers: requesterHeaders,
        data: {},
      },
    );
    expect(submitWithoutEscalationRes.status()).toBe(400);
    const submitWithoutEscalation = await submitWithoutEscalationRes.json();
    expect(submitWithoutEscalation?.error?.code).toBe(
      'BUDGET_ESCALATION_REQUIRED',
    );

    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId: expenseFixture.projectId,
      targetTable: 'expenses',
      targetId: expense.id as string,
      submitData: {
        budgetEscalationReason: `budget reason ${suffix}`,
        budgetEscalationImpact: `budget impact ${suffix}`,
        budgetEscalationAlternative: `budget alternative ${suffix}`,
      },
    });
    expect(approval.status).toBe('pending_qa');

    const submittedExpenseRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expense.id)}`,
      {
        headers: requesterHeaders,
      },
    );
    await ensureOk(submittedExpenseRes);
    const submittedExpense = await submittedExpenseRes.json();
    expect(submittedExpense?.status).toBe('pending_qa');
    expect(String(submittedExpense?.budgetEscalationReason || '')).toContain(
      `budget reason ${suffix}`,
    );
    expect(Number(submittedExpense?.budgetOverrunAmount ?? 0)).toBeGreaterThan(
      0,
    );
    await deactivateRule();

    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(expense.id)}/qa-checklist`,
      {
        headers: adminHeaders,
        data: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
          notes: `e2e budget checklist ${suffix}`,
        },
      },
    );
    await ensureOk(checklistRes);

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes);
    const qaApproved = await qaApproveRes.json();
    expect(qaApproved?.status).toBe('pending_exec');

    const execApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e exec approve ${suffix}` },
      },
    );
    await ensureOk(execApproveRes);
    const execApproved = await execApproveRes.json();
    expect(execApproved?.status).toBe('approved');
  } finally {
    await deactivateRule();
  }
});

test('approval flow: expense attachments/comments and transition history are tracked @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createProjectFixture(
    request,
    suffix,
    'expense-history',
    {
      budgetCost: 200000,
      currency: 'JPY',
    },
  );
  const requesterHeaders = buildHeaders({
    userId: `e2e-expense-history-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });
  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 25000,
        amountMax: 35000,
      },
      steps: [
        { stepOrder: 1, approverGroupId: 'mgmt' },
        { stepOrder: 2, approverGroupId: 'exec' },
      ],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const deactivateRes = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(deactivateRes);
  };

  try {
    const createRes = await request.post(`${apiBase}/expenses`, {
      headers: requesterHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: requesterHeaders['x-user-id'],
        category: 'travel',
        amount: 30000,
        currency: 'JPY',
        incurredOn: '2026-02-12',
        lines: [
          {
            lineNo: 1,
            expenseDate: '2026-02-11',
            category: 'travel',
            description: `taxi ${suffix}`,
            amount: 18000,
            taxRate: 10,
            taxAmount: 1800,
            currency: 'JPY',
          },
          {
            lineNo: 2,
            expenseDate: '2026-02-12',
            category: 'meal',
            description: `meal ${suffix}`,
            amount: 12000,
            taxRate: 10,
            taxAmount: 1200,
            currency: 'JPY',
          },
        ],
        attachments: [
          {
            fileUrl: `https://example.com/e2e/expense-history-${suffix}.pdf`,
            fileName: `expense-history-${suffix}.pdf`,
            contentType: 'application/pdf',
          },
        ],
      },
    });
    await ensureOk(createRes);
    const expense = await createRes.json();
    const expenseId = String(expense?.id ?? '');
    expect(expenseId).not.toBe('');

    const detailRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}`,
      {
        headers: requesterHeaders,
      },
    );
    await ensureOk(detailRes);
    const detail = await detailRes.json();
    expect(String(detail?.receiptUrl ?? '')).toBe('');
    expect(detail?.lines).toHaveLength(2);
    expect(detail?.attachments).toHaveLength(1);

    const commentRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/comments`,
      {
        headers: requesterHeaders,
        data: {
          kind: 'review',
          body: `e2e expense comment ${suffix}`,
        },
      },
    );
    await ensureOk(commentRes);

    // Submit without receiptUrl and verify attachment evidence is accepted.
    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId: expenseFixture.projectId,
      targetTable: 'expenses',
      targetId: expenseId,
      submitData: {},
    });
    expect(approval.status).toBe('pending_qa');
    await deactivateRule();

    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/qa-checklist`,
      {
        headers: adminHeaders,
        data: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
          notes: `e2e qa checklist ${suffix}`,
        },
      },
    );
    await ensureOk(checklistRes);

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes);
    const qaApproved = await qaApproveRes.json();
    expect(qaApproved?.status).toBe('pending_exec');

    const execApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e exec approve ${suffix}` },
      },
    );
    await ensureOk(execApproveRes);
    const execApproved = await execApproveRes.json();
    expect(execApproved?.status).toBe('approved');

    const markPaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/mark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `e2e mark paid ${suffix}` },
      },
    );
    await ensureOk(markPaidRes);
    const paid = await markPaidRes.json();
    expect(paid?.settlementStatus).toBe('paid');

    const unmarkPaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/unmark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `e2e unmark paid ${suffix}` },
      },
    );
    await ensureOk(unmarkPaidRes);
    const unpaid = await unmarkPaidRes.json();
    expect(unpaid?.settlementStatus).toBe('unpaid');

    const transitionsRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/state-transitions?limit=20`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(transitionsRes);
    const transitions = await transitionsRes.json();
    const triggers = new Set(
      (transitions?.items ?? []).map((item: any) =>
        String(item?.metadata?.trigger ?? ''),
      ),
    );
    expect(triggers.has('create')).toBe(true);
    expect(triggers.has('submit')).toBe(true);
    expect(triggers.has('mark_paid')).toBe(true);
    expect(triggers.has('unmark_paid')).toBe(true);

    const updatedDetailRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(updatedDetailRes);
    const updatedDetail = await updatedDetailRes.json();
    expect(
      (updatedDetail?.comments ?? []).some(
        (item: any) => String(item?.body ?? '').indexOf(suffix) >= 0,
      ),
    ).toBe(true);
  } finally {
    await deactivateRule();
  }
});

test('approval flow: expense submit requires receipt evidence and transition log access is owner-only @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createProjectFixture(
    request,
    suffix,
    'expense-evidence',
  );
  const ownerHeaders = buildHeaders({
    userId: `e2e-expense-evidence-owner-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });
  const otherUserHeaders = buildHeaders({
    userId: `e2e-expense-evidence-other-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });

  const createRes = await request.post(`${apiBase}/expenses`, {
    headers: ownerHeaders,
    data: {
      projectId: expenseFixture.projectId,
      userId: ownerHeaders['x-user-id'],
      category: 'travel',
      amount: 12000,
      currency: 'JPY',
      incurredOn: '2026-02-15',
    },
  });
  await ensureOk(createRes);
  const expense = await createRes.json();
  const expenseId = String(expense?.id ?? '');
  expect(expenseId).not.toBe('');

  const submitRes = await request.post(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/submit`,
    {
      headers: ownerHeaders,
      data: {},
    },
  );
  expect(submitRes.status()).toBe(400);
  const submitPayload = await submitRes.json();
  expect(submitPayload?.error?.code).toBe('RECEIPT_REQUIRED');

  const transitionsAsOwnerRes = await request.get(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/state-transitions?limit=20`,
    {
      headers: ownerHeaders,
    },
  );
  await ensureOk(transitionsAsOwnerRes);
  const transitionsAsOwner = await transitionsAsOwnerRes.json();
  const ownerTriggers = new Set(
    (transitionsAsOwner?.items ?? []).map((item: any) =>
      String(item?.metadata?.trigger ?? ''),
    ),
  );
  expect(ownerTriggers.has('create')).toBe(true);
  expect(ownerTriggers.has('submit')).toBe(false);

  const transitionsAsOtherRes = await request.get(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/state-transitions?limit=20`,
    {
      headers: otherUserHeaders,
    },
  );
  expect(transitionsAsOtherRes.status()).toBe(403);
});

test('approval flow: expense settlement guards reject invalid transitions and missing reason @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createProjectFixture(
    request,
    suffix,
    'expense-settlement-guard',
    {
      budgetCost: 180000,
      currency: 'JPY',
    },
  );
  const ownerHeaders = buildHeaders({
    userId: `e2e-expense-settlement-guard-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });

  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 18000,
        amountMax: 22000,
      },
      steps: [
        { stepOrder: 1, approverGroupId: 'mgmt' },
        { stepOrder: 2, approverGroupId: 'exec' },
      ],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const deactivateRes = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(deactivateRes);
  };

  try {
    const createRes = await request.post(`${apiBase}/expenses`, {
      headers: ownerHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: ownerHeaders['x-user-id'],
        category: 'travel',
        amount: 20000,
        currency: 'JPY',
        incurredOn: '2026-02-16',
        receiptUrl: `https://example.com/e2e/settlement-guard-${suffix}.pdf`,
      },
    });
    await ensureOk(createRes);
    const expense = await createRes.json();
    const expenseId = String(expense?.id ?? '');
    expect(expenseId).not.toBe('');

    const markPaidBeforeApproveRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/mark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `mark before approve ${suffix}` },
      },
    );
    expect(markPaidBeforeApproveRes.status()).toBe(409);
    const markPaidBeforeApprove = await markPaidBeforeApproveRes.json();
    expect(markPaidBeforeApprove?.error?.code).toBe('INVALID_STATUS');

    const unmarkBeforePaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/unmark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `unmark before paid ${suffix}` },
      },
    );
    expect(unmarkBeforePaidRes.status()).toBe(409);
    const unmarkBeforePaid = await unmarkBeforePaidRes.json();
    expect(unmarkBeforePaid?.error?.code).toBe('INVALID_STATUS');

    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: ownerHeaders,
      flowType: 'expense',
      projectId: expenseFixture.projectId,
      targetTable: 'expenses',
      targetId: expenseId,
      submitData: {},
    });
    expect(approval.status).toBe('pending_qa');
    await deactivateRule();

    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/qa-checklist`,
      {
        headers: adminHeaders,
        data: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
        },
      },
    );
    await ensureOk(checklistRes);

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes);

    const execApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `exec approve ${suffix}` },
      },
    );
    await ensureOk(execApproveRes);
    const execApproved = await execApproveRes.json();
    expect(execApproved?.status).toBe('approved');

    const markPaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/mark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `mark paid ${suffix}` },
      },
    );
    await ensureOk(markPaidRes);

    const unmarkMissingReasonRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/unmark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: '   ' },
      },
    );
    expect(unmarkMissingReasonRes.status()).toBe(400);
    const unmarkMissingReason = await unmarkMissingReasonRes.json();
    expect(unmarkMissingReason?.error?.code).toBe('INVALID_REASON');

    const unmarkPaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}/unmark-paid`,
      {
        headers: adminHeaders,
        data: { reasonText: `unmark paid ${suffix}` },
      },
    );
    await ensureOk(unmarkPaidRes);
    const unmarked = await unmarkPaidRes.json();
    expect(unmarked?.settlementStatus).toBe('unpaid');
  } finally {
    await deactivateRule();
  }
});

test('approval flow: expense list filters (receipt/settlement/paid date) work as expected @core', async ({
  request,
}) => {
  const suffix = runId();
  const expenseFixture = await createProjectFixture(
    request,
    suffix,
    'expense-list-filters',
    {
      budgetCost: 300000,
      currency: 'JPY',
    },
  );
  const ownerHeaders = buildHeaders({
    userId: `e2e-expense-list-filter-${suffix}@example.com`,
    roles: ['user'],
    projectIds: [expenseFixture.projectId],
  });
  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 19000,
        amountMax: 21000,
      },
      steps: [
        { stepOrder: 1, approverGroupId: 'mgmt' },
        { stepOrder: 2, approverGroupId: 'exec' },
      ],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const deactivateRes = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(deactivateRes);
  };

  try {
    const withReceiptRes = await request.post(`${apiBase}/expenses`, {
      headers: ownerHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: ownerHeaders['x-user-id'],
        category: 'travel',
        amount: 20000,
        currency: 'JPY',
        incurredOn: '2026-02-18',
        receiptUrl: `https://example.com/e2e/list-filter-with-receipt-${suffix}.pdf`,
      },
    });
    await ensureOk(withReceiptRes);
    const withReceiptExpense = await withReceiptRes.json();
    const paidExpenseId = String(withReceiptExpense?.id ?? '');
    expect(paidExpenseId).not.toBe('');

    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: ownerHeaders,
      flowType: 'expense',
      projectId: expenseFixture.projectId,
      targetTable: 'expenses',
      targetId: paidExpenseId,
      submitData: {},
    });
    expect(approval.status).toBe('pending_qa');
    await deactivateRule();

    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(paidExpenseId)}/qa-checklist`,
      {
        headers: adminHeaders,
        data: {
          amountVerified: true,
          receiptVerified: true,
          journalPrepared: true,
          projectLinked: true,
          budgetChecked: true,
        },
      },
    );
    await ensureOk(checklistRes);

    const qaApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `qa approve ${suffix}` },
      },
    );
    await ensureOk(qaApproveRes);

    const execApproveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `exec approve ${suffix}` },
      },
    );
    await ensureOk(execApproveRes);

    const markPaidRes = await request.post(
      `${apiBase}/expenses/${encodeURIComponent(paidExpenseId)}/mark-paid`,
      {
        headers: adminHeaders,
        data: {
          paidAt: '2026-02-20',
          reasonText: `mark paid for filter ${suffix}`,
        },
      },
    );
    await ensureOk(markPaidRes);

    const withoutReceiptRes = await request.post(`${apiBase}/expenses`, {
      headers: ownerHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: ownerHeaders['x-user-id'],
        category: 'meal',
        amount: 5000,
        currency: 'JPY',
        incurredOn: '2026-02-19',
      },
    });
    await ensureOk(withoutReceiptRes);
    const withoutReceiptExpense = await withoutReceiptRes.json();
    const unpaidExpenseId = String(withoutReceiptExpense?.id ?? '');
    expect(unpaidExpenseId).not.toBe('');

    const attachmentOnlyRes = await request.post(`${apiBase}/expenses`, {
      headers: ownerHeaders,
      data: {
        projectId: expenseFixture.projectId,
        userId: ownerHeaders['x-user-id'],
        category: 'supplies',
        amount: 7200,
        currency: 'JPY',
        incurredOn: '2026-02-19',
        attachments: [
          {
            fileUrl: `https://example.com/e2e/list-filter-attachment-only-${suffix}.pdf`,
            fileName: `list-filter-attachment-only-${suffix}.pdf`,
            contentType: 'application/pdf',
            fileSizeBytes: 1024,
          },
        ],
      },
    });
    await ensureOk(attachmentOnlyRes);
    const attachmentOnlyExpense = await attachmentOnlyRes.json();
    const attachmentOnlyExpenseId = String(attachmentOnlyExpense?.id ?? '');
    expect(attachmentOnlyExpenseId).not.toBe('');

    const paidOnlyRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&settlementStatus=paid`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(paidOnlyRes);
    const paidOnly = await paidOnlyRes.json();
    const paidOnlyIds = new Set(
      (paidOnly?.items ?? []).map((item: any) => String(item?.id ?? '')),
    );
    expect(paidOnlyIds.has(paidExpenseId)).toBe(true);
    expect(paidOnlyIds.has(unpaidExpenseId)).toBe(false);

    const withReceiptOnlyRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&hasReceipt=true`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(withReceiptOnlyRes);
    const withReceiptOnly = await withReceiptOnlyRes.json();
    const withReceiptIds = new Set(
      (withReceiptOnly?.items ?? []).map((item: any) => String(item?.id ?? '')),
    );
    expect(withReceiptIds.has(paidExpenseId)).toBe(true);
    expect(withReceiptIds.has(attachmentOnlyExpenseId)).toBe(true);
    expect(withReceiptIds.has(unpaidExpenseId)).toBe(false);

    const withoutReceiptOnlyRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&hasReceipt=false`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(withoutReceiptOnlyRes);
    const withoutReceiptOnly = await withoutReceiptOnlyRes.json();
    const withoutReceiptIds = new Set(
      (withoutReceiptOnly?.items ?? []).map((item: any) =>
        String(item?.id ?? ''),
      ),
    );
    expect(withoutReceiptIds.has(paidExpenseId)).toBe(false);
    expect(withoutReceiptIds.has(attachmentOnlyExpenseId)).toBe(false);
    expect(withoutReceiptIds.has(unpaidExpenseId)).toBe(true);

    const paidRangeHitRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&paidFrom=2026-02-19&paidTo=2026-02-21`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(paidRangeHitRes);
    const paidRangeHit = await paidRangeHitRes.json();
    const paidRangeHitIds = new Set(
      (paidRangeHit?.items ?? []).map((item: any) => String(item?.id ?? '')),
    );
    expect(paidRangeHitIds.has(paidExpenseId)).toBe(true);

    const paidRangeMissRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&paidFrom=2026-02-21&paidTo=2026-02-21`,
      {
        headers: adminHeaders,
      },
    );
    await ensureOk(paidRangeMissRes);
    const paidRangeMiss = await paidRangeMissRes.json();
    const paidRangeMissIds = new Set(
      (paidRangeMiss?.items ?? []).map((item: any) => String(item?.id ?? '')),
    );
    expect(paidRangeMissIds.has(paidExpenseId)).toBe(false);

    const invalidBooleanRes = await request.get(
      `${apiBase}/expenses?projectId=${encodeURIComponent(expenseFixture.projectId)}&hasReceipt=maybe`,
      {
        headers: adminHeaders,
      },
    );
    expect(invalidBooleanRes.status()).toBe(400);
    const invalidBoolean = await invalidBooleanRes.json();
    expect(
      ['INVALID_BOOLEAN', 'VALIDATION_ERROR'].includes(
        String(invalidBoolean?.error?.code ?? ''),
      ),
    ).toBe(true);
  } finally {
    await deactivateRule();
  }
});
