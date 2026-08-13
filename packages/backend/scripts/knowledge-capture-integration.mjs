import assert from 'node:assert/strict';

import { Prisma } from '@prisma/client';

import {
  PrismaKnowledgeCaptureRepository,
  PrismaKnowledgeCaptureUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeCaptureAdapter.js';
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
const artifactsBySnapshot = new Map();

const artifacts = {
  async store(input) {
    const row = await prisma.storageArtifact.create({
      data: {
        context: 'knowledge_snapshot',
        provider: 'local',
        providerKey: `synthetic/${input.sha256}`,
        status: 'ready',
        idempotencyKey: input.idempotencyNamespace,
        originalName: input.originalName,
        contentType: input.contentType,
        sizeBytes: BigInt(input.sizeBytes),
        sha256: input.sha256,
        ownerType: 'knowledge_snapshot',
        ownerId: input.snapshotId,
        createdBy: input.createdBy,
      },
    });
    const artifact = {
      artifactId: row.id,
      contentType: row.contentType,
      createdAt: row.createdAt.toISOString(),
      originalName: row.originalName,
      provider: 'local',
      sha256: row.sha256,
      sizeBytes: Number(row.sizeBytes),
    };
    artifactsBySnapshot.set(input.snapshotId, artifact);
    return artifact;
  },
  async reconcile(input) {
    const artifact = artifactsBySnapshot.get(input.snapshotId) ?? null;
    if (
      !artifact ||
      artifact.sha256 !== input.sha256 ||
      artifact.sizeBytes !== input.sizeBytes
    ) {
      return null;
    }
    return artifact;
  },
  async open() {
    throw new Error('not used');
  },
};

const tokenCodec = createKnowledgeCaptureTokenCodec({
  env: {
    NODE_ENV: 'test',
    KNOWLEDGE_CURSOR_SIGNING_SECRET:
      'knowledge-capture-integration-signing-secret-0001',
  },
  now: () => now,
});

function service(customUnitOfWork = unitOfWork) {
  return createKnowledgeCaptureService({
    artifacts,
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
  const created = await commit(
    currentService,
    value,
    currentPreview,
    'synthetic-request-key',
  );
  assert.equal(created.ok, true);
  assert.equal(created.value.status, 'ready');

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

  const auditText = JSON.stringify(
    await prisma.auditLog.findMany({
      where: { targetTable: 'knowledge_capture_requests' },
      select: { action: true, metadata: true },
    }),
  );
  for (const forbidden of [
    'selected-body',
    'unselected-description-canary',
    'example.invalid',
    'synthetic-request-key',
    created.value.itemId,
    created.value.snapshotId,
  ]) {
    assert.equal(auditText.includes(forbidden), false, forbidden);
  }

  console.log(
    JSON.stringify({
      captureCount,
      itemCount,
      snapshotCount,
      idempotentReplay: true,
      auditRollback: true,
      immutableHistory: true,
      unselectedCanaryStored: false,
    }),
  );
} finally {
  await prisma.$disconnect();
}
