import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKnowledgeLabelManageabilityWhere,
  buildKnowledgeLabelVisibilityWhere,
  PrismaKnowledgeItemLabelRepository,
  PrismaKnowledgeLabelAuditWriter,
  PrismaKnowledgeLabelRepository,
  PrismaKnowledgeLabelUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeLabelAdapter.js';

test('mutation locks apply authorization predicates before acquiring label or item row locks', async () => {
  const rawQueries = [];
  let labelReadCount = 0;
  let itemReadCount = 0;
  const client = {
    $queryRaw: async (query) => {
      rawQueries.push(query);
      return [];
    },
    knowledgeLabel: {
      findUnique: async () => {
        labelReadCount += 1;
        return null;
      },
    },
    knowledgeItem: {
      findUnique: async () => {
        itemReadCount += 1;
        return null;
      },
    },
  };
  const actor = {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  };
  const labels = new PrismaKnowledgeLabelRepository(client);
  const itemLabels = new PrismaKnowledgeItemLabelRepository(client);

  assert.equal(await labels.findManageableById(actor, 'label-1'), null);
  assert.equal(await labels.findUsableById(actor, 'label-1'), null);
  assert.equal(
    await itemLabels.findOwnedItemForMutation({ actor, itemId: 'item-1' }),
    null,
  );
  assert.equal(labelReadCount, 0);
  assert.equal(itemReadCount, 0);
  assert.equal(rawQueries.length, 3);

  const manageableSql = rawQueries[0].text;
  assert.match(manageableSql, /label\."deletedAt" IS NULL/);
  assert.match(manageableSql, /label\."ownerUserId" = \$\d+/);
  assert.match(manageableSql, /label\."organizationId" = \$\d+/);
  assert.match(manageableSql, /label_grant\."capability" = 'manage'/);
  assert.match(manageableSql, /group_account\."active" = TRUE/);
  assert.match(manageableSql, /FOR UPDATE/);

  const usableSql = rawQueries[1].text;
  assert.match(usableSql, /label\."deletedAt" IS NULL/);
  assert.match(usableSql, /label_grant\."capability" IN \('use', 'manage'\)/);
  assert.match(usableSql, /FOR SHARE/);

  const itemSql = rawQueries[2].text;
  assert.match(itemSql, /item\."ownerUserId" = \$\d+/);
  assert.match(itemSql, /item\."deletedAt" IS NULL/);
  assert.match(itemSql, /FOR UPDATE/);
});

test('reparent locks only an entirely manageable subtree before changing closure paths', async () => {
  const rawQueries = [];
  let pathReadCount = 0;
  let labelWriteCount = 0;
  const repository = new PrismaKnowledgeLabelRepository({
    $queryRaw: async (query) => {
      rawQueries.push(query);
      return [{ id: 'label-root' }];
    },
    knowledgeLabelPath: {
      findMany: async () => {
        pathReadCount += 1;
        return [
          { descendantId: 'label-root', depth: 0 },
          { descendantId: 'label-hidden-child', depth: 1 },
        ];
      },
    },
    knowledgeLabel: {
      updateMany: async () => {
        labelWriteCount += 1;
        return { count: 1 };
      },
    },
  });

  const result = await repository.updateVersioned({
    actor: {
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: ['group-1'],
    },
    labelId: 'label-root',
    expectedVersion: 1,
    patch: { parentId: null },
  });

  assert.deepEqual(result, { ok: false, reason: 'version_conflict' });
  assert.equal(pathReadCount, 1);
  assert.equal(labelWriteCount, 0);
  assert.equal(rawQueries.length, 1);
  const lockSql = rawQueries[0].text;
  assert.match(lockSql, /FROM "KnowledgeLabel" AS label/);
  assert.match(lockSql, /label\."deletedAt" IS NULL/);
  assert.match(lockSql, /label\."ownerUserId" = \$\d+/);
  assert.match(lockSql, /label\."organizationId" = \$\d+/);
  assert.match(lockSql, /label_grant\."capability" = 'manage'/);
  assert.match(lockSql, /group_account\."active" = TRUE/);
  assert.match(lockSql, /ORDER BY label\."id"/);
  assert.match(lockSql, /FOR UPDATE/);
});

