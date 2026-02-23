import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOk } from './approval-e2e-helpers';

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

const hrHeaders = buildHeaders({
  userId: 'e2e-hr@example.com',
  roles: ['hr'],
  groupIds: ['hr-group'],
});

const mgmtHeaders = buildHeaders({
  userId: 'e2e-mgmt@example.com',
  roles: ['mgmt'],
  groupIds: ['mgmt'],
});

test('wellbeing rbac: user cannot spoof userId and read endpoints are hr/admin only @core', async ({
  request,
}) => {
  const suffix = runId();
  const entryDate = '2026-04-01';
  const visibilityGroupId = `e2e-wellbeing-${suffix}`;
  const userId = `e2e-wb-user-${suffix}@example.com`;
  const otherUserId = `e2e-wb-other-${suffix}@example.com`;

  const userHeaders = buildHeaders({
    userId,
    roles: ['user'],
  });

  const userCreateRes = await request.post(`${apiBase}/wellbeing-entries`, {
    headers: userHeaders,
    data: {
      entryDate,
      status: 'good',
      userId: otherUserId,
      notes: `e2e wellbeing user ${suffix}`,
      helpRequested: false,
      visibilityGroupId,
    },
  });
  await ensureOk(userCreateRes);
  const userEntry = await userCreateRes.json();
  expect(String(userEntry?.userId ?? '')).toBe(userId);
  expect(String(userEntry?.visibilityGroupId ?? '')).toBe(visibilityGroupId);

  const adminCreateRes = await request.post(`${apiBase}/wellbeing-entries`, {
    headers: adminHeaders,
    data: {
      entryDate,
      status: 'not_good',
      userId: otherUserId,
      notes: `e2e wellbeing admin ${suffix}`,
      helpRequested: true,
      visibilityGroupId,
    },
  });
  await ensureOk(adminCreateRes);
  const adminEntry = await adminCreateRes.json();
  expect(String(adminEntry?.userId ?? '')).toBe(otherUserId);

  for (const headers of [userHeaders, mgmtHeaders]) {
    const listRes = await request.get(`${apiBase}/wellbeing-entries`, {
      headers,
    });
    expect(listRes.status()).toBe(403);
    const listPayload = await listRes.json();
    expect(String(listPayload?.error?.code ?? '')).toBe('forbidden');
    expect(String(listPayload?.error?.category ?? '')).toBe('permission');

    const analyticsRes = await request.get(`${apiBase}/wellbeing-analytics`, {
      headers,
    });
    expect(analyticsRes.status()).toBe(403);
    const analyticsPayload = await analyticsRes.json();
    expect(String(analyticsPayload?.error?.code ?? '')).toBe('forbidden');
    expect(String(analyticsPayload?.error?.category ?? '')).toBe('permission');
  }

  const hrListRes = await request.get(`${apiBase}/wellbeing-entries`, {
    headers: hrHeaders,
  });
  await ensureOk(hrListRes);
  const hrListPayload = await hrListRes.json();
  const listedIds = new Set(
    (hrListPayload?.items ?? []).map((item: any) => String(item?.id ?? '')),
  );
  expect(listedIds.has(String(userEntry?.id ?? ''))).toBe(true);
  expect(listedIds.has(String(adminEntry?.id ?? ''))).toBe(true);

  const analyticsQuery = new URLSearchParams({
    from: entryDate,
    to: entryDate,
    minUsers: '1',
    groupBy: 'group',
    visibilityGroupId,
  }).toString();

  const hrAnalyticsRes = await request.get(
    `${apiBase}/wellbeing-analytics?${analyticsQuery}`,
    {
      headers: hrHeaders,
    },
  );
  await ensureOk(hrAnalyticsRes);
  const hrAnalytics = await hrAnalyticsRes.json();
  expect(String(hrAnalytics?.meta?.groupBy ?? '')).toBe('group');
  const bucket = (hrAnalytics?.items ?? []).find(
    (item: any) => String(item?.bucket ?? '') === visibilityGroupId,
  );
  expect(Boolean(bucket)).toBe(true);
  expect(Number(bucket?.users ?? 0)).toBeGreaterThanOrEqual(1);

  const adminListRes = await request.get(`${apiBase}/wellbeing-entries`, {
    headers: adminHeaders,
  });
  await ensureOk(adminListRes);
  const adminListPayload = await adminListRes.json();
  const adminListedIds = new Set(
    (adminListPayload?.items ?? []).map((item: any) => String(item?.id ?? '')),
  );
  expect(adminListedIds.has(String(userEntry?.id ?? ''))).toBe(true);
  expect(adminListedIds.has(String(adminEntry?.id ?? ''))).toBe(true);

  const adminAnalyticsRes = await request.get(
    `${apiBase}/wellbeing-analytics?${analyticsQuery}`,
    {
      headers: adminHeaders,
    },
  );
  await ensureOk(adminAnalyticsRes);
  const adminAnalytics = await adminAnalyticsRes.json();
  expect(String(adminAnalytics?.meta?.groupBy ?? '')).toBe('group');
});
