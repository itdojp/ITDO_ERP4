import { randomUUID } from 'node:crypto';
import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE || 'http://localhost:3002';

type ActorHeaderInput = {
  userId: string;
  roles: string[];
  projectIds?: string[];
  groupIds?: string[];
};

type IdorFixture = {
  projectA: string;
  projectB: string;
  userAId: string;
  userBId: string;
  userAHeaders: Record<string, string>;
  userBHeaders: Record<string, string>;
};

const runId = () => `${Date.now().toString().slice(-6)}-${randomUUID()}`;

const buildHeaders = (input: ActorHeaderInput) => ({
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

async function parseJsonOrText(res: APIResponse) {
  try {
    return await res.json();
  } catch {
    return { raw: await res.text() };
  }
}

function extractErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

async function ensureOk(res: APIResponse, label: string) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] ${label} failed: ${res.status()} ${body}`);
}

async function expectDenied(res: APIResponse, label: string) {
  const status = res.status();
  if (status !== 403 && status !== 404) {
    const body = await res.text();
    throw new Error(
      `[e2e] ${label} should be denied (403/404) but got ${status}: ${body}`,
    );
  }
  const payload = await parseJsonOrText(res);
  const code = extractErrorCode(payload);
  if (status === 403) {
    expect(
      ['forbidden', 'forbidden_project', 'FORBIDDEN', 'FORBIDDEN_PROJECT'].includes(
        code,
      ),
    ).toBeTruthy();
  }
}

async function createProject(
  request: APIRequestContext,
  suffix: string,
  label: 'A' | 'B',
) {
  const res = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-IDOR-${label}-${suffix}`.slice(0, 32),
      name: `E2E IDOR ${label} ${suffix}`,
      status: 'active',
    },
    headers: adminHeaders,
  });
  await ensureOk(res, `create project ${label}`);
  const payload = (await res.json()) as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id as string;
}

async function addProjectMember(
  request: APIRequestContext,
  projectId: string,
  userId: string,
) {
  const res = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/members`,
    {
      data: { userId, role: 'member' },
      headers: adminHeaders,
    },
  );
  await ensureOk(res, `add member ${userId}`);
}

async function createFixture(request: APIRequestContext): Promise<IdorFixture> {
  const suffix = runId();
  const projectA = await createProject(request, suffix, 'A');
  const projectB = await createProject(request, suffix, 'B');
  const userAId = `e2e-idor-a-${suffix}@example.com`;
  const userBId = `e2e-idor-b-${suffix}@example.com`;
  await addProjectMember(request, projectA, userAId);
  await addProjectMember(request, projectB, userBId);
  return {
    projectA,
    projectB,
    userAId,
    userBId,
    userAHeaders: buildHeaders({
      userId: userAId,
      roles: ['user'],
      projectIds: [projectA],
    }),
    userBHeaders: buildHeaders({
      userId: userBId,
      roles: ['user'],
      projectIds: [projectB],
    }),
  };
}

async function createProjectTask(
  request: APIRequestContext,
  projectId: string,
  headers: Record<string, string>,
) {
  const suffix = runId();
  const res = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/tasks`,
    {
      data: { name: `IDOR Task ${suffix}` },
      headers,
    },
  );
  await ensureOk(res, 'create project task');
  const payload = (await res.json()) as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id as string;
}

test('idor api boundary fixture rejects cross-project invoice access @core', async ({
  request,
}) => {
  const fixture = await createFixture(request);

  const ownRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(fixture.projectA)}/invoices`,
    { headers: fixture.userAHeaders },
  );
  await ensureOk(ownRes, 'own project invoices');

  const deniedRes = await request.get(
    `${apiBase}/projects/${encodeURIComponent(fixture.projectA)}/invoices`,
    { headers: fixture.userBHeaders },
  );
  await expectDenied(deniedRes, 'cross project invoices');
});

test('idor smoke: selected endpoints reject cross-project read/write access @core', async ({
  request,
}) => {
  const fixture = await createFixture(request);
  const taskId = await createProjectTask(
    request,
    fixture.projectA,
    fixture.userAHeaders,
  );

  const projectA = encodeURIComponent(fixture.projectA);
  const deniedChecks = [
    {
      label: 'invoices list',
      request: () =>
        request.get(`${apiBase}/projects/${projectA}/invoices`, {
          headers: fixture.userBHeaders,
        }),
    },
    {
      label: 'estimates list',
      request: () =>
        request.get(`${apiBase}/projects/${projectA}/estimates`, {
          headers: fixture.userBHeaders,
        }),
    },
    {
      label: 'chat messages list',
      request: () =>
        request.get(`${apiBase}/projects/${projectA}/chat-messages?limit=1`, {
          headers: fixture.userBHeaders,
        }),
    },
    {
      label: 'project task list',
      request: () =>
        request.get(`${apiBase}/projects/${projectA}/tasks`, {
          headers: fixture.userBHeaders,
        }),
    },
    {
      label: 'ref candidates',
      request: () =>
        request.get(
          `${apiBase}/ref-candidates?projectId=${projectA}&q=ID&types=invoice`,
          { headers: fixture.userBHeaders },
        ),
    },
    {
      label: 'project task patch',
      request: () =>
        request.patch(
          `${apiBase}/projects/${projectA}/tasks/${encodeURIComponent(taskId)}`,
          {
            data: { name: `patched-${runId()}` },
            headers: fixture.userBHeaders,
          },
        ),
    },
    {
      label: 'chat message post',
      request: () =>
        request.post(`${apiBase}/projects/${projectA}/chat-messages`, {
          data: { body: `idor-cross-post-${runId()}` },
          headers: fixture.userBHeaders,
        }),
    },
  ];

  for (const denied of deniedChecks) {
    const res = await denied.request();
    await expectDenied(res, denied.label);
  }
});
