import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt'],
};

const buildAuthHeaders = () => ({
  'x-user-id': authState.userId,
  'x-roles': authState.roles.join(','),
  'x-project-ids': authState.projectIds.join(','),
  'x-group-ids': authState.groupIds.join(','),
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

async function prepare(page: Page) {
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
    window.localStorage.removeItem('erp4-audit-log-saved-views');
  }, authState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToAuditLogs(page: Page) {
  await page.getByRole('button', { name: '監査ログ', exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: '監査ログ', level: 2, exact: true }),
  ).toBeVisible();
}

test('frontend smoke audit logs: AgentRun詳細ドリルダウンが利用できる @core', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const marker = `${Date.now().toString().slice(-6)}-${randomUUID().slice(0, 8)}`;
  const action = `agent_run_seeded_${marker}`;
  const seedRes = await page.request.post(
    `${apiBase}/__test__/agent-runs/seed-audit-log`,
    {
      headers: buildAuthHeaders(),
      data: {
        action,
        targetTable: 'invoices',
        targetId: `inv-${marker}`,
      },
    },
  );
  await ensureOk(seedRes);
  const seed = await seedRes.json();
  const runId = String(seed?.runId || '').trim();
  expect(runId).toBeTruthy();
  const auditRes = await page.request.get(
    `${apiBase}/audit-logs?action=${encodeURIComponent(action)}&format=json&mask=0`,
    { headers: buildAuthHeaders() },
  );
  await ensureOk(auditRes);
  const auditPayload = await auditRes.json();
  expect(Array.isArray(auditPayload?.items)).toBeTruthy();
  expect((auditPayload?.items ?? []).length).toBeGreaterThan(0);

  await prepare(page);
  await navigateToAuditLogs(page);

  const auditSection = page
    .locator('main')
    .getByRole('heading', { name: '監査ログ', level: 2, exact: true })
    .locator('..');
  await auditSection.getByLabel('action').fill(action, {
    timeout: actionTimeout,
  });
  await auditSection.getByRole('button', { name: '検索' }).click({
    timeout: actionTimeout,
  });

  const detailButton = auditSection
    .getByRole('button', { name: '詳細' })
    .first();
  await expect(detailButton).toBeVisible({ timeout: actionTimeout });
  await detailButton.click();

  await expect(auditSection.getByText(`AgentRun ${runId}`)).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    auditSection.getByText('"decisionType": "policy_override"'),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(auditSection.getByText('"status": "failed"')).toBeVisible({
    timeout: actionTimeout,
  });
});
