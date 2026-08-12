import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeLlmContextCandidateService } from '../dist/application/knowledge/knowledgeLlmContextCandidates.js';

const actor = {
  userId: 'canonical-user',
  organizationId: 'organization-safe',
  groupAccountIds: ['group-safe'],
};

test('context candidate service binds organization scope to the canonical actor', async () => {
  let calls = 0;
  const service = createKnowledgeLlmContextCandidateService({
    candidates: {
      list: async () => {
        calls += 1;
        return { items: [], nextBoundary: null };
      },
    },
  });
  const result = await service.list({
    actor,
    itemId: 'item-safe',
    scope: 'organization',
    organizationId: 'organization-other',
    sourceType: 'snapshot',
    limit: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 404);
  assert.equal(calls, 0);
});

test('context candidate service delegates a bounded canonical request', async () => {
  let delegated;
  const service = createKnowledgeLlmContextCandidateService({
    candidates: {
      list: async (input) => {
        delegated = input;
        return {
          items: [
            {
              sourceType: 'thread_promotion_message',
              sourceId: 'promotion-message-safe',
              exactSourceVersion: 1,
              byteLength: 20,
              createdAt: new Date('2026-08-13T00:00:00.000Z'),
            },
          ],
          nextBoundary: null,
        };
      },
    },
  });
  const result = await service.list({
    actor,
    itemId: 'item-safe',
    scope: 'personal',
    organizationId: null,
    sourceType: 'thread_promotion_message',
    limit: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.items.length, 1);
  assert.equal(delegated.actor.userId, actor.userId);
  assert.equal(delegated.itemId, 'item-safe');
});
