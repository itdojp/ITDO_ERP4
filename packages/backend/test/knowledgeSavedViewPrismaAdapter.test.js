import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrismaKnowledgeSavedViewAuditWriter,
  PrismaKnowledgeSavedViewRepository,
  PrismaKnowledgeSavedViewUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeSavedViewAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-2', 'group-1', 'group-1', ''],
};

function canonicalFilter(overrides = {}) {
  return {
    labels: {
      any: [{ id: 'label-any', includeDescendants: true }],
      all: [{ id: 'label-all', includeDescendants: false }],
      not: [{ id: 'label-not', includeDescendants: true }],
    },
    sourceType: 'manual',
    status: 'inbox',
    scope: 'personal',
    publishedFrom: new Date('2026-01-01T00:00:00.000Z'),
    publishedTo: new Date('2026-12-31T23:59:59.999Z'),
    capturedFrom: new Date('2026-01-02T00:00:00.000Z'),
    capturedTo: new Date('2026-12-30T23:59:59.999Z'),
    ...overrides,
  };
}

function savedViewRow(overrides = {}) {
  return {
    id: 'view-1',
    ownerUserId: 'owner-1',
    name: 'My view',
    sourceType: 'manual',
    status: 'inbox',
    scope: 'personal',
    publishedFrom: new Date('2026-01-01T00:00:00.000Z'),
    publishedTo: new Date('2026-12-31T23:59:59.999Z'),
    capturedFrom: new Date('2026-01-02T00:00:00.000Z'),
    capturedTo: new Date('2026-12-30T23:59:59.999Z'),
    schemaVersion: 1,
    version: 1,
    deletedAt: null,
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    createdBy: 'owner-1',
    updatedAt: new Date('2026-08-05T01:00:00.000Z'),
    updatedBy: 'owner-1',
    labelFilters: [
      {
        savedViewId: 'view-1',
        labelId: 'label-any',
        operator: 'any',
        includeDescendants: true,
      },
      {
        savedViewId: 'view-1',
        labelId: 'label-all',
        operator: 'all',
        includeDescendants: false,
      },
      {
        savedViewId: 'view-1',
        labelId: 'label-not',
        operator: 'not',
        includeDescendants: true,
      },
    ],
    ...overrides,
  };
}

function assertCurrentLabelVisibility(where) {
  const serialized = JSON.stringify(where);
  assert.match(serialized, /"deletedAt":null/);
  assert.match(serialized, /"scope":"personal","ownerUserId":"owner-1"/);
  assert.match(serialized, /"scope":"organization"/);
  assert.match(serialized, /"organizationId":"org-1"/);
  const organizationVisibility = where.OR.find(
    (candidate) => candidate.scope === 'organization',
  );
  assert.deepEqual(
    [...organizationVisibility.groupGrants.some.groupAccountId.in].sort(),
    ['group-1', 'group-2'],
  );
  assert.match(serialized, /"capability":\{"in":\["use","manage"\]\}/);
  assert.match(serialized, /"active":true/);
  assert.match(serialized, /"groupAccount":\{"active":true\}/);
}

test('saved-view list and detail always bind reads to the current owner and active row', async () => {
  const calls = [];
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeSavedView: {
      findMany: async (args) => {
        calls.push(['list', args]);
        return [savedViewRow()];
      },
      findFirst: async (args) => {
        calls.push(['detail', args]);
        return savedViewRow();
      },
    },
  });

  const listed = await repository.listOwned(actor, { limit: 25, offset: 5 });
  const detailed = await repository.findOwnedById(actor, 'view-1');
  const recovery = await repository.listOwnedRecoveryMetadata(actor, {
    limit: 10,
    offset: 2,
  });

  assert.deepEqual(calls[0][1].where, {
    ownerUserId: 'owner-1',
    deletedAt: null,
  });
  assert.deepEqual(calls[0][1].orderBy, [
    { updatedAt: 'desc' },
    { id: 'desc' },
  ]);
  assert.equal(calls[0][1].take, 25);
  assert.equal(calls[0][1].skip, 5);
  assert.deepEqual(calls[1][1].where, {
    id: 'view-1',
    ownerUserId: 'owner-1',
    deletedAt: null,
  });
  assert.equal(listed[0].ownerUserId, 'owner-1');
  assert.equal(detailed.ownerUserId, 'owner-1');
  assert.deepEqual(calls[2][1], {
    where: { ownerUserId: 'owner-1', deletedAt: null },
    select: { id: true, name: true, version: true, updatedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 10,
    skip: 2,
  });
  assert.equal(recovery[0].id, 'view-1');
});

