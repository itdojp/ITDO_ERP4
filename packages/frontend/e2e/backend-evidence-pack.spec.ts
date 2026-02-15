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

async function createEstimateWithPendingApproval(request: any, suffix: string) {
  const projectRes = await request.post(`${apiBase}/projects`, {
    data: {
      code: `E2E-EVP-${suffix}`,
      name: `E2E Evidence Project ${suffix}`,
      status: 'active',
    },
    headers: adminHeaders,
  });
  await ensureOk(projectRes);
  const project = await projectRes.json();
  const projectId = (project?.id ?? project?.project?.id ?? '') as string;
  if (!projectId) {
    throw new Error(`[e2e] project id missing: ${JSON.stringify(project)}`);
  }

  const estimateRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      data: {
        totalAmount: 120000,
        notes: `E2E evidence estimate ${suffix}`,
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(estimateRes);
  const estimatePayload = await estimateRes.json();
  const estimateId = (estimatePayload?.id ??
    estimatePayload?.estimate?.id ??
    '') as string;
  if (!estimateId) {
    throw new Error(
      `[e2e] estimate id missing: ${JSON.stringify(estimatePayload)}`,
    );
  }

  const chatMessageRes = await request.post(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/chat-messages`,
    {
      data: {
        body: `Evidence chat message ${suffix}`,
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(chatMessageRes);
  const chatMessage = await chatMessageRes.json();
  const chatMessageId = (chatMessage?.id ?? chatMessage?.message?.id ?? '') as string;
  if (!chatMessageId) {
    throw new Error(
      `[e2e] chat message id missing: ${JSON.stringify(chatMessage)}`,
    );
  }

  const annotationRes = await request.patch(
    `${apiBase}/annotations/estimate/${encodeURIComponent(estimateId)}`,
    {
      data: {
        notes: `owner qa@example.com 09012345678 ${suffix}`,
        externalUrls: [
          `https://example.com/evidence/${suffix}`,
          `https://example.com/evidence/${suffix}`,
        ],
        internalRefs: [
          {
            kind: 'chat_message',
            id: chatMessageId,
            label: `E2E chat ref ${suffix}`,
          },
        ],
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(annotationRes);

  const submitRes = await request.post(
    `${apiBase}/estimates/${encodeURIComponent(estimateId)}/submit`,
    { headers: adminHeaders },
  );
  await ensureOk(submitRes);

  const instanceRes = await request.get(
    `${apiBase}/approval-instances?flowType=estimate&projectId=${encodeURIComponent(projectId)}`,
    { headers: adminHeaders },
  );
  await ensureOk(instanceRes);
  const instancePayload = await instanceRes.json();
  const instance = (instancePayload?.items ?? []).find(
    (item: any) =>
      item?.targetTable === 'estimates' &&
      item?.targetId === estimateId &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected',
  );
  expect(instance?.id).toBeTruthy();

  return {
    projectId,
    estimateId,
    approvalInstanceId: instance.id as string,
    chatMessageId,
  };
}

test('evidence pack flow: snapshot/export/archive and audit log consistency @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const target = await createEstimateWithPendingApproval(request, suffix);

  const snapshotRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot`,
    { headers: adminHeaders },
  );
  await ensureOk(snapshotRes);
  const snapshotPayload = await snapshotRes.json();
  expect(snapshotPayload?.exists).toBeTruthy();
  expect(snapshotPayload?.snapshot?.version).toBeGreaterThan(0);
  expect(snapshotPayload?.snapshot?.items?.notes).toContain('qa@example.com');
  expect(snapshotPayload?.snapshot?.items?.externalUrls).toContain(
    `https://example.com/evidence/${suffix}`,
  );
  expect(snapshotPayload?.snapshot?.items?.internalRefs?.[0]?.id).toBe(
    target.chatMessageId,
  );
  expect(
    (snapshotPayload?.snapshot?.items?.chatMessages ?? []).some(
      (item: any) => item?.id === target.chatMessageId,
    ),
  ).toBeTruthy();

  const exportJsonRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/export?format=json&mask=0`,
    { headers: adminHeaders },
  );
  await ensureOk(exportJsonRes);
  expect(exportJsonRes.headers()['content-disposition']).toContain('.json');
  const exportJson = await exportJsonRes.json();
  expect(exportJson?.format).toBe('json');
  expect(exportJson?.payload?.snapshot?.id).toBe(snapshotPayload.snapshot.id);
  expect(exportJson?.payload?.snapshot?.items?.notes).toContain('qa@example.com');
  expect(exportJson?.payload?.snapshot?.items?.externalUrls?.[0]).toBe(
    `https://example.com/evidence/${suffix}`,
  );
  expect(exportJson?.integrity?.digest).toMatch(/^[a-f0-9]{64}$/);

  const exportMaskedRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/export?format=json`,
    { headers: adminHeaders },
  );
  await ensureOk(exportMaskedRes);
  const exportMasked = await exportMaskedRes.json();
  expect(exportMasked?.payload?.snapshot?.items?.notes).not.toContain(
    'qa@example.com',
  );
  expect(exportMasked?.payload?.snapshot?.items?.notes).not.toContain(
    '09012345678',
  );
  expect(exportMasked?.payload?.snapshot?.items?.externalUrls?.[0]).toBe(
    'https://example.com/***',
  );

  const exportPdfRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/export?format=pdf&mask=0`,
    { headers: adminHeaders },
  );
  await ensureOk(exportPdfRes);
  expect(exportPdfRes.headers()['content-type']).toContain('application/pdf');
  const exportPdfBody = await exportPdfRes.body();
  expect(exportPdfBody.subarray(0, 4).toString()).toBe('%PDF');

  const archiveJsonRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/archive`,
    {
      data: { format: 'json', mask: 1 },
      headers: adminHeaders,
    },
  );
  await ensureOk(archiveJsonRes);
  const archiveJson = await archiveJsonRes.json();
  expect(archiveJson?.archived).toBeTruthy();
  expect(archiveJson?.archive?.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(archiveJson?.archive?.provider).toBeTruthy();
  expect(archiveJson?.archive?.archiveUri).toBeTruthy();

  const archivePdfRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/archive`,
    {
      data: { format: 'pdf', mask: 0 },
      headers: adminHeaders,
    },
  );
  await ensureOk(archivePdfRes);
  const archivePdf = await archivePdfRes.json();
  expect(archivePdf?.archived).toBeTruthy();
  expect(archivePdf?.archive?.format).toBe('pdf');

  const exportAuditRes = await request.get(
    `${apiBase}/audit-logs?action=evidence_pack_exported&targetTable=approval_instances&targetId=${encodeURIComponent(target.approvalInstanceId)}&format=json&mask=0&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(exportAuditRes);
  const exportAudit = await exportAuditRes.json();
  const exportItems = exportAudit?.items ?? [];
  expect(
    exportItems.some(
      (item: any) =>
        item?.action === 'evidence_pack_exported' &&
        item?.metadata?.success === true &&
        typeof item?.metadata?.digest === 'string',
    ),
  ).toBeTruthy();

  const archiveAuditRes = await request.get(
    `${apiBase}/audit-logs?action=evidence_pack_archived&targetTable=approval_instances&targetId=${encodeURIComponent(target.approvalInstanceId)}&format=json&mask=0&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(archiveAuditRes);
  const archiveAudit = await archiveAuditRes.json();
  const archiveItems = archiveAudit?.items ?? [];
  expect(
    archiveItems.some(
      (item: any) =>
        item?.action === 'evidence_pack_archived' &&
        item?.metadata?.success === true &&
        typeof item?.metadata?.archiveUri === 'string',
    ),
  ).toBeTruthy();
});

