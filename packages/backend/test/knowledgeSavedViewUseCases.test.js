import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeSavedViewService } from '../dist/application/knowledge/knowledgeSavedViewUseCases.js';
import { KnowledgeSavedViewTransactionConflictError } from '../dist/application/knowledge/knowledgeSavedViewPorts.js';

const fixedNow = new Date('2026-08-05T03:00:00.000Z');

function actor(overrides = {}) {
  return {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
    ...overrides,
  };
}

function canonicalFilter(overrides = {}) {
  return {
    labels: {
      any: [{ id: 'label-1', includeDescendants: false }],
      all: [],
      not: [],
    },
    status: 'inbox',
    ...overrides,
  };
}

function savedView(overrides = {}) {
  return {
    id: 'view-1',
    ownerUserId: 'owner-1',
    name: 'Daily review',
    filter: canonicalFilter(),
    schemaVersion: 1,
    version: 1,
    deletedAt: null,
    createdAt: fixedNow,
    createdBy: 'owner-1',
    updatedAt: fixedNow,
    updatedBy: 'owner-1',
    ...overrides,
  };
}

function searchFailure(code) {
  const messages = {
    invalid_request: 'Invalid knowledge search request',
    invalid_cursor: 'Invalid cursor',
    invalid_saved_view: 'Invalid saved view',
    query_too_complex: 'Knowledge search query is too complex',
  };
  return {
    ok: false,
    statusCode: 400,
    code,
    message: messages[code],
  };
}

function createHarness(overrides = {}) {
  const calls = {
    list: [],
    recovery: [],
    find: [],
    resolve: [],
    validate: [],
    execute: [],
    uow: [],
    create: [],
    update: [],
    remove: [],
    audit: [],
  };

  const defaultView = overrides.view ?? savedView();
  const repository = {
    async listOwned(requestActor, query) {
      calls.list.push({ actor: requestActor, query });
      return requestActor.userId === defaultView.ownerUserId
        ? [defaultView]
        : [];
    },
    async findOwnedById(requestActor, savedViewId) {
      calls.find.push({ actor: requestActor, savedViewId });
      return requestActor.userId === defaultView.ownerUserId &&
        savedViewId === defaultView.id
        ? defaultView
        : null;
    },
    async listOwnedRecoveryMetadata(requestActor, query) {
      calls.recovery.push({ actor: requestActor, query });
      return requestActor.userId === defaultView.ownerUserId
        ? [
            {
              id: defaultView.id,
              name: defaultView.name,
              version: defaultView.version,
              updatedAt: defaultView.updatedAt,
            },
          ]
        : [];
    },
    ...overrides.repository,
  };

  const search = {
    async resolveFilter(input) {
      calls.resolve.push(input);
      return { ok: true, value: canonicalFilter() };
    },
    async validateCanonicalFilter(input) {
      calls.validate.push(input);
      return {
        ok: true,
        value: {
          any: [
            {
              id: 'label-1',
              includeDescendants: false,
              labelIds: ['label-1'],
            },
          ],
          all: [],
          not: [],
        },
      };
    },
    async executeCanonical(input) {
      calls.execute.push(input);
      return {
        ok: true,
        value: { items: [], total: 0, facets: {}, nextCursor: null },
      };
    },
    async search() {
      throw new Error('saved views must use canonical execution');
    },
    async suggest() {
      throw new Error('saved views must not call suggestions');
    },
    ...overrides.search,
  };

  const transaction = {
    savedViews: {
      async create(input) {
        calls.create.push(input);
        return {
          ok: true,
          value: savedView({ name: input.name, filter: input.filter }),
        };
      },
      async updateOwnedVersioned(input) {
        calls.update.push(input);
        return {
          ok: true,
          value: savedView({
            id: input.savedViewId,
            name: input.name,
            filter: input.filter,
            version: input.expectedVersion + 1,
          }),
        };
      },
      async deleteOwnedVersioned(input) {
        calls.remove.push(input);
        return {
          ok: true,
          value: savedView({
            id: input.savedViewId,
            version: input.expectedVersion + 1,
            deletedAt: input.deletedAt,
          }),
        };
      },
      ...overrides.savedViews,
    },
    audit: {
      async write(entry) {
        calls.audit.push(entry);
      },
      ...overrides.audit,
    },
  };

  const unitOfWork = {
    async run(work) {
      calls.uow.push('begin');
      try {
        const result = await work(transaction);
        calls.uow.push('commit');
        return result;
      } catch (error) {
        calls.uow.push('rollback');
        throw error;
      }
    },
    ...overrides.unitOfWork,
  };

  return {
    calls,
    service: createKnowledgeSavedViewService({
      repository,
      unitOfWork,
      search,
    }),
  };
}