test('create checks current label visibility and persists canonical IDs in the same repository client', async () => {
  const calls = [];
  const client = {
    knowledgeLabel: {
      findMany: async (args) => {
        calls.push(['labelRoots', args]);
        return args.where.AND[0].id.in.map((id) => ({ id }));
      },
    },
    knowledgeLabelPath: {
      findMany: async (args) => {
        calls.push(['labelPaths', args]);
        return args.where.ancestorId.in.map((id) => ({
          ancestorId: id,
          descendantId: id,
          depth: 0,
        }));
      },
    },
    knowledgeSavedView: {
      create: async (args) => {
        calls.push(['create', args]);
        return savedViewRow();
      },
    },
  };
  const repository = new PrismaKnowledgeSavedViewRepository(client);

  const result = await repository.create({
    actor,
    name: 'My view',
    filter: canonicalFilter(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['labelRoots', 'labelPaths', 'create'],
  );
  const labelWhere = calls[0][1].where;
  assert.deepEqual(labelWhere.AND[0], {
    id: { in: ['label-any', 'label-all', 'label-not'] },
  });
  assertCurrentLabelVisibility(labelWhere.AND[1]);
  assert.deepEqual(calls[1][1].where.ancestorId.in, ['label-any', 'label-not']);
  const createData = calls[2][1].data;
  assert.equal(createData.ownerUserId, 'owner-1');
  assert.equal(createData.createdBy, 'owner-1');
  assert.equal(createData.updatedBy, 'owner-1');
  assert.equal(createData.schemaVersion, 1);
  assert.deepEqual(createData.labelFilters.create, [
    {
      labelId: 'label-any',
      operator: 'any',
      includeDescendants: true,
    },
    {
      labelId: 'label-all',
      operator: 'all',
      includeDescendants: false,
    },
    {
      labelId: 'label-not',
      operator: 'not',
      includeDescendants: true,
    },
  ]);
  assert.equal(
    JSON.stringify(createData).includes('label display name'),
    false,
  );
  assert.equal(JSON.stringify(createData).includes('label alias'), false);
});

test('create fails closed before persistence when any canonical label is not currently visible', async () => {
  let createCount = 0;
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeLabel: {
      findMany: async () => [{ id: 'label-any' }, { id: 'label-all' }],
    },
    knowledgeSavedView: {
      create: async () => {
        createCount += 1;
        return savedViewRow();
      },
    },
  });

  const result = await repository.create({
    actor,
    name: 'My view',
    filter: canonicalFilter(),
  });

  assert.deepEqual(result, { ok: false, reason: 'invalid_labels' });
  assert.equal(createCount, 0);
});

test('create fails closed inside the write repository when visible descendant expansion exceeds 100 IDs', async () => {
  let createCount = 0;
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeLabel: {
      findMany: async () => [{ id: 'root' }],
    },
    knowledgeLabelPath: {
      findMany: async () =>
        Array.from({ length: 101 }, (_, index) => ({
          ancestorId: 'root',
          descendantId: index === 0 ? 'root' : `child-${index}`,
          depth: index === 0 ? 0 : 1,
        })),
    },
    knowledgeSavedView: {
      create: async () => {
        createCount += 1;
        return savedViewRow();
      },
    },
  });

  const result = await repository.create({
    actor,
    name: 'Too broad',
    filter: canonicalFilter({
      labels: {
        any: [{ id: 'root', includeDescendants: true }],
        all: [],
        not: [],
      },
    }),
  });

  assert.deepEqual(result, { ok: false, reason: 'invalid_labels' });
  assert.equal(createCount, 0);
});

