import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeItemService } from '../dist/application/knowledge/knowledgeItemUseCases.js';

const fixedNow = new Date('2026-08-04T09:00:00.000Z');

function actor(userId, { organizationId, groupAccountIds = [] } = {}) {
  return { userId, organizationId, groupAccountIds };
}

function auditActor(userId) {
  return { userId, actorRole: 'user', requestId: 'request-1', source: 'api' };
}

function createHarness({ failAuditAction } = {}) {
  const items = new Map();
  const grants = new Map();
  const audits = [];
  const activeGroups = new Set(['group-1', 'group-2']);
  let sequence = 0;

  const cloneItems = () => structuredClone([...items.entries()]);
  const restoreItems = (snapshot) => {
    items.clear();
    for (const [key, value] of snapshot) items.set(key, value);
  };

  const visible = (item, requestActor) => {
    if (item.deletedAt) return false;
    if (item.ownerUserId === requestActor.userId) return true;
    if (
      item.scope !== 'organization' ||
      !requestActor.organizationId ||
      item.organizationId !== requestActor.organizationId
    ) {
      return false;
    }
    const itemGroups = grants.get(item.id) ?? [];
    return requestActor.groupAccountIds.some(
      (groupId) => activeGroups.has(groupId) && itemGroups.includes(groupId),
    );
  };

  const repository = {
    listVisible: async (requestActor, query) =>
      [...items.values()]
        .filter((item) => visible(item, requestActor))
        .filter((item) => !query.scope || item.scope === query.scope)
        .filter((item) => !query.status || item.status === query.status)
        .slice(query.offset, query.offset + query.limit),
    countVisible: async (requestActor, filters) =>
      [...items.values()]
        .filter((item) => visible(item, requestActor))
        .filter((item) => !filters.scope || item.scope === filters.scope)
        .filter((item) => !filters.status || item.status === filters.status)
        .length,
    findVisibleById: async (requestActor, itemId) => {
      const item = items.get(itemId);
      return item && visible(item, requestActor) ? item : null;
    },
    countActiveGroups: async (groupIds) =>
      groupIds.filter((groupId) => activeGroups.has(groupId)).length,
    create: async (input) => {
      sequence += 1;
      const item = {
        id: `item-${sequence}`,
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        sourceAuthor: input.sourceAuthor,
        publishedAt: input.publishedAt,
        capturedAt: input.capturedAt,
        saveReason: input.saveReason,
        shortNote: input.shortNote,
        unresolvedQuestion: input.unresolvedQuestion,
        status: input.status,
        version: 1,
        deletedAt: null,
        deletedReason: null,
        createdAt: fixedNow,
        createdBy: input.createdBy,
        updatedAt: fixedNow,
        updatedBy: input.updatedBy,
      };
      items.set(item.id, item);
      grants.set(item.id, [...input.groupAccountIds]);
      return item;
    },
    findOwnedForMutation: async ({ actor: requestActor, itemId, deleted }) => {
      const item = items.get(itemId);
      if (!item || item.ownerUserId !== requestActor.userId) return null;
      return Boolean(item.deletedAt) === deleted ? item : null;
    },
    updateOwnedVersioned: async ({
      actor: requestActor,
      itemId,
      expectedVersion,
      patch,
    }) => {
      const item = items.get(itemId);
      if (
        !item ||
        item.ownerUserId !== requestActor.userId ||
        item.deletedAt ||
        item.version !== expectedVersion
      ) {
        return null;
      }
      const updated = {
        ...item,
        ...patch,
        version: item.version + 1,
        updatedAt: fixedNow,
        updatedBy: requestActor.userId,
      };
      items.set(itemId, updated);
      return updated;
    },
    deleteOwnedVersioned: async ({
      actor: requestActor,
      itemId,
      expectedVersion,
      deletedAt,
      reasonCode,
    }) => {
      const item = items.get(itemId);
      if (
        !item ||
        item.ownerUserId !== requestActor.userId ||
        item.deletedAt ||
        item.version !== expectedVersion
      ) {
        return null;
      }
      const updated = {
        ...item,
        deletedAt,
        deletedReason: reasonCode,
        version: item.version + 1,
      };
      items.set(itemId, updated);
      return updated;
    },
    restoreOwnedVersioned: async ({
      actor: requestActor,
      itemId,
      expectedVersion,
    }) => {
      const item = items.get(itemId);
      if (
        !item ||
        item.ownerUserId !== requestActor.userId ||
        !item.deletedAt ||
        item.version !== expectedVersion
      ) {
        return null;
      }
      const updated = {
        ...item,
        deletedAt: null,
        deletedReason: null,
        version: item.version + 1,
      };
      items.set(itemId, updated);
      return updated;
    },
  };

  const unitOfWork = {
    run: async (work) => {
      const itemSnapshot = cloneItems();
      const grantSnapshot = structuredClone([...grants.entries()]);
      const auditLength = audits.length;
      try {
        return await work({
          items: repository,
          audit: {
            write: async (entry) => {
              if (entry.action === failAuditAction) {
                throw new Error('audit unavailable');
              }
              audits.push(entry);
            },
          },
        });
      } catch (error) {
        restoreItems(itemSnapshot);
        grants.clear();
        for (const [key, value] of grantSnapshot) grants.set(key, value);
        audits.splice(auditLength);
        throw error;
      }
    },
  };

  return {
    items,
    grants,
    audits,
    service: createKnowledgeItemService({
      reader: repository,
      unitOfWork,
      now: () => fixedNow,
    }),
  };
}

