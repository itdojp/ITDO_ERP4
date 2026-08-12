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