test('label visibility requires owner for personal and same-org active use/manage grant for organization', () => {
  assert.deepEqual(
    buildKnowledgeLabelVisibilityWhere({
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: ['group-1', 'group-1', ''],
    }),
    {
      deletedAt: null,
      OR: [
        { scope: 'personal', ownerUserId: 'owner-1' },
        {
          scope: 'organization',
          organizationId: 'org-1',
          groupGrants: {
            some: {
              groupAccountId: { in: ['group-1'] },
              capability: { in: ['use', 'manage'] },
              active: true,
              groupAccount: { active: true },
            },
          },
        },
      ],
    },
  );

  const missing = buildKnowledgeLabelVisibilityWhere({
    userId: ' ',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.deepEqual(missing.AND, [
    { id: '__knowledge_label_missing_principal__' },
    { NOT: { id: '__knowledge_label_missing_principal__' } },
  ]);
  assert.deepEqual(
    buildKnowledgeLabelVisibilityWhere({
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: [],
    }),
    {
      deletedAt: null,
      OR: [{ scope: 'personal', ownerUserId: 'owner-1' }],
    },
  );
});

test('label manageability keeps personal owner-only and does not let use grants imply manage', () => {
  assert.deepEqual(
    buildKnowledgeLabelManageabilityWhere({
      userId: 'owner-1',
      organizationId: 'org-1',
      groupAccountIds: ['group-1'],
    }),
    {
      deletedAt: null,
      OR: [
        { scope: 'personal', ownerUserId: 'owner-1' },
        {
          scope: 'organization',
          organizationId: 'org-1',
          OR: [
            { ownerUserId: 'owner-1' },
            {
              groupGrants: {
                some: {
                  groupAccountId: { in: ['group-1'] },
                  capability: 'manage',
                  active: true,
                  groupAccount: { active: true },
                },
              },
            },
          ],
        },
      ],
    },
  );
});

test('alias and grant reads bind authorization and payload to one label query', async () => {
  const calls = [];
  const client = {
    knowledgeLabel: {
      findFirst: async (args) => {
        calls.push(args);
        if (args.select?.aliases) return { aliases: [] };
        return { scope: 'organization', groupGrants: [] };
      },
    },
  };
  const repository = new PrismaKnowledgeLabelRepository(client);
  const actor = {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  };
  assert.deepEqual(await repository.listVisibleAliases(actor, 'label-1'), []);
  assert.deepEqual(await repository.listManageableGrants(actor, 'label-1'), []);
  assert.equal(calls.length, 2);
  assert.match(
    JSON.stringify(calls[0].where),
    /"capability":\{"in":\["use","manage"\]\}/,
  );
  assert.match(JSON.stringify(calls[1].where), /"capability":"manage"/);
  assert.ok(calls[0].select.aliases);
  assert.ok(calls[1].select.groupGrants);
});

test('canonical-name updates exclude only self canonical fields while retaining self aliases', async () => {
  let receivedWhere;
  const repository = new PrismaKnowledgeLabelRepository({
    knowledgeLabel: {
      findFirst: async (args) => {
        receivedWhere = args.where;
        return null;
      },
    },
  });
  assert.equal(
    await repository.isNameAvailable({
      actor: {
        userId: 'owner-1',
        organizationId: null,
        groupAccountIds: [],
      },
      scope: 'personal',
      organizationId: null,
      normalizedName: 'existing-alias',
      excludeLabelId: 'label-1',
    }),
    true,
  );

  const namespace = receivedWhere.AND[2].OR;
  assert.deepEqual(namespace[0].AND[0], { NOT: { id: 'label-1' } });
  assert.deepEqual(namespace[1], {
    aliases: { some: { normalizedAlias: 'existing-alias' } },
  });
});

test('label audit writer allowlists metadata and never stores a raw label identifier', async () => {
  const writes = [];
  const writer = new PrismaKnowledgeLabelAuditWriter({
    auditLog: {
      create: async (input) => {
        writes.push(input.data);
        return { id: 'audit-1' };
      },
    },
  });
  await writer.write({
    action: 'knowledge_label_updated',
    actor: {
      userId: 'owner-1',
      requestId: 'request-1',
      source: 'api',
      labelId: 'must-not-pass-through',
      alias: 'must-not-pass-through',
    },
    target: {
      kind: 'label_master',
      scope: 'personal',
      version: 2,
      labelId: 'must-not-pass-through',
      displayName: 'must-not-pass-through',
    },
  });
  assert.deepEqual(writes[0], {
    action: 'knowledge_label_updated',
    userId: 'owner-1',
    requestId: 'request-1',
    source: 'api',
    targetTable: 'knowledge_labels',
    targetId: 'label_master',
    metadata: {
      scope: 'personal',
      version: 2,
      targetKind: 'label_master',
    },
  });
  assert.equal(
    JSON.stringify(writes[0]).includes('must-not-pass-through'),
    false,
  );

  await writer.write({
    action: 'knowledge_item_label_attached',
    actor: {
      userId: 'owner-1',
      requestId: 'Bearer must-not-pass-through',
      source: 'Bearer must-not-pass-through',
    },
    target: {
      kind: 'knowledge_item',
      itemId: 'item-1',
      scope: 'organization',
      status: 'reviewing',
      version: 3,
      assignmentSource: 'manual',
      labelId: 'must-not-pass-through',
    },
  });
  assert.equal(writes[1].targetId, 'item-1');
  assert.equal(writes[1].requestId, undefined);
  assert.equal(writes[1].source, undefined);
  assert.deepEqual(writes[1].metadata, {
    scope: 'organization',
    status: 'reviewing',
    version: 3,
    relation: 'label',
    assignmentSource: 'manual',
  });
  assert.equal(
    JSON.stringify(writes[1]).includes('must-not-pass-through'),
    false,
  );
});

test('detach logically retires the active assignment and preserves its provenance row', async () => {
  const createdAt = new Date('2026-08-05T00:00:00.000Z');
  const active = {
    id: 'assignment-1',
    knowledgeItemId: 'item-1',
    labelId: 'label-1',
    assignmentSource: 'ai_suggestion',
    assignedBy: 'owner-1',
    confidenceBasisPoints: 7500,
    detachedAt: null,
    detachedBy: null,
    createdAt,
    updatedAt: createdAt,
  };
  let findArgs;
  let updateArgs;
  const repository = new PrismaKnowledgeItemLabelRepository({
    knowledgeItemLabel: {
      findFirst: async (args) => {
        findArgs = args;
        return active;
      },
      update: async (args) => {
        updateArgs = args;
        return {
          ...active,
          ...args.data,
          updatedAt: args.data.detachedAt,
        };
      },
    },
    knowledgeItem: {
      updateMany: async () => ({ count: 1 }),
    },
  });

  const result = await repository.detachVersioned({
    actor: { userId: 'owner-1', groupAccountIds: [] },
    itemId: 'item-1',
    labelId: 'label-1',
    expectedVersion: 1,
  });

  assert.deepEqual(findArgs.where, {
    knowledgeItemId: 'item-1',
    labelId: 'label-1',
    detachedAt: null,
  });
  assert.deepEqual(updateArgs.where, { id: 'assignment-1' });
  assert.equal(updateArgs.data.detachedBy, 'owner-1');
  assert.ok(updateArgs.data.detachedAt instanceof Date);
  assert.equal(result.ok, true);
  assert.equal(result.value.itemVersion, 2);
  assert.equal(result.value.assignment.assignmentSource, 'ai_suggestion');
  assert.equal(result.value.assignment.assignedBy, 'owner-1');
  assert.equal(result.value.assignment.confidenceBasisPoints, 7500);
  assert.equal(result.value.assignment.detachedAt, updateArgs.data.detachedAt);
  assert.equal(result.value.assignment.detachedBy, 'owner-1');
});

test('label unit of work binds repositories and audit to one serializable transaction', async () => {
  const transaction = {
    knowledgeLabel: {},
    knowledgeLabelAlias: {},
    knowledgeLabelPath: {},
    knowledgeItemLabel: {},
    knowledgeLabelGroupGrant: {},
    knowledgeItem: {},
    groupAccount: {},
    auditLog: {},
    $queryRaw: async () => [],
  };
  let options;
  const unitOfWork = new PrismaKnowledgeLabelUnitOfWork({
    $transaction: async (work, receivedOptions) => {
      options = receivedOptions;
      return work(transaction);
    },
  });
  await unitOfWork.run(async (bound) => {
    assert.equal(bound.labels.client, transaction);
    assert.equal(bound.itemLabels.client, transaction);
    assert.equal(bound.audit.client, transaction);
  });
  assert.deepEqual(options, { isolationLevel: 'Serializable' });
});

test('label unit of work retries bounded serializable conflicts with a fresh transaction binding', async () => {
  const clients = [
    {
      knowledgeLabel: {},
      knowledgeLabelAlias: {},
      knowledgeLabelPath: {},
      knowledgeItemLabel: {},
      knowledgeLabelGroupGrant: {},
      knowledgeItem: {},
      groupAccount: {},
      auditLog: {},
      $queryRaw: async () => [],
    },
    {
      knowledgeLabel: {},
      knowledgeLabelAlias: {},
      knowledgeLabelPath: {},
      knowledgeItemLabel: {},
      knowledgeLabelGroupGrant: {},
      knowledgeItem: {},
      groupAccount: {},
      auditLog: {},
      $queryRaw: async () => [],
    },
  ];
  let transactionCalls = 0;
  const workClients = [];
  const unitOfWork = new PrismaKnowledgeLabelUnitOfWork({
    $transaction: async (work, options) => {
      assert.deepEqual(options, { isolationLevel: 'Serializable' });
      const client = clients[transactionCalls];
      transactionCalls += 1;
      if (transactionCalls === 1) {
        await work(client);
        throw Object.assign(new Error('synthetic serialization conflict'), {
          code: 'P2034',
        });
      }
      return work(client);
    },
  });

  const result = await unitOfWork.run(async (bound) => {
    workClients.push(bound.labels.client);
    return `attempt-${workClients.length}`;
  });

  assert.equal(result, 'attempt-2');
  assert.equal(transactionCalls, 2);
  assert.deepEqual(workClients, clients);
});

test('label unit of work retries adapter-pg serialization and deadlock SQLSTATE wrappers', async () => {
  for (const sqlState of ['40001', '40P01']) {
    let transactionCalls = 0;
    const unitOfWork = new PrismaKnowledgeLabelUnitOfWork({
      $transaction: async (work) => {
        transactionCalls += 1;
        if (transactionCalls === 1) {
          throw Object.assign(new Error(`sqlstate-${sqlState}`), {
            code: 'P2010',
            meta: {
              driverAdapterError: {
                cause: { originalCode: sqlState },
              },
            },
          });
        }
        return work({});
      },
    });
    assert.equal(
      await unitOfWork.run(async () => `recovered-${sqlState}`),
      `recovered-${sqlState}`,
    );
    assert.equal(transactionCalls, 2);
  }
});

test('label unit of work bounds retryable conflicts and never retries permanent errors', async () => {
  let transactionCalls = 0;
  const serializable = new PrismaKnowledgeLabelUnitOfWork({
    $transaction: async () => {
      transactionCalls += 1;
      throw Object.assign(new Error(`serialization-${transactionCalls}`), {
        code: 'P2034',
      });
    },
  });
  await assert.rejects(
    () => serializable.run(async () => undefined),
    (error) => {
      assert.equal(error.name, 'KnowledgeLabelTransactionConflictError');
      assert.equal(error.message, 'knowledge_label_transaction_conflict');
      assert.equal(error.conflict, 'concurrent');
      assert.equal('code' in error, false);
      return true;
    },
  );
  assert.equal(transactionCalls, 3);

  transactionCalls = 0;
  const uniqueConflict = new PrismaKnowledgeLabelUnitOfWork({
    $transaction: async () => {
      transactionCalls += 1;
      throw Object.assign(new Error(`unique-${transactionCalls}`), {
        code: 'P2002',
      });
    },
  });
  await assert.rejects(
    () => uniqueConflict.run(async () => undefined),
    (error) => {
      assert.equal(error.name, 'KnowledgeLabelTransactionConflictError');
      assert.equal(error.conflict, 'duplicate');
      assert.equal('code' in error, false);
      return true;
    },
  );
  assert.equal(transactionCalls, 3);

  transactionCalls = 0;
  const permanent = new PrismaKnowledgeLabelUnitOfWork({
    $transaction: async () => {
      transactionCalls += 1;
      throw Object.assign(new Error('permanent'), { code: 'P2003' });
    },
  });
  await assert.rejects(() => permanent.run(async () => undefined), {
    message: 'permanent',
    code: 'P2003',
  });
  assert.equal(transactionCalls, 1);
});
