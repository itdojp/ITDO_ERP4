import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { Prisma } from '@prisma/client';

import { createKnowledgeArtifactPort } from '../dist/adapters/knowledge/knowledgeArtifactStorageAdapter.js';
import {
  PrismaKnowledgeCaptureRepository,
  PrismaKnowledgeCaptureUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeCaptureAdapter.js';
import { KnowledgeArtifactStoreError } from '../dist/application/knowledge/knowledgeArtifactPort.js';
import { createKnowledgeCaptureTokenCodec } from '../dist/application/knowledge/knowledgeCaptureToken.js';
import { createKnowledgeCaptureService } from '../dist/application/knowledge/knowledgeCaptureUseCases.js';
import { prisma } from '../dist/services/db.js';

if (process.env.KNOWLEDGE_CAPTURE_INTEGRATION_CONFIRM !== '1') {
  throw new Error('KNOWLEDGE_CAPTURE_INTEGRATION_CONFIRM=1 is required');
}

const now = new Date('2026-08-14T00:00:00.000Z');
const actor = {
  userId: 'synthetic-capture-owner',
  organizationId: 'synthetic-organization',
  groupAccountIds: [],
};
const repository = new PrismaKnowledgeCaptureRepository(prisma);
const unitOfWork = new PrismaKnowledgeCaptureUnitOfWork(prisma);
const scratchRoot = path.resolve(process.cwd(), '.codex-local', 'tmp');
await mkdir(scratchRoot, { recursive: true });
const knowledgeStorageDir = await mkdtemp(
  path.join(scratchRoot, 'erp4-knowledge-capture-integration-'),
);
const artifacts = createKnowledgeArtifactPort({
  env: { ...process.env, KNOWLEDGE_STORAGE_DIR: knowledgeStorageDir },
  provider: 'local',
});

const tokenCodec = createKnowledgeCaptureTokenCodec({
  env: {
    NODE_ENV: 'test',
    KNOWLEDGE_CURSOR_SIGNING_SECRET:
      'knowledge-capture-integration-signing-secret-0001',
    KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET:
      'knowledge-capture-integration-idempotency-secret-0001',
  },
  now: () => now,
});

function service(customUnitOfWork = unitOfWork, customArtifacts = artifacts) {
  return createKnowledgeCaptureService({
    artifacts: customArtifacts,
    reader: repository,
    unitOfWork: customUnitOfWork,
    tokenCodec,
    now: () => now,
    reportInternalError(error) {
      console.error('capture-integration-internal-error', error);
    },
  });
}

function request(selectedText = 'selected-body') {
  return {
    draft: {
      schemaVersion: 1,
      channel: 'browser_extension',
      title: 'Synthetic title',
      url: 'https://example.invalid/article',
      selectedText,
      description: 'unselected-description-canary',
      author: null,
      publishedAt: null,
      capturedAt: now.toISOString(),
    },
    selectedFields: ['title', 'selectedText'],
    scope: 'personal',
    organizationGroupAccountIds: [],
    sourceType: 'web',
  };
}

async function preview(currentService, value) {
  const result = await currentService.preview({
    actor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: value,
  });
  assert.equal(result.ok, true);
  return result.value;
}

async function commit(currentService, value, currentPreview, requestKey) {
  return currentService.commit({
    actor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: {
      ...value,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: currentPreview.previewToken,
      requestKey,
    },
  });
}

try {
  const currentService = service();
  const value = request();
  const currentPreview = await preview(currentService, value);
  const concurrent = await Promise.all([
    commit(currentService, value, currentPreview, 'synthetic-request-key'),
    commit(currentService, value, currentPreview, 'synthetic-request-key'),
  ]);
  assert.equal(
    concurrent.every((result) => result.ok),
    true,
  );
  const created = concurrent.find(
    (result) => result.ok && !result.value.reused,
  );
  const concurrentReplay = concurrent.find(
    (result) => result.ok && result.value.reused,
  );
  assert.ok(created?.ok);
  assert.ok(concurrentReplay?.ok);
  assert.equal(created.ok, true);
  assert.equal(created.value.status, 'ready');
  assert.equal(concurrentReplay.value.itemId, created.value.itemId);
  assert.equal(concurrentReplay.value.snapshotId, created.value.snapshotId);

  const replay = await commit(
    currentService,
    value,
    currentPreview,
    'synthetic-request-key',
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.value.reused, true);
  assert.equal(replay.value.itemId, created.value.itemId);
  assert.equal(replay.value.snapshotId, created.value.snapshotId);

  const [captureCount, itemCount, snapshotCount, capture, item, snapshot] =
    await Promise.all([
      prisma.knowledgeCaptureRequest.count(),
      prisma.knowledgeItem.count({ where: { ownerUserId: actor.userId } }),
      prisma.knowledgeSnapshot.count({
        where: { knowledgeItem: { ownerUserId: actor.userId } },
      }),
      prisma.knowledgeCaptureRequest.findUniqueOrThrow({
        where: { id: created.value.captureId },
      }),
      prisma.knowledgeItem.findUniqueOrThrow({
        where: { id: created.value.itemId },
      }),
      prisma.knowledgeSnapshot.findUniqueOrThrow({
        where: { id: created.value.snapshotId },
      }),
    ]);
  assert.equal(captureCount, 1);
  assert.equal(itemCount, 1);
  assert.equal(snapshotCount, 1);
  assert.equal(capture.status, 'ready');
  assert.equal(item.shortNote, null);
  assert.equal(item.canonicalUrl, null);
  assert.equal(snapshot.extractedText.includes('selected-body'), true);
  assert.equal(
    snapshot.extractedText.includes('unselected-description-canary'),
    false,
  );

  const conflictingValue = request('changed-body');
  const conflictingPreview = await preview(currentService, conflictingValue);
  const conflict = await commit(
    currentService,
    conflictingValue,
    conflictingPreview,
    'synthetic-request-key',
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'idempotency_conflict');
  assert.equal(await prisma.knowledgeCaptureRequest.count(), 1);

  await assert.rejects(
    prisma.knowledgeCaptureRequest.delete({ where: { id: capture.id } }),
    /knowledge capture history is immutable|23514/,
  );
  await assert.rejects(
    prisma.knowledgeCaptureRequest.update({
      where: { id: capture.id },
      data: { payloadHash: 'f'.repeat(64) },
    }),
    /knowledge capture identity is immutable|23514/,
  );

  const auditFailureValue = request('audit-rollback-body');
  const auditFailurePreview = await preview(currentService, auditFailureValue);
  const failingUnitOfWork = {
    run(work) {
      return prisma.$transaction(
        (client) =>
          work({
            captures: new PrismaKnowledgeCaptureRepository(client),
            audit: {
              async write() {
                throw new Error('synthetic_mandatory_audit_failure');
              },
            },
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  };
  await assert.rejects(
    commit(
      service(failingUnitOfWork),
      auditFailureValue,
      auditFailurePreview,
      'audit-failure-key',
    ),
    /synthetic_mandatory_audit_failure/,
  );
  assert.equal(await prisma.knowledgeCaptureRequest.count(), 1);
  assert.equal(
    await prisma.knowledgeItem.count({ where: { ownerUserId: actor.userId } }),
    1,
  );

  let uncertainStoreCalls = 0;
  const unknownAfterStoreArtifacts = {
    ...artifacts,
    async store(input) {
      uncertainStoreCalls += 1;
      await artifacts.store(input);
      throw new KnowledgeArtifactStoreError('unknown');
    },
  };
  const unknownValue = request('unknown-outcome-selected-body');
  const unknownPreview = await preview(currentService, unknownValue);
  const unknownCommit = await commit(
    service(unitOfWork, unknownAfterStoreArtifacts),
    unknownValue,
    unknownPreview,
    'synthetic-unknown-outcome-key',
  );
  assert.equal(unknownCommit.ok, true);
  assert.equal(unknownCommit.value.status, 'pending');
  assert.equal(uncertainStoreCalls, 1);
  const unknownPendingSnapshot =
    await prisma.knowledgeSnapshot.findUniqueOrThrow({
      where: { id: unknownCommit.value.snapshotId },
    });
  assert.equal(unknownPendingSnapshot.status, 'pending');
  assert.equal(unknownPendingSnapshot.contentType, 'text/plain');
  assert.equal(unknownPendingSnapshot.sha256?.length, 64);
  assert.equal(Number(unknownPendingSnapshot.sizeBytes) > 0, true);
  assert.equal(
    unknownPendingSnapshot.extractedText.includes(
      'unknown-outcome-selected-body',
    ),
    true,
  );
  const unknownReconciled = await currentService.reconcile({
    actor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    captureId: unknownPreview.captureId,
    request: {
      ...unknownValue,
      previewToken: unknownPreview.previewToken,
      requestKey: 'synthetic-unknown-outcome-key',
    },
  });
  assert.equal(unknownReconciled.ok, true);
  assert.equal(unknownReconciled.value.status, 'ready');
  assert.equal(uncertainStoreCalls, 1);

  let accessLossStoreCalls = 0;
  let accessLossReconcileCalls = 0;
  const accessLossArtifacts = {
    ...artifacts,
    async store(input) {
      accessLossStoreCalls += 1;
      const stored = await artifacts.store(input);
      const snapshotBeforeRevocation =
        await prisma.knowledgeSnapshot.findUniqueOrThrow({
          where: { id: input.snapshotId },
          select: { knowledgeItemId: true },
        });
      const revokedItem = await prisma.knowledgeItem.update({
        where: { id: snapshotBeforeRevocation.knowledgeItemId },
        data: {
          deletedAt: now,
          deletedReason: 'owner_request',
          updatedBy: actor.userId,
        },
      });
      assert.notEqual(revokedItem.deletedAt, null);
      return stored;
    },
    async reconcile(input) {
      accessLossReconcileCalls += 1;
      return artifacts.reconcile(input);
    },
  };
  const accessLossService = service(unitOfWork, accessLossArtifacts);
  const accessLossValue = request('access-loss-selected-body');
  const accessLossPreview = await preview(
    accessLossService,
    accessLossValue,
  );
  const accessLossCommit = await commit(
    accessLossService,
    accessLossValue,
    accessLossPreview,
    'synthetic-access-loss-key',
  );
  assert.equal(accessLossStoreCalls, 1);
  const accessLossCapture =
    await prisma.knowledgeCaptureRequest.findUniqueOrThrow({
      where: { id: accessLossPreview.captureId },
      include: { knowledgeItem: true, snapshot: true },
    });
  assert.notEqual(accessLossCapture.knowledgeItem.deletedAt, null);
  assert.equal(accessLossCapture.status, 'pending');
  assert.equal(accessLossCapture.snapshot.status, 'pending');
  assert.equal(accessLossCapture.snapshot.contentType, 'text/plain');
  assert.equal(accessLossCapture.snapshot.sha256?.length, 64);
  assert.equal(Number(accessLossCapture.snapshot.sizeBytes) > 0, true);
  assert.equal(accessLossCommit.ok, false);
  assert.equal(accessLossCommit.statusCode, 404);
  const accessLossReconcile = await accessLossService.reconcile({
    actor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    captureId: accessLossPreview.captureId,
    request: {
      ...accessLossValue,
      previewToken: accessLossPreview.previewToken,
      requestKey: 'synthetic-access-loss-key',
    },
  });
  assert.equal(accessLossReconcile.ok, false);
  assert.equal(accessLossReconcile.statusCode, 404);
  assert.equal(accessLossReconcileCalls, 0);

  const auditText = JSON.stringify(
    await prisma.auditLog.findMany({
      where: { targetTable: 'knowledge_capture_requests' },
      select: { action: true, metadata: true },
    }),
  );
  for (const forbidden of [
    'selected-body',
    'unselected-description-canary',
    'unknown-outcome-selected-body',
    'access-loss-selected-body',
    'synthetic-unknown-outcome-key',
    'example.invalid',
    'synthetic-request-key',
    created.value.itemId,
    created.value.snapshotId,
  ]) {
    assert.equal(auditText.includes(forbidden), false, forbidden);
  }

  const organizationGroupId = 'synthetic-capture-group';
  await prisma.userAccount.create({
    data: {
      id: actor.userId,
      userName: 'synthetic-capture-owner',
      active: true,
      organization: actor.organizationId,
    },
  });
  await prisma.groupAccount.create({
    data: {
      id: organizationGroupId,
      displayName: 'Synthetic capture group',
      active: true,
    },
  });
  await prisma.userGroup.create({
    data: {
      id: 'synthetic-capture-membership',
      userId: actor.userId,
      groupId: organizationGroupId,
    },
  });
  const organizationActor = {
    ...actor,
    groupAccountIds: [organizationGroupId],
  };
  const organizationValue = {
    ...request('organization-selected-body'),
    scope: 'organization',
    organizationGroupAccountIds: [organizationGroupId],
  };
  const organizationPreview = await currentService.preview({
    actor: organizationActor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: organizationValue,
  });
  assert.equal(organizationPreview.ok, true);
  const organizationCreated = await currentService.commit({
    actor: organizationActor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: {
      ...organizationValue,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: organizationPreview.value.previewToken,
      requestKey: 'synthetic-organization-request-key',
    },
  });
  assert.equal(organizationCreated.ok, true);
  assert.equal(organizationCreated.value.status, 'ready');
  await prisma.userGroup.delete({
    where: { id: 'synthetic-capture-membership' },
  });
  const organizationPreviewAfterMembershipLoss = await currentService.preview({
    actor: organizationActor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: organizationValue,
  });
  assert.equal(organizationPreviewAfterMembershipLoss.ok, false);
  assert.equal(organizationPreviewAfterMembershipLoss.statusCode, 404);
  const organizationReplayAfterMembershipLoss = await currentService.commit({
    actor: organizationActor,
    auditActor: { source: 'api', requestId: crypto.randomUUID() },
    request: {
      ...organizationValue,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: organizationPreview.value.previewToken,
      requestKey: 'synthetic-organization-request-key',
    },
  });
  assert.equal(organizationReplayAfterMembershipLoss.ok, false);
  assert.equal(organizationReplayAfterMembershipLoss.statusCode, 404);
  await prisma.userGroup.create({
    data: {
      id: 'synthetic-capture-membership-restored',
      userId: actor.userId,
      groupId: organizationGroupId,
    },
  });
  await prisma.userAccount.update({
    where: { id: actor.userId },
    data: { organization: 'synthetic-other-organization' },
  });
  const organizationPreviewAfterOrganizationChange =
    await currentService.preview({
      actor: organizationActor,
      auditActor: { source: 'api', requestId: crypto.randomUUID() },
      request: organizationValue,
    });
  assert.equal(organizationPreviewAfterOrganizationChange.ok, false);
  assert.equal(organizationPreviewAfterOrganizationChange.statusCode, 404);
  const organizationReplayAfterOrganizationChange = await currentService.commit(
    {
      actor: organizationActor,
      auditActor: { source: 'api', requestId: crypto.randomUUID() },
      request: {
        ...organizationValue,
        confirmed: true,
        organizationConfirmed: true,
        previewToken: organizationPreview.value.previewToken,
        requestKey: 'synthetic-organization-request-key',
      },
    },
  );
  assert.equal(organizationReplayAfterOrganizationChange.ok, false);
  assert.equal(organizationReplayAfterOrganizationChange.statusCode, 404);

  console.log(
    JSON.stringify({
      captureCount,
      itemCount,
      snapshotCount,
      idempotentReplay: true,
      concurrentReplay: true,
      membershipLossFailsClosed: true,
      organizationChangeFailsClosed: true,
      itemAccessLossFailsClosedBeforeFinalization: true,
      pendingIntentMetadataPersistedBeforeArtifactIo: true,
      realArtifactAdapterReady: true,
      realArtifactReconcileNoResend: true,
      auditRollback: true,
      immutableHistory: true,
      unselectedCanaryStored: false,
    }),
  );
} finally {
  await prisma.$disconnect();
  await rm(knowledgeStorageDir, { recursive: true, force: true });
}