test('evidence pack archive is restricted to admin/mgmt while export is readable for project user @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const target = await createEstimateWithPendingApproval(request, suffix);

  const projectUserHeaders = buildHeaders({
    userId: `project-user-${suffix}`,
    roles: ['user'],
    projectIds: [target.projectId],
    groupIds: [],
  });

  const userExportRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/export?format=json`,
    { headers: projectUserHeaders },
  );
  await ensureOk(userExportRes);

  const userArchiveRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/archive`,
    {
      data: { format: 'json' },
      headers: projectUserHeaders,
    },
  );
  expect(userArchiveRes.status()).toBe(403);
});

test('evidence snapshot regenerate requires reason and history keeps versions @core', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = runId();
  const target = await createEstimateWithPendingApproval(request, suffix);

  const initialSnapshotRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot`,
    { headers: adminHeaders },
  );
  await ensureOk(initialSnapshotRes);
  const initialSnapshot = await initialSnapshotRes.json();
  expect(initialSnapshot?.exists).toBeTruthy();
  const initialVersion = Number(initialSnapshot?.snapshot?.version ?? 0);
  expect(initialVersion).toBeGreaterThan(0);

  const missingReasonRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot`,
    {
      data: { forceRegenerate: true },
      headers: adminHeaders,
    },
  );
  expect(missingReasonRes.status()).toBe(400);
  const missingReasonPayload = await missingReasonRes.json();
  expect(missingReasonPayload?.error?.code).toBe('REASON_REQUIRED');

  const regenerateReason = `e2e regenerate ${suffix}`;
  const regenerateRes = await request.post(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot`,
    {
      data: {
        forceRegenerate: true,
        reasonText: regenerateReason,
      },
      headers: adminHeaders,
    },
  );
  await ensureOk(regenerateRes);
  const regenerated = await regenerateRes.json();
  expect(regenerated?.created).toBeTruthy();
  expect(regenerated?.snapshot?.version).toBe(initialVersion + 1);

  const historyRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot/history?limit=10`,
    { headers: adminHeaders },
  );
  await ensureOk(historyRes);
  const historyPayload = await historyRes.json();
  const versions = (historyPayload?.items ?? []).map((item: any) => item?.version);
  expect(versions[0]).toBe(initialVersion + 1);
  expect(versions).toContain(initialVersion);

  const projectUserHeaders = buildHeaders({
    userId: `project-user-history-${suffix}`,
    roles: ['user'],
    projectIds: [target.projectId],
    groupIds: [],
  });
  const forbiddenHistoryRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-snapshot/history?limit=10`,
    { headers: projectUserHeaders },
  );
  expect(forbiddenHistoryRes.status()).toBe(403);

  const exportOldVersionRes = await request.get(
    `${apiBase}/approval-instances/${encodeURIComponent(target.approvalInstanceId)}/evidence-pack/export?format=json&version=${initialVersion}&mask=0`,
    { headers: adminHeaders },
  );
  await ensureOk(exportOldVersionRes);
  const exportOldVersionPayload = await exportOldVersionRes.json();
  expect(exportOldVersionPayload?.payload?.snapshot?.version).toBe(initialVersion);

  const regenAuditRes = await request.get(
    `${apiBase}/audit-logs?action=evidence_snapshot_regenerated&targetTable=evidence_snapshots&targetId=${encodeURIComponent(regenerated?.snapshot?.id ?? '')}&format=json&mask=0&limit=20`,
    { headers: adminHeaders },
  );
  await ensureOk(regenAuditRes);
  const regenAuditPayload = await regenAuditRes.json();
  expect(
    (regenAuditPayload?.items ?? []).some(
      (item: any) =>
        item?.action === 'evidence_snapshot_regenerated' &&
        item?.reasonText === regenerateReason &&
        item?.metadata?.approvalInstanceId === target.approvalInstanceId,
    ),
  ).toBeTruthy();
});