async function createPersonal(harness, owner = 'owner-1') {
  return harness.service.create({
    actor: actor(owner),
    auditActor: auditActor(owner),
    body: { scope: 'personal', sourceType: 'manual', title: 'Private note' },
  });
}

test('personal list, detail, and count never expose another owner item, including admin-like actors', async () => {
  const harness = createHarness();
  const created = await createPersonal(harness);
  assert.equal(created.ok, true);

  const outsider = actor('admin-user', {
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.deepEqual(
    await harness.service.list({
      actor: outsider,
      query: { limit: 50, offset: 0 },
    }),
    [],
  );
  assert.equal(await harness.service.count({ actor: outsider }), 0);
  const detail = await harness.service.detail({
    actor: outsider,
    itemId: created.value.id,
  });
  assert.equal(detail.ok, false);
  assert.equal(detail.statusCode, 404);
});

test('organization visibility requires matching organization and an explicit active group grant', async () => {
  const harness = createHarness();
  const created = await harness.service.create({
    actor: actor('owner-1', {
      organizationId: 'org-1',
      groupAccountIds: ['group-1'],
    }),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'organization',
      organizationGroupIds: ['group-1'],
      sourceType: 'web',
      title: 'Organization item',
    },
  });
  assert.equal(created.ok, true);

  const allowed = await harness.service.detail({
    actor: actor('viewer-1', {
      organizationId: 'org-1',
      groupAccountIds: ['group-1'],
    }),
    itemId: created.value.id,
  });
  assert.equal(allowed.ok, true);

  const allowedActor = actor('viewer-1', {
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.deepEqual(
    await harness.service.list({
      actor: allowedActor,
      query: { limit: 50, offset: 0 },
    }),
    [created.value],
  );
  assert.equal(await harness.service.count({ actor: allowedActor }), 1);

  for (const deniedActor of [
    actor('viewer-2', {
      organizationId: 'org-2',
      groupAccountIds: ['group-1'],
    }),
    actor('viewer-3', {
      organizationId: 'org-1',
      groupAccountIds: ['group-2'],
    }),
    actor('viewer-4', { organizationId: 'org-1' }),
  ]) {
    const denied = await harness.service.detail({
      actor: deniedActor,
      itemId: created.value.id,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.statusCode, 404);
    assert.deepEqual(
      await harness.service.list({
        actor: deniedActor,
        query: { limit: 50, offset: 0 },
      }),
      [],
    );
    assert.equal(await harness.service.count({ actor: deniedActor }), 0);
  }
});

test('organization create rejects missing, foreign, and inactive group grants', async () => {
  const harness = createHarness();
  for (const organizationGroupIds of [
    [],
    ['group-foreign'],
    ['group-inactive'],
  ]) {
    const result = await harness.service.create({
      actor: actor('owner-1', {
        organizationId: 'org-1',
        groupAccountIds:
          organizationGroupIds[0] === 'group-inactive'
            ? ['group-inactive']
            : ['group-1'],
      }),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'organization',
        organizationGroupIds,
        sourceType: 'manual',
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.size, 0);
});

test('owner mutations enforce optimistic concurrency and hide items from non-owners', async () => {
  const harness = createHarness();
  const created = await createPersonal(harness);
  assert.equal(created.ok, true);

  const outsiderUpdate = await harness.service.update({
    actor: actor('other-user'),
    auditActor: auditActor('other-user'),
    itemId: created.value.id,
    body: { expectedVersion: 1, title: 'stolen' },
  });
  assert.equal(outsiderUpdate.ok, false);
  assert.equal(outsiderUpdate.statusCode, 404);

  const outsiderDelete = await harness.service.remove({
    actor: actor('other-user'),
    auditActor: auditActor('other-user'),
    itemId: created.value.id,
    expectedVersion: 1,
    reasonCode: 'owner_request',
  });
  assert.equal(outsiderDelete.ok, false);
  assert.equal(outsiderDelete.statusCode, 404);
  assert.equal(harness.items.get(created.value.id).version, 1);
  assert.equal(harness.items.get(created.value.id).deletedAt, null);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );

  const updated = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    body: { expectedVersion: 1, title: 'updated' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.value.version, 2);

  const stale = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    body: { expectedVersion: 1, title: 'stale' },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.statusCode, 409);
});

test('logical delete hides normal reads and restore is owner/version protected', async () => {
  const harness = createHarness();
  const created = await createPersonal(harness);
  assert.equal(created.ok, true);

  const removed = await harness.service.remove({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    expectedVersion: 1,
    reasonCode: 'owner_request',
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.value.version, 2);
  assert.equal(await harness.service.count({ actor: actor('owner-1') }), 0);

  const deniedRestore = await harness.service.restore({
    actor: actor('other-user'),
    auditActor: auditActor('other-user'),
    itemId: created.value.id,
    expectedVersion: 2,
  });
  assert.equal(deniedRestore.ok, false);
  assert.equal(deniedRestore.statusCode, 404);

  const restored = await harness.service.restore({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    expectedVersion: 2,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.value.version, 3);
  assert.equal(await harness.service.count({ actor: actor('owner-1') }), 1);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    [
      'knowledge_item_created',
      'knowledge_item_deleted',
      'knowledge_item_restored',
    ],
  );
});

test('logical delete rejects arbitrary reason text before item or audit mutation', async () => {
  const harness = createHarness();
  const created = await createPersonal(harness);
  assert.equal(created.ok, true);

  const rejected = await harness.service.remove({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    expectedVersion: 1,
    reasonCode: 'pasted credential or free-form explanation',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.statusCode, 400);
  assert.equal(harness.items.get(created.value.id).deletedAt, null);
  assert.equal(harness.items.get(created.value.id).version, 1);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );
});

test('logical delete rejects malformed reason types without throwing or mutating', async () => {
  for (const reasonCode of [42, null, undefined, { code: 'owner_request' }]) {
    const harness = createHarness();
    const created = await createPersonal(harness);
    assert.equal(created.ok, true);

    const rejected = await harness.service.remove({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: created.value.id,
      expectedVersion: 1,
      reasonCode,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.statusCode, 400);
    assert.equal(harness.items.get(created.value.id).deletedAt, null);
    assert.equal(harness.items.get(created.value.id).version, 1);
    assert.deepEqual(
      harness.audits.map((entry) => entry.action),
      ['knowledge_item_created'],
    );
  }
});

test('mandatory audit failure rolls back the business write and propagates', async () => {
  const harness = createHarness({
    failAuditAction: 'knowledge_item_created',
  });
  await assert.rejects(() => createPersonal(harness), /audit unavailable/);
  assert.equal(harness.items.size, 0);
  assert.equal(harness.audits.length, 0);
});

test('mandatory audit failure rolls back every owner mutation', async () => {
  for (const action of [
    'knowledge_item_updated',
    'knowledge_item_deleted',
    'knowledge_item_restored',
  ]) {
    const harness = createHarness({ failAuditAction: action });
    const created = await createPersonal(harness);
    assert.equal(created.ok, true);

    if (action === 'knowledge_item_updated') {
      await assert.rejects(
        () =>
          harness.service.update({
            actor: actor('owner-1'),
            auditActor: auditActor('owner-1'),
            itemId: created.value.id,
            body: { expectedVersion: 1, title: 'must rollback' },
          }),
        /audit unavailable/,
      );
      assert.equal(harness.items.get(created.value.id).title, 'Private note');
      assert.equal(harness.items.get(created.value.id).version, 1);
    } else if (action === 'knowledge_item_deleted') {
      await assert.rejects(
        () =>
          harness.service.remove({
            actor: actor('owner-1'),
            auditActor: auditActor('owner-1'),
            itemId: created.value.id,
            expectedVersion: 1,
            reasonCode: 'owner_request',
          }),
        /audit unavailable/,
      );
      assert.equal(harness.items.get(created.value.id).deletedAt, null);
      assert.equal(harness.items.get(created.value.id).version, 1);
    } else {
      const removed = await harness.service.remove({
        actor: actor('owner-1'),
        auditActor: auditActor('owner-1'),
        itemId: created.value.id,
        expectedVersion: 1,
        reasonCode: 'owner_request',
      });
      assert.equal(removed.ok, true);
      await assert.rejects(
        () =>
          harness.service.restore({
            actor: actor('owner-1'),
            auditActor: auditActor('owner-1'),
            itemId: created.value.id,
            expectedVersion: 2,
          }),
        /audit unavailable/,
      );
      assert.notEqual(harness.items.get(created.value.id).deletedAt, null);
      assert.equal(harness.items.get(created.value.id).version, 2);
    }

    assert.equal(
      harness.audits.some((entry) => entry.action === action),
      false,
    );
  }
});

test('canonical URL normalization removes credentials, fragments, tracking, and secret query values', async () => {
  const harness = createHarness();
  const result = await harness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl:
        'https://user:password@Example.com/path?utm_source=test&b=2&a=1#fragment',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.canonicalUrl, 'https://example.com/path?a=1&b=2');
  assert.equal(JSON.stringify(harness.audits).includes('password'), false);

  const encodeLayers = (value, count) => {
    let encoded = value;
    for (let layer = 0; layer < count; layer += 1) {
      encoded = encodeURIComponent(encoded);
    }
    return encoded;
  };
  const encodeQueryNameLayers = (value, count) => {
    let encoded = [...value]
      .map(
        (character) =>
          `%${character.codePointAt(0).toString(16).padStart(2, '0')}`,
      )
      .join('');
    for (let layer = 1; layer < count; layer += 1) {
      encoded = encodeURIComponent(encoded);
    }
    return encoded;
  };

  const signedUrl = await harness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl:
        'https://example.com/file?X-Amz-Credential=credential&X-Amz-Signature=signature&GoogleAccessId=account@example.com',
    },
  });
  assert.equal(signedUrl.ok, false);
  assert.equal(signedUrl.statusCode, 400);
  assert.equal(harness.items.size, 1);

  for (const credentialQuery of [
    'key=google-api-key-value',
    'resourcekey=drive-resource-key-value',
    'auth_key=credential-value',
    'x_sig=credential-value',
    'private_key=credential-value',
    'AuthKey=credential-value',
    'privatekey=credential-value',
  ]) {
    const credentialUrl = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'personal',
        sourceType: 'web',
        canonicalUrl: `https://drive.google.com/open?${credentialQuery}`,
      },
    });
    assert.equal(credentialUrl.ok, false);
    assert.equal(credentialUrl.statusCode, 400);
  }
  assert.equal(harness.items.size, 1);

  for (const canonicalUrl of [
    'https://target.example/#/callback?token=credential-value',
    'https://target.example/#/callback?privatekey=credential-value',
    'https://target.example/#/callback?download=1;token=credential-value',
    'https://target.example/#/callback;privatekey=credential-value',
    'https://target.example/file?download=1;token=credential-value',
    'https://target.example/file?download=1%3Bprivatekey%3Dcredential-value',
    'https://target.example/file?download=1%26token%3Dcredential-value',
    `https://target.example/file?${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/file?${encodeQueryNameLayers('privatekey', 12)}=credential-value`,
    `https://target.example/file?download=1;${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/#/callback?${encodeQueryNameLayers('privatekey', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('privatekey', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('GoogleAccessId', 2)}=credential-value`,
  ]) {
    const fragmentCredentialUrl = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'personal',
        sourceType: 'web',
        canonicalUrl,
      },
    });
    assert.equal(fragmentCredentialUrl.ok, false);
    assert.equal(fragmentCredentialUrl.statusCode, 400);
  }
  assert.equal(harness.items.size, 1);

  const nestedCredentialUrl =
    'https://drive.google.com/open?resourcekey=drive-resource-key-value&authuser=0';
  for (const nestedValue of [
    encodeURIComponent(nestedCredentialUrl),
    encodeURIComponent(nestedCredentialUrl.replace('https://', 'HTTPS://')),
    encodeURIComponent(encodeURIComponent(nestedCredentialUrl)),
    encodeLayers(` ${nestedCredentialUrl}`, 2),
    encodeLayers(nestedCredentialUrl, 4),
    encodeLayers(nestedCredentialUrl, 12),
    `%ZZ${encodeLayers(nestedCredentialUrl, 2)}`,
    encodeURIComponent('/open?resourcekey=drive-resource-key-value'),
    encodeURIComponent('callback?token=credential-value'),
    encodeURIComponent(
      'https://target.example/#/callback?token=credential-value',
    ),
  ]) {
    const nestedUrl = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'personal',
        sourceType: 'web',
        canonicalUrl: `https://example.com/redirect?next=${nestedValue}`,
      },
    });
    assert.equal(nestedUrl.ok, false);
    assert.equal(nestedUrl.statusCode, 400);
  }
  assert.equal(harness.items.size, 1);

  const harmlessHarness = createHarness();
  const harmlessDeeplyEncodedQuery = await harmlessHarness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl: `https://example.com/redirect?next=${encodeLayers('plain text', 12)}`,
    },
  });
  assert.equal(harmlessDeeplyEncodedQuery.ok, true);
  const harmlessDeeplyEncodedNestedUrl = await harmlessHarness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl: `https://example.com/redirect?next=${encodeLayers('https://example.com/safe?x=1', 12)}`,
    },
  });
  assert.equal(harmlessDeeplyEncodedNestedUrl.ok, true);
  const harmlessQueryLikeText = await harmlessHarness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl: `https://example.com/search?q=${encodeURIComponent('What?sort=done')}`,
    },
  });
  assert.equal(harmlessQueryLikeText.ok, true);
  const harmlessSemicolonQuery = await harmlessHarness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl: 'https://example.com/file?download=1;sort=asc',
    },
  });
  assert.equal(harmlessSemicolonQuery.ok, true);
  const harmlessDeeplyEncodedQueryName = await harmlessHarness.service.create({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    body: {
      scope: 'personal',
      sourceType: 'web',
      canonicalUrl: `https://example.com/file?${encodeQueryNameLayers('sort', 12)}=asc`,
    },
  });
  assert.equal(harmlessDeeplyEncodedQueryName.ok, true);

  for (const credentialQuery of [
    'auth_key=credential-value',
    'x-sig=credential-value',
    'privateKey=credential-value',
  ]) {
    const rejectedUpdate = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: result.value.id,
      body: {
        expectedVersion: 1,
        canonicalUrl: `https://example.com/file?${credentialQuery}`,
      },
    });
    assert.equal(rejectedUpdate.ok, false);
    assert.equal(rejectedUpdate.statusCode, 400);
  }
  for (const nestedValue of [
    encodeLayers(nestedCredentialUrl, 4),
    `%ZZ${encodeLayers(nestedCredentialUrl, 2)}`,
    encodeURIComponent('callback?token=credential-value'),
    encodeURIComponent(
      'https://target.example/#/callback?token=credential-value',
    ),
  ]) {
    const nestedRejectedUpdate = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: result.value.id,
      body: {
        expectedVersion: 1,
        canonicalUrl: `https://example.com/redirect?next=${nestedValue}`,
      },
    });
    assert.equal(nestedRejectedUpdate.ok, false);
    assert.equal(nestedRejectedUpdate.statusCode, 400);
  }
  for (const canonicalUrl of [
    'https://target.example/#/callback?token=credential-value',
    'https://target.example/#/callback?privatekey=credential-value',
    'https://target.example/#/callback?download=1;token=credential-value',
    'https://target.example/#/callback;privatekey=credential-value',
    'https://target.example/file?download=1;token=credential-value',
    'https://target.example/file?download=1%3Bprivatekey%3Dcredential-value',
    'https://target.example/file?download=1%26token%3Dcredential-value',
    `https://target.example/file?${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/file?${encodeQueryNameLayers('privatekey', 12)}=credential-value`,
    `https://target.example/file?download=1;${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/#/callback?${encodeQueryNameLayers('privatekey', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('token', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('privatekey', 2)}=credential-value`,
    `https://target.example/file?%ZZ${encodeQueryNameLayers('GoogleAccessId', 2)}=credential-value`,
  ]) {
    const fragmentRejectedUpdate = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: result.value.id,
      body: { expectedVersion: 1, canonicalUrl },
    });
    assert.equal(fragmentRejectedUpdate.ok, false);
    assert.equal(fragmentRejectedUpdate.statusCode, 400);
  }
  assert.equal(harness.items.get(result.value.id).version, 1);
  assert.equal(
    harness.items.get(result.value.id).canonicalUrl,
    'https://example.com/path?a=1&b=2',
  );

  const rejected = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: result.value.id,
    body: { expectedVersion: 1, canonicalUrl: 'file:///etc/passwd' },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.statusCode, 400);
});

