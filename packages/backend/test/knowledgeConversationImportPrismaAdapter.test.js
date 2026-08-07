import assert from 'node:assert/strict';
import test from 'node:test';

import { KnowledgeConversationImportConflictError } from '../dist/application/knowledge/knowledgeConversationImportPorts.js';
import {
  PrismaKnowledgeConversationImportRepository,
  PrismaKnowledgeConversationImportUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeConversationImportAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

function client(overrides = {}) {
  return {
    knowledgeItem: {
      findMany: async () => [],
    },
    knowledgeConversation: {
      findUnique: async () => null,
      create: async () => {
        throw new Error('unexpected create');
      },
    },
    knowledgeConversationImportRequest: {
      findUnique: async () => null,
      create: async () => {
        throw new Error('unexpected request create');
      },
    },
    $queryRaw: async () => [],
    ...overrides,
  };
}

test('preview ACL check and commit lock compare the same sorted owner-only item set', async () => {
  const calls = [];
  const repository = new PrismaKnowledgeConversationImportRepository(
    client({
      knowledgeItem: {
        async findMany(args) {
          calls.push(args);
          return [{ id: 'item-1' }, { id: 'item-2' }];
        },
      },
      async $queryRaw() {
        return [{ id: 'item-1' }, { id: 'item-2' }];
      },
    }),
  );
  assert.equal(
    await repository.checkOwnedItems({
      actor,
      itemIds: ['item-2', 'item-1'],
    }),
    true,
  );
  assert.deepEqual(calls[0].where, {
    id: { in: ['item-1', 'item-2'] },
    ownerUserId: 'owner-1',
    deletedAt: null,
  });
  assert.equal(
    await repository.lockOwnedItems({
      actor,
      itemIds: ['item-2', 'item-1'],
    }),
    true,
  );
  assert.equal(
    await repository.lockOwnedItems({
      actor,
      itemIds: ['item-1', 'item-1'],
    }),
    false,
  );
});

test('request lookup is owner-scoped and returns bounded counts without content', async () => {
  let where;
  const repository = new PrismaKnowledgeConversationImportRepository(
    client({
      knowledgeConversationImportRequest: {
        async findUnique(args) {
          where = args.where;
          return {
            id: 'ledger-1',
            ownerUserId: 'owner-1',
            requestKeyHash: 'a'.repeat(64),
            canonicalPayloadHash: 'b'.repeat(64),
            sourceType: 'json',
            conversationId: 'conversation-1',
            conversation: {
              deletedAt: null,
              sourceType: 'json',
              contentHash: 'c'.repeat(64),
              _count: { turns: 4, items: 2 },
            },
          };
        },
      },
    }),
  );
  const result = await repository.findRequest({
    actor,
    requestKeyHash: 'a'.repeat(64),
  });
  assert.deepEqual(where, {
    ownerUserId_requestKeyHash: {
      ownerUserId: 'owner-1',
      requestKeyHash: 'a'.repeat(64),
    },
  });
  assert.deepEqual(result, {
    id: 'ledger-1',
    ownerUserId: 'owner-1',
    requestKeyHash: 'a'.repeat(64),
    canonicalPayloadHash: 'b'.repeat(64),
    sourceType: 'json',
    conversationId: 'conversation-1',
    turnCount: 4,
    linkedItemCount: 2,
    conversationDeleted: false,
  });
  assert.equal(JSON.stringify(result).includes('content'), false);
});

test('import unit of work retries P2002/P2034/P2010 transaction conflicts at most three times', async () => {
  for (const error of [
    { code: 'P2002' },
    { code: 'P2034' },
    {
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '40001' } },
      },
    },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { code: '40P01' } } },
    },
  ]) {
    let attempts = 0;
    const unit = new PrismaKnowledgeConversationImportUnitOfWork({
      async $transaction(work, options) {
        attempts += 1;
        assert.equal(options.isolationLevel, 'Serializable');
        if (attempts < 3) throw error;
        return work(client({ auditLog: {} }));
      },
    });
    assert.equal(await unit.run(async () => 'ok'), 'ok');
    assert.equal(attempts, 3);
  }
});

test('import unit of work maps exhausted retry conflicts and propagates permanent failures', async () => {
  let attempts = 0;
  const unit = new PrismaKnowledgeConversationImportUnitOfWork({
    async $transaction() {
      attempts += 1;
      throw { code: 'P2034' };
    },
  });
  await assert.rejects(
    () => unit.run(async () => 'never'),
    KnowledgeConversationImportConflictError,
  );
  assert.equal(attempts, 3);

  const permanent = new Error('permanent');
  const noRetry = new PrismaKnowledgeConversationImportUnitOfWork({
    async $transaction() {
      throw permanent;
    },
  });
  await assert.rejects(() => noRetry.run(async () => 'never'), permanent);
});
