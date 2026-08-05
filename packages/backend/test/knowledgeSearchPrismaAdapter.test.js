import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeSearchRepository } from '../dist/adapters/knowledge/prismaKnowledgeSearchAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-2', 'group-1', 'group-1', ''],
};

test('search repository runs the complete read pipeline in one Repeatable Read snapshot', async () => {
  let options;
  let transactionCount = 0;
  const repository = new PrismaKnowledgeSearchRepository(
    {},
    {
      $transaction: async (work, transactionOptions) => {
        transactionCount += 1;
        options = transactionOptions;
        return work({});
      },
    },
  );

  const result = await repository.runInReadSnapshot(async (scoped) => {
    assert.notEqual(scoped, repository);
    return 'snapshot-result';
  });

  assert.equal(result, 'snapshot-result');
  assert.equal(transactionCount, 1);
  assert.equal(options.isolationLevel, 'RepeatableRead');
});

function itemRow(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    sourceType: 'manual',
    canonicalUrl: null,
    title: 'Knowledge item',
    sourceAuthor: null,
    publishedAt: null,
    capturedAt: '2026-08-05T00:00:00.000Z',
    saveReason: null,
    shortNote: null,
    unresolvedQuestion: null,
    status: 'inbox',
    version: 1,
    deletedAt: null,
    deletedReason: null,
    createdAt: '2026-08-05T00:00:00.000Z',
    createdBy: 'owner-1',
    updatedAt: '2026-08-05T01:00:00.000Z',
    updatedBy: 'owner-1',
    ...overrides,
  };
}

