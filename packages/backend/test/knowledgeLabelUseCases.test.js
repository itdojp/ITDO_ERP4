import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeLabelService } from '../dist/application/knowledge/knowledgeLabelUseCases.js';
import { KnowledgeLabelTransactionConflictError } from '../dist/application/knowledge/knowledgeLabelPorts.js';

const fixedNow = new Date('2026-08-05T00:00:00.000Z');

function actor(overrides = {}) {
  return {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
    ...overrides,
  };
}

function label(overrides = {}) {
  return {
    id: 'label-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    displayName: 'Architecture',
    slug: 'architecture',
    parentId: null,
    version: 1,
    deletedAt: null,
    createdAt: fixedNow,
    createdBy: 'owner-1',
    updatedAt: fixedNow,
    updatedBy: 'owner-1',
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    status: 'inbox',
    version: 1,
    ...overrides,
  };
}

function assignment(overrides = {}) {
  return {
    itemId: 'item-1',
    labelId: 'label-1',
    assignmentSource: 'manual',
    assignedBy: 'owner-1',
    confidenceBasisPoints: null,
    detachedAt: null,
    detachedBy: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const audits = [];
  const calls = {
    create: 0,
    update: 0,
    remove: 0,
    attach: 0,
    detach: 0,
  };
  const labels = {
    countActiveGroups: async (ids) => ids.length,
    findManageableById: async (_actor, id) =>
      id === 'label-1' ? label() : null,
    findUsableById: async (_actor, id) => (id === 'label-1' ? label() : null),
    isNameAvailable: async () => true,
    create: async (input) => {
      calls.create += 1;
      return {
        ok: true,
        value: label({
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          organizationId: input.organizationId,
          displayName: input.displayName,
          slug: input.slug,
          parentId: input.parentId,
        }),
      };
    },
    updateVersioned: async ({ patch }) => {
      calls.update += 1;
      return { ok: true, value: label({ ...patch, version: 2 }) };
    },
    deleteVersioned: async ({ deletedAt }) => {
      calls.remove += 1;
      return {
        ok: true,
        value: label({ version: 2, deletedAt }),
      };
    },
    addAliasVersioned: async ({ alias: value, normalizedAlias }) => ({
      ok: true,
      value: {
        alias: {
          id: 'alias-1',
          labelId: 'label-1',
          alias: value,
          normalizedAlias,
          createdAt: fixedNow,
          createdBy: 'owner-1',
        },
        labelVersion: 2,
      },
    }),
    removeAliasVersioned: async () => ({
      ok: true,
      value: {
        alias: {
          id: 'alias-1',
          labelId: 'label-1',
          alias: 'Arch',
          normalizedAlias: 'arch',
          createdAt: fixedNow,
          createdBy: 'owner-1',
        },
        labelVersion: 2,
      },
    }),
    replaceGrantsVersioned: async ({ grants }) => ({
      ok: true,
      value: {
        grants: grants.map((grant, index) => ({
          id: `grant-${index + 1}`,
          labelId: 'label-1',
          ...grant,
          active: true,
          createdAt: fixedNow,
          createdBy: 'owner-1',
          updatedAt: fixedNow,
          updatedBy: 'owner-1',
        })),
        labelVersion: 2,
      },
    }),
  };
  const itemLabels = {
    findOwnedItemForMutation: async (_input) => item(),
    attachVersioned: async (input) => {
      calls.attach += 1;
      return {
        ok: true,
        value: {
          assignment: assignment({
            assignmentSource: input.assignmentSource,
            confidenceBasisPoints: input.confidenceBasisPoints,
          }),
          itemVersion: 2,
        },
      };
    },
    detachVersioned: async () => {
      calls.detach += 1;
      return {
        ok: true,
        value: {
          assignment: assignment({
            detachedAt: fixedNow,
            detachedBy: 'owner-1',
          }),
          itemVersion: 2,
        },
      };
    },
  };
  Object.assign(labels, overrides.labels);
  Object.assign(itemLabels, overrides.itemLabels);
  const reader = {
    listVisible: async () => [],
    findVisibleById: async (_actor, id) => (id === 'label-1' ? label() : null),
    listVisibleAliases: async (_actor, id) => (id === 'label-1' ? [] : null),
    listManageableGrants: async (_actor, id) => (id === 'label-1' ? [] : null),
    ...overrides.reader,
  };
  const audit = {
    write: async (entry) => {
      audits.push(entry);
      if (overrides.auditError) throw overrides.auditError;
    },
  };
  const service = createKnowledgeLabelService({
    reader,
    unitOfWork: {
      run: async (work) => work({ labels, itemLabels, audit }),
    },
    now: () => fixedNow,
  });
  return { service, labels, itemLabels, audits, calls };
}

test('personal label create normalizes display text and writes a constant-target audit', async () => {
  const harness = createHarness();
  const result = await harness.service.create({
    actor: actor(),
    auditActor: { requestId: 'request-1', source: 'api' },
    body: {
      scope: 'personal',
      displayName: ' ＡＩ ',
      slug: 'ai',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.displayName, 'AI');
  assert.equal(result.value.organizationId, null);
  assert.equal(harness.calls.create, 1);
  assert.deepEqual(harness.audits, [
    {
      action: 'knowledge_label_created',
      actor: { userId: 'owner-1', requestId: 'request-1', source: 'api' },
      target: { kind: 'label_master', scope: 'personal', version: 1 },
    },
  ]);
});

test('organization create requires current organization, an active explicit grant, and a same-domain parent', async () => {
  const missingGrant = createHarness();
  assert.deepEqual(
    await missingGrant.service.create({
      actor: actor(),
      auditActor: {},
      body: {
        scope: 'organization',
        displayName: 'Org',
        slug: 'org',
      },
    }),
    {
      ok: false,
      statusCode: 400,
      code: 'invalid_request',
      message:
        'organization scope requires organization context and a group grant',
    },
  );

  const inactive = createHarness({
    labels: { countActiveGroups: async () => 0 },
  });
  const inactiveResult = await inactive.service.create({
    actor: actor(),
    auditActor: {},
    body: {
      scope: 'organization',
      displayName: 'Org',
      slug: 'org',
      groupGrants: [{ groupAccountId: 'group-1', capability: 'manage' }],
    },
  });
  assert.equal(inactiveResult.code, 'invalid_request');
  assert.equal(inactive.calls.create, 0);

  const crossDomain = createHarness({
    labels: {
      findManageableById: async () =>
        label({
          id: 'parent-1',
          scope: 'organization',
          organizationId: 'org-2',
        }),
    },
  });
  const hidden = await crossDomain.service.create({
    actor: actor(),
    auditActor: {},
    body: {
      scope: 'organization',
      displayName: 'Org',
      slug: 'org',
      parentId: 'parent-1',
      groupGrants: [{ groupAccountId: 'group-1', capability: 'manage' }],
    },
  });
  assert.deepEqual(hidden, {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  });
  assert.equal(crossDomain.calls.create, 0);
});

test('create rejects ambiguous names, duplicate grants, unsupported fields, and personal grants before writes', async () => {
  const harness = createHarness({
    labels: { isNameAvailable: async () => false },
  });
  const conflict = await harness.service.create({
    actor: actor(),
    auditActor: {},
    body: {
      scope: 'personal',
      displayName: 'Architecture',
      slug: 'architecture',
    },
  });
  assert.equal(conflict.code, 'label_conflict');

  for (const body of [
    {
      scope: 'organization',
      displayName: 'Org',
      slug: 'org',
      groupGrants: [
        { groupAccountId: 'group-1', capability: 'use' },
        { groupAccountId: 'group-1', capability: 'manage' },
      ],
    },
    {
      scope: 'personal',
      displayName: 'Personal',
      slug: 'personal',
      groupGrants: [{ groupAccountId: 'group-1', capability: 'use' }],
    },
    {
      scope: 'personal',
      displayName: 'Personal',
      slug: 'personal',
      ownerUserId: 'spoofed',
    },
  ]) {
    const result = await createHarness().service.create({
      actor: actor(),
      auditActor: {},
      body,
    });
    assert.equal(result.code, 'invalid_request');
  }
});

test('reparent rejects hidden/cross-domain parents and maps cycle/depth/path failures without audit', async () => {
  for (const reason of ['cycle', 'hierarchy_too_deep', 'broken_hierarchy']) {
    const harness = createHarness({
      labels: {
        findManageableById: async (_actor, id) =>
          id === 'label-1' ? label() : label({ id: 'parent-1' }),
        updateVersioned: async () => ({ ok: false, reason }),
      },
    });
    const result = await harness.service.update({
      actor: actor(),
      auditActor: {},
      labelId: 'label-1',
      body: { expectedVersion: 1, parentId: 'parent-1' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.equal(harness.audits.length, 0);
  }

  const crossDomain = createHarness({
    labels: {
      findManageableById: async (_actor, id) =>
        id === 'label-1'
          ? label()
          : label({
              id: 'parent-1',
              scope: 'organization',
              organizationId: 'org-1',
            }),
    },
  });
  const result = await crossDomain.service.update({
    actor: actor(),
    auditActor: {},
    labelId: 'label-1',
    body: { expectedVersion: 1, parentId: 'parent-1' },
  });
  assert.equal(result.code, 'not_found');
  assert.equal(crossDomain.calls.update, 0);
});

test('use-only visibility does not substitute for manage authorization', async () => {
  const harness = createHarness({
    reader: {
      findVisibleById: async () =>
        label({ scope: 'organization', organizationId: 'org-1' }),
    },
    labels: { findManageableById: async () => null },
  });
  assert.equal(
    (
      await harness.service.detail({
        actor: actor({ userId: 'user-2' }),
        labelId: 'label-1',
      })
    ).ok,
    true,
  );
  const update = await harness.service.update({
    actor: actor({ userId: 'user-2' }),
    auditActor: {},
    labelId: 'label-1',
    body: { expectedVersion: 1, displayName: 'Changed' },
  });
  assert.equal(update.code, 'not_found');
  assert.equal(harness.calls.update, 0);
});

test('alias mutations preserve normalized canonical namespace and version/audit contract', async () => {
  const harness = createHarness();
  const added = await harness.service.addAlias({
    actor: actor(),
    auditActor: {},
    labelId: 'label-1',
    expectedVersion: 1,
    alias: ' ＡＲＣＨ ',
  });
  assert.equal(added.ok, true);
  assert.equal(added.value.alias.alias, 'ARCH');
  assert.equal(added.value.alias.normalizedAlias, 'arch');
  assert.equal(harness.audits[0].action, 'knowledge_label_alias_added');
  assert.equal(JSON.stringify(harness.audits[0]).includes('ARCH'), false);

  const canonicalAlias = await createHarness().service.addAlias({
    actor: actor(),
    auditActor: {},
    labelId: 'label-1',
    expectedVersion: 1,
    alias: 'architecture',
  });
  assert.equal(canonicalAlias.code, 'invalid_request');
});

test('grant replacement can delegate to an active group outside the manager membership', async () => {
  const manager = actor();
  const personal = await createHarness().service.replaceGrants({
    actor: manager,
    auditActor: {},
    labelId: 'label-1',
    expectedVersion: 1,
    groupGrants: [],
  });
  assert.equal(personal.code, 'invalid_request');

  const organization = label({
    scope: 'organization',
    organizationId: 'org-1',
  });
  const harness = createHarness({
    labels: {
      findManageableById: async () => organization,
      countActiveGroups: async () => 1,
    },
  });
  const replaced = await harness.service.replaceGrants({
    actor: manager,
    auditActor: {},
    labelId: 'label-1',
    expectedVersion: 1,
    groupGrants: [{ groupAccountId: 'group-2', capability: 'use' }],
  });
  assert.equal(manager.groupAccountIds.includes('group-2'), false);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.value.grants[0].capability, 'use');
  assert.equal(harness.audits[0].action, 'knowledge_label_grants_replaced');
});

test('attach evaluates owned item/version and current label use in one unit of work', async () => {
  const harness = createHarness();
  const result = await harness.service.attach({
    actor: actor(),
    auditActor: { requestId: 'request-1', source: 'api' },
    itemId: 'item-1',
    body: { expectedVersion: 1, labelId: 'label-1' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.itemVersion, 2);
  assert.equal(harness.calls.attach, 1);
  assert.deepEqual(harness.audits[0], {
    action: 'knowledge_item_label_attached',
    actor: { userId: 'owner-1', requestId: 'request-1', source: 'api' },
    target: {
      kind: 'knowledge_item',
      itemId: 'item-1',
      scope: 'personal',
      status: 'inbox',
      version: 2,
      assignmentSource: 'manual',
    },
  });
  assert.equal(JSON.stringify(harness.audits[0]).includes('label-1'), false);
});

test('hidden, deleted, revoked, absent, and cross-domain labels have the same attach result and no side effects', async () => {
  const expected = {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  };
  const cases = [
    { findUsableById: async () => null },
    { findUsableById: async () => null },
    { findUsableById: async () => null },
    { findUsableById: async () => null },
    {
      findUsableById: async () =>
        label({ scope: 'organization', organizationId: 'org-1' }),
    },
  ];
  for (const labels of cases) {
    const harness = createHarness({ labels });
    const result = await harness.service.attach({
      actor: actor(),
      auditActor: {},
      itemId: 'item-1',
      body: { expectedVersion: 1, labelId: 'label-1' },
    });
    assert.deepEqual(result, expected);
    assert.equal(harness.calls.attach, 0);
    assert.equal(harness.audits.length, 0);
  }
});

test('attach validates source/confidence and unknown fields without reaching persistence', async () => {
  for (const body of [
    {
      expectedVersion: 1,
      labelId: 'label-1',
      assignmentSource: 'manual',
      confidenceBasisPoints: 8000,
    },
    {
      expectedVersion: 1,
      labelId: 'label-1',
      assignmentSource: 'ai_suggestion',
      confidenceBasisPoints: 10001,
    },
    {
      expectedVersion: 1,
      labelId: 'label-1',
      assignmentSource: 'unknown',
    },
    {
      expectedVersion: 1,
      labelId: 'label-1',
      ownerUserId: 'spoofed',
    },
  ]) {
    const harness = createHarness();
    const result = await harness.service.attach({
      actor: actor(),
      auditActor: {},
      itemId: 'item-1',
      body,
    });
    assert.equal(result.code, 'invalid_request');
    assert.equal(harness.calls.attach, 0);
  }
});

test('attach maps an existing active assignment to a specific invalid request', async () => {
  const harness = createHarness({
    itemLabels: {
      attachVersioned: async () => ({ ok: false, reason: 'duplicate' }),
    },
  });
  const result = await harness.service.attach({
    actor: actor(),
    auditActor: {},
    itemId: 'item-1',
    body: { expectedVersion: 1, labelId: 'label-1' },
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 400,
    code: 'invalid_request',
    message: 'label is already attached',
  });
  assert.equal(harness.audits.length, 0);

  const exhausted = createKnowledgeLabelService({
    reader: {
      listVisible: async () => [],
      findVisibleById: async () => null,
      listVisibleAliases: async () => null,
      listManageableGrants: async () => null,
    },
    unitOfWork: {
      run: async () => {
        throw new KnowledgeLabelTransactionConflictError('duplicate');
      },
    },
  });
  assert.deepEqual(
    await exhausted.attach({
      actor: actor(),
      auditActor: {},
      itemId: 'item-1',
      body: { expectedVersion: 1, labelId: 'label-1' },
    }),
    result,
  );
});

test('detach missing assignment is generic not_found and audit failure is propagated', async () => {
  const missing = createHarness({
    itemLabels: {
      detachVersioned: async () => ({
        ok: true,
        value: { assignment: null, itemVersion: 1 },
      }),
    },
  });
  const result = await missing.service.detach({
    actor: actor(),
    auditActor: {},
    itemId: 'item-1',
    labelId: 'label-1',
    expectedVersion: 1,
  });
  assert.equal(result.code, 'not_found');
  assert.equal(missing.audits.length, 0);

  const failing = createHarness({ auditError: new Error('audit failed') });
  await assert.rejects(
    () =>
      failing.service.attach({
        actor: actor(),
        auditActor: {},
        itemId: 'item-1',
        body: { expectedVersion: 1, labelId: 'label-1' },
      }),
    /audit failed/,
  );
});

test('detach audit preserves bounded assignment source without exposing the label id', async () => {
  const harness = createHarness({
    itemLabels: {
      detachVersioned: async () => ({
        ok: true,
        value: {
          assignment: assignment({
            assignmentSource: 'ai_suggestion',
            confidenceBasisPoints: 7000,
            detachedAt: fixedNow,
            detachedBy: 'owner-1',
          }),
          itemVersion: 2,
        },
      }),
    },
  });

  const result = await harness.service.detach({
    actor: actor(),
    auditActor: { requestId: 'request-1', source: 'api' },
    itemId: 'item-1',
    labelId: 'label-1',
    expectedVersion: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.audits, [
    {
      action: 'knowledge_item_label_detached',
      actor: { userId: 'owner-1', requestId: 'request-1', source: 'api' },
      target: {
        kind: 'knowledge_item',
        itemId: 'item-1',
        scope: 'personal',
        status: 'inbox',
        version: 2,
        assignmentSource: 'ai_suggestion',
      },
    },
  ]);
  assert.equal(JSON.stringify(harness.audits).includes('label-1'), false);
});

test('transaction conflict exhaustion is normalized to stable 409 application results', async () => {
  const reader = {
    listVisible: async () => [],
    findVisibleById: async () => null,
    listVisibleAliases: async () => null,
    listManageableGrants: async () => null,
  };
  for (const [conflict, expectedCode] of [
    ['duplicate', 'label_conflict'],
    ['concurrent', 'version_conflict'],
  ]) {
    const service = createKnowledgeLabelService({
      reader,
      unitOfWork: {
        run: async () => {
          throw new KnowledgeLabelTransactionConflictError(conflict);
        },
      },
    });
    const result = await service.create({
      actor: actor(),
      auditActor: {},
      body: {
        scope: 'personal',
        displayName: 'Architecture',
        slug: 'architecture',
      },
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 409,
      code: expectedCode,
      message:
        conflict === 'duplicate'
          ? 'Label name is not available'
          : 'Version conflict',
    });
  }
});
