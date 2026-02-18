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
  roles: ['admin', 'mgmt', 'exec'],
  groupIds: ['mgmt', 'exec'],
});

async function ensureOk(
  res: { ok(): boolean; status(): number; text(): Promise<string> },
  label: string,
) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] ${label} failed: ${res.status()} ${body}`);
}

async function waitAuditAction(
  request: APIRequestContext,
  action: string,
  targetTable: string,
  targetId: string,
) {
  await expect
    .poll(
      async () => {
        const params = new URLSearchParams({
          action,
          targetTable,
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

test('audit required events: project status change is recorded @core @audit-required', async ({
  request,
}) => {
  const suffix = runId();
  const createRes = await request.post(`${apiBase}/projects`, {
    headers: adminHeaders,
    data: {
      code: `E2E-AUD-${suffix}`.slice(0, 32),
      name: `E2E Audit ${suffix}`,
      status: 'active',
    },
  });
  await ensureOk(createRes, 'create project');
  const created = await createRes.json();
  const projectId = String(created?.id || '');
  expect(projectId).toBeTruthy();

  const patchRes = await request.patch(
    `${apiBase}/projects/${encodeURIComponent(projectId)}`,
    {
      headers: adminHeaders,
      data: { status: 'closed' },
    },
  );
  await ensureOk(patchRes, 'patch project status');
  const patched = await patchRes.json();
  expect(String(patched?.status || '')).toBe('closed');

  await waitAuditAction(
    request,
    'project_status_updated',
    'projects',
    projectId,
  );

  const params = new URLSearchParams({
    action: 'project_status_updated',
    targetTable: 'projects',
    targetId: projectId,
    format: 'json',
    mask: '0',
    limit: '20',
  });
  const auditRes = await request.get(`${apiBase}/audit-logs?${params}`, {
    headers: adminHeaders,
  });
  await ensureOk(auditRes, 'fetch audit logs');
  const payload = await auditRes.json();
  const event = (payload?.items ?? []).find(
    (item: any) => item?.action === 'project_status_updated',
  );
  expect(event).toBeTruthy();
  expect(event?.metadata?.fromStatus).toBe('active');
  expect(event?.metadata?.toStatus).toBe('closed');
});
