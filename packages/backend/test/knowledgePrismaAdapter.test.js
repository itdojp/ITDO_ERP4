import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKnowledgeVisibilityWhere,
  PrismaKnowledgeAuditWriter,
  PrismaKnowledgeItemRepository,
  PrismaKnowledgeUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js';

function row(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    sourceType: 'manual',
    canonicalUrl: null,
    title: null,
    sourceAuthor: null,
    publishedAt: null,
    capturedAt: new Date('2026-08-04T00:00:00.000Z'),
    saveReason: null,
    shortNote: null,
    unresolvedQuestion: null,
    status: 'inbox',
    version: 1,
    deletedAt: null,
    deletedReason: null,
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    createdBy: 'owner-1',
    updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedBy: 'owner-1',
    ...overrides,
  };
}

test('visibility predicate keeps owner access and requires org plus active canonical group grant', () => {
  assert.deepEqual(
    buildKnowledgeVisibilityWhere({
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: ['group-1', 'group-1', ''],
    }),
    {
      deletedAt: null,
      OR: [
        { ownerUserId: 'owner-1' },
        {
          scope: 'organization',
          organizationId: 'org-1',
          groupGrants: {
            some: {
              groupAccountId: { in: ['group-1'] },
              groupAccount: { active: true },
            },
          },
        },
      ],
    },
  );

  const missingPrincipal = buildKnowledgeVisibilityWhere({
    userId: ' ',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.deepEqual(missingPrincipal.AND, [
    { id: '__knowledge_missing_principal__' },
    { NOT: { id: '__knowledge_missing_principal__' } },
  ]);

  assert.deepEqual(
    buildKnowledgeVisibilityWhere({
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: [],
    }),
    { deletedAt: null, OR: [{ ownerUserId: 'owner-1' }] },
  );
});

test('list, detail, and count embed the shared authorization predicate in database queries', async () => {
  const calls = [];
  const client = {
    knowledgeItem: {
      findMany: async (args) => {
        calls.push(['list', args]);
        return [row()];
      },
      count: async (args) => {
        calls.push(['count', args]);
        return 1;
      },
      findFirst: async (args) => {
        calls.push(['detail', args]);
        return row();
      },
    },
    groupAccount: {},
    auditLog: {},
  };
  const repository = new PrismaKnowledgeItemRepository(client);
  const requestActor = {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  };
  await repository.listVisible(requestActor, { limit: 10, offset: 0 });
  await repository.countVisible(requestActor, {});
  await repository.findVisibleById(requestActor, 'item-1');

  const serialized = calls.map(([name, args]) => [
    name,
    JSON.stringify(args.where),
  ]);
  for (const [name, where] of serialized) {
    assert.match(where, /"ownerUserId":"owner-1"/, name);
    assert.match(where, /"deletedAt":null/, name);
    assert.match(where, /"organizationId":"org-1"/, name);
    assert.match(where, /"groupAccountId":\{"in":\["group-1"\]\}/, name);
    assert.match(where, /"active":true/, name);
  }
});

test('knowledge audit writer is fail-closed and writes only typed allowlisted metadata', async () => {
  let createInput;
  const writer = new PrismaKnowledgeAuditWriter({
    auditLog: {
      create: async (input) => {
        createInput = input;
        return { id: 'audit-1' };
      },
    },
  });
  await writer.write({
    action: 'knowledge_item_updated',
    actor: {
      userId: 'owner-1',
      principalUserId: 'principal-1',
      actorUserId: 'actor-1',
      authScopes: ['knowledge:write', ' knowledge:write ', 'scope-2'],
      requestId: 'request-1',
      userAgent: 'Bearer must-not-pass-through',
      source: 'api',
      secret: 'must-not-pass-through',
    },
    targetId: 'item-1',
    metadata: {
      scope: 'personal',
      status: 'reviewing',
      version: 2,
      changedFields: ['title', 'status', 'body'],
      body: 'must-not-pass-through',
    },
  });
  assert.deepEqual(createInput.data.metadata, {
    scope: 'personal',
    status: 'reviewing',
    version: 2,
    changedFields: ['title', 'status'],
    _auth: {
      principalUserId: 'principal-1',
      actorUserId: 'actor-1',
      scopes: ['knowledge:write', 'scope-2'],
    },
  });
  assert.equal(
    JSON.stringify(createInput).includes('must-not-pass-through'),
    false,
  );
  assert.equal(createInput.data.requestId, 'request-1');
  assert.equal(createInput.data.userAgent, undefined);
  assert.equal(createInput.data.targetTable, 'knowledge_items');

  await writer.write({
    action: 'knowledge_item_created',
    actor: {
      userId: 'owner-1',
      requestId: 'Bearer must-not-pass-through',
      userAgent: 'Bearer must-not-pass-through',
    },
    targetId: 'item-1',
    metadata: { scope: 'personal', status: 'inbox', version: 1 },
  });
  assert.equal(createInput.data.requestId, undefined);
  assert.equal(createInput.data.userAgent, undefined);
  assert.equal(
    JSON.stringify(createInput).includes('must-not-pass-through'),
    false,
  );

  await writer.write({
    action: 'knowledge_item_deleted',
    actor: { userId: 'owner-1' },
    targetId: 'item-1',
    reasonCode: 'owner_request',
    metadata: { scope: 'personal', status: 'inbox', version: 3 },
  });
  assert.equal(createInput.data.reasonCode, 'owner_request');

  const failingWriter = new PrismaKnowledgeAuditWriter({
    auditLog: {
      create: async () => Promise.reject(new Error('db unavailable')),
    },
  });
  await assert.rejects(
    () =>
      failingWriter.write({
        action: 'knowledge_item_created',
        actor: { userId: 'owner-1' },
        targetId: 'item-1',
        metadata: { scope: 'personal', status: 'inbox', version: 1 },
      }),
    /db unavailable/,
  );
});

test('knowledge audit writer rejects invalid or misplaced deletion reasons before persistence', async () => {
  let createCount = 0;
  const writer = new PrismaKnowledgeAuditWriter({
    auditLog: {
      create: async () => {
        createCount += 1;
        return { id: 'audit-1' };
      },
    },
  });
  const metadata = { scope: 'personal', status: 'inbox', version: 2 };
  for (const entry of [
    {
      action: 'knowledge_item_deleted',
      actor: { userId: 'owner-1' },
      targetId: 'item-1',
      reasonCode: 'free-form credential fragment',
      metadata,
    },
    {
      action: 'knowledge_item_deleted',
      actor: { userId: 'owner-1' },
      targetId: 'item-1',
      metadata,
    },
    {
      action: 'knowledge_item_updated',
      actor: { userId: 'owner-1' },
      targetId: 'item-1',
      reasonCode: 'owner_request',
      metadata,
    },
  ]) {
    await assert.rejects(
      () => writer.write(entry),
      /knowledge_audit_reason_code_invalid/,
    );
  }
  assert.equal(createCount, 0);
});

test('Prisma adapter rejects invalid persisted and mutation deletion reasons', async () => {
  let mutationCount = 0;
  const client = {
    knowledgeItem: {
      findMany: async () => [row({ deletedReason: 'free-form' })],
      updateMany: async () => {
        mutationCount += 1;
        return { count: 1 };
      },
      findUnique: async () => row(),
    },
    groupAccount: {},
    auditLog: {},
  };
  const repository = new PrismaKnowledgeItemRepository(client);
  const requestActor = { userId: 'owner-1', groupAccountIds: [] };

  await assert.rejects(
    () => repository.listVisible(requestActor, { limit: 10, offset: 0 }),
    /knowledge_deletion_reason_code_invalid/,
  );
  await assert.rejects(
    () =>
      repository.deleteOwnedVersioned({
        actor: requestActor,
        itemId: 'item-1',
        expectedVersion: 1,
        deletedAt: new Date(),
        reasonCode: 'free-form credential fragment',
      }),
    /knowledge_deletion_reason_code_invalid/,
  );
  assert.equal(mutationCount, 0);
});

test('Prisma write adapter creates explicit grants and applies owner/version predicates to every mutation', async () => {
  const calls = [];
  const client = {
    knowledgeItem: {
      create: async (args) => {
        calls.push(['create', args]);
        return row({ scope: 'organization', organizationId: 'org-1' });
      },
      findFirst: async (args) => {
        calls.push(['findOwned', args]);
        return row();
      },
      updateMany: async (args) => {
        calls.push(['updateMany', args]);
        return { count: 1 };
      },
      findUnique: async (args) => {
        calls.push(['findUnique', args]);
        return row({ version: 2 });
      },
    },
    groupAccount: {
      count: async (args) => {
        calls.push(['groupCount', args]);
        return 2;
      },
    },
    auditLog: {},
  };
  const repository = new PrismaKnowledgeItemRepository(client);
  const requestActor = {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1', 'group-2'],
  };

  assert.equal(await repository.countActiveGroups(['group-1', 'group-2']), 2);
  await repository.create({
    ownerUserId: 'owner-1',
    scope: 'organization',
    organizationId: 'org-1',
    groupAccountIds: ['group-1', 'group-2'],
    sourceType: 'manual',
    canonicalUrl: null,
    title: null,
    sourceAuthor: null,
    publishedAt: null,
    capturedAt: new Date('2026-08-04T00:00:00.000Z'),
    saveReason: null,
    shortNote: null,
    unresolvedQuestion: null,
    status: 'inbox',
    createdBy: 'owner-1',
    updatedBy: 'owner-1',
  });
  await repository.findOwnedForMutation({
    actor: requestActor,
    itemId: 'item-1',
    deleted: false,
  });
  await repository.findOwnedForMutation({
    actor: requestActor,
    itemId: 'item-1',
    deleted: true,
  });
  await repository.updateOwnedVersioned({
    actor: requestActor,
    itemId: 'item-1',
    expectedVersion: 1,
    patch: { title: 'updated' },
  });
  await repository.deleteOwnedVersioned({
    actor: requestActor,
    itemId: 'item-1',
    expectedVersion: 1,
    deletedAt: new Date('2026-08-04T00:00:00.000Z'),
    reasonCode: 'owner_request',
  });
  await repository.restoreOwnedVersioned({
    actor: requestActor,
    itemId: 'item-1',
    expectedVersion: 1,
  });

  const create = calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(create.data.groupGrants.create, [
    { groupAccountId: 'group-1', createdBy: 'owner-1' },
    { groupAccountId: 'group-2', createdBy: 'owner-1' },
  ]);
  const ownerQueries = calls
    .filter(([name]) => name === 'findOwned')
    .map(([, args]) => args.where);
  assert.deepEqual(ownerQueries[0], {
    id: 'item-1',
    ownerUserId: 'owner-1',
    deletedAt: null,
  });
  assert.deepEqual(ownerQueries[1].deletedAt, { not: null });

  const mutations = calls
    .filter(([name]) => name === 'updateMany')
    .map(([, args]) => args);
  assert.equal(mutations.length, 3);
  for (const mutation of mutations) {
    assert.equal(mutation.where.ownerUserId, 'owner-1');
    assert.equal(mutation.where.version, 1);
    assert.deepEqual(mutation.data.version, { increment: 1 });
  }
  assert.equal(mutations[0].data.title, 'updated');
  assert.equal(mutations[1].data.deletedReason, 'owner_request');
  assert.equal(mutations[2].data.deletedReason, null);
});

test('Prisma mutation adapter returns conflict signal when conditional update loses the race', async () => {
  const client = {
    knowledgeItem: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => {
        throw new Error('findUnique must not run after a lost race');
      },
    },
    groupAccount: {},
    auditLog: {},
  };
  const repository = new PrismaKnowledgeItemRepository(client);
  const requestActor = { userId: 'owner-1', groupAccountIds: [] };
  assert.equal(
    await repository.updateOwnedVersioned({
      actor: requestActor,
      itemId: 'item-1',
      expectedVersion: 1,
      patch: { title: 'stale' },
    }),
    null,
  );
  assert.equal(
    await repository.deleteOwnedVersioned({
      actor: requestActor,
      itemId: 'item-1',
      expectedVersion: 1,
      deletedAt: new Date(),
      reasonCode: 'owner_request',
    }),
    null,
  );
  assert.equal(
    await repository.restoreOwnedVersioned({
      actor: requestActor,
      itemId: 'item-1',
      expectedVersion: 1,
    }),
    null,
  );
});

test('unit of work binds repository and mandatory audit writer to the same Prisma transaction', async () => {
  const events = [];
  const transactionClient = {
    knowledgeItem: {},
    groupAccount: {
      count: async () => {
        events.push('group-count');
        return 1;
      },
    },
    auditLog: {
      create: async () => {
        events.push('audit-create');
        return { id: 'audit-1' };
      },
    },
  };
  const host = {
    $transaction: async (work) => {
      events.push('transaction-start');
      const value = await work(transactionClient);
      events.push('transaction-commit');
      return value;
    },
  };
  const unitOfWork = new PrismaKnowledgeUnitOfWork(host);
  const value = await unitOfWork.run(async ({ items, audit }) => {
    assert.equal(await items.countActiveGroups(['group-1']), 1);
    await audit.write({
      action: 'knowledge_item_created',
      actor: { userId: 'owner-1' },
      targetId: 'item-1',
      metadata: { scope: 'personal', status: 'inbox', version: 1 },
    });
    return 'done';
  });
  assert.equal(value, 'done');
  assert.deepEqual(events, [
    'transaction-start',
    'group-count',
    'audit-create',
    'transaction-commit',
  ]);
});
