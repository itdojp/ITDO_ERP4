import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeLlmRunAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmRunAdapter.js';
import { buildKnowledgeConversationVisibilityWhere } from '../dist/adapters/knowledge/prismaKnowledgeConversationVisibility.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

test('LLM result conversation visibility rechecks every direct synthesis source', () => {
  const predicate = buildKnowledgeConversationVisibilityWhere(actor);
  const serialized = JSON.stringify(predicate);
  assert.match(serialized, /"sourceSynthesisVersion":\{"is":/);
  assert.match(serialized, /"sources":\{"some":\{\},"every":/);
  assert.match(serialized, /"sourceKnowledgeItem":\{"is":/);
  assert.match(serialized, /"sourceAnnotationRevision":\{"is":/);
  assert.match(serialized, /"sourceConversationTurn":\{"is":/);
});

test('context resolution, request replay, and run detail use one repeatable-read snapshot', async () => {
  const isolationLevels = [];
  const transaction = {
    knowledgeSnapshot: {
      findFirst: async () => ({
        id: 'snapshot-1',
        version: 1,
        sha256: 'a'.repeat(64),
        extractedText: 'bounded source',
        knowledgeItem: {
          id: 'item-1',
          ownerUserId: actor.userId,
          scope: 'personal',
          organizationId: null,
        },
      }),
    },
    knowledgeLlmRequest: { findFirst: async () => null },
    knowledgeLlmRun: { findFirst: async () => null },
  };
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {
      $transaction: async (work, options) => {
        isolationLevels.push(options?.isolationLevel);
        return work(transaction);
      },
    },
    transaction,
  );

  await adapter.resolveContext({
    actor,
    scope: 'personal',
    organizationId: null,
    selectors: [{ sourceType: 'snapshot', sourceId: 'snapshot-1' }],
  });
  assert.equal(
    await adapter.findByRequestKey({
      actor,
      requestKeyHash: 'b'.repeat(64),
    }),
    null,
  );
  assert.equal(await adapter.findOwned({ actor, runId: 'run-1' }), null);
  assert.deepEqual(isolationLevels, [
    'RepeatableRead',
    'RepeatableRead',
    'RepeatableRead',
  ]);
});

test('conversation turn source resolution excludes LLM result conversations from item-based visibility', async () => {
  let turnPredicate;
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {},
    {
      knowledgeConversationTurn: {
        findFirst: async ({ where }) => {
          turnPredicate = where;
          return null;
        },
      },
    },
  );

  await assert.rejects(
    () =>
      adapter.resolveContext({
        actor,
        scope: 'organization',
        organizationId: 'org-1',
        selectors: [{ sourceType: 'conversation_turn', sourceId: 'turn-1' }],
      }),
    /not_found/,
  );

  const serialized = JSON.stringify(turnPredicate);
  assert.match(serialized, /"conversation":\{"is":/);
  assert.match(
    serialized,
    /"items":\{"some":\{\}\},"llmRuns":\{"none":\{\}\},"AND":\{"items":\{"every":/,
  );
  assert.match(serialized, /"ownerUserId":"owner-1"/);
  assert.match(serialized, /"organizationId":"org-1"/);
  assert.match(serialized, /"groupAccountId":\{"in":\["group-1"\]\}/);
  assert.match(serialized, /"active":true/);
});

function synthesisSource(overrides = {}) {
  return {
    sourceKnowledgeItemId: null,
    sourceSnapshot: null,
    sourceAnnotation: null,
    sourceAnnotationRevision: null,
    sourceConversation: null,
    sourceConversationTurn: null,
    sourceSynthesisVersionId: null,
    sourceThreadPromotionId: null,
    ...overrides,
  };
}

test('synthesis and thread-promotion context count their directly bound Knowledge items', async () => {
  let synthesisPredicate;
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {},
    {
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => {
          synthesisPredicate = where;
          return {
            id: 'synthesis-version-1',
            version: 2,
            content: 'bounded synthesis',
            synthesis: {
              ownerUserId: actor.userId,
              scope: 'personal',
              organizationId: null,
            },
            sources: [
              synthesisSource({ sourceKnowledgeItemId: 'item-1' }),
              synthesisSource({
                sourceSnapshot: { knowledgeItemId: 'item-1' },
              }),
              synthesisSource({
                sourceConversation: {
                  llmRuns: [],
                  turns: [],
                  items: [{ knowledgeItemId: 'item-2' }],
                },
              }),
            ],
          };
        },
      },
      knowledgeThreadPromotionMessage: {
        findFirst: async () => ({
          id: 'promotion-message-1',
          ordinal: 0,
          content: 'bounded promoted reply',
          contentHash: 'a'.repeat(64),
          promotion: {
            ownerUserId: actor.userId,
            scope: 'personal',
            organizationId: null,
            sourceShare: { sourceKnowledgeItemId: 'item-3' },
          },
        }),
      },
    },
  );

  const resolved = await adapter.resolveContext({
    actor,
    scope: 'personal',
    organizationId: null,
    selectors: [
      { sourceType: 'synthesis_version', sourceId: 'synthesis-version-1' },
      {
        sourceType: 'thread_promotion_message',
        sourceId: 'promotion-message-1',
      },
    ],
  });

  assert.equal(resolved.selectedItemCount, 3);
  const serialized = JSON.stringify(synthesisPredicate);
  assert.match(serialized, /"sources":\{"some":\{\},"every":/);
  assert.match(serialized, /"sourceKnowledgeItem":\{"is":/);
  assert.match(serialized, /"sourceConversation":\{"is":/);
});

test('synthesis context rejects more than ten directly bound Knowledge items', async () => {
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {},
    {
      knowledgeSynthesisVersion: {
        findFirst: async () => ({
          id: 'synthesis-version-many-items',
          version: 1,
          content: 'bounded synthesis',
          synthesis: {
            ownerUserId: actor.userId,
            scope: 'personal',
            organizationId: null,
          },
          sources: Array.from({ length: 11 }, (_, index) =>
            synthesisSource({ sourceKnowledgeItemId: `item-${index + 1}` }),
          ),
        }),
      },
    },
  );

  await assert.rejects(
    () =>
      adapter.resolveContext({
        actor,
        scope: 'personal',
        organizationId: null,
        selectors: [
          {
            sourceType: 'synthesis_version',
            sourceId: 'synthesis-version-many-items',
          },
        ],
      }),
    /not_found/,
  );
});

test('provider outcome capture rejects invalid runtime failure codes before persistence', async () => {
  let transactionStarted = false;
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {
      $transaction: async () => {
        transactionStarted = true;
      },
    },
    {},
  );
  const base = {
    runId: 'run-1',
    actor,
  };

  for (const outcome of [
    null,
    42,
    [],
    { status: 'invalid' },
    { status: 'invalid', failureCode: 'usage_missing' },
    {
      status: 'usage_unknown',
      normalizedContent: 'bounded result',
      failureCode: 'provider_5xx',
    },
    {
      status: 'usage_unknown',
      normalizedContent: 'bounded result',
    },
    {
      status: 'valid',
      normalizedContent: 'bounded result',
      inputTokens: 1,
      outputTokens: 1,
      failureCode: 'usage_missing',
    },
    {
      status: 'unexpected',
      normalizedContent: 'bounded result',
      failureCode: 'provider_5xx',
    },
  ]) {
    await assert.rejects(
      () => adapter.captureProviderOutcome({ ...base, outcome }),
      /knowledge_llm_outcome_invalid/,
    );
  }

  assert.equal(transactionStarted, false);
});

test('reconcile does not classify an arbitrary error by its message', async () => {
  let transactionStarted = false;
  const adapter = new PrismaKnowledgeLlmRunAdapter(
    {
      $transaction: async () => {
        transactionStarted = true;
      },
    },
    {},
  );
  adapter.finalizeCapturedOutcome = async () => {
    throw new Error('knowledge_llm_outcome_missing');
  };

  await assert.rejects(
    () =>
      adapter.reconcile({
        runId: 'run-1',
        actor,
        auditActor: {
          requestId: 'request-1',
          source: 'api',
          principalUserId: actor.userId,
          actorUserId: actor.userId,
        },
      }),
    /knowledge_llm_outcome_missing/,
  );
  assert.equal(transactionStarted, false);
});
