import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';

const runId = () =>
  `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

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

test('project access guard: route/query projectId is enforced @core', async ({
  request,
}) => {
  const suffix = runId();
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-RBAC-${suffix}`,
      name: `E2E RBAC ${suffix}`,
      status: 'active',
    },
    headers: adminHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectId = project.id as string;
  expect(projectId).toBeTruthy();

  const outsiderHeaders = buildHeaders({
    userId: 'e2e-outsider@example.com',
    roles: ['user'],
    projectIds: [],
  });
  const memberHeaders = buildHeaders({
    userId: 'e2e-member@example.com',
    roles: ['user'],
    projectIds: [projectId],
  });
  const mgmtHeaders = buildHeaders({
    userId: 'e2e-mgmt@example.com',
    roles: ['mgmt'],
    projectIds: [],
    groupIds: ['mgmt'],
  });

  const chatForbiddenRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages?limit=1`,
    { headers: outsiderHeaders },
  );
  expect(chatForbiddenRes.status()).toBe(403);
  const chatForbidden = await chatForbiddenRes.json();
  expect(chatForbidden?.error?.code).toBe('forbidden_project');

  const chatAllowedRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages?limit=1`,
    { headers: memberHeaders },
  );
  await ensureOk(chatAllowedRes);

  const chatMgmtBypassRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages?limit=1`,
    { headers: mgmtHeaders },
  );
  await ensureOk(chatMgmtBypassRes);

  const timeEntriesForbiddenRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(projectId)}`,
    { headers: outsiderHeaders },
  );
  expect(timeEntriesForbiddenRes.status()).toBe(403);
  const timeEntriesForbidden = await timeEntriesForbiddenRes.json();
  expect(timeEntriesForbidden?.error?.code).toBe('forbidden_project');

  const timeEntriesAllowedRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(projectId)}`,
    { headers: memberHeaders },
  );
  await ensureOk(timeEntriesAllowedRes);

  const timeEntriesMgmtBypassRes = await request.get(
    `${apiBase}/time-entries?projectId=${encodeURIComponent(projectId)}`,
    { headers: mgmtHeaders },
  );
  await ensureOk(timeEntriesMgmtBypassRes);
});
