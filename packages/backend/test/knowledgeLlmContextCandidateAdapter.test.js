import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeLlmContextCandidateAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmContextCandidateAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

test('context candidate listing applies item visibility before returning non-empty snapshots', async () => {
  let itemPredicate;
  let snapshotQuery;
  const createdAt = new Date('2026-08-13T00:00:00.000Z');
  const adapter = new PrismaKnowledgeLlmContextCandidateAdapter({
    knowledgeItem: {
      findFirst: async ({ where }) => {
        itemPredicate = where;
        return {
          id: 'item-1',
          ownerUserId: actor.userId,
          scope: 'personal',
          organizationId: null,
        };
      },
    },
    knowledgeSnapshot: {
      findMany: async (query) => {
        snapshotQuery = query;
        return [
          {
            id: 'snapshot-1',
            version: 3,
            extractedText: 'safe synthetic text',
            createdAt,
          },
        ];
      },
    },
  });

  const result = await adapter.list({
    actor,
    itemId: 'item-1',
    scope: 'personal',
    organizationId: null,
    sourceType: 'snapshot',
    limit: 10,
    boundary: null,
  });

  assert.equal(itemPredicate.id, 'item-1');
  assert.equal(itemPredicate.OR[0].ownerUserId, actor.userId);
  assert.deepEqual(snapshotQuery.where.extractedText, { not: '' });
  assert.equal(snapshotQuery.where.knowledgeItemId, 'item-1');
  assert.equal(snapshotQuery.take, 11);
  assert.deepEqual(result, {
    items: [
      {
        sourceType: 'snapshot',
        sourceId: 'snapshot-1',
        exactSourceVersion: 3,
        byteLength: Buffer.byteLength('safe synthetic text', 'utf8'),
        createdAt,
      },
    ],
    nextBoundary: null,
  });
});

test('thread promotion candidate listing remains bound to the selected item and visible destination synthesis', async () => {
  let promotionQuery;
  const createdAt = new Date('2026-08-13T00:00:00.000Z');
  const adapter = new PrismaKnowledgeLlmContextCandidateAdapter({
    knowledgeItem: {
      findFirst: async () => ({
        id: 'item-1',
        ownerUserId: actor.userId,
        scope: 'organization',
        organizationId: actor.organizationId,
      }),
    },
    knowledgeThreadPromotionMessage: {
      findMany: async (query) => {
        promotionQuery = query;
        return [
          {
            id: 'promotion-message-1',
            ordinal: 4,
            content: 'selected synthetic reply',
            createdAt,
          },
        ];
      },
    },
  });

  const result = await adapter.list({
    actor,
    itemId: 'item-1',
    scope: 'organization',
    organizationId: actor.organizationId,
    sourceType: 'thread_promotion_message',
    limit: 10,
    boundary: null,
  });

  const serialized = JSON.stringify(promotionQuery.where);
  assert.match(serialized, /"sourceKnowledgeItemId":"item-1"/);
  assert.match(serialized, /"destinationSynthesis":\{"is":/);
  assert.match(serialized, /"organizationId":"org-1"/);
  assert.match(serialized, /"groupAccountId":\{"in":\["group-1"\]\}/);
  assert.deepEqual(result, {
    items: [
      {
        sourceType: 'thread_promotion_message',
        sourceId: 'promotion-message-1',
        exactSourceVersion: 5,
        byteLength: Buffer.byteLength('selected synthetic reply', 'utf8'),
        createdAt,
      },
    ],
    nextBoundary: null,
  });
});
