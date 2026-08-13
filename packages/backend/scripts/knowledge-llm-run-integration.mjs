import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';
import { PrismaKnowledgeLlmBudgetAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js';
import { PrismaKnowledgeLlmContextCandidateAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmContextCandidateAdapter.js';
import { PrismaKnowledgeLlmRunAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmRunAdapter.js';
import { PrismaKnowledgeConversationRepository } from '../dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js';
import { createKnowledgeLlmBudgetUseCases } from '../dist/application/knowledge/knowledgeLlmBudgetUseCases.js';
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
  const budgetAdapter = new PrismaKnowledgeLlmBudgetAdapter(prisma);
  const runAdapter = new PrismaKnowledgeLlmRunAdapter(prisma, prisma);
  const conversationRepository = new PrismaKnowledgeConversationRepository(
    prisma,
  );
  const service = createKnowledgeLlmRunService({
    runtime: { provider: 'stub', catalog },
    providerPort: provider,
    budgetPort: budgetAdapter,
    runPort: runAdapter,
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
  const reserveOnly = async ({ runId, requestKey, source = snapshot }) => {
    const resolved = await runAdapter.resolveContext({
      actor,
      scope: 'personal',
      organizationId: null,
      selectors: [{ sourceType: 'snapshot', sourceId: source.id }],
    });
    const budgetService = createKnowledgeLlmBudgetUseCases(
      budgetAdapter,
      catalog,
      provider,
    );
    const result = await budgetService.reserve({
      runId,
      actor,
      auditActor: {
        ...auditActor,
        requestId: `run-integration-${runId}`,
      },
      scope: 'personal',
      organizationId: null,
      provider: 'stub',
      model: 'stub-run-integration',
      catalogVersion: 1,
      promptTemplateVersion: 1,
      requestKeyHash: hash(requestKey),
      systemPrompt: 'Synthetic system instruction',
      userPrompt: 'Synthetic reserved prompt',
      selectedContextSources: resolved.sources,
      maxOutputTokens: 32,
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.created, true);
    const stored = await prisma.knowledgeLlmRun.findUniqueOrThrow({
      where: { id: runId },
      select: { providerRequestHash: true },
    });
    return { resolved, providerRequestHash: stored.providerRequestHash };
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

  const roleBoundaryConversation = await prisma.knowledgeConversation.create({
    data: {
      id: 'run-integration-role-boundary-conversation',
      ownerUserId: actor.userId,
      title: 'Synthetic role boundary conversation',
      sourceType: 'manual',
      contentHash: hash('run-integration-role-boundary-conversation'),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  for (const [sequence, role] of ['system', 'tool'].entries()) {
    const content = `Synthetic ${role} turn must remain ineligible`;
    const turn = await prisma.knowledgeConversationTurn.create({
      data: {
        id: `run-integration-${role}-turn`,
        conversationId: roleBoundaryConversation.id,
        sequence: sequence + 1,
        role,
        origin: role,
        content,
        contentHash: hash(content),
        createdBy: actor.userId,
      },
    });
    await assert.rejects(
      service.preview({
        actor,
        auditActor: {
          ...auditActor,
          requestId: `run-integration-${role}-turn-reselect`,
        },
        request: {
          ...request,
          sources: [{ sourceType: 'conversation_turn', sourceId: turn.id }],
        },
      }),
      (error) => error.status === 404 && error.code === 'not_found',
    );

    const synthesisVersionId = `run-integration-${role}-turn-synthesis-version`;
    await prisma.knowledgeSynthesis.create({
      data: {
        id: `run-integration-${role}-turn-synthesis`,
        ownerUserId: actor.userId,
        scope: 'personal',
        title: `Synthetic ${role} turn synthesis`,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        versions: {
          create: {
            id: synthesisVersionId,
            version: 1,
            content: `Synthetic synthesis derived from a ${role} turn`,
            unresolvedQuestions: [],
            createdBy: actor.userId,
            sources: {
              create: {
                relationType: 'primary',
                ordinal: 0,
                sourceConversationTurnId: turn.id,
                createdBy: actor.userId,
              },
            },
          },
        },
      },
    });
    await assert.rejects(
      service.preview({
        actor,
        auditActor: {
          ...auditActor,
          requestId: `run-integration-${role}-turn-synthesis-reselect`,
        },
        request: {
          ...request,
          sources: [
            { sourceType: 'synthesis_version', sourceId: synthesisVersionId },
          ],
        },
      }),
      (error) => error.status === 404 && error.code === 'not_found',
    );
  }

  const roleBoundaryConversationSynthesisVersionId =
    'run-integration-role-boundary-conversation-synthesis-version';
  await prisma.knowledgeSynthesis.create({
    data: {
      id: 'run-integration-role-boundary-conversation-synthesis',
      ownerUserId: actor.userId,
      scope: 'personal',
      title: 'Synthetic role boundary conversation synthesis',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: roleBoundaryConversationSynthesisVersionId,
          version: 1,
          content:
            'Synthetic synthesis derived from an ineligible conversation',
          unresolvedQuestions: [],
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceConversationId: roleBoundaryConversation.id,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-role-boundary-conversation-reselect',
      },
      request: {
        ...request,
        sources: [
          {
            sourceType: 'synthesis_version',
            sourceId: roleBoundaryConversationSynthesisVersionId,
          },
        ],
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
  assert.ok(
    await conversationRepository.findVisible({
      actor,
      conversationId: completed.run.conversationId,
    }),
  );
  const linkedResultConversation = await conversationRepository.addItem({
    actor,
    conversationId: completed.run.conversationId,
    itemId: item.id,
    relationType: 'context',
    ordinal: 0,
    expectedVersion: 1,
  });
  assert.ok(linkedResultConversation);
  assert.ok(
    await conversationRepository.findVisible({
      actor,
      conversationId: completed.run.conversationId,
    }),
  );
  const completedAssistant =
    await prisma.knowledgeConversationTurn.findFirstOrThrow({
      where: {
        conversationId: completed.run.conversationId,
        role: 'assistant',
      },
    });
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-llm-result-reselect',
      },
      request: {
        ...request,
        sources: [
          {
            sourceType: 'conversation_turn',
            sourceId: completedAssistant.id,
          },
        ],
      },
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  const nestedSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: 'run-integration-nested-llm-synthesis',
      ownerUserId: actor.userId,
      scope: 'personal',
      title: 'Synthetic nested LLM synthesis',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: 'run-integration-nested-llm-synthesis-version',
          version: 1,
          content: 'Synthetic synthesis derived from an LLM result',
          unresolvedQuestions: [],
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceConversationTurnId: completedAssistant.id,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });
  assert.ok(nestedSynthesis);
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-nested-synthesis-reselect',
      },
      request: {
        ...request,
        sources: [
          {
            sourceType: 'synthesis_version',
            sourceId: 'run-integration-nested-llm-synthesis-version',
          },
        ],
      },
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  const nestedConversationSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: 'run-integration-nested-llm-conversation-synthesis',
      ownerUserId: actor.userId,
      scope: 'personal',
      title: 'Synthetic synthesis derived from an LLM conversation',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: 'run-integration-nested-llm-conversation-version',
          version: 1,
          content: 'Synthetic synthesis derived from an LLM conversation',
          unresolvedQuestions: [],
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceConversationId: completed.run.conversationId,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });
  assert.ok(nestedConversationSynthesis);
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-nested-conversation-reselect',
      },
      request: {
        ...request,
        sources: [
          {
            sourceType: 'synthesis_version',
            sourceId: 'run-integration-nested-llm-conversation-version',
          },
        ],
      },
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );

  const concurrentPreviewA = await service.preview({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-concurrent-a' },
    request,
  });
  const concurrentPreviewB = await service.preview({
    actor,
    auditActor: { ...auditActor, requestId: 'run-integration-concurrent-b' },
    request,
  });
  assert.notEqual(concurrentPreviewA.runId, concurrentPreviewB.runId);
  const concurrentReplay = await Promise.all([
    service.execute({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-concurrent-execute-a',
      },
      request,
      previewToken: concurrentPreviewA.previewToken,
      requestKey: 'run-integration-concurrent-key',
      confirmed: true,
    }),
    service.execute({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-concurrent-execute-b',
      },
      request,
      previewToken: concurrentPreviewB.previewToken,
      requestKey: 'run-integration-concurrent-key',
      confirmed: true,
    }),
  ]);
  assert.equal(concurrentReplay[0].run.id, concurrentReplay[1].run.id);
  assert.deepEqual(
    concurrentReplay
      .map((result) => [result.created, result.reused])
      .sort((left, right) => Number(left[0]) - Number(right[0])),
    [
      [false, true],
      [true, false],
    ],
  );
  assert.equal(dispatches, 2);
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: {
        id: { in: [concurrentPreviewA.runId, concurrentPreviewB.runId] },
      },
    }),
    1,
  );
  assert.equal(
    await prisma.knowledgeLlmReservation.count({
      where: { runId: concurrentReplay[0].run.id },
    }),
    1,
  );
  assert.equal(
    await prisma.knowledgeConversation.count({
      where: { llmRuns: { some: { id: concurrentReplay[0].run.id } } },
    }),
    1,
  );
  assert.equal(
    await prisma.knowledgeConversationTurn.count({
      where: {
        conversation: { llmRuns: { some: { id: concurrentReplay[0].run.id } } },
      },
    }),
    2,
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
  assert.equal(dispatches, 3);
  assert.ok(
    await conversationRepository.findVisible({
      actor,
      conversationId: organizationCompleted.run.conversationId,
    }),
  );
  assert.ok(
    (
      await conversationRepository.listVisible({ actor, limit: 100 })
    ).items.some(
      (conversation) =>
        conversation.id === organizationCompleted.run.conversationId,
    ),
  );

  const secondaryOrganizationItem = await prisma.knowledgeItem.create({
    data: {
      id: 'run-integration-secondary-organization-item',
      ownerUserId: 'run-integration-secondary-owner',
      scope: 'organization',
      organizationId: actor.organizationId,
      sourceType: 'manual',
      title: 'Synthetic secondary organization item',
      createdBy: 'run-integration-secondary-owner',
      updatedBy: 'run-integration-secondary-owner',
      groupGrants: {
        create: {
          groupAccountId: actor.groupAccountIds[0],
          createdBy: 'run-integration-secondary-owner',
        },
      },
    },
  });
  const synthesisVersionId = 'run-integration-organization-synthesis-version';
  await prisma.knowledgeSynthesis.create({
    data: {
      id: 'run-integration-organization-synthesis',
      ownerUserId: 'run-integration-synthesis-owner',
      scope: 'organization',
      organizationId: actor.organizationId,
      title: 'Synthetic organization synthesis',
      createdBy: 'run-integration-synthesis-owner',
      updatedBy: 'run-integration-synthesis-owner',
      groupGrants: {
        create: {
          groupAccountId: actor.groupAccountIds[0],
          createdBy: 'run-integration-synthesis-owner',
          updatedBy: 'run-integration-synthesis-owner',
        },
      },
      versions: {
        create: {
          id: synthesisVersionId,
          version: 1,
          content: 'Selected organization synthesis content',
          unresolvedQuestions: [],
          createdBy: 'run-integration-synthesis-owner',
          sources: {
            create: [
              {
                relationType: 'primary',
                ordinal: 0,
                sourceKnowledgeItemId: organizationItem.id,
                createdBy: 'run-integration-synthesis-owner',
              },
              {
                relationType: 'supporting',
                ordinal: 1,
                sourceKnowledgeItemId: secondaryOrganizationItem.id,
                createdBy: 'run-integration-synthesis-owner',
              },
            ],
          },
        },
      },
    },
  });
  const synthesisRequest = {
    ...organizationRequest,
    userPrompt: 'Selected synthesis prompt',
    sources: [
      { sourceType: 'synthesis_version', sourceId: synthesisVersionId },
    ],
  };
  const candidateAdapter = new PrismaKnowledgeLlmContextCandidateAdapter(
    prisma,
  );
  const candidatesBeforeRevoke = await candidateAdapter.list({
    actor,
    itemId: organizationItem.id,
    scope: 'organization',
    organizationId: actor.organizationId,
    sourceType: 'synthesis_version',
    limit: 10,
    boundary: null,
  });
  assert.ok(
    candidatesBeforeRevoke?.items.some(
      (candidate) => candidate.sourceId === synthesisVersionId,
    ),
  );
  const synthesisPreview = await service.preview({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-synthesis-preview',
    },
    request: synthesisRequest,
  });
  const staleSynthesisPreview = await service.preview({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-stale-synthesis-preview',
    },
    request: synthesisRequest,
  });
  const synthesisCompleted = await service.execute({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-synthesis-execute',
    },
    request: synthesisRequest,
    previewToken: synthesisPreview.previewToken,
    requestKey: 'run-integration-synthesis-request-key',
    confirmed: true,
  });
  assert.equal(dispatches, 4);
  assert.ok(
    await conversationRepository.findVisible({
      actor,
      conversationId: synthesisCompleted.run.conversationId,
    }),
  );
  await prisma.knowledgeItemGroupGrant.delete({
    where: {
      knowledgeItemId_groupAccountId: {
        knowledgeItemId: secondaryOrganizationItem.id,
        groupAccountId: actor.groupAccountIds[0],
      },
    },
  });
  const candidatesAfterRevoke = await candidateAdapter.list({
    actor,
    itemId: organizationItem.id,
    scope: 'organization',
    organizationId: actor.organizationId,
    sourceType: 'synthesis_version',
    limit: 10,
    boundary: null,
  });
  assert.equal(
    candidatesAfterRevoke?.items.some(
      (candidate) => candidate.sourceId === synthesisVersionId,
    ),
    false,
  );
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-revoked-synthesis-preview',
      },
      request: synthesisRequest,
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );
  await assert.rejects(
    service.execute({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-stale-synthesis-execute',
      },
      request: synthesisRequest,
      previewToken: staleSynthesisPreview.previewToken,
      requestKey: 'run-integration-stale-synthesis-request-key',
      confirmed: true,
    }),
    (error) =>
      error.status === 404 &&
      ['not_found', 'stale_preview'].includes(error.code),
  );
  assert.equal(dispatches, 4);
  await assert.rejects(
    service.detail({ actor, runId: synthesisCompleted.run.id }),
    (error) => error.status === 404 && error.code === 'not_found',
  );
  assert.equal(
    await conversationRepository.findVisible({
      actor,
      conversationId: synthesisCompleted.run.conversationId,
    }),
    null,
  );
  assert.equal(
    (
      await conversationRepository.listVisible({ actor, limit: 100 })
    ).items.some(
      (conversation) =>
        conversation.id === synthesisCompleted.run.conversationId,
    ),
    false,
  );
  await prisma.knowledgeItemGroupGrant.create({
    data: {
      knowledgeItemId: secondaryOrganizationItem.id,
      groupAccountId: actor.groupAccountIds[0],
      createdBy: 'run-integration-secondary-owner',
    },
  });
  await prisma.knowledgeItem.update({
    where: { id: secondaryOrganizationItem.id },
    data: {
      deletedAt: new Date(),
      deletedReason: 'owner_request',
      updatedBy: 'run-integration-secondary-owner',
    },
  });
  await assert.rejects(
    service.preview({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-deleted-synthesis-preview',
      },
      request: synthesisRequest,
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );
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
  assert.equal(
    await conversationRepository.findVisible({
      actor,
      conversationId: organizationCompleted.run.conversationId,
    }),
    null,
  );
  assert.equal(
    (
      await conversationRepository.listVisible({ actor, limit: 100 })
    ).items.some(
      (conversation) =>
        conversation.id === organizationCompleted.run.conversationId,
    ),
    false,
  );

  const finalizationRaceId = 'run-integration-finalization-race';
  const finalizationRace = await reserveOnly({
    runId: finalizationRaceId,
    requestKey: 'finalization-race-key',
  });
  await runAdapter.authorizeAndMarkDispatched({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-finalization-race-dispatch',
    },
    runId: finalizationRaceId,
    scope: 'personal',
    organizationId: null,
    selectors: [{ sourceType: 'snapshot', sourceId: snapshot.id }],
    expectedSources: finalizationRace.resolved.sources,
    expectedProviderRequestHash: finalizationRace.providerRequestHash,
  });
  const finalizationRaceAdapter = new PrismaKnowledgeLlmRunAdapter(
    prisma,
    prisma,
    () => new Date(Date.now() + 120_000),
  );
  await runAdapter.captureProviderOutcome({
    actor,
    runId: finalizationRaceId,
    outcome: {
      status: 'valid',
      normalizedContent: 'Synthetic race result',
      inputTokens: 20,
      outputTokens: 10,
    },
  });
  await assert.rejects(
    runAdapter.captureProviderOutcome({
      actor: outsider,
      runId: finalizationRaceId,
      outcome: {
        status: 'valid',
        normalizedContent: 'Synthetic race result',
        inputTokens: 20,
        outputTokens: 10,
      },
    }),
    (error) =>
      error?.name === 'KnowledgeLlmRunAccessError' &&
      error?.code === 'not_found',
  );
  const finalizationRaceResults = await Promise.allSettled([
    runAdapter.finalizeCapturedOutcome({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-finalization-race-result',
      },
      runId: finalizationRaceId,
    }),
    finalizationRaceAdapter.reconcile({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-finalization-race-reconcile',
      },
      runId: finalizationRaceId,
    }),
  ]);
  assert.ok(
    finalizationRaceResults.some((result) => result.status === 'fulfilled'),
  );
  const finalizationRaceRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: finalizationRaceId },
  });
  assert.equal(finalizationRaceRun.executionStatus, 'result_ready');
  assert.equal(finalizationRaceRun.settlementStatus, 'settled_actual');
  assert.ok(
    (await prisma.knowledgeConversation.count({
      where: { llmRuns: { some: { id: finalizationRaceId } } },
    })) <= 1,
  );

  const captureAckRaceId = 'run-integration-capture-ack-race';
  const captureAckRace = await reserveOnly({
    runId: captureAckRaceId,
    requestKey: 'capture-ack-race-key',
  });
  await runAdapter.authorizeAndMarkDispatched({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-capture-ack-race-dispatch',
    },
    runId: captureAckRaceId,
    scope: 'personal',
    organizationId: null,
    selectors: [{ sourceType: 'snapshot', sourceId: snapshot.id }],
    expectedSources: captureAckRace.resolved.sources,
    expectedProviderRequestHash: captureAckRace.providerRequestHash,
  });
  const commitUnknownHost = {
    async $transaction(callback, options) {
      await prisma.$transaction(callback, options);
      await runAdapter.finalizeCapturedOutcome({
        actor,
        auditActor: {
          ...auditActor,
          requestId: 'run-integration-capture-ack-race-finalize',
        },
        runId: captureAckRaceId,
      });
      throw new Error('synthetic_capture_commit_ack_unknown');
    },
  };
  const commitUnknownAdapter = new PrismaKnowledgeLlmRunAdapter(
    commitUnknownHost,
    prisma,
  );
  await commitUnknownAdapter.captureProviderOutcome({
    actor,
    runId: captureAckRaceId,
    outcome: {
      status: 'valid',
      normalizedContent: 'Synthetic capture acknowledgment race result',
      inputTokens: 20,
      outputTokens: 10,
    },
  });
  const captureAckRaceRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: captureAckRaceId },
  });
  assert.equal(captureAckRaceRun.executionStatus, 'result_ready');
  assert.equal(captureAckRaceRun.settlementStatus, 'settled_actual');
  assert.equal(
    await prisma.knowledgeConversation.count({
      where: { llmRuns: { some: { id: captureAckRaceId } } },
    }),
    1,
  );

  const accountingBefore =
    await prisma.knowledgeLlmBudgetPeriod.findFirstOrThrow({
      where: { policy: { subjectType: 'user', subjectId: actor.userId } },
      orderBy: { periodStartUtc: 'desc' },
    });
  const disabledReservedId = 'run-integration-disabled-reserved';
  const disabledReserved = await reserveOnly({
    runId: disabledReservedId,
    requestKey: 'disabled-reserved-key',
  });
  assert.ok(disabledReserved.providerRequestHash);
  const reconcileClock = () => new Date(Date.now() + 180_000);
  const reconcileRunAdapter = new PrismaKnowledgeLlmRunAdapter(
    prisma,
    prisma,
    reconcileClock,
  );
  const disabledService = createKnowledgeLlmRunService({
    runtime: { provider: 'disabled', catalog: null },
    providerPort: null,
    budgetPort: budgetAdapter,
    runPort: reconcileRunAdapter,
    tokenCodec: createKnowledgeLlmRunTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'run-integration-disabled-secret-00000000000001',
      },
    }),
  });
  const released = await disabledService.reconcile({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-disabled-reconcile',
    },
    runId: disabledReservedId,
  });
  assert.equal(released.executionStatus, 'failed');
  assert.equal(released.settlementStatus, 'released');
  const releasedAgain = await disabledService.reconcile({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-disabled-reconcile-again',
    },
    runId: disabledReservedId,
  });
  assert.equal(releasedAgain.settlementStatus, 'released');

  const aclLostDispatchedId = 'run-integration-acl-lost-dispatched';
  const aclLostDispatched = await reserveOnly({
    runId: aclLostDispatchedId,
    requestKey: 'acl-lost-dispatched-key',
  });
  await runAdapter.authorizeAndMarkDispatched({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-acl-lost-dispatch',
    },
    runId: aclLostDispatchedId,
    scope: 'personal',
    organizationId: null,
    selectors: [{ sourceType: 'snapshot', sourceId: snapshot.id }],
    expectedSources: aclLostDispatched.resolved.sources,
    expectedProviderRequestHash: aclLostDispatched.providerRequestHash,
  });
  const inFlightReconcileService = createKnowledgeLlmRunService({
    runtime: { provider: 'disabled', catalog: null },
    providerPort: null,
    budgetPort: budgetAdapter,
    runPort: new PrismaKnowledgeLlmRunAdapter(
      prisma,
      prisma,
      () => new Date(Date.now() + 120_000),
    ),
    tokenCodec: createKnowledgeLlmRunTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'run-integration-inflight-secret-0000000000001',
      },
    }),
  });
  const inFlightReconcile = await inFlightReconcileService.reconcile({
    actor,
    auditActor: {
      ...auditActor,
      requestId: 'run-integration-inflight-reconcile',
    },
    runId: aclLostDispatchedId,
  });
  assert.equal(inFlightReconcile.executionStatus, 'dispatched');
  assert.equal(inFlightReconcile.settlementStatus, 'reserved');

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
  assert.equal(
    await conversationRepository.findVisible({
      actor,
      conversationId: completed.run.conversationId,
    }),
    null,
  );
  await assert.rejects(
    disabledService.reconcile({
      actor,
      auditActor: {
        ...auditActor,
        requestId: 'run-integration-acl-lost-reconcile',
      },
      runId: aclLostDispatchedId,
    }),
    (error) => error.status === 404 && error.code === 'not_found',
  );
  const heldAfterAclLoss = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: aclLostDispatchedId },
  });
  assert.equal(heldAfterAclLoss.executionStatus, 'result_unknown');
  assert.equal(heldAfterAclLoss.settlementStatus, 'held_maximum');
  const heldAfterAclLossPrompt =
    await prisma.knowledgeLlmPromptSnapshot.findUniqueOrThrow({
      where: { runId: aclLostDispatchedId },
    });
  assert.equal(heldAfterAclLossPrompt.normalizedPrompt, null);
  assert.ok(heldAfterAclLossPrompt.finalizedAt);
  const relevantRunIds = [disabledReservedId, aclLostDispatchedId];
  const relevantReservations = await prisma.knowledgeLlmReservation.findMany({
    where: { runId: { in: relevantRunIds } },
    orderBy: { runId: 'asc' },
  });
  assert.equal(relevantReservations.length, 2);
  const heldReservation = relevantReservations.find(
    (reservation) => reservation.runId === aclLostDispatchedId,
  );
  const releasedReservation = relevantReservations.find(
    (reservation) => reservation.runId === disabledReservedId,
  );
  assert.equal(heldReservation.status, 'held_maximum');
  assert.equal(releasedReservation.status, 'released');
  const relevantPeriods = await prisma.knowledgeLlmBudgetPeriod.findMany({
    where: { reservations: { some: { runId: { in: relevantRunIds } } } },
  });
  assert.equal(relevantPeriods.length, 1);
  assert.equal(
    relevantPeriods[0].heldMaximumMicros - accountingBefore.heldMaximumMicros,
    heldReservation.maximumCostMicros,
  );
  assert.equal(
    (
      BigInt(relevantPeriods[0].releasedMicros.toString()) -
      BigInt(accountingBefore.releasedMicros.toString())
    ).toString(),
    releasedReservation.maximumCostMicros.toString(),
  );
  assert.equal(
    relevantPeriods[0].activeReservedMicros,
    accountingBefore.activeReservedMicros,
  );

  console.log('knowledge LLM run PostgreSQL integration: PASS');
} finally {
  await prisma.$disconnect();
}
