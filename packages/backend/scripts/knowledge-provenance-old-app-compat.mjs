import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const baseline = process.env.KNOWLEDGE_PROVENANCE_OLD_APP_BASE_SHA;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
const mode = process.env.KNOWLEDGE_PROVENANCE_OLD_APP_MODE;
const itemIdFile = process.env.PREEXISTING_ITEM_ID_FILE;
const conversationIdFile = process.env.IMPORTED_CONVERSATION_ID_FILE;

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_PROVENANCE_OLD_APP_CONFIRM !== '1' ||
  !baseline ||
  !oldRoot ||
  !currentRoot ||
  !itemIdFile ||
  !conversationIdFile ||
  !['seed', 'import', 'verify'].includes(mode) ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_provenance_old_app_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback Knowledge provenance old-app database',
  );
}

const appRoot = mode === 'import' ? currentRoot : oldRoot;
const load = (path) => import(pathToFileURL(`${appRoot}/${path}`).href);
const actor = { userId: 'old-app-owner', groupAccountIds: [] };
const auditActor = {
  requestId: 'old-app-compat',
  source: 'api',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
  authScopes: ['knowledge:write'],
};
const legacyVocabularyConversationId = 'old-app-legacy-vocabulary-conversation';

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

if (mode === 'import') {
  const [
    { createKnowledgeConversationImportUseCases },
    { createKnowledgeConversationImportTokenCodec },
    { encodeKnowledgeConversationImportInput },
    importAdapter,
    { createKnowledgeConversationService },
    provenanceAdapter,
    responseMapper,
    { prisma },
  ] = await Promise.all([
    load(
      'packages/backend/dist/application/knowledge/knowledgeConversationImportUseCases.js',
    ),
    load(
      'packages/backend/dist/application/knowledge/knowledgeConversationImportToken.js',
    ),
    load(
      'packages/backend/dist/application/knowledge/knowledgeConversationImportParser.js',
    ),
    load(
      'packages/backend/dist/adapters/knowledge/prismaKnowledgeConversationImportAdapter.js',
    ),
    load(
      'packages/backend/dist/application/knowledge/knowledgeConversationUseCases.js',
    ),
    load(
      'packages/backend/dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js',
    ),
    load('packages/backend/dist/routes/knowledgeProvenanceSchemas.js'),
    load('packages/backend/dist/services/db.js'),
  ]);
  const conversationService = createKnowledgeConversationService({
    reader: provenanceAdapter.prismaKnowledgeConversationRepository,
    unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });
  try {
    const legacyVocabularyConversation =
      await prisma.knowledgeConversation.findUniqueOrThrow({
        where: { id: legacyVocabularyConversationId },
        include: { items: true },
      });
    const mappedLegacyVocabulary = responseMapper.conversationResponse(
      legacyVocabularyConversation,
    );
    assert.equal(mappedLegacyVocabulary.provider, null);
    assert.equal(mappedLegacyVocabulary.model, null);
    const currentAppLegacyAppend = expectOk(
      await conversationService.appendTurn({
        actor,
        auditActor,
        conversationId: legacyVocabularyConversationId,
        body: {
          expectedVersion: legacyVocabularyConversation.version,
          role: 'user',
          origin: 'user',
          content: 'Synthetic current-application legacy-row turn',
        },
      }),
      'current application legacy vocabulary turn append',
    );
    assert.equal(
      currentAppLegacyAppend.conversation.version,
      legacyVocabularyConversation.version + 1,
    );
    const currentAppLegacyRow =
      await prisma.knowledgeConversation.findUniqueOrThrow({
        where: { id: legacyVocabularyConversationId },
      });
    assert.equal(currentAppLegacyRow.provider, 'legacy-provider');
    assert.equal(currentAppLegacyRow.model, 'legacy-model');
    assert.equal(
      responseMapper.conversationResponse(currentAppLegacyAppend.conversation)
        .provider,
      null,
    );
    assert.equal(
      responseMapper.conversationResponse(currentAppLegacyAppend.conversation)
        .model,
      null,
    );

    const itemId = (await readFile(itemIdFile, 'utf8')).trim();
    assert.ok(itemId);
    const payload = {
      format: 'manual',
      inputBase64: encodeKnowledgeConversationImportInput(
        JSON.stringify({
          title: 'Imported conversation for old application compatibility',
          provider: 'openai',
          model: 'gpt',
          turns: [
            {
              role: 'user',
              origin: 'user',
              content: 'Synthetic old-application compatibility question',
            },
            {
              role: 'tool',
              origin: 'tool',
              name: 'search',
              content: 'Synthetic old-application compatibility result',
            },
          ],
        }),
      ),
      linkedItems: [{ itemId, relationType: 'primary' }],
    };
    const tokenCodec = createKnowledgeConversationImportTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'old-application-import-compatibility-secret-0001',
      },
    });
    const service = createKnowledgeConversationImportUseCases({
      unitOfWork: importAdapter.prismaKnowledgeConversationImportUnitOfWork,
      tokenCodec,
    });
    const preview = expectOk(
      await service.preview({ actor, auditActor, body: payload }),
      'preview imported row',
    );
    const committed = expectOk(
      await service.commit({
        actor,
        auditActor,
        body: {
          ...payload,
          previewToken: preview.previewToken,
          requestKey: 'old-app-compat-request-key-0001',
        },
      }),
      'commit imported row',
    );
    assert.equal(committed.created, true);
    assert.equal(committed.turnCount, 2);
    assert.equal(
      await prisma.knowledgeConversationImportRequest.count({
        where: { conversationId: committed.conversationId },
      }),
      1,
    );
    await writeFile(conversationIdFile, `${committed.conversationId}\n`, {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        result: 'IMPORTED',
        baseline,
        legacyVocabularyRowRetained: true,
        legacyVocabularyRedactedByNewApp: true,
        legacyVocabularyMutableByNewApp: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
} else {
  const [
    { createKnowledgeItemService },
    itemAdapter,
    { createKnowledgeConversationService },
    provenanceAdapter,
    responseMapper,
    { buildServer },
    { prisma },
  ] = await Promise.all([
    load(
      'packages/backend/dist/application/knowledge/knowledgeItemUseCases.js',
    ),
    load(
      'packages/backend/dist/adapters/knowledge/prismaKnowledgeItemAdapter.js',
    ),
    load(
      'packages/backend/dist/application/knowledge/knowledgeConversationUseCases.js',
    ),
    load(
      'packages/backend/dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js',
    ),
    load('packages/backend/dist/routes/knowledgeProvenanceSchemas.js'),
    load('packages/backend/dist/server.js'),
    load('packages/backend/dist/services/db.js'),
  ]);
  const itemService = createKnowledgeItemService({
    reader: itemAdapter.prismaKnowledgeItemRepository,
    unitOfWork: itemAdapter.prismaKnowledgeUnitOfWork,
    now: () => new Date('2026-08-06T00:00:00.000Z'),
  });
  const conversationService = createKnowledgeConversationService({
    reader: provenanceAdapter.prismaKnowledgeConversationRepository,
    unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });
  try {
    if (mode === 'seed') {
      await prisma.knowledgeConversation.create({
        data: {
          id: legacyVocabularyConversationId,
          ownerUserId: actor.userId,
          title: 'Old application legacy vocabulary conversation',
          sourceType: 'manual',
          provider: 'legacy-provider',
          model: 'legacy-model',
          contentHash: 'f'.repeat(64),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });
      const created = expectOk(
        await itemService.create({
          actor,
          auditActor,
          body: {
            scope: 'personal',
            sourceType: 'manual',
            title: 'Old application compatibility item',
          },
        }),
        'seed item',
      );
      await writeFile(itemIdFile, `${created.id}\n`, { mode: 0o600 });
      console.log(
        JSON.stringify({
          result: 'SEEDED',
          baseline,
          legacyVocabularyRowCreatedBeforeMigration: true,
        }),
      );
    } else {
      const itemId = (await readFile(itemIdFile, 'utf8')).trim();
      const conversationId = (
        await readFile(conversationIdFile, 'utf8')
      ).trim();
      assert.ok(itemId);
      assert.ok(conversationId);
      assert.equal((await itemService.detail({ actor, itemId })).ok, true);
      const updated = expectOk(
        await itemService.update({
          actor,
          auditActor,
          itemId,
          body: { expectedVersion: 1, title: 'Old application updated item' },
        }),
        'old application item update',
      );
      const removed = expectOk(
        await itemService.remove({
          actor,
          auditActor,
          itemId,
          expectedVersion: updated.version,
          reasonCode: 'owner_request',
        }),
        'old application item delete',
      );
      const restored = expectOk(
        await itemService.restore({
          actor,
          auditActor,
          itemId,
          expectedVersion: removed.version,
        }),
        'old application item restore',
      );

      const detail = expectOk(
        await conversationService.detail({ actor, conversationId }),
        'old application imported conversation detail',
      );
      const turns = expectOk(
        await conversationService.listTurns({
          actor,
          conversationId,
          limit: 10,
        }),
        'old application imported conversation turns',
      );
      assert.equal(turns.items.length, 2);
      const mappedConversation = responseMapper.conversationResponse(detail);
      const mappedTurns = turns.items.map(
        responseMapper.conversationTurnResponse,
      );
      assert.equal(mappedConversation.provider, null);
      assert.equal(mappedConversation.model, null);
      assert.equal(
        mappedTurns.every((turn) => turn.name === null),
        true,
      );
      const legacyVocabularyDetail = expectOk(
        await conversationService.detail({
          actor,
          conversationId: legacyVocabularyConversationId,
        }),
        'old application legacy vocabulary conversation detail',
      );
      const mappedLegacyVocabulary = responseMapper.conversationResponse(
        legacyVocabularyDetail,
      );
      assert.equal(mappedLegacyVocabulary.provider, null);
      assert.equal(mappedLegacyVocabulary.model, null);
      const oldAppLegacyAppend = expectOk(
        await conversationService.appendTurn({
          actor,
          auditActor,
          conversationId: legacyVocabularyConversationId,
          body: {
            expectedVersion: legacyVocabularyDetail.version,
            role: 'user',
            origin: 'user',
            content: 'Synthetic old-application legacy-row turn',
          },
        }),
        'old application legacy vocabulary turn append',
      );
      assert.equal(
        oldAppLegacyAppend.conversation.version,
        legacyVocabularyDetail.version + 1,
      );
      const oldAppLegacyRow =
        await prisma.knowledgeConversation.findUniqueOrThrow({
          where: { id: legacyVocabularyConversationId },
        });
      assert.equal(oldAppLegacyRow.provider, 'legacy-provider');
      assert.equal(oldAppLegacyRow.model, 'legacy-model');
      const mappedOldAppLegacyAppend = responseMapper.conversationResponse(
        oldAppLegacyAppend.conversation,
      );
      assert.equal(mappedOldAppLegacyAppend.provider, null);
      assert.equal(mappedOldAppLegacyAppend.model, null);

      const oldCreated = expectOk(
        await conversationService.create({
          actor,
          auditActor,
          body: { title: 'Old application post-migration conversation' },
        }),
        'old application conversation create after migration',
      );
      expectOk(
        await conversationService.appendTurn({
          actor,
          auditActor,
          conversationId: oldCreated.id,
          body: {
            expectedVersion: oldCreated.version,
            role: 'user',
            origin: 'user',
            content: 'Synthetic post-migration turn',
          },
        }),
        'old application turn append after migration',
      );

      const app = await buildServer({ logger: false });
      try {
        const health = await app.inject({ method: 'GET', url: '/healthz' });
        const ready = await app.inject({ method: 'GET', url: '/readyz' });
        assert.equal(health.statusCode, 200, health.body);
        assert.equal(ready.statusCode, 200, ready.body);
      } finally {
        await app.close();
      }
      console.log(
        JSON.stringify({
          result: 'PASS',
          baseline,
          existingDataRetained: true,
          importedConversationReadable: true,
          importedProviderModelRedacted: true,
          importedToolNameRedacted: true,
          legacyVocabularyRowRetained: true,
          legacyVocabularyRedacted: true,
          legacyVocabularyMutableByOldAndNewApp: true,
          oldApplicationCrudFinalVersion: restored.version,
          healthz: 200,
          readyz: 200,
        }),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