test('versioned update checks owner/version and current labels before fully replacing normalized filters', async () => {
  const calls = [];
  const replacementFilter = canonicalFilter({
    labels: {
      any: [{ id: 'replacement-any', includeDescendants: false }],
      all: [],
      not: [{ id: 'replacement-not', includeDescendants: true }],
    },
    status: 'reviewing',
  });
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeSavedView: {
      findFirst: async (args) => {
        calls.push(['findCurrent', args]);
        return { version: 4 };
      },
      updateMany: async (args) => {
        calls.push(['updateMany', args]);
        return { count: 1 };
      },
      findUniqueOrThrow: async (args) => {
        calls.push(['findUpdated', args]);
        return savedViewRow({
          name: 'Replacement',
          status: 'reviewing',
          version: 5,
          labelFilters: [
            {
              savedViewId: 'view-1',
              labelId: 'replacement-any',
              operator: 'any',
              includeDescendants: false,
            },
            {
              savedViewId: 'view-1',
              labelId: 'replacement-not',
              operator: 'not',
              includeDescendants: true,
            },
          ],
        });
      },
    },
    knowledgeLabel: {
      findMany: async (args) => {
        calls.push(['labelRoots', args]);
        return args.where.AND[0].id.in.map((id) => ({ id }));
      },
    },
    knowledgeLabelPath: {
      findMany: async (args) => {
        calls.push(['labelPaths', args]);
        return args.where.ancestorId.in.map((id) => ({
          ancestorId: id,
          descendantId: id,
          depth: 0,
        }));
      },
    },
    knowledgeSavedViewLabelFilter: {
      deleteMany: async (args) => {
        calls.push(['deleteOldFilters', args]);
        return { count: 3 };
      },
      createMany: async (args) => {
        calls.push(['createNewFilters', args]);
        return { count: 2 };
      },
    },
  });

  const result = await repository.updateOwnedVersioned({
    actor,
    savedViewId: 'view-1',
    expectedVersion: 4,
    name: 'Replacement',
    filter: replacementFilter,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      'findCurrent',
      'labelRoots',
      'labelPaths',
      'updateMany',
      'deleteOldFilters',
      'createNewFilters',
      'findUpdated',
    ],
  );
  assert.deepEqual(calls[0][1].where, {
    id: 'view-1',
    ownerUserId: 'owner-1',
    deletedAt: null,
  });
  assert.deepEqual(calls[1][1].where.AND[0], {
    id: { in: ['replacement-any', 'replacement-not'] },
  });
  assertCurrentLabelVisibility(calls[1][1].where.AND[1]);
  assert.deepEqual(calls[2][1].where.ancestorId.in, ['replacement-not']);
  assert.deepEqual(calls[3][1].where, {
    id: 'view-1',
    ownerUserId: 'owner-1',
    deletedAt: null,
    version: 4,
  });
  assert.deepEqual(calls[3][1].data.version, { increment: 1 });
  assert.deepEqual(calls[4][1].where, { savedViewId: 'view-1' });
  assert.deepEqual(calls[5][1].data, [
    {
      savedViewId: 'view-1',
      labelId: 'replacement-any',
      operator: 'any',
      includeDescendants: false,
    },
    {
      savedViewId: 'view-1',
      labelId: 'replacement-not',
      operator: 'not',
      includeDescendants: true,
    },
  ]);
  assert.deepEqual(result.value.filter.labels, replacementFilter.labels);
  assert.equal(result.value.version, 5);
});

