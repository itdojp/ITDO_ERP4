import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';
import { PrismaKnowledgeLlmBudgetAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js';
import { PrismaKnowledgeLlmRunAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmRunAdapter.js';
import { createKnowledgeLlmRunService } from '../dist/application/knowledge/knowledgeLlmRunUseCases.js';
import { createKnowledgeLlmRunTokenCodec } from '../dist/application/knowledge/knowledgeLlmRunToken.js';

const parsed = new URL(process.env.DATABASE_URL || '');
if (
  process.env.KNOWLEDGE_LLM_BUDGET_INTEGRATION_CONFIRM !== '1' ||
  parsed.protocol !== 'postgresql:' ||
  !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
  parsed.pathname !== '/erp4_knowledge_llm_budget'
) {
  throw new Error('Refusing non-ephemeral Knowledge LLM run database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const actor = {
  userId: 'run-integration-user',
  organizationId: 'run-integration-organization',
  groupAccountIds: ['run-integration-group'],
};
const outsider = {
  userId: 'run-integration-outsider',
  groupAccountIds: [],
};
const auditActor = {
  requestId: 'run-integration-request',
  source: 'api',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
};
const promptCanary = 'Selected synthetic prompt';
const sourceCanary = 'Selected synthetic source';
const unselectedCanary = 'UNSELECTED-PRIVATE-CANARY';
const keyCanary = 'raw-request-key-must-not-persist';

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

try {
  await prisma.groupAccount.create({
    data: {
      id: actor.groupAccountIds[0],
      displayName: 'Synthetic LLM integration group',
    },
  });
  await prisma.userAccount.create({
    data: {
      id: actor.userId,
      userName: actor.userId,
      active: true,
      organization: actor.organizationId,
    },
  });
  await prisma.userGroup.create({
    data: {
      userId: actor.userId,
      groupId: actor.groupAccountIds[0],
    },
  });
  await prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id: 'run-integration-policy',
      subjectType: 'user',
      subjectId: actor.userId,
      currency: 'JPY',
      timezone: 'Asia/Tokyo',
      softLimitMicros: 1_000n,
      hardLimitMicros: 2_000n,
      requestsPerHour: 10,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
  await prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id: 'run-integration-organization-policy',
      subjectType: 'organization',
      subjectId: actor.organizationId,
      currency: 'JPY',
      timezone: 'Asia/Tokyo',
      softLimitMicros: 1_000n,
      hardLimitMicros: 2_000n,
      requestsPerHour: 10,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
  const item = await prisma.knowledgeItem.create({
    data: {
      id: 'run-integration-item',
      ownerUserId: actor.userId,
      scope: 'personal',
      sourceType: 'manual',
      title: 'Synthetic LLM integration item',
      shortNote: unselectedCanary,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const artifact = await prisma.storageArtifact.create({
    data: {
      id: 'run-integration-artifact',
      context: 'knowledge-snapshot',
      provider: 'local',
      providerKey: 'synthetic/run-integration-source',
      status: 'ready',
      originalName: 'synthetic.txt',
      contentType: 'text/plain',
      sizeBytes: BigInt(Buffer.byteLength(sourceCanary, 'utf8')),
      sha256: hash(sourceCanary),
      ownerType: 'knowledge-item',
      ownerId: item.id,
      createdBy: actor.userId,
    },
  });
  const snapshot = await prisma.knowledgeSnapshot.create({
    data: {
      id: 'run-integration-snapshot',
      knowledgeItemId: item.id,
      artifactId: artifact.id,
      version: 1,
      status: 'ready',
      captureMethod: 'text',
      originalName: 'synthetic.txt',
      contentType: 'text/plain',
      sizeBytes: BigInt(Buffer.byteLength(sourceCanary, 'utf8')),
      sha256: hash(sourceCanary),
      extractedText: sourceCanary,
      requestKeyHash: hash('snapshot-key'),
      requestPayloadHash: hash('snapshot-payload'),
      capturedBy: actor.userId,
      readyAt: new Date(),
    },
  });
  const organizationItem = await prisma.knowledgeItem.create({
    data: {
      id: 'run-integration-organization-item',
      ownerUserId: 'run-integration-organization-owner',
      scope: 'organization',
      organizationId: actor.organizationId,
      sourceType: 'manual',
      title: 'Synthetic organization LLM item',
      createdBy: 'run-integration-organization-owner',
      updatedBy: 'run-integration-organization-owner',
      groupGrants: {
        create: {
          groupAccountId: actor.groupAccountIds[0],
          createdBy: 'run-integration-organization-owner',
        },
      },
    },
  });
  const organizationSource = 'Selected organization source';
  const organizationArtifact = await prisma.storageArtifact.create({
    data: {
      id: 'run-integration-organization-artifact',
      context: 'knowledge-snapshot',
      provider: 'local',
      providerKey: 'synthetic/run-integration-organization-source',
      status: 'ready',
      originalName: 'organization.txt',
      contentType: 'text/plain',
      sizeBytes: BigInt(Buffer.byteLength(organizationSource, 'utf8')),
      sha256: hash(organizationSource),
      ownerType: 'knowledge-item',
      ownerId: organizationItem.id,
      createdBy: 'run-integration-organization-owner',
    },
  });
  const organizationSnapshot = await prisma.knowledgeSnapshot.create({
    data: {
      id: 'run-integration-organization-snapshot',
      knowledgeItemId: organizationItem.id,
      artifactId: organizationArtifact.id,
      version: 1,
      status: 'ready',
      captureMethod: 'text',
      originalName: 'organization.txt',
      contentType: 'text/plain',
      sizeBytes: BigInt(Buffer.byteLength(organizationSource, 'utf8')),
      sha256: hash(organizationSource),
      extractedText: organizationSource,
      requestKeyHash: hash('organization-snapshot-key'),
      requestPayloadHash: hash('organization-snapshot-payload'),
      capturedBy: 'run-integration-organization-owner',
      readyAt: new Date(),
    },
  });
  const catalog = {
    version: 1,
    models: [
      {
        provider: 'stub',
        model: 'stub-run-integration',
        enabled: true,
        maxInputTokens: 100_000,
        maxOutputTokens: 128,
        inputCostMicrosPerMillion: 100_000n,
        outputCostMicrosPerMillion: 100_000n,
        currency: 'JPY',
        capabilities: ['text'],
      },
    ],
  };
  const stub = new StubExternalLlmTextAdapter();
  let dispatches = 0;
  const provider = {
    bind: (request) => stub.bind(request),
    async prepare(request) {
      const prepared = await stub.prepare(request);
      return {
        requestFingerprint: prepared.requestFingerprint,
        async dispatch() {
          dispatches += 1;
          return prepared.dispatch();
        },
      };
    },
  };
  const service = createKnowledgeLlmRunService({
    runtime: { provider: 'stub', catalog },
    providerPort: provider,
    budgetPort: new PrismaKnowledgeLlmBudgetAdapter(prisma),
    runPort: new PrismaKnowledgeLlmRunAdapter(prisma, prisma),
    tokenCodec: createKnowledgeLlmRunTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'run-integration-signing-secret-0000000000000001',
      },
    }),
  });
  const request = {
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-run-integration',
    catalogVersion: 1,
    userPrompt: promptCanary,
    maxOutputTokens: 32,
    sources: [{ sourceType: 'snapshot', sourceId: snapshot.id }],
  };

  const outsiderItem = await prisma.knowledgeItem.create({
    data: {
      id: 'run-integration-outsider-item',
      ownerUserId: outsider.userId,
      scope: 'personal',
      sourceType: 'manual',
      title: 'Synthetic outsider item',
      createdBy: outsider.userId,
      updatedBy: outsider.userId,
    },
  });
  const outsiderArtifact = await prisma.storageArtifact.create({
    data: {
      id: 'run-integration-outsider-artifact',
      context: 'knowledge-snapshot',
      provider: 'local',
      providerKey: 'synthetic/run-integration-outsider',
      status: 'ready',
      originalName: 'outsider.txt',
      contentType: 'text/plain',
      sizeBytes: 8n,
      sha256: hash('outsider'),
      ownerType: 'knowledge-item',
      ownerId: outsiderItem.id,
      createdBy: outsider.userId,
    },
  });
  const outsiderSnapshot = await prisma.knowledgeSnapshot.create({
    data: {
      id: 'run-integration-outsider-snapshot',
      knowledgeItemId: outsiderItem.id,
      artifactId: outsiderArtifact.id,
      version: 1,
      status: 'ready',
      captureMethod: 'text',
      originalName: 'outsider.txt',
      contentType: 'text/plain',
      sizeBytes: 8n,
      sha256: hash('outsider'),
      extractedText: 'outsider',
      requestKeyHash: hash('outsider-key'),
      requestPayloadHash: hash('outsider-payload'),
      capturedBy: outsider.userId,
      readyAt: new Date(),
    },
  });
  await assert.rejects(
    service.preview({
      actor,
      auditActor,
      request: {
        ...request,
        sources: [{ sourceType: 'snapshot', sourceId: outsiderSnapshot.id }],
      },
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  const beforePreview = await prisma.knowledgeLlmRun.count({
    where: { actorUserId: actor.userId },
  });
  const preview = await service.preview({ actor, auditActor, request });
  assert.equal(dispatches, 0);
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { actorUserId: actor.userId },
    }),
    beforePreview,
  );
  assert.equal(preview.sourceCounts.snapshot, 1);
  assert.equal(preview.selectedSourceCount, 1);
  assert.equal(preview.budget.configured, true);

  const completed = await service.execute({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-execute' },
    request,
    previewToken: preview.previewToken,
    requestKey: keyCanary,
    confirmed: true,
  });
  assert.equal(completed.created, true);
  assert.equal(completed.run.executionStatus, 'result_ready');
  assert.equal(completed.run.settlementStatus, 'settled_actual');
  assert.equal(dispatches, 1);
  assert.equal(completed.run.result, 'Synthetic ex');

  const replay = await service.execute({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-replay' },
    request,
    previewToken: preview.previewToken,
    requestKey: keyCanary,
    confirmed: true,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.run.id, completed.run.id);
  assert.equal(dispatches, 1);
  assert.equal(
    await prisma.knowledgeConversation.count({
      where: { llmRuns: { some: { id: completed.run.id } } },
    }),
    1,
  );

  await assert.rejects(
    service.detail({ actor: outsider, runId: completed.run.id }),
    (error) => error.code === 'not_found',
  );
  const sourceRows = await prisma.knowledgeLlmContextSource.findMany({
    where: { runId: completed.run.id },
  });
  assert.equal(sourceRows.length, 1);
  assert.equal(sourceRows[0].sourceSnapshotId, snapshot.id);
  assert.equal(
    sourceRows[0].representationHash,
    hash(`erp4:knowledge:llm-context-representation:v1\0${sourceCanary}`),
  );

  const auditRows = await prisma.auditLog.findMany({
    where: {
      userId: actor.userId,
      action: { startsWith: 'knowledge_llm_' },
      targetId: { in: [preview.runId, completed.run.id] },
    },
  });
  assert.ok(auditRows.some((row) => row.action === 'knowledge_llm_previewed'));
  assert.ok(auditRows.some((row) => row.action === 'knowledge_llm_completed'));
  const sanitizedAudit = JSON.stringify(auditRows.map((row) => row.metadata));
  for (const canary of [
    promptCanary,
    sourceCanary,
    unselectedCanary,
    keyCanary,
    snapshot.id,
  ]) {
    assert.equal(sanitizedAudit.includes(canary), false);
  }
  const persistedText = JSON.stringify(
    await prisma.knowledgeConversation.findFirstOrThrow({
      where: { llmRuns: { some: { id: completed.run.id } } },
      include: { turns: { orderBy: { sequence: 'asc' } } },
    }),
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
  assert.equal(persistedText.includes(promptCanary), true);
  assert.equal(persistedText.includes(unselectedCanary), false);

  const missingUsageProvider = {
    bind: (providerRequest) => stub.bind(providerRequest),
    async prepare(providerRequest) {
      const prepared = await stub.prepare(providerRequest);
      return {
        requestFingerprint: prepared.requestFingerprint,
        async dispatch() {
          const result = await prepared.dispatch();
          return { ...result, usageStatus: 'missing', usage: null };
        },
      };
    },
  };
  const missingUsageService = createKnowledgeLlmRunService({
    runtime: { provider: 'stub', catalog },
    providerPort: missingUsageProvider,
    budgetPort: new PrismaKnowledgeLlmBudgetAdapter(prisma),
    runPort: new PrismaKnowledgeLlmRunAdapter(prisma, prisma),
    tokenCodec: createKnowledgeLlmRunTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'run-integration-missing-usage-secret-000000000001',
      },
    }),
  });
  const missingUsagePreview = await missingUsageService.preview({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-usage-preview' },
    request,
  });
  const missingUsageRun = await missingUsageService.execute({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-usage-execute' },
    request,
    previewToken: missingUsagePreview.previewToken,
    requestKey: 'run-integration-missing-usage-key',
    confirmed: true,
  });
  assert.equal(missingUsageRun.run.executionStatus, 'result_ready');
  assert.equal(missingUsageRun.run.settlementStatus, 'held_maximum');
  assert.equal(missingUsageRun.run.failureCode, 'usage_missing');
  assert.equal(missingUsageRun.run.result, 'Synthetic ex');
  const missingUsageOutcome =
    await prisma.knowledgeLlmProviderOutcome.findUniqueOrThrow({
      where: { runId: missingUsageRun.run.id },
    });
  assert.equal(missingUsageOutcome.status, 'usage_unknown');
  assert.equal(missingUsageOutcome.normalizedContent, null);
  assert.ok(missingUsageOutcome.finalizedAt);

  const organizationRequest = {
    ...request,
    scope: 'organization',
    organizationId: actor.organizationId,
    userPrompt: 'Selected organization prompt',
    sources: [{ sourceType: 'snapshot', sourceId: organizationSnapshot.id }],
  };
  const organizationPreview = await service.preview({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-org-preview' },
    request: organizationRequest,
  });
  const organizationCompleted = await service.execute({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-org-execute' },
    request: organizationRequest,
    previewToken: organizationPreview.previewToken,
    requestKey: 'run-integration-organization-request-key',
    confirmed: true,
  });
  assert.equal(organizationCompleted.run.executionStatus, 'result_ready');
  assert.equal(organizationCompleted.run.settlementStatus, 'settled_actual');
  assert.equal(dispatches, 2);
  await prisma.knowledgeItemGroupGrant.delete({
    where: {
      knowledgeItemId_groupAccountId: {
        knowledgeItemId: organizationItem.id,
        groupAccountId: actor.groupAccountIds[0],
      },
    },
  });
  await assert.rejects(
    service.detail({ actor, runId: organizationCompleted.run.id }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: {
      deletedAt: new Date(),
      deletedReason: 'owner_request',
      updatedBy: actor.userId,
    },
  });
  await assert.rejects(
    service.detail({ actor, runId: completed.run.id }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  console.log('knowledge LLM run PostgreSQL integration: PASS');
} finally {
  await prisma.$disconnect();
}