function valuesBoundBy(fragment, values) {
  return [...fragment.matchAll(/\$(\d+)/g)].map(
    (match) => values[Number(match[1]) - 1],
  );
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

test('label resolution applies current personal/org visibility and active use/manage group grants', async () => {
  let findManyArgs;
  const repository = new PrismaKnowledgeSearchRepository({
    knowledgeLabel: {
      findMany: async (args) => {
        findManyArgs = args;
        return [
          {
            id: 'label-1',
            displayName: 'Finance',
            slug: 'finance',
            aliases: [{ normalizedAlias: 'accounting' }],
          },
        ];
      },
    },
  });

  const result = await repository.resolveVisibleLabelReferences(actor, [
    'label-1',
    'Finance',
    'accounting',
    'missing',
  ]);

  assertCurrentLabelVisibility(findManyArgs.where.AND[0]);
  assert.deepEqual(findManyArgs.where.AND[1].OR, [
    { id: { in: ['label-1', 'Finance', 'accounting', 'missing'] } },
    { slug: { in: ['label-1', 'finance', 'accounting', 'missing'] } },
    {
      displayName: {
        in: ['label-1', 'Finance', 'accounting', 'missing'],
        mode: 'insensitive',
      },
    },
    {
      aliases: {
        some: {
          normalizedAlias: {
            in: ['label-1', 'finance', 'accounting', 'missing'],
          },
        },
      },
    },
  ]);
  assert.deepEqual(findManyArgs.select, {
    id: true,
    displayName: true,
    slug: true,
    aliases: { select: { normalizedAlias: true } },
  });
  assert.deepEqual(result, [
    {
      reference: 'label-1',
      candidates: [{ id: 'label-1', displayName: 'Finance', slug: 'finance' }],
    },
    {
      reference: 'Finance',
      candidates: [{ id: 'label-1', displayName: 'Finance', slug: 'finance' }],
    },
    {
      reference: 'accounting',
      candidates: [{ id: 'label-1', displayName: 'Finance', slug: 'finance' }],
    },
    { reference: 'missing', candidates: [] },
  ]);
});

test('descendant expansion applies current label visibility and the fixed depth-eight boundary', async () => {
  let rootReadArgs;
  let pathReadArgs;
  const repository = new PrismaKnowledgeSearchRepository({
    knowledgeLabel: {
      findMany: async (args) => {
        rootReadArgs = args;
        return [{ id: 'root-1' }, { id: 'root-2' }];
      },
    },
    knowledgeLabelPath: {
      findMany: async (args) => {
        pathReadArgs = args;
        return [
          { ancestorId: 'root-1', descendantId: 'child-2' },
          { ancestorId: 'root-1', descendantId: 'root-1' },
          { ancestorId: 'root-1', descendantId: 'child-1' },
        ];
      },
    },
  });

  const result = await repository.expandVisibleLabelRoots(actor, [
    { id: 'root-1', includeDescendants: true },
    { id: 'root-2', includeDescendants: false },
    { id: 'hidden-root', includeDescendants: true },
  ]);

  assert.deepEqual(rootReadArgs.where.AND[0], {
    id: { in: ['root-1', 'root-2', 'hidden-root'] },
  });
  assertCurrentLabelVisibility(rootReadArgs.where.AND[1]);
  assert.deepEqual(pathReadArgs.where.ancestorId, { in: ['root-1'] });
  assert.deepEqual(pathReadArgs.where.depth, { lte: 8 });
  assertCurrentLabelVisibility(pathReadArgs.where.descendant);
  assert.deepEqual(pathReadArgs.orderBy, [
    { ancestorId: 'asc' },
    { depth: 'asc' },
    { descendantId: 'asc' },
  ]);
  assert.deepEqual(result, [
    {
      id: 'root-1',
      includeDescendants: true,
      labelIds: ['child-1', 'child-2', 'root-1'],
    },
    { id: 'root-2', includeDescendants: false, labelIds: ['root-2'] },
  ]);
});

test('search execution uses one WITH statement and derives page, total, and facets from one distinct ACL-filtered match set', async () => {
  const rawQueries = [];
  const repository = new PrismaKnowledgeSearchRepository({
    $queryRaw: async (query) => {
      rawQueries.push(query);
      return [
        {
          items: [itemRow()],
          total: 12n,
          facets: {
            sourceType: [{ value: 'manual', count: 12 }],
            status: [{ value: 'inbox', count: 12 }],
            scope: [{ value: 'personal', count: 12 }],
            label: [
              {
                id: 'any-1',
                displayName: 'Any',
                slug: 'any',
                count: 3,
              },
            ],
          },
          hasMore: true,
          nextUpdatedAt: '2026-08-05T01:00:00.000Z',
          nextId: 'item-1',
          visibleRootCount: 5n,
        },
      ];
    },
  });
  const cursorUpdatedAt = new Date('2026-08-05T02:00:00.000Z');

  const result = await repository.execute(actor, {
    labels: {
      any: [
        { id: 'any-root-1', includeDescendants: true, labelIds: ['any-1'] },
        {
          id: 'any-root-2',
          includeDescendants: false,
          labelIds: ['any-2', 'any-1'],
        },
      ],
      all: [
        {
          id: 'all-root-1',
          includeDescendants: true,
          labelIds: ['all-1', 'all-child-1'],
        },
        {
          id: 'all-root-2',
          includeDescendants: false,
          labelIds: ['all-2'],
        },
      ],
      not: [
        {
          id: 'not-root',
          includeDescendants: true,
          labelIds: ['not-1', 'not-child'],
        },
      ],
    },
    sourceType: 'manual',
    status: 'inbox',
    scope: 'personal',
    publishedFrom: new Date('2026-01-01T00:00:00.000Z'),
    publishedTo: new Date('2026-12-31T23:59:59.999Z'),
    capturedFrom: new Date('2026-01-02T00:00:00.000Z'),
    capturedTo: new Date('2026-12-30T23:59:59.999Z'),
    facets: ['sourceType', 'status', 'scope', 'label'],
    limit: 7,
    cursorBoundary: { updatedAt: cursorUpdatedAt, id: 'cursor-item' },
  });

  assert.equal(rawQueries.length, 1);
  const sql = rawQueries[0];
  const text = sql.text;
  assert.match(text, /^\s*WITH visible_labels AS MATERIALIZED/);
  assert.equal((text.match(/\bWITH\b/g) ?? []).length, 1);
  assert.equal(text.includes(';'), false);

  assert.match(
    text,
    /visible_labels AS MATERIALIZED[\s\S]*label\."deletedAt" IS NULL/,
  );
  assert.match(
    text,
    /label\."scope" = 'personal'[\s\S]*label\."ownerUserId" = \$\d+/,
  );
  assert.match(text, /label\."scope" = 'organization'/);
  assert.match(text, /label_grant\."capability" IN \('use', 'manage'\)/);
  assert.match(text, /label_grant\."active" = TRUE/);
  assert.match(text, /label_group\."active" = TRUE/);
  assert.match(
    text,
    /effective_assignments AS MATERIALIZED[\s\S]*assignment\."detachedAt" IS NULL/,
  );
  assert.match(
    text,
    /effective_assignments AS MATERIALIZED[\s\S]*INNER JOIN visible_labels/,
  );

  assert.match(
    text,
    /visible_items AS MATERIALIZED[\s\S]*item\."deletedAt" IS NULL/,
  );
  assert.match(text, /item\."ownerUserId" = \$\d+/);
  assert.match(text, /item\."organizationId" = \$\d+/);
  assert.match(text, /item_grant\."groupAccountId" IN \([^)]+\)/);
  assert.match(text, /item_group\."active" = TRUE/);
  assert.match(
    text,
    /matched AS MATERIALIZED \(\s*SELECT DISTINCT item\."id"\s*FROM visible_items AS item/,
  );

  const anyClause = text.match(
    /EXISTS \(\s*SELECT 1 FROM effective_assignments AS any_assignment[\s\S]*?\n\s*\)/,
  )?.[0];
  assert.ok(anyClause);
  assert.deepEqual(valuesBoundBy(anyClause, sql.values), ['any-1', 'any-2']);

  const allClauses = [
    ...text.matchAll(
      /EXISTS \(\s*SELECT 1 FROM effective_assignments AS all_assignment[\s\S]*?\n\s*\)/g,
    ),
  ].map((match) => match[0]);
  assert.equal(allClauses.length, 2);
  assert.deepEqual(valuesBoundBy(allClauses[0], sql.values), [
    'all-1',
    'all-child-1',
  ]);
  assert.deepEqual(valuesBoundBy(allClauses[1], sql.values), ['all-2']);

  const notClause = text.match(
    /NOT EXISTS \(\s*SELECT 1 FROM effective_assignments AS not_assignment[\s\S]*?\n\s*\)/,
  )?.[0];
  assert.ok(notClause);
  assert.deepEqual(valuesBoundBy(notClause, sql.values), [
    'not-1',
    'not-child',
  ]);

  assert.match(
    text,
    /item\."updatedAt" < \$\d+[\s\S]*item\."updatedAt" = \$\d+[\s\S]*item\."id" < \$\d+/,
  );
  assert.ok(sql.values.includes(cursorUpdatedAt));
  assert.ok(sql.values.includes('cursor-item'));
  assert.match(text, /ORDER BY item\."updatedAt" DESC, item\."id" DESC/);
  assert.match(text, /FROM matched\s+INNER JOIN "KnowledgeItem" AS item/);
  assert.match(text, /\(SELECT COUNT\(\*\) FROM matched\) AS "total"/);
  assert.ok((text.match(/FROM matched/g) ?? []).length >= 5);
  assert.match(
    text,
    /FROM matched\s+INNER JOIN effective_assignments AS assignment/,
  );
  assert.match(text, /INNER JOIN visible_labels AS visible_label/);
  assert.match(text, /COUNT\(DISTINCT assignment\."knowledgeItemId"\)/);
  assert.match(text, /LIMIT 100/);

  const rootCountClause = text.match(
    /SELECT COUNT\(\*\) FROM visible_labels\s+WHERE visible_labels\."id" IN \([^)]+\)/,
  )?.[0];
  assert.ok(rootCountClause);
  assert.deepEqual(valuesBoundBy(rootCountClause, sql.values), [
    'any-root-1',
    'any-root-2',
    'all-root-1',
    'all-root-2',
    'not-root',
  ]);

  const orderedPage = text.match(
    /ordered_page AS MATERIALIZED \([\s\S]*?\n\s*\),\s*page AS MATERIALIZED/,
  )?.[0];
  assert.ok(orderedPage);
  assert.ok(valuesBoundBy(orderedPage, sql.values).includes(8));
  assert.match(text, /page AS MATERIALIZED[\s\S]*LIMIT \$\d+/);
  assert.ok(sql.values.includes(7));
  assert.match(text, /COUNT\(\*\) > \$\d+ FROM ordered_page/);
  assert.match(
    text,
    /SELECT page\."updatedAt" FROM page ORDER BY page\."updatedAt" ASC, page\."id" ASC LIMIT 1/,
  );
  assert.match(
    text,
    /SELECT page\."id" FROM page ORDER BY page\."updatedAt" ASC, page\."id" ASC LIMIT 1/,
  );

  assert.equal(result.total, 12);
  assert.equal(result.visibleRootCount, 5);
  assert.deepEqual(result.nextBoundary, {
    updatedAt: new Date('2026-08-05T01:00:00.000Z'),
    id: 'item-1',
  });
  assert.equal(result.items[0].id, 'item-1');
  assert.equal(result.facets.label[0].id, 'any-1');
});