test('versioned update performs no visibility or write work after an expected-version mismatch', async () => {
  let labelReadCount = 0;
  let mutationCount = 0;
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeSavedView: {
      findFirst: async () => ({ version: 5 }),
      updateMany: async () => {
        mutationCount += 1;
        return { count: 1 };
      },
    },
    knowledgeLabel: {
      findMany: async () => {
        labelReadCount += 1;
        return [{ id: 'not-reached' }];
      },
    },
    knowledgeSavedViewLabelFilter: {
      deleteMany: async () => {
        mutationCount += 1;
      },
      createMany: async () => {
        mutationCount += 1;
      },
    },
  });

  const result = await repository.updateOwnedVersioned({
    actor,
    savedViewId: 'view-1',
    expectedVersion: 4,
    name: 'Replacement',
    filter: canonicalFilter(),
  });

  assert.deepEqual(result, { ok: false, reason: 'version_conflict' });
  assert.equal(labelReadCount, 0);
  assert.equal(mutationCount, 0);
});

test('delete permits owner cleanup of a stale saved view without re-reading old label visibility', async () => {
  const calls = [];
  const deletedAt = new Date('2026-08-05T03:00:00.000Z');
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeLabel: {
      findMany: async () => {
        throw new Error('stale labels must not block delete');
      },
    },
    knowledgeSavedView: {
      findFirst: async (args) => {
        calls.push(['findCurrent', args]);
        return { version: 3 };
      },
      updateMany: async (args) => {
        calls.push(['delete', args]);
        return { count: 1 };
      },
      findUniqueOrThrow: async (args) => {
        calls.push(['findDeleted', args]);
        return savedViewRow({ version: 4, deletedAt });
      },
    },
  });

  const result = await repository.deleteOwnedVersioned({
    actor,
    savedViewId: 'view-1',
    expectedVersion: 3,
    deletedAt,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[1][1].where, {
    id: 'view-1',
    ownerUserId: 'owner-1',
    deletedAt: null,
    version: 3,
  });
  assert.deepEqual(calls[1][1].data, {
    deletedAt,
    version: { increment: 1 },
    updatedBy: 'owner-1',
  });
  assert.equal(result.value.deletedAt.getTime(), deletedAt.getTime());
});

test('delete fails closed on the optimistic-lock write result', async () => {
  let finalReadCount = 0;
  const repository = new PrismaKnowledgeSavedViewRepository({
    knowledgeSavedView: {
      findFirst: async () => ({ version: 3 }),
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => {
        finalReadCount += 1;
        return savedViewRow();
      },
    },
  });

  const result = await repository.deleteOwnedVersioned({
    actor,
    savedViewId: 'view-1',
    expectedVersion: 3,
    deletedAt: new Date('2026-08-05T03:00:00.000Z'),
  });

  assert.deepEqual(result, { ok: false, reason: 'version_conflict' });
  assert.equal(finalReadCount, 0);
});

