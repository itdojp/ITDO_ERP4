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
      code: `E2E-APP-CANCEL-${suffix}`,
      name: `E2E Approval Cancel ${suffix}`,
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

async function createExpenseDraft(
  request: APIRequestContext,
  input: {
    projectId: string;
    userId: string;
    headers: Record<string, string>;
    suffix: string;
  },
): Promise<string> {
  const res = await request.post(`${apiBase}/expenses`, {
    headers: input.headers,
    data: {
      projectId: input.projectId,
      userId: input.userId,
      category: 'travel',
      amount: 42100,
      currency: 'JPY',
      incurredOn: '2026-04-01',
      receiptUrl: `https://example.com/e2e/approval-cancel-${input.suffix}.pdf`,
    },
  });
  await ensureOk(res);
  const payload = await res.json();
  const expenseId = String(payload?.id ?? '');
  expect(expenseId).not.toBe('');
  return expenseId;
}

test('approval cancel requires reason and enforces ownership @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectId = await createProjectFixture(request, suffix);
  const requesterUserId = `e2e-approval-cancel-owner-${suffix}@example.com`;
  const otherUserId = `e2e-approval-cancel-other-${suffix}@example.com`;
  const requesterHeaders = buildHeaders({
    userId: requesterUserId,
    roles: ['user'],
    projectIds: [projectId],
  });
  const otherUserHeaders = buildHeaders({
    userId: otherUserId,
    roles: ['user'],
    projectIds: [projectId],
  });

  const ruleRes = await request.post(`${apiBase}/approval-rules`, {
    headers: adminHeaders,
    data: {
      flowType: 'expense',
      conditions: {
        amountMin: 42000,
        amountMax: 43000,
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
    const expenseId = await createExpenseDraft(request, {
      projectId,
      userId: requesterUserId,
      headers: requesterHeaders,
      suffix,
    });
    const approval = await submitAndFindApprovalInstance({
      request,
      apiBase,
      headers: requesterHeaders,
      flowType: 'expense',
      projectId,
      targetTable: 'expenses',
      targetId: expenseId,
      submitData: {},
    });
    expect(String(approval?.status ?? '')).toBe('pending_qa');

    const missingReasonRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/cancel`,
      {
        headers: requesterHeaders,
        data: { reason: '   ' },
      },
    );
    expect(missingReasonRes.status()).toBe(400);
    const missingReasonPayload = await missingReasonRes.json();
    expect(
      String(
        missingReasonPayload?.error?.code ?? missingReasonPayload?.error ?? '',
      ),
    ).toBe('invalid_reason');

    const forbiddenRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/cancel`,
      {
        headers: otherUserHeaders,
        data: { reason: `e2e forbidden ${suffix}` },
      },
    );
    expect(forbiddenRes.status()).toBe(403);
    const forbiddenPayload = await forbiddenRes.json();
    expect(
      String(forbiddenPayload?.error?.code ?? forbiddenPayload?.error ?? ''),
    ).toBe('forbidden');

    const cancelRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/cancel`,
      {
        headers: requesterHeaders,
        data: { reason: `e2e cancel ${suffix}` },
      },
    );
    await ensureOk(cancelRes);
    const cancelPayload = await cancelRes.json();
    expect(String(cancelPayload?.status ?? '')).toBe('cancelled');

    const closedRes = await request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approval.id)}/cancel`,
      {
        headers: requesterHeaders,
        data: { reason: `e2e cancel again ${suffix}` },
      },
    );
    expect(closedRes.status()).toBe(400);
    const closedPayload = await closedRes.json();
    expect(
      String(closedPayload?.error?.code ?? closedPayload?.error ?? ''),
    ).toBe('instance_closed');

    const expenseRes = await request.get(
      `${apiBase}/expenses/${encodeURIComponent(expenseId)}`,
      {
        headers: requesterHeaders,
      },
    );
    await ensureOk(expenseRes);
    const expensePayload = await expenseRes.json();
    expect(String(expensePayload?.status ?? '')).toBe('draft');
  } finally {
    await deactivateRule();
  }
});