test('create and update reject present but invalid date-time values before writes', async () => {
  const harness = createHarness();

  for (const body of [
    { scope: 'personal', sourceType: 'manual', publishedAt: '' },
    { scope: 'personal', sourceType: 'manual', capturedAt: '' },
    { scope: 'personal', sourceType: 'manual', publishedAt: '2026-08-04' },
    {
      scope: 'personal',
      sourceType: 'manual',
      publishedAt: 'August 4, 2026',
    },
    {
      scope: 'personal',
      sourceType: 'manual',
      capturedAt: '2026-02-30T00:00:00Z',
    },
    { scope: 'personal', sourceType: 'manual', publishedAt: undefined },
    { scope: 'personal', sourceType: 'manual', capturedAt: undefined },
    { scope: 'personal', sourceType: 'manual', capturedAt: null },
  ]) {
    const result = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.size, 0);

  const created = await createPersonal(harness);
  assert.equal(created.ok, true);
  for (const patch of [
    { publishedAt: '' },
    { capturedAt: '' },
    { publishedAt: '2026-08-04' },
    { publishedAt: 'August 4, 2026' },
    { capturedAt: '2026-02-30T00:00:00Z' },
    { publishedAt: undefined },
    { capturedAt: undefined },
    { capturedAt: null },
  ]) {
    const result = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: created.value.id,
      body: { expectedVersion: 1, ...patch },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.get(created.value.id).version, 1);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );

  const validDateTime = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    body: {
      expectedVersion: 1,
      publishedAt: '2026-08-04T12:34:56.789+09:00',
      capturedAt: '2026-08-04T03:34:56Z',
    },
  });
  assert.equal(validDateTime.ok, true);
  assert.equal(
    validDateTime.value.publishedAt.toISOString(),
    '2026-08-04T03:34:56.789Z',
  );
  assert.equal(
    validDateTime.value.capturedAt.toISOString(),
    '2026-08-04T03:34:56.000Z',
  );
});