function assertFailure(result, code, statusCode) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(result.statusCode, statusCode);
}

test('owner reads map hidden, deleted, and revoked current label references to generic invalid_saved_view', async () => {
  for (const staleReason of ['hidden', 'deleted', 'revoked']) {
    const harness = createHarness({
      search: {
        async validateCanonicalFilter(input) {
          harness.calls.validate.push({ ...input, staleReason });
          return searchFailure('invalid_saved_view');
        },
      },
    });

    const detailResult = await harness.service.detail({
      actor: actor(),
      savedViewId: 'view-1',
    });
    assertFailure(detailResult, 'invalid_saved_view', 400);
    assert.equal(detailResult.message, 'Invalid saved view');
    assert.equal(
      harness.calls.validate[0].staleReferenceCode,
      'invalid_saved_view',
    );

    const listResult = await harness.service.list({
      actor: actor(),
      query: { limit: 20, offset: 0 },
    });
    assertFailure(listResult, 'invalid_saved_view', 400);
    assert.equal(listResult.message, 'Invalid saved view');
  }
});

test('owner recovery metadata remains available without exposing stale filter contents', async () => {
  const harness = createHarness({
    search: {
      async validateCanonicalFilter() {
        throw new Error('recovery metadata must not resolve stale labels');
      },
    },
  });

  const result = await harness.service.listRecoveryMetadata({
    actor: actor(),
    query: { limit: 20, offset: 0 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [
    {
      id: 'view-1',
      name: 'Daily review',
      version: 1,
      updatedAt: fixedNow,
    },
  ]);
  assert.equal('filter' in result.value[0], false);
  assert.equal(harness.calls.validate.length, 0);
});

test('actors outside the owner boundary receive not_found without current-filter validation', async () => {
  const harness = createHarness();
  const outsider = actor({ userId: 'other-user' });

  const detailResult = await harness.service.detail({
    actor: outsider,
    savedViewId: 'view-1',
  });
  assertFailure(detailResult, 'not_found', 404);

  const executeResult = await harness.service.execute({
    actor: outsider,
    savedViewId: 'view-1',
  });
  assertFailure(executeResult, 'not_found', 404);
  assert.equal(harness.calls.validate.length, 0);
  assert.equal(harness.calls.execute.length, 0);
});

test('create resolves and validates the current filter before mutation and audits in one UoW', async () => {
  const inputFilter = {
    labels: { any: [{ reference: 'Architecture' }] },
    status: 'inbox',
  };
  const harness = createHarness();
  const result = await harness.service.create({
    actor: actor(),
    auditActor: { requestId: 'request-1', source: 'api' },
    name: '  Ｄａｉｌｙ review  ',
    filter: inputFilter,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.resolve, [
    { actor: actor(), filter: inputFilter },
  ]);
  assert.deepEqual(harness.calls.validate, [
    { actor: actor(), filter: canonicalFilter() },
  ]);
  assert.deepEqual(harness.calls.uow, ['begin', 'commit']);
  assert.equal(harness.calls.create.length, 1);
  assert.equal(harness.calls.create[0].name, 'Daily review');
  assert.deepEqual(harness.calls.create[0].filter, canonicalFilter());
  assert.deepEqual(harness.calls.audit, [
    {
      action: 'knowledge_saved_view_created',
      actor: {
        userId: 'owner-1',
        requestId: 'request-1',
        source: 'api',
      },
      version: 1,
      schemaVersion: 1,
    },
  ]);
});

test('create and update reject a newly supplied filter that is not currently valid before UoW', async () => {
  for (const operation of ['create', 'update']) {
    const harness = createHarness({
      search: {
        async validateCanonicalFilter(input) {
          harness.calls.validate.push(input);
          return searchFailure('invalid_request');
        },
      },
    });
    const common = {
      actor: actor(),
      auditActor: {},
      name: 'Replacement',
      filter: { labels: { any: [{ reference: 'hidden-label' }] } },
    };
    const result =
      operation === 'create'
        ? await harness.service.create(common)
        : await harness.service.update({
            ...common,
            savedViewId: 'view-1',
            expectedVersion: 1,
          });

    assertFailure(result, 'invalid_request', 400);
    assert.equal(harness.calls.uow.length, 0);
    assert.equal(harness.calls.create.length, 0);
    assert.equal(harness.calls.update.length, 0);
    assert.equal(harness.calls.audit.length, 0);
  }
});

test('update validates only the replacement filter and can recover from stale old references', async () => {
  const replacement = canonicalFilter({
    labels: {
      any: [],
      all: [{ id: 'current-label', includeDescendants: true }],
      not: [],
    },
    status: 'processed',
  });
  const harness = createHarness({
    repository: {
      async findOwnedById() {
        throw new Error('update must not read or validate the stale old view');
      },
    },
    search: {
      async resolveFilter(input) {
        harness.calls.resolve.push(input);
        return { ok: true, value: replacement };
      },
      async validateCanonicalFilter(input) {
        harness.calls.validate.push(input);
        return { ok: true, value: { any: [], all: [], not: [] } };
      },
    },
  });

  const result = await harness.service.update({
    actor: actor(),
    auditActor: { requestId: 'request-2' },
    savedViewId: ' view-1 ',
    expectedVersion: 4,
    name: 'Replacement',
    filter: { status: 'processed' },
  });

  assert.equal(result.ok, true);
  assert.equal(harness.calls.find.length, 0);
  assert.deepEqual(harness.calls.validate, [
    { actor: actor(), filter: replacement },
  ]);
  assert.equal(harness.calls.update.length, 1);
  assert.equal(harness.calls.update[0].savedViewId, 'view-1');
  assert.deepEqual(harness.calls.update[0].filter, replacement);
  assert.deepEqual(harness.calls.uow, ['begin', 'commit']);
  assert.deepEqual(harness.calls.audit, [
    {
      action: 'knowledge_saved_view_updated',
      actor: { userId: 'owner-1', requestId: 'request-2', source: undefined },
      version: 5,
      schemaVersion: 1,
    },
  ]);
});

test('delete is versioned and can remove a stale view without resolving old label references', async () => {
  const harness = createHarness({
    repository: {
      async findOwnedById() {
        throw new Error('delete must not read or validate stale labels');
      },
    },
    search: {
      async resolveFilter() {
        throw new Error('delete must not resolve labels');
      },
      async validateCanonicalFilter() {
        throw new Error('delete must not validate labels');
      },
    },
  });

  const result = await harness.service.remove({
    actor: actor(),
    auditActor: { source: 'api' },
    savedViewId: ' view-1 ',
    expectedVersion: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(harness.calls.find.length, 0);
  assert.equal(harness.calls.remove.length, 1);
  assert.equal(harness.calls.remove[0].savedViewId, 'view-1');
  assert.equal(harness.calls.remove[0].expectedVersion, 2);
  assert.ok(harness.calls.remove[0].deletedAt instanceof Date);
  assert.deepEqual(harness.calls.uow, ['begin', 'commit']);
  assert.deepEqual(harness.calls.audit, [
    {
      action: 'knowledge_saved_view_deleted',
      actor: { userId: 'owner-1', requestId: undefined, source: 'api' },
      version: 3,
      schemaVersion: 1,
    },
  ]);
});

test('audit failure rejects the mutation UoW and the mock transaction rolls back', async () => {
  const state = [];
  const audits = [];
  const harness = createHarness({
    unitOfWork: {
      async run(work) {
        harness.calls.uow.push('begin');
        const snapshot = structuredClone(state);
        try {
          const result = await work({
            savedViews: {
              async create(input) {
                harness.calls.create.push(input);
                const created = savedView({
                  name: input.name,
                  filter: input.filter,
                });
                state.push(created);
                return { ok: true, value: created };
              },
              async updateOwnedVersioned() {
                throw new Error('not used');
              },
              async deleteOwnedVersioned() {
                throw new Error('not used');
              },
            },
            audit: {
              async write(entry) {
                audits.push(entry);
                throw new Error('audit unavailable');
              },
            },
          });
          harness.calls.uow.push('commit');
          return result;
        } catch (error) {
          state.splice(0, state.length, ...snapshot);
          audits.length = 0;
          harness.calls.uow.push('rollback');
          throw error;
        }
      },
    },
  });

  await assert.rejects(
    harness.service.create({
      actor: actor(),
      auditActor: {},
      name: 'Will roll back',
      filter: {},
    }),
    /audit unavailable/,
  );
  assert.deepEqual(harness.calls.uow, ['begin', 'rollback']);
  assert.deepEqual(state, []);
  assert.deepEqual(audits, []);
});

test('exhausted serializable mutation conflicts map to version_conflict', async () => {
  const harness = createHarness({
    unitOfWork: {
      async run() {
        throw new KnowledgeSavedViewTransactionConflictError();
      },
    },
  });

  const result = await harness.service.remove({
    actor: actor(),
    auditActor: {},
    savedViewId: 'view-1',
    expectedVersion: 1,
  });

  assertFailure(result, 'version_conflict', 409);
});

test('execute maps stale current ACL references to invalid_saved_view', async () => {
  const harness = createHarness({
    search: {
      async executeCanonical(input) {
        harness.calls.execute.push(input);
        return searchFailure('invalid_saved_view');
      },
    },
  });

  const result = await harness.service.execute({
    actor: actor(),
    savedViewId: 'view-1',
    facets: ['status'],
    limit: 25,
  });

  assertFailure(result, 'invalid_saved_view', 400);
  assert.equal(harness.calls.execute.length, 1);
  assert.equal(
    harness.calls.execute[0].staleReferenceCode,
    'invalid_saved_view',
  );
  assert.deepEqual(harness.calls.execute[0].filter, canonicalFilter());
});

test('execute preserves invalid_cursor without exposing saved-view contents', async () => {
  const harness = createHarness({
    search: {
      async executeCanonical(input) {
        harness.calls.execute.push(input);
        return searchFailure('invalid_cursor');
      },
    },
  });

  const result = await harness.service.execute({
    actor: actor(),
    savedViewId: 'view-1',
    cursor: 'invalid-signed-cursor',
  });

  assertFailure(result, 'invalid_cursor', 400);
  assert.equal(result.message, 'Invalid cursor');
});

test('unsupported schemaVersion is generic invalid_saved_view for read and execute', async () => {
  const harness = createHarness({ view: savedView({ schemaVersion: 2 }) });

  const listResult = await harness.service.list({
    actor: actor(),
    query: { limit: 10, offset: 0 },
  });
  assertFailure(listResult, 'invalid_saved_view', 400);

  const detailResult = await harness.service.detail({
    actor: actor(),
    savedViewId: 'view-1',
  });
  assertFailure(detailResult, 'invalid_saved_view', 400);

  const executeResult = await harness.service.execute({
    actor: actor(),
    savedViewId: 'view-1',
  });
  assertFailure(executeResult, 'invalid_saved_view', 400);
  assert.equal(harness.calls.validate.length, 0);
  assert.equal(harness.calls.execute.length, 0);
});
