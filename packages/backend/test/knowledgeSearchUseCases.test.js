import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeSearchService } from '../dist/application/knowledge/knowledgeSearchUseCases.js';

const requestActor = {
  userId: 'user-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-2', 'group-1'],
};

function resolvedLabel(id, overrides = {}) {
  return {
    id,
    displayName: `Label ${id}`,
    slug: id.replaceAll(':', '-'),
    ...overrides,
  };
}

function repositoryCallCount(calls) {
  return (
    calls.resolve.length +
    calls.expand.length +
    calls.execute.length +
    calls.suggest.length
  );
}

function createHarness(overrides = {}) {
  const calls = {
    snapshot: [],
    resolve: [],
    expand: [],
    execute: [],
    suggest: [],
    decode: [],
    encode: [],
  };

  const repository = {
    async runInReadSnapshot(work) {
      calls.snapshot.push('begin');
      try {
        const result = await work(this);
        calls.snapshot.push('commit');
        return result;
      } catch (error) {
        calls.snapshot.push('rollback');
        throw error;
      }
    },
    async resolveVisibleLabelReferences(actor, references) {
      calls.resolve.push({ actor, references });
      return references.map((reference) => ({
        reference,
        candidates: [resolvedLabel(`label:${reference}`)],
      }));
    },
    async expandVisibleLabelRoots(actor, roots) {
      calls.expand.push({ actor, roots });
      return roots.map((root) => ({ ...root, labelIds: [root.id] }));
    },
    async execute(actor, query) {
      calls.execute.push({ actor, query });
      return {
        items: [],
        total: 0,
        facets: {},
        nextBoundary: null,
        visibleRootCount: Object.values(query.labels).flat().length,
      };
    },
    async suggest(input) {
      calls.suggest.push(input);
      return [
        {
          ...resolvedLabel('label:suggestion'),
          usageCount: 3,
        },
      ];
    },
    ...overrides.repository,
  };

  const cursorCodec = {
    decode(input) {
      calls.decode.push(input);
      return {
        updatedAt: new Date('2026-08-05T01:02:03.000Z'),
        id: 'item-boundary',
      };
    },
    encode(input) {
      calls.encode.push(input);
      return 'next-cursor';
    },
    ...overrides.cursorCodec,
  };

  return {
    calls,
    service: createKnowledgeSearchService({ repository, cursorCodec }),
  };
}

function labelInputs(count, options = {}) {
  return Array.from({ length: count }, (_, index) => ({
    reference: `label-${index + 1}`,
    ...options,
  }));
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.code, code);
}

test('shape limits reject before label resolution or item/count/facet execution', async () => {
  const cases = [
    {
      name: '31 label references',
      body: { labels: { any: labelInputs(31) } },
    },
    {
      name: '101 cost units',
      body: {
        labels: {
          any: [
            ...labelInputs(3, { includeDescendants: true }),
            ...Array.from({ length: 8 }, (_, index) => ({
              reference: `plain-${index + 1}`,
            })),
          ],
        },
        facets: ['sourceType', 'status', 'scope', 'label'],
        limit: 100,
      },
    },
    {
      name: 'page size 101',
      body: { limit: 101 },
    },
  ];

  for (const entry of cases) {
    const harness = createHarness();
    const result = await harness.service.search({
      actor: requestActor,
      body: entry.body,
    });

    assertFailure(result, 'query_too_complex');
    assert.equal(
      repositoryCallCount(harness.calls),
      0,
      `${entry.name} must not reach a repository`,
    );
    assert.equal(harness.calls.decode.length, 0);
    assert.equal(harness.calls.encode.length, 0);
  }
});

