import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';
const defaultProjectId = '00000000-0000-0000-0000-000000000001';

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
  projectIds: [defaultProjectId],
  groupIds: ['mgmt'],
});

async function ensureOk(res: { ok(): boolean; status(): number; text(): any }) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}

test('backend e2e: integration hub validation/run/metrics/audit @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const startedAt = new Date().toISOString();
  const suffix = runId();
  const name = `e2e-crm-${suffix}`;

  const invalidCreateRes = await request.post(
    `${apiBase}/integration-settings`,
    {
      headers: adminHeaders,
      data: {
        type: 'crm',
        name: `${name}-invalid`,
        config: { retryMax: 99 },
      },
    },
  );
  expect(invalidCreateRes.status()).toBe(400);
  const invalidCreatePayload = await invalidCreateRes.json();
  expect(invalidCreatePayload?.error).toBe('invalid_config');

  const createRes = await request.post(`${apiBase}/integration-settings`, {
    headers: adminHeaders,
    data: {
      type: 'crm',
      name,
      provider: 'e2e-provider',
      status: 'active',
      schedule: '*/30 * * * *',
      config: {
        retryMax: 2,
        retryBaseMinutes: 10,
        apiToken: 'do-not-leak',
      },
    },
  });
  await ensureOk(createRes);
  const created = await createRes.json();
  const settingId = String(created?.id || '');
  expect(settingId).not.toBe('');

  const runRes = await request.post(
    `${apiBase}/integration-settings/${encodeURIComponent(settingId)}/run`,
    { headers: adminHeaders },
  );
  await ensureOk(runRes);
  const runPayload = await runRes.json();
  const runIdValue = String(runPayload?.id || '');
  expect(runIdValue).not.toBe('');
  expect(['success', 'failed']).toContain(String(runPayload?.status ?? ''));

  const runsRes = await request.get(
    `${apiBase}/integration-runs?settingId=${encodeURIComponent(settingId)}&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(runsRes);
  const runsPayload = await runsRes.json();
  const runItems = Array.isArray(runsPayload?.items) ? runsPayload.items : [];
  expect(runItems.some((item: any) => item?.id === runIdValue)).toBeTruthy();

  const metricsRes = await request.get(
    `${apiBase}/integration-runs/metrics?settingId=${encodeURIComponent(settingId)}&days=14&limit=100`,
    { headers: adminHeaders },
  );
  await ensureOk(metricsRes);
  const metricsPayload = await metricsRes.json();
  expect(Number(metricsPayload?.summary?.totalRuns ?? 0)).toBeGreaterThan(0);
  expect(Array.isArray(metricsPayload?.byType)).toBeTruthy();
  expect(
    (metricsPayload?.byType ?? []).some((item: any) => item?.type === 'crm'),
  ).toBeTruthy();

  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({
          action: 'integration_setting_created',
          targetTable: 'integration_settings',
          targetId: settingId,
          from: startedAt,
          format: 'json',
          mask: '0',
          limit: '50',
        });
        const auditRes = await request.get(`${apiBase}/audit-logs?${query}`, {
          headers: adminHeaders,
        });
        if (!auditRes.ok()) return false;
        const payload = await auditRes.json();
        const item = (payload?.items ?? [])[0];
        return item?.metadata?.config?.apiToken === '[REDACTED]';
      },
      { timeout: 10000 },
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({
          action: 'integration_run_executed',
          targetTable: 'integration_runs',
          targetId: runIdValue,
          from: startedAt,
          format: 'json',
          mask: '0',
          limit: '50',
        });
        const auditRes = await request.get(`${apiBase}/audit-logs?${query}`, {
          headers: adminHeaders,
        });
        if (!auditRes.ok()) return false;
        const payload = await auditRes.json();
        const item = (payload?.items ?? [])[0];
        return item?.metadata?.settingId === settingId;
      },
      { timeout: 10000 },
    )
    .toBe(true);
});
