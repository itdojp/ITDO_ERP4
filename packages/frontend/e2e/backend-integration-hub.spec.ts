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

test('backend e2e: integration hub success/failure/retry metrics and audit @core', async ({
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
  const successRunId = String(runPayload?.id || '');
  expect(successRunId).not.toBe('');
  expect(String(runPayload?.status ?? '')).toBe('success');

  const failedSettingRes = await request.post(
    `${apiBase}/integration-settings`,
    {
      headers: adminHeaders,
      data: {
        type: 'crm',
        name: `${name}-failed`,
        provider: 'e2e-provider',
        status: 'active',
        config: {
          retryMax: 2,
          retryBaseMinutes: 1,
          simulateFailure: true,
        },
      },
    },
  );
  await ensureOk(failedSettingRes);
  const failedSetting = await failedSettingRes.json();
  const failedSettingId = String(failedSetting?.id || '');
  expect(failedSettingId).not.toBe('');

  const failedRunRes = await request.post(
    `${apiBase}/integration-settings/${encodeURIComponent(failedSettingId)}/run`,
    { headers: adminHeaders },
  );
  await ensureOk(failedRunRes);
  const failedRunPayload = await failedRunRes.json();
  const failedRunId = String(failedRunPayload?.id || '');
  expect(failedRunId).not.toBe('');
  expect(String(failedRunPayload?.status ?? '')).toBe('failed');
  expect(Number(failedRunPayload?.retryCount ?? 0)).toBe(1);
  expect(typeof failedRunPayload?.nextRetryAt).toBe('string');

  const jobsRes = await request.post(`${apiBase}/jobs/integrations/run`, {
    headers: adminHeaders,
  });
  await ensureOk(jobsRes);
  const jobsPayload = await jobsRes.json();
  expect(jobsPayload?.ok).toBe(true);
  // 直前に失敗した run は nextRetryAt が未来のため、即時再試行対象にならない。
  const retriedRunIds = Array.isArray(jobsPayload?.retries)
    ? jobsPayload.retries.map((item: any) =>
        typeof item === 'string' || typeof item === 'number'
          ? String(item)
          : String(item?.id ?? ''),
      )
    : [];
  expect(retriedRunIds).not.toContain(failedRunId);

  const runsRes = await request.get(
    `${apiBase}/integration-runs?settingId=${encodeURIComponent(settingId)}&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(runsRes);
  const runsPayload = await runsRes.json();
  const runItems = Array.isArray(runsPayload?.items) ? runsPayload.items : [];
  expect(runItems.some((item: any) => item?.id === successRunId)).toBeTruthy();

  const failedRunsRes = await request.get(
    `${apiBase}/integration-runs?settingId=${encodeURIComponent(failedSettingId)}&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(failedRunsRes);
  const failedRunsPayload = await failedRunsRes.json();
  const failedRunItems = Array.isArray(failedRunsPayload?.items)
    ? failedRunsPayload.items
    : [];
  expect(
    failedRunItems.some((item: any) => item?.id === failedRunId),
  ).toBeTruthy();

  const metricsRes = await request.get(
    `${apiBase}/integration-runs/metrics?days=14&limit=100`,
    { headers: adminHeaders },
  );
  await ensureOk(metricsRes);
  const metricsPayload = await metricsRes.json();
  expect(
    Number(metricsPayload?.summary?.totalRuns ?? 0),
  ).toBeGreaterThanOrEqual(2);
  expect(
    Number(metricsPayload?.summary?.successRuns ?? 0),
  ).toBeGreaterThanOrEqual(1);
  expect(
    Number(metricsPayload?.summary?.failedRuns ?? 0),
  ).toBeGreaterThanOrEqual(1);
  expect(
    Number(metricsPayload?.summary?.retryScheduledRuns ?? 0),
  ).toBeGreaterThanOrEqual(1);
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
          targetId: successRunId,
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

  await expect
    .poll(
      async () => {
        const query = new URLSearchParams({
          action: 'integration_run_executed',
          targetTable: 'integration_runs',
          targetId: failedRunId,
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
        return (
          item?.metadata?.status === 'failed' &&
          Number(item?.metadata?.retryCount ?? 0) >= 1
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
});