test('resolution, descendant expansion, and execution share one repository read snapshot', async () => {
  const harness = createHarness();
  const result = await harness.service.search({
    actor: requestActor,
    body: {
      labels: {
        any: [{ reference: 'root', includeDescendants: true }],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.snapshot, ['begin', 'commit']);
  assert.equal(harness.calls.resolve.length, 1);
  assert.equal(harness.calls.expand.length, 1);
  assert.equal(harness.calls.execute.length, 1);
});

test('label facet remains available with scalar-only filters', async () => {
  const harness = createHarness();
  const result = await harness.service.search({
    actor: requestActor,
    body: { status: 'inbox', facets: ['label'], limit: 50 },
  });

  assert.equal(result.ok, true);
  assert.equal(harness.calls.execute.length, 1);
  assert.deepEqual(harness.calls.execute[0].query.facets, ['label']);
  assert.equal(harness.calls.execute[0].query.status, 'inbox');
});

test('30 references, 100 cost units, and page size 100 are accepted at their boundaries', async () => {
  const thirty = createHarness();
  const thirtyResult = await thirty.service.search({
    actor: requestActor,
    body: { labels: { any: labelInputs(30) } },
  });
  assert.equal(thirtyResult.ok, true);
  assert.equal(thirty.calls.resolve[0].references.length, 30);
  assert.equal(thirty.calls.execute.length, 1);

  const exactCost = createHarness();
  const exactCostResult = await exactCost.service.search({
    actor: requestActor,
    body: {
      labels: {
        any: [
          ...labelInputs(3, { includeDescendants: true }),
          ...Array.from({ length: 7 }, (_, index) => ({
            reference: `plain-${index + 1}`,
          })),
        ],
      },
      facets: ['sourceType', 'status', 'scope', 'label'],
      limit: 100,
    },
  });
  assert.equal(exactCostResult.ok, true);
  assert.equal(exactCost.calls.execute.length, 1);
  assert.equal(exactCost.calls.execute[0].query.limit, 100);
});

test('canonical IDs, names, and aliases resolve to one canonical root', async () => {
  const harness = createHarness({
    repository: {
      async resolveVisibleLabelReferences(actor, references) {
        harness.calls.resolve.push({ actor, references });
        return references.map((reference) => ({
          reference,
          candidates: [
            resolvedLabel('canonical-label', {
              displayName: 'Architecture',
              slug: 'architecture',
            }),
          ],
        }));
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: {
      labels: {
        any: [
          { reference: 'canonical-label' },
          { reference: ' Architecture ' },
          { reference: 'Arch' },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.resolve[0].references, [
    'canonical-label',
    'Architecture',
    'Arch',
  ]);
  assert.deepEqual(harness.calls.execute[0].query.labels.any, [
    {
      id: 'canonical-label',
      includeDescendants: false,
      labelIds: ['canonical-label'],
    },
  ]);
});

test('ambiguous visible label resolution is rejected before expansion and execution', async () => {
  const harness = createHarness({
    repository: {
      async resolveVisibleLabelReferences(actor, references) {
        harness.calls.resolve.push({ actor, references });
        return [
          {
            reference: references[0],
            candidates: [resolvedLabel('label-1'), resolvedLabel('label-2')],
          },
        ];
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: { labels: { any: [{ reference: 'shared-name' }] } },
  });

  assertFailure(result, 'invalid_request');
  assert.equal(harness.calls.resolve.length, 1);
  assert.equal(harness.calls.expand.length, 0);
  assert.equal(harness.calls.execute.length, 0);
});

test('the same canonical ID across operators is invalid', async () => {
  const harness = createHarness({
    repository: {
      async resolveVisibleLabelReferences(actor, references) {
        harness.calls.resolve.push({ actor, references });
        return references.map((reference) => ({
          reference,
          candidates: [resolvedLabel('same-label')],
        }));
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: {
      labels: {
        any: [{ reference: 'name' }],
        not: [{ reference: 'alias' }],
      },
    },
  });

  assertFailure(result, 'invalid_request');
  assert.equal(harness.calls.expand.length, 0);
  assert.equal(harness.calls.execute.length, 0);
});

test('same-operator duplicates collapse but conflicting descendant flags fail', async () => {
  const resolvingToOne = () =>
    createHarness({
      repository: {
        async resolveVisibleLabelReferences(actor, references) {
          void actor;
          return references.map((reference) => ({
            reference,
            candidates: [resolvedLabel('same-label')],
          }));
        },
      },
    });

  const duplicate = resolvingToOne();
  const duplicateResult = await duplicate.service.search({
    actor: requestActor,
    body: {
      labels: {
        all: [
          { reference: 'canonical-id', includeDescendants: true },
          { reference: 'alias', includeDescendants: true },
        ],
      },
    },
  });
  assert.equal(duplicateResult.ok, true);
  assert.deepEqual(duplicate.calls.execute[0].query.labels.all, [
    {
      id: 'same-label',
      includeDescendants: true,
      labelIds: ['same-label'],
    },
  ]);

  const conflicting = resolvingToOne();
  const conflictingResult = await conflicting.service.search({
    actor: requestActor,
    body: {
      labels: {
        any: [
          { reference: 'canonical-id', includeDescendants: false },
          { reference: 'alias', includeDescendants: true },
        ],
      },
    },
  });
  assertFailure(conflictingResult, 'invalid_request');
  assert.equal(conflicting.calls.expand.length, 0);
  assert.equal(conflicting.calls.execute.length, 0);
});

test('ALL keeps one expanded set per canonical root', async () => {
  const harness = createHarness({
    repository: {
      async expandVisibleLabelRoots(actor, roots) {
        harness.calls.expand.push({ actor, roots });
        return roots.map((root) => ({
          ...root,
          labelIds:
            root.id === 'label:root-a'
              ? ['label:root-a', 'child-a-1', 'child-a-2']
              : ['label:root-b'],
        }));
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: {
      labels: {
        all: [
          { reference: 'root-a', includeDescendants: true },
          { reference: 'root-b' },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.execute[0].query.labels.all, [
    {
      id: 'label:root-a',
      includeDescendants: true,
      labelIds: ['child-a-1', 'child-a-2', 'label:root-a'],
    },
    {
      id: 'label:root-b',
      includeDescendants: false,
      labelIds: ['label:root-b'],
    },
  ]);
});

test('visible expansion allows 100 unique IDs and rejects 101 before item/count/facet execution', async () => {
  function expandedIds(count) {
    return [
      'label:root',
      ...Array.from({ length: count - 1 }, (_, index) => `child-${index + 1}`),
    ];
  }

  const exact = createHarness({
    repository: {
      async expandVisibleLabelRoots(actor, roots) {
        exact.calls.expand.push({ actor, roots });
        return roots.map((root) => ({ ...root, labelIds: expandedIds(100) }));
      },
    },
  });
  const exactResult = await exact.service.search({
    actor: requestActor,
    body: {
      labels: { any: [{ reference: 'root', includeDescendants: true }] },
    },
  });
  assert.equal(exactResult.ok, true);
  assert.equal(exact.calls.execute.length, 1);

  const exceeded = createHarness({
    repository: {
      async expandVisibleLabelRoots(actor, roots) {
        exceeded.calls.expand.push({ actor, roots });
        return roots.map((root) => ({ ...root, labelIds: expandedIds(101) }));
      },
    },
  });
  const exceededResult = await exceeded.service.search({
    actor: requestActor,
    body: {
      labels: { any: [{ reference: 'root', includeDescendants: true }] },
    },
  });
  assertFailure(exceededResult, 'query_too_complex');
  assert.equal(exceeded.calls.execute.length, 0);
});

test('scalar filters and date ranges are normalized for repository execution', async () => {
  const harness = createHarness();
  const result = await harness.service.search({
    actor: requestActor,
    body: {
      sourceType: 'web',
      status: 'reviewing',
      scope: 'organization',
      publishedFrom: '2026-08-01T00:00:00+09:00',
      publishedTo: '2026-08-02T00:00:00+09:00',
      capturedFrom: '2026-08-03T00:00:00.000Z',
      capturedTo: '2026-08-04T00:00:00.000Z',
    },
  });

  assert.equal(result.ok, true);
  const query = harness.calls.execute[0].query;
  assert.equal(query.sourceType, 'web');
  assert.equal(query.status, 'reviewing');
  assert.equal(query.scope, 'organization');
  assert.equal(query.publishedFrom.toISOString(), '2026-07-31T15:00:00.000Z');
  assert.equal(query.publishedTo.toISOString(), '2026-08-01T15:00:00.000Z');
  assert.equal(query.capturedFrom.toISOString(), '2026-08-03T00:00:00.000Z');
  assert.equal(query.capturedTo.toISOString(), '2026-08-04T00:00:00.000Z');

  for (const body of [
    { sourceType: 'unknown' },
    {
      publishedFrom: '2026-08-02T00:00:00.000Z',
      publishedTo: '2026-08-01T00:00:00.000Z',
    },
    { capturedFrom: 'not-a-date' },
  ]) {
    const invalid = createHarness();
    const invalidResult = await invalid.service.search({
      actor: requestActor,
      body,
    });
    assertFailure(invalidResult, 'invalid_request');
    assert.equal(repositoryCallCount(invalid.calls), 0);
  }
});

test('cursor codec receives stable canonical filter, sorted facets, page size, and actor scope', async () => {
  const nextBoundary = {
    updatedAt: new Date('2026-08-05T02:03:04.000Z'),
    id: 'item-next',
  };
  const harness = createHarness({
    repository: {
      async execute(actor, query) {
        harness.calls.execute.push({ actor, query });
        return {
          items: [],
          total: 4,
          facets: { status: [{ value: 'inbox', count: 4 }] },
          nextBoundary,
          visibleRootCount: 1,
        };
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: {
      labels: { any: [{ reference: 'root' }] },
      status: 'inbox',
      publishedFrom: '2026-08-01T00:00:00.000Z',
      facets: ['status', 'sourceType'],
      limit: 25,
      cursor: 'current-cursor',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.nextCursor, 'next-cursor');
  assert.deepEqual(harness.calls.decode, [
    {
      cursor: 'current-cursor',
      filter: {
        labels: {
          any: [{ id: 'label:root', includeDescendants: false }],
          all: [],
          not: [],
        },
        sourceType: undefined,
        status: 'inbox',
        scope: undefined,
        publishedFrom: '2026-08-01T00:00:00.000Z',
        publishedTo: undefined,
        capturedFrom: undefined,
        capturedTo: undefined,
        facets: ['sourceType', 'status'],
        limit: 25,
      },
      actor: requestActor,
    },
  ]);
  assert.deepEqual(harness.calls.execute[0].query.cursorBoundary, {
    updatedAt: new Date('2026-08-05T01:02:03.000Z'),
    id: 'item-boundary',
  });
  assert.deepEqual(harness.calls.encode, [
    {
      boundary: nextBoundary,
      filter: harness.calls.decode[0].filter,
      actor: requestActor,
    },
  ]);
});

test('cursor decode errors become invalid_cursor and never execute the search query', async () => {
  const harness = createHarness({
    cursorCodec: {
      decode() {
        throw new Error('signature mismatch with sensitive input omitted');
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: { cursor: 'malformed' },
  });

  assertFailure(result, 'invalid_cursor');
  assert.equal(harness.calls.execute.length, 0);
  assert.equal(harness.calls.encode.length, 0);
});

test('visibleRootCount mismatch fails generically after the atomic repository query', async () => {
  const harness = createHarness({
    repository: {
      async execute(actor, query) {
        harness.calls.execute.push({ actor, query });
        return {
          items: [],
          total: 0,
          facets: {},
          nextBoundary: {
            updatedAt: new Date('2026-08-05T00:00:00.000Z'),
            id: 'hidden-race',
          },
          visibleRootCount: 0,
        };
      },
    },
  });

  const result = await harness.service.search({
    actor: requestActor,
    body: { labels: { any: [{ reference: 'root' }] } },
  });

  assertFailure(result, 'invalid_request');
  assert.equal(harness.calls.execute.length, 1);
  assert.equal(harness.calls.encode.length, 0);
});

test('suggestions normalize body query and enforce the bounded limit before repository access', async () => {
  const harness = createHarness();
  const result = await harness.service.suggest({
    actor: requestActor,
    query: '  ＡＲＣＨ  ',
    limit: 20,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.suggest, [
    { actor: requestActor, query: 'arch', limit: 20 },
  ]);

  for (const input of [
    { query: 'arch', limit: 21 },
    { query: '   ', limit: 10 },
    { query: 'a', limit: 10 },
    { query: 'a'.repeat(201), limit: 10 },
  ]) {
    const invalid = createHarness();
    const invalidResult = await invalid.service.suggest({
      actor: requestActor,
      ...input,
    });
    assertFailure(invalidResult, 'invalid_request');
    assert.equal(invalid.calls.suggest.length, 0);
  }
});