test('service boundary rejects malformed create and update values before writes', async () => {
  const harness = createHarness();

  for (const body of [
    { scope: 'invalid', sourceType: 'manual' },
    { scope: 'personal', sourceType: 'invalid' },
    { scope: 'personal', sourceType: 'manual', title: 42 },
    {
      scope: 'organization',
      sourceType: 'manual',
      organizationGroupIds: [42],
    },
  ]) {
    const result = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.size, 0);

  const created = await createPersonal(harness);
  assert.equal(created.ok, true);
  for (const patch of [
    { title: undefined },
    { title: 42 },
    { canonicalUrl: 42 },
    { publishedAt: 42 },
    { capturedAt: 42 },
    { sourceType: 'invalid' },
    { status: 'invalid' },
  ]) {
    const result = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: created.value.id,
      body: { expectedVersion: 1, ...patch },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.get(created.value.id).version, 1);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );
});

test('service boundary enforces mutable string size limits before writes', async () => {
  const harness = createHarness();
  const oversizedValues = [
    { canonicalUrl: `https://example.com/${'a'.repeat(4096)}` },
    { canonicalUrl: `https://example.com/${'😀'.repeat(4000)}` },
    { title: 'a'.repeat(501) },
    { sourceAuthor: 'a'.repeat(501) },
    { saveReason: 'a'.repeat(4001) },
    { shortNote: 'a'.repeat(10001) },
    { unresolvedQuestion: 'a'.repeat(4001) },
  ];

  for (const oversizedValue of oversizedValues) {
    const result = await harness.service.create({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'personal',
        sourceType: 'manual',
        ...oversizedValue,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.size, 0);

  const created = await createPersonal(harness);
  assert.equal(created.ok, true);
  for (const oversizedValue of oversizedValues) {
    const result = await harness.service.update({
      actor: actor('owner-1'),
      auditActor: auditActor('owner-1'),
      itemId: created.value.id,
      body: { expectedVersion: 1, ...oversizedValue },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.get(created.value.id).version, 1);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );
});

test('service boundary enforces organization group collection limits before writes', async () => {
  const harness = createHarness();

  for (const organizationGroupIds of [
    Array.from({ length: 101 }, (_, index) => `group-${index}`),
    ['g'.repeat(101)],
    ['   '],
    ['group-1', 'group-1'],
    ['group-1', ' group-1 '],
  ]) {
    const result = await harness.service.create({
      actor: actor('owner-1', { organizationId: 'org-1' }),
      auditActor: auditActor('owner-1'),
      body: {
        scope: 'organization',
        sourceType: 'manual',
        organizationGroupIds,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }

  assert.equal(harness.items.size, 0);
  assert.deepEqual(harness.audits, []);
});

test('service boundary rejects unbounded read queries and item ids without repository mutation', async () => {
  const harness = createHarness();
  const created = await createPersonal(harness);
  assert.equal(created.ok, true);

  for (const query of [
    { limit: 0, offset: 0 },
    { limit: 101, offset: 0 },
    { limit: 1.5, offset: 0 },
    { limit: 50, offset: -1 },
    { limit: 50, offset: 10001 },
    { limit: 50, offset: 0, scope: 'invalid' },
    { limit: 50, offset: 0, status: 'invalid' },
    { limit: 50, offset: 0, unexpected: true },
  ]) {
    const items = await harness.service.list({
      actor: actor('owner-1'),
      query,
    });
    assert.deepEqual(items, []);
  }

  assert.equal(
    await harness.service.count({
      actor: actor('owner-1'),
      scope: 'invalid',
    }),
    0,
  );

  const oversizedVersion = 2147483648;
  for (const mutation of [
    () =>
      harness.service.update({
        actor: actor('owner-1'),
        auditActor: auditActor('owner-1'),
        itemId: created.value.id,
        body: { expectedVersion: oversizedVersion, title: 'must not update' },
      }),
    () =>
      harness.service.remove({
        actor: actor('owner-1'),
        auditActor: auditActor('owner-1'),
        itemId: created.value.id,
        expectedVersion: oversizedVersion,
        reasonCode: 'owner_request',
      }),
    () =>
      harness.service.restore({
        actor: actor('owner-1'),
        auditActor: auditActor('owner-1'),
        itemId: created.value.id,
        expectedVersion: oversizedVersion,
      }),
  ]) {
    const result = await mutation();
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
  }
  assert.equal(harness.items.get(created.value.id).version, 1);

  const maximumVersion = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: created.value.id,
    body: { expectedVersion: 2147483647, title: 'bounded but stale' },
  });
  assert.equal(maximumVersion.ok, false);
  assert.equal(maximumVersion.statusCode, 409);

  const originalId = created.value.id;
  const oversizedId = 'i'.repeat(101);
  harness.items.delete(originalId);
  created.value.id = oversizedId;
  harness.items.set(oversizedId, created.value);

  const detail = await harness.service.detail({
    actor: actor('owner-1'),
    itemId: oversizedId,
  });
  assert.equal(detail.ok, false);
  assert.equal(detail.statusCode, 404);

  const update = await harness.service.update({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: oversizedId,
    body: { expectedVersion: 1, title: 'must not update' },
  });
  assert.equal(update.ok, false);
  assert.equal(update.statusCode, 404);

  const remove = await harness.service.remove({
    actor: actor('owner-1'),
    auditActor: auditActor('owner-1'),
    itemId: oversizedId,
    expectedVersion: 1,
    reasonCode: 'owner_request',
  });
  assert.equal(remove.ok, false);
  assert.equal(remove.statusCode, 404);
  assert.equal(harness.items.get(oversizedId).version, 1);
  assert.equal(harness.items.get(oversizedId).deletedAt, null);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_item_created'],
  );
});