test('audit uses a constant target and allowlisted metadata without saved-view ID, name, or filter data', async () => {
  const writes = [];
  const writer = new PrismaKnowledgeSavedViewAuditWriter({
    auditLog: {
      create: async (args) => {
        writes.push(args);
        return { id: 'audit-1' };
      },
    },
  });

  await writer.write({
    action: 'knowledge_saved_view_updated',
    actor: {
      userId: 'owner-1',
      requestId: 'request-1',
      source: 'api',
      secret: 'must-not-pass-through',
    },
    version: 4,
    schemaVersion: 1,
    savedViewId: 'private-view-id',
    name: 'private view name',
    filter: { labels: ['private-label-id'] },
  });

  const data = writes[0].data;
  assert.equal(data.targetTable, 'knowledge_saved_views');
  assert.equal(data.targetId, 'saved_view');
  assert.equal(data.userId, 'owner-1');
  assert.equal(data.actorUserId, undefined);
  assert.equal(data.requestId, 'request-1');
  assert.equal(data.source, 'api');
  assert.deepEqual(data.metadata, {
    targetKind: 'saved_view',
    schemaVersion: 1,
    version: 4,
  });
  const serialized = JSON.stringify(data);
  for (const forbidden of [
    'must-not-pass-through',
    'private-view-id',
    'private view name',
    'private-label-id',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('unit of work gives saved-view writes and audit the exact same transaction client', async () => {
  const calls = [];
  const transactionClient = {
    knowledgeLabel: {
      findMany: async (args) => {
        const ids = args.where.AND[0].id.in;
        calls.push(['transaction-label-roots', ids]);
        return ids.map((id) => ({ id }));
      },
    },
    knowledgeLabelPath: {
      findMany: async (args) => {
        const ids = args.where.ancestorId.in;
        calls.push(['transaction-label-paths', ids]);
        return ids.map((id) => ({
          ancestorId: id,
          descendantId: id,
          depth: 0,
        }));
      },
    },
    knowledgeSavedView: {
      create: async () => {
        calls.push(['transaction-view-create']);
        return savedViewRow();
      },
      findFirst: async () => {
        calls.push(['transaction-view-find-current']);
        return { version: 1 };
      },
      updateMany: async () => {
        calls.push(['transaction-view-update']);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => {
        calls.push(['transaction-view-find-updated']);
        return savedViewRow({
          version: 2,
          labelFilters: [
            {
              savedViewId: 'view-1',
              labelId: 'replacement-any',
              operator: 'any',
              includeDescendants: false,
            },
          ],
        });
      },
    },
    knowledgeSavedViewLabelFilter: {
      deleteMany: async () => {
        calls.push(['transaction-filter-delete']);
        return { count: 3 };
      },
      createMany: async () => {
        calls.push(['transaction-filter-create']);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async () => {
        calls.push(['transaction-audit-create']);
        return { id: 'audit-1' };
      },
    },
  };
  let transactionCount = 0;
  let transactionOptions;
  const unitOfWork = new PrismaKnowledgeSavedViewUnitOfWork({
    $transaction: async (work, options) => {
      transactionCount += 1;
      transactionOptions = options;
      return work(transactionClient);
    },
  });

  const result = await unitOfWork.run(async (transaction) => {
    const created = await transaction.savedViews.create({
      actor,
      name: 'Initial view',
      filter: canonicalFilter(),
    });
    assert.equal(created.ok, true);
    await transaction.audit.write({
      action: 'knowledge_saved_view_created',
      actor,
      version: created.value.version,
      schemaVersion: created.value.schemaVersion,
    });
    const updated = await transaction.savedViews.updateOwnedVersioned({
      actor,
      savedViewId: created.value.id,
      expectedVersion: created.value.version,
      name: 'Updated view',
      filter: canonicalFilter({
        labels: {
          any: [{ id: 'replacement-any', includeDescendants: false }],
          all: [],
          not: [],
        },
      }),
    });
    assert.equal(updated.ok, true);
    await transaction.audit.write({
      action: 'knowledge_saved_view_updated',
      actor,
      version: updated.value.version,
      schemaVersion: updated.value.schemaVersion,
    });
    return updated.value.id;
  });

  assert.equal(transactionCount, 1);
  assert.equal(transactionOptions.isolationLevel, 'Serializable');
  assert.equal(result, 'view-1');
  assert.deepEqual(calls, [
    ['transaction-label-roots', ['label-any', 'label-all', 'label-not']],
    ['transaction-label-paths', ['label-any', 'label-not']],
    ['transaction-view-create'],
    ['transaction-audit-create'],
    ['transaction-view-find-current'],
    ['transaction-label-roots', ['replacement-any']],
    ['transaction-view-update'],
    ['transaction-filter-delete'],
    ['transaction-filter-create'],
    ['transaction-view-find-updated'],
    ['transaction-audit-create'],
  ]);
});

test('unit of work retries serializable conflicts with the same isolation contract', async () => {
  const options = [];
  let attempts = 0;
  const unitOfWork = new PrismaKnowledgeSavedViewUnitOfWork({
    $transaction: async (work, transactionOptions) => {
      attempts += 1;
      options.push(transactionOptions);
      if (attempts < 3) throw { code: 'P2034' };
      return work({});
    },
  });

  const result = await unitOfWork.run(async () => 'committed');

  assert.equal(result, 'committed');
  assert.equal(attempts, 3);
  assert.deepEqual(
    options.map((entry) => entry.isolationLevel),
    ['Serializable', 'Serializable', 'Serializable'],
  );
});
