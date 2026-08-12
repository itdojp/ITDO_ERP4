import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeLlmRunAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmRunAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

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
