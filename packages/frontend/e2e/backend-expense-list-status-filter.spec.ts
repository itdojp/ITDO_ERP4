import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureOk, submitAndFindApprovalInstance } from './approval-e2e-helpers';

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
  groupIds: ['mgmt', 'hr-group'],
});

async function createProjectFixture(
  request: APIRequestContext,
  suffix: string,
): Promise<string> {
  const res = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-EXP-STATUS-${suffix}`,
      name: `E2E Expense Status ${suffix}`,
      status: 'active',
      currency: 'JPY',
      budgetCost: 500000,
    },
  });
  await ensureOk(res);
  const payload = await res.json();
  const projectId = String(payload?.id ?? payload?.project?.id ?? '');
  expect(projectId).not.toBe('');
  return projectId;
}

async function createExpense(
  request: APIRequestContext,
  input: {
    projectId: string;
    userId: string;
    headers: Record<string, string>;
    amount: number;
    label: string;
    suffix: string;
  },
): Promise<string> {
  const res = await request.post(`${apiBase}/expenses`, {
    headers: input.headers,
    data: {
      projectId: input.projectId,
      userId: input.userId,
      category: 'travel',
      amount: input.amount,
      currency: 'JPY',
      incurredOn: '2026-04-01',
      receiptUrl: `https://example.com/e2e/expense-status-${input.label}-${input.suffix}.pdf`,
    },
  });
  await ensureOk(res);
  const payload = await res.json();
  const expenseId = String(payload?.id ?? '');
  expect(expenseId).not.toBe('');
  return expenseId;
}

test('expense list filters by status (draft/pending_qa/approved/rejected) @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProjectFixture(request, suffix);
  const requesterUserId = `e2e-expense-status-${suffix}@example.com`;
  const requesterHeaders = buildHeaders({
    userId: requesterUserId,
    roles: ['user'],
    projectIds: [projectId],
  });

  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 51000,
        amountMax: 52000,
      },
      steps: [{ stepOrder: 1, approverGroupId: 'mgmt' }],
    },
  });
  await ensureOk(ruleRes);
  const createdRule = await ruleRes.json();
  const deactivateRule = async () => {
    if (!createdRule?.id) return;
    const res = await request.patch(
      `${apiBase}/approval-rules/${encodeURIComponent(createdRule.id)}`,
      {
        headers: adminHeaders,
        data: { isActive: false },
      },
    );
    await ensureOk(res);
  };

  try {
    const draftExpenseId = await createExpense(request, {
      projectId,
      userId: requesterUserId,
      headers: requesterHeaders,
      amount: 51100,
      label: 'draft',
      suffix,
    });

    const pendingExpenseId = await createExpense(request, {
      projectId,
      userId: requesterUserId,
      headers: requesterHeaders,
      amount: 51110,
      label: 'pending',
      suffix,
    });
    const pendingApproval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId,
      targetTable: 'expenses',
      targetId: pendingExpenseId,
      submitData: {},
    });
    expect(pendingApproval.status).toBe('pending_qa');

    const approvedExpenseId = await createExpense(request, {
      projectId,
      userId: requesterUserId,
      headers: requesterHeaders,
      amount: 51120,
      label: 'approved',
      suffix,
    });
    const approvedApproval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId,
      targetTable: 'expenses',
      targetId: approvedExpenseId,
      submitData: {},
    });
    const checklistRes = await request.put(
      `${apiBase}/expenses/${encodeURIComponent(approvedExpenseId)}/qa-checklist`,
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
    const approveRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approvedApproval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'approve', reason: `e2e approve ${suffix}` },
      },
    );
    await ensureOk(approveRes);
    const approvedPayload = await approveRes.json();
    expect(String(approvedPayload?.status ?? '')).toBe('approved');

    const rejectedExpenseId = await createExpense(request, {
      projectId,
      userId: requesterUserId,
      headers: requesterHeaders,
      amount: 51130,
      label: 'rejected',
      suffix,
    });
    const rejectedApproval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId,
      targetTable: 'expenses',
      targetId: rejectedExpenseId,
      submitData: {},
    });
    const rejectRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(rejectedApproval.id)}/act`,
      {
        headers: adminHeaders,
        data: { action: 'reject', reason: `e2e reject ${suffix}` },
      },
    );
    await ensureOk(rejectRes);
    const rejectedPayload = await rejectRes.json();
    expect(String(rejectedPayload?.status ?? '')).toBe('rejected');

    const fetchIds = async (status: string) => {
      const res = await request.get(
        `${apiBase}/expenses?projectId=${encodeURIComponent(projectId)}&status=${encodeURIComponent(status)}`,
        { headers: requesterHeaders },
      );
      await ensureOk(res);
      const payload = await res.json();
      return new Set(
        (payload?.items ?? []).map((item: any) => String(item?.id ?? '')),
      );
    };

    const draftIds = await fetchIds('draft');
    expect(draftIds.has(draftExpenseId)).toBe(true);
    expect(draftIds.has(pendingExpenseId)).toBe(false);
    expect(draftIds.has(approvedExpenseId)).toBe(false);
    expect(draftIds.has(rejectedExpenseId)).toBe(false);

    const pendingIds = await fetchIds('pending_qa');
    expect(pendingIds.has(draftExpenseId)).toBe(false);
    expect(pendingIds.has(pendingExpenseId)).toBe(true);
    expect(pendingIds.has(approvedExpenseId)).toBe(false);
    expect(pendingIds.has(rejectedExpenseId)).toBe(false);

    const approvedIds = await fetchIds('approved');
    expect(approvedIds.has(draftExpenseId)).toBe(false);
    expect(approvedIds.has(pendingExpenseId)).toBe(false);
    expect(approvedIds.has(approvedExpenseId)).toBe(true);
    expect(approvedIds.has(rejectedExpenseId)).toBe(false);

    const rejectedIds = await fetchIds('rejected');
    expect(rejectedIds.has(draftExpenseId)).toBe(false);
    expect(rejectedIds.has(pendingExpenseId)).toBe(false);
    expect(rejectedIds.has(approvedExpenseId)).toBe(false);
    expect(rejectedIds.has(rejectedExpenseId)).toBe(true);
  } finally {
    await deactivateRule();
  }
});
