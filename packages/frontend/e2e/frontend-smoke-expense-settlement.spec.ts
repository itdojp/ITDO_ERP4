import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  ensureOk,
  submitAndFindApprovalInstance,
} from './approval-e2e-helpers';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = process.env.CI ? 30_000 : 12_000;

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt'],
};

const buildHeaders = (override?: Partial<typeof authState>) => {
  const resolved = { ...authState, ...(override ?? {}) };
  return {
    'x-user-id': resolved.userId,
    'x-roles': resolved.roles.join(','),
    'x-project-ids': (resolved.projectIds ?? []).join(','),
    'x-group-ids': (resolved.groupIds ?? []).join(','),
  };
};

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const resolvedAuthState = { ...authState, ...(override ?? {}) };
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, resolvedAuthState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    { timeout: actionTimeout },
  );
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function createProjectFixture(page: Page, suffix: string) {
  const projectRes = await page.request.post(`${apiBase}/projects`, {
    headers: buildHeaders(),
    data: {
      code: `E2E-EXP-${suffix}`.slice(0, 30),
      name: `E2E Expense ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(projectRes);
  const payload = await projectRes.json();
  const projectId = String(payload?.id || payload?.project?.id || '');
  expect(projectId).toBeTruthy();
  return { projectId };
}

async function approveExpense(
  page: Page,
  expenseId: string,
  projectId: string,
) {
  const approval = await submitAndFindApprovalInstance({
    request: page.request,
    apiBase,
    headers: buildHeaders({ projectIds: [projectId] }),
    flowType: 'expense',
    projectId,
    targetTable: 'expenses',
    targetId: expenseId,
  });
  const approvalId = approval.id;
  expect(approvalId).toBeTruthy();

  const checklistRes = await page.request.put(
    `${apiBase}/expenses/${encodeURIComponent(expenseId)}/qa-checklist`,
    {
      headers: buildHeaders({ projectIds: [projectId] }),
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

  let status = '';
  for (let index = 0; index < 8; index += 1) {
    const actRes = await page.request.post(
      `${apiBase}/approval-instances/${encodeURIComponent(approvalId)}/act`,
      {
        headers: buildHeaders({
          projectIds: [projectId],
          roles: ['admin', 'mgmt', 'exec'],
        }),
        data: { action: 'approve', reason: `e2e approve expense ${index}` },
      },
    );
    await ensureOk(actRes);
    const acted = await actRes.json();
    status = String(acted?.status || '');
    if (status !== 'pending_qa' && status !== 'pending_exec') break;
  }
  expect(status).toBe('approved');
}

test('expense settlement actions and filters on UI @core', async ({ page }) => {
  const suffix = runId();
  const { projectId } = await createProjectFixture(page, suffix);
  const category = `経費-${suffix.slice(0, 6)}`;
  const amount = 12000 + (Number(suffix.slice(0, 3)) % 5000);

  const createRes = await page.request.post(`${apiBase}/expenses`, {
    headers: buildHeaders({ projectIds: [projectId] }),
    data: {
      projectId,
      userId: 'demo-user',
      category,
      amount,
      currency: 'JPY',
      incurredOn: new Date().toISOString().slice(0, 10),
      receiptUrl: `https://example.com/expense/${suffix}`,
    },
  });
  await ensureOk(createRes);
  const created = await createRes.json();
  const expenseId = String(created?.id || '');
  expect(expenseId).toBeTruthy();

  await approveExpense(page, expenseId, projectId);

  await prepare(page, { projectIds: [projectId], roles: ['admin', 'mgmt'] });
  await navigateToSection(page, '経費精算', '経費入力');
  const expenseSection = page
    .locator('main')
    .locator('h2', { hasText: '経費入力' })
    .locator('..');
  await expect(expenseSection).toBeVisible({ timeout: actionTimeout });

  await expenseSection.getByRole('button', { name: '再読み込み' }).click();
  const expenseItem = expenseSection
    .locator('li', { hasText: category })
    .first();
  await expect(expenseItem).toContainText('未払い', { timeout: actionTimeout });

  await expenseItem.getByRole('button', { name: '支払済みにする' }).click();
  const markDialog = page.getByRole('dialog', { name: '経費を支払済みに更新' });
  await expect(markDialog).toBeVisible({ timeout: actionTimeout });
  await markDialog.getByLabel('支払更新理由').fill(`e2e mark paid ${suffix}`);
  await markDialog.getByRole('button', { name: '支払済みにする' }).click();
  await expect(markDialog).toBeHidden({ timeout: actionTimeout });
  await expect(expenseItem).toContainText('支払済み', {
    timeout: actionTimeout,
  });

  await expenseSection.getByLabel('経費精算フィルタ').selectOption('paid');
  await expect(expenseItem).toBeVisible({ timeout: actionTimeout });

  await expenseItem.getByRole('button', { name: '支払取消' }).click();
  const unmarkDialog = page.getByRole('dialog', {
    name: '経費の支払済みを取り消し',
  });
  await expect(unmarkDialog).toBeVisible({ timeout: actionTimeout });
  await expect(
    unmarkDialog.getByRole('button', { name: '支払取消' }),
  ).toBeDisabled();
  await unmarkDialog
    .getByLabel('支払取消理由')
    .fill(`e2e unmark paid ${suffix}`);
  await unmarkDialog.getByRole('button', { name: '支払取消' }).click();
  await expect(unmarkDialog).toBeHidden({ timeout: actionTimeout });

  await expenseSection.getByLabel('経費精算フィルタ').selectOption('unpaid');
  await expect(expenseItem).toBeVisible({ timeout: actionTimeout });
  await expect(expenseItem).toContainText('未払い', { timeout: actionTimeout });
});