test('suggestion parameterizes and escapes body terms while counting only current visible item usage', async () => {
  let rawQuery;
  const repository = new PrismaKnowledgeSearchRepository({
    $queryRaw: async (query) => {
      rawQuery = query;
      return [
        {
          id: 'label-1',
          displayName: 'Plan 50%',
          slug: 'plan-50',
          usageCount: 2n,
        },
      ];
    },
  });
  const term = '50%_\\plan';

  const result = await repository.suggest({ actor, query: term, limit: 20 });

  assert.equal(rawQuery.text.includes(term), false);
  assert.ok(rawQuery.values.includes('%50\\%\\_\\\\plan%'));
  assert.ok(rawQuery.values.includes(20));
  assert.match(rawQuery.text, /^\s*WITH visible_labels AS MATERIALIZED/);
  assert.match(rawQuery.text, /label\."deletedAt" IS NULL/);
  assert.match(
    rawQuery.text,
    /label_grant\."capability" IN \('use', 'manage'\)/,
  );
  assert.match(rawQuery.text, /label_grant\."active" = TRUE/);
  assert.match(rawQuery.text, /label_group\."active" = TRUE/);
  assert.match(rawQuery.text, /visible_items AS MATERIALIZED/);
  assert.match(rawQuery.text, /item\."deletedAt" IS NULL/);
  assert.match(rawQuery.text, /item_grant\."groupAccountId" IN \([^)]+\)/);
  assert.match(rawQuery.text, /item_group\."active" = TRUE/);
  assert.match(
    rawQuery.text,
    /effective_assignments AS MATERIALIZED[\s\S]*INNER JOIN visible_labels[\s\S]*INNER JOIN visible_items/,
  );
  assert.match(rawQuery.text, /assignment\."detachedAt" IS NULL/);
  assert.match(
    rawQuery.text,
    /COUNT\(DISTINCT assignment\."knowledgeItemId"\)/,
  );
  assert.equal((rawQuery.text.match(/LIKE \$\d+ ESCAPE/g) ?? []).length, 3);
  assert.equal(rawQuery.text.includes("ESCAPE '\\'"), true);
  assert.match(rawQuery.text, /LIMIT \$\d+/);
  assert.deepEqual(result, [
    {
      id: 'label-1',
      displayName: 'Plan 50%',
      slug: 'plan-50',
      usageCount: 2,
    },
  ]);
});
