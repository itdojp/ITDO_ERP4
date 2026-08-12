import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const baseline = process.env.KNOWLEDGE_LLM_OLD_APP_BASE_SHA;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
const mode = process.env.KNOWLEDGE_LLM_OLD_APP_MODE;
const databaseUrl = new URL(process.env.DATABASE_URL || '');

if (
  process.env.KNOWLEDGE_LLM_OLD_APP_CONFIRM !== '1' ||
  baseline !== 'e6d49dd3d2eda7a41001835b0b776bce4350b486' ||
  !oldRoot ||
  !currentRoot ||
  !['seed', 'current-row', 'old-after'].includes(mode) ||
  databaseUrl.protocol !== 'postgresql:' ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_llm_old_app' ||
  databaseUrl.hash !== '' ||
  [...databaseUrl.searchParams.keys()].some((key) => key !== 'schema') ||
  databaseUrl.searchParams.getAll('schema').length !== 1 ||
  databaseUrl.searchParams.get('schema') !== 'public'
) {
  throw new Error('Refusing non-ephemeral Knowledge LLM old-app database');
}

const oldRequire = createRequire(
  pathToFileURL(`${oldRoot}/packages/backend/package.json`),
);
const currentRequire = createRequire(
  pathToFileURL(`${currentRoot}/packages/backend/package.json`),
);

function client(requireFromRoot) {
  const { PrismaClient } = requireFromRoot('@prisma/client');
  const { PrismaPg } = requireFromRoot('@prisma/adapter-pg');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

const itemId = 'knowledge-llm-old-app-item';
const roomId = 'knowledge-llm-old-app-room';
const messageId = 'knowledge-llm-old-app-message';

if (mode === 'seed') {
  const prisma = client(oldRequire);
  try {
    await prisma.knowledgeItem.create({
      data: {
        id: itemId,
        ownerUserId: 'old-app-user',
        scope: 'personal',
        sourceType: 'manual',
        title: 'Synthetic old application item',
        createdBy: 'old-app-user',
        updatedBy: 'old-app-user',
      },
    });
    await prisma.chatRoom.create({
      data: { id: roomId, type: 'private_group', name: 'Synthetic room' },
    });
    await prisma.chatRoomMember.create({
      data: { roomId, userId: 'old-app-user' },
    });
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        roomId,
        userId: 'old-app-user',
        body: 'Synthetic legacy message',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'current-row') {
  const prisma = client(currentRequire);
  try {
    await prisma.knowledgeLlmBudgetPolicy.create({
      data: {
        id: 'knowledge-llm-old-app-policy',
        subjectType: 'user',
        subjectId: 'old-app-user',
        currency: 'JPY',
        timezone: 'Asia/Tokyo',
        softLimitMicros: 100n,
        hardLimitMicros: 200n,
        requestsPerHour: 10,
        createdBy: 'synthetic-admin',
        updatedBy: 'synthetic-admin',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
} else {
  const prisma = client(oldRequire);
  try {
    const item = await prisma.knowledgeItem.update({
      where: { id: itemId },
      data: { shortNote: 'Old application write after expand migration' },
    });
    assert.equal(
      item.shortNote,
      'Old application write after expand migration',
    );
    assert.equal(
      (await prisma.chatMessage.findUnique({ where: { id: messageId } })).body,
      'Synthetic legacy message',
    );
    await prisma.chatMessage.create({
      data: {
        id: 'knowledge-llm-old-app-post-migration-message',
        roomId,
        userId: 'old-app-user',
        body: 'Old application still writes Chat rows',
      },
    });
    const [budgetAdapterModule, stubAdapterModule, budgetUseCaseModule] =
      await Promise.all([
        import(
          pathToFileURL(
            `${oldRoot}/packages/backend/dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js`,
          ).href
        ),
        import(
          pathToFileURL(
            `${oldRoot}/packages/backend/dist/adapters/externalLlm/stubTextAdapter.js`,
          ).href
        ),
        import(
          pathToFileURL(
            `${oldRoot}/packages/backend/dist/application/knowledge/knowledgeLlmBudgetUseCases.js`,
          ).href
        ),
      ]);
    const oldService = budgetUseCaseModule.createKnowledgeLlmBudgetUseCases(
      new budgetAdapterModule.PrismaKnowledgeLlmBudgetAdapter(prisma),
      {
        version: 1,
        models: [
          {
            provider: 'stub',
            model: 'stub-old-app-compat',
            enabled: true,
            maxInputTokens: 10_000,
            maxOutputTokens: 100,
            inputCostMicrosPerMillion: 0n,
            outputCostMicrosPerMillion: 0n,
            currency: 'JPY',
            capabilities: ['text'],
          },
        ],
      },
      new stubAdapterModule.StubExternalLlmTextAdapter(),
      () => new Date(),
    );
    const reserved = await oldService.reserve({
      runId: 'knowledge-llm-old-app-run-after-expand',
      actor: { userId: 'old-app-user', groupAccountIds: [] },
      auditActor: {
        requestId: 'knowledge-llm-old-app-run-after-expand',
        source: 'api',
      },
      scope: 'personal',
      organizationId: null,
      provider: 'stub',
      model: 'stub-old-app-compat',
      catalogVersion: 1,
      promptTemplateVersion: 1,
      requestKeyHash: 'a'.repeat(64),
      systemPrompt: '',
      userPrompt: 'Synthetic old application prompt',
      selectedContextSources: [],
      reservationInputTokenFloor: 1,
      maxOutputTokens: 1,
    });
    assert.equal(reserved.ok, true);
    assert.ok(
      await prisma.knowledgeLlmRun.findUnique({
        where: { id: 'knowledge-llm-old-app-run-after-expand' },
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
  const currentPrisma = client(currentRequire);
  try {
    const currentRun = await currentPrisma.knowledgeLlmRun.findUniqueOrThrow({
      where: { id: 'knowledge-llm-old-app-run-after-expand' },
      include: { promptSnapshot: true, reservations: true },
    });
    assert.equal(currentRun.promptSnapshot, null);
    assert.equal(currentRun.reservations.length, 1);
  } finally {
    await currentPrisma.$disconnect();
  }
}

console.log(JSON.stringify({ mode, result: 'PASS', baseline }));
