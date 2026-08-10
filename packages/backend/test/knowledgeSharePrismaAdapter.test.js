import assert from 'node:assert/strict';
import test from 'node:test';

import { createPrismaKnowledgeShareAdapter } from '../dist/adapters/knowledge/prismaKnowledgeShareAdapter.js';

const now = new Date('2026-08-10T00:00:00.000Z');
const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['knowledge-group-1'],
};
const chatActor = {
  canonicalUserId: actor.userId,
  userId: 'owner-1',
  roles: ['user'],
  projectIds: [],
  groupIds: [],
  groupAccountIds: ['knowledge-group-1'],
};
const auditActor = {
  principalUserId: 'owner-1',
  actorUserId: 'owner-1',
  requestId: 'request-1',
  source: 'api',
};

const titleSelection = {
  includeTitle: true,
  includeSourceType: true,
  includeCanonicalUrl: true,
  snapshot: null,
  labelAssignmentIds: [],
  annotations: [],
  conversationTurnIds: [],
  syntheses: [],
  sharerNote: null,
};

function item(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    sourceType: 'web',
    canonicalUrl:
      'https://source-user:source-password@example.test/path?token=private-query#private-fragment',
    title: 'Selected title',
    version: 3,
    updatedAt: now,
    ...overrides,
  };
}

function room(overrides = {}) {
  return {
    id: 'room-1',
    type: 'company',
    name: 'Synthetic room',
    projectId: null,
    isOfficial: true,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
    updatedAt: now,
    ...overrides,
  };
}

function pendingShare(resolved, overrides = {}) {
  return {
    id: 'share-1',
    sourceKnowledgeItemId: resolved.sourceItemId,
    sourceOwnerUserId: resolved.sourceOwnerUserId,
    sharerUserId: 'owner-1',
    chatPosterUserId: chatActor.userId,
    destinationRoomId: resolved.destinationRoomId,
    chatMessageId: null,
    selectionSchemaVersion: 1,
    requestKeyHash: 'a'.repeat(64),
    requestPayloadHash: 'b'.repeat(64),
    selectionHash: resolved.selectionHash,
    contentHash: resolved.snapshot.contentHash,
    sourceItemVersion: resolved.sourceItemVersion,
    sourceItemUpdatedAt: resolved.sourceItemUpdatedAt,
    selectedTitle: resolved.snapshot.title ?? null,
    selectedSourceType: resolved.snapshot.sourceType ?? null,
    selectedCanonicalUrl: resolved.snapshot.canonicalUrl ?? null,
    selectedSharerNote: resolved.snapshot.sharerNote ?? null,
    status: 'pending',
    failureCode: null,
    version: 1,
    postedAt: null,
    failedAt: null,
    revokedAt: null,
    revokedBy: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
    snapshot: null,
    labels: [],
    annotations: [],
    turns: [],
    syntheses: [],
    ...overrides,
  };
}

function postedCardShare(overrides = {}) {
  return pendingShare(
    {
      sourceItemId: 'item-1',
      sourceOwnerUserId: 'owner-1',
      sourceItemVersion: 3,
      sourceItemUpdatedAt: now,
      destinationRoomId: 'room-1',
      selectionHash: 'a'.repeat(64),
      snapshot: {
        title: 'Selected title',
        sourceType: 'web',
        canonicalUrl:
          'https://example.test/selected?private=query#private-fragment',
        contentHash: 'b'.repeat(64),
      },
    },
    {
      status: 'posted',
      chatMessageId: 'share-1',
      version: 2,
      postedAt: now,
      selectedCanonicalUrl:
        'https://example.test/selected?private=query#private-fragment',
      ...overrides,
    },
  );
}

function basicTransaction(overrides = {}) {
  const auditRows = [];
  const sourceItem = item(overrides.item);
  const destinationRoom = room(overrides.room);
  return {
    auditRows,
    knowledgeItem: {
      async findFirst() {
        return sourceItem;
      },
    },
    chatRoom: {
      async findUnique() {
        return destinationRoom;
      },
      async findFirst() {
        return destinationRoom;
      },
    },
    chatRoomMember: {
      async findFirst() {
        return null;
      },
    },
    projectMember: {
      async findFirst() {
        return null;
      },
    },
    knowledgeItemLabel: { findMany: async () => [] },
    knowledgeAnnotation: { findMany: async () => [] },
    knowledgeConversationTurn: { findMany: async () => [] },
    knowledgeSynthesis: {
      findFirst: async () => null,
    },
    knowledgeSynthesisVersion: {
      findUnique: async () => null,
    },
    knowledgeShare: {},
    chatMessage: {},
    auditLog: {
      async create(input) {
        auditRows.push(input.data);
        return input.data;
      },
    },
    async $queryRaw() {
      return [];
    },
    ...overrides.transaction,
  };
}

function host(transaction, transactionCalls = []) {
  return {
    async $transaction(operation, options) {
      transactionCalls.push(options ?? null);
      return operation(transaction);
    },
  };
}

async function previewWith(transaction, selection = titleSelection) {
  return createPrismaKnowledgeShareAdapter(host(transaction)).preview({
    actor,
    chatActor,
    auditActor,
    shareId: '11111111-2222-4333-8444-123456789012',
    itemId: 'item-1',
    destinationRoomId: 'room-1',
    selection,
  });
}

test('preview copies only selected fields, strips URL credentials/query/hash, and writes redacted mandatory audit', async () => {
  const transaction = basicTransaction();
  const result = await previewWith(transaction);
  assert.equal(result.ok, true);
  assert.equal(result.value.snapshot.title, 'Selected title');
  assert.equal(result.value.snapshot.sourceType, 'web');
  assert.equal(result.value.snapshot.canonicalUrl, 'https://example.test/path');
  assert.deepEqual(result.value.snapshot.labels, []);
  assert.deepEqual(result.value.snapshot.annotations, []);
  assert.deepEqual(result.value.snapshot.turns, []);
  assert.deepEqual(result.value.snapshot.syntheses, []);

  assert.equal(transaction.auditRows.length, 1);
  const serializedAudit = JSON.stringify(transaction.auditRows[0]);
  assert.equal(serializedAudit.includes('Selected title'), false);
  assert.equal(serializedAudit.includes('private-query'), false);
  assert.equal(serializedAudit.includes('item-1'), false);
  assert.equal(serializedAudit.includes('room-1'), false);
  assert.equal(transaction.auditRows[0].action, 'knowledge_share_previewed');
  assert.equal(
    transaction.auditRows[0].targetId,
    '11111111-2222-4333-8444-123456789012',
  );
  assert.deepEqual(transaction.auditRows[0].metadata.selectedCategoryCount, 3);
});

test('preview fails closed for an external-audience room without writing an audit row', async () => {
  const transaction = basicTransaction({ room: { allowExternalUsers: true } });
  const result = await previewWith(transaction);
  assert.deepEqual(result, {
    ok: false,
    error: {
      status: 400,
      code: 'external_audience_not_supported',
      message: 'Destination is not supported',
    },
    deterministicFailureCode: 'post_rejected',
  });
  assert.deepEqual(transaction.auditRows, []);
});

test('preview rejects Google Drive and provider-host canonical URLs instead of sharing provider identifiers', async () => {
  for (const canonicalUrl of [
    'https://drive.google.com/file/d/PRIVATE_PROVIDER_ID/view',
    'https://drive.google.com./file/d/PRIVATE_PROVIDER_ID/view',
    'https://drive.google.com%2e/file/d/PRIVATE_PROVIDER_ID/view',
    'https://drive。google。com/file/d/PRIVATE_PROVIDER_ID/view',
    'https://docs.google.com/document/d/PRIVATE_PROVIDER_ID/edit',
    'https://docs.google.com./document/d/PRIVATE_PROVIDER_ID/edit',
    'https://storage.googleapis.com/private-bucket/private-object',
    'https://storage.googleapis.com./private-bucket/private-object',
    'https://private-bucket.storage.googleapis.com./private-object',
  ]) {
    const transaction = basicTransaction({ item: { canonicalUrl } });
    const result = await previewWith(transaction);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_request');
    assert.deepEqual(transaction.auditRows, []);
    assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_ID'), false);
  }
});

test('preview rejects synthesis questions above the 4096-byte database bound before persistence', async () => {
  const sourceItem = item({ canonicalUrl: null, title: null });
  const synthesis = {
    id: 'synthesis-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    title: 'Synthetic synthesis',
    currentVersion: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
  };
  const version = {
    id: 'synthesis-version-1',
    synthesisId: synthesis.id,
    version: 1,
    content: 'Selected conclusion',
    unresolvedQuestions: ['x'.repeat(4097)],
    confidenceBasisPoints: 5000,
    createdAt: now,
    createdBy: 'owner-1',
    sources: [],
  };
  const transaction = basicTransaction({
    item: sourceItem,
    transaction: {
      knowledgeItem: { findFirst: async () => sourceItem },
      knowledgeSynthesis: { findFirst: async () => synthesis },
      knowledgeSynthesisVersion: { findUnique: async () => version },
    },
  });
  const result = await previewWith(transaction, {
    includeTitle: false,
    includeSourceType: false,
    includeCanonicalUrl: false,
    snapshot: null,
    labelAssignmentIds: [],
    annotations: [],
    conversationTurnIds: [],
    syntheses: [{ synthesisId: synthesis.id, version: 1 }],
    sharerNote: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
  assert.deepEqual(transaction.auditRows, []);
});

test('preview rejects an existing synthesis with an empty unresolved question before persistence', async () => {
  const sourceItem = item({ canonicalUrl: null, title: null });
  const synthesis = {
    id: 'synthesis-empty-question',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    title: 'Synthetic synthesis',
    currentVersion: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
  };
  const transaction = basicTransaction({
    item: sourceItem,
    transaction: {
      knowledgeItem: { findFirst: async () => sourceItem },
      knowledgeSynthesis: { findFirst: async () => synthesis },
      knowledgeSynthesisVersion: {
        findUnique: async () => ({
          id: 'synthesis-empty-question-version',
          synthesisId: synthesis.id,
          version: 1,
          content: 'Selected conclusion',
          unresolvedQuestions: [''],
          confidenceBasisPoints: 5000,
          createdAt: now,
          createdBy: 'owner-1',
          sources: [],
        }),
      },
    },
  });
  const result = await previewWith(transaction, {
    includeTitle: false,
    includeSourceType: false,
    includeCanonicalUrl: false,
    snapshot: null,
    labelAssignmentIds: [],
    annotations: [],
    conversationTurnIds: [],
    syntheses: [{ synthesisId: synthesis.id, version: 1 }],
    sharerNote: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
  assert.deepEqual(transaction.auditRows, []);
});

test('project share preserves the canonical project-claim room policy without inventing a ProjectMember requirement', async () => {
  const destinationRoom = room({
    type: 'project',
    projectId: 'project-1',
  });
  const projectActor = { ...chatActor, projectIds: ['project-1'] };
  const transaction = basicTransaction({
    room: destinationRoom,
    transaction: {
      chatRoom: {
        findUnique: async () => destinationRoom,
        findFirst: async () => destinationRoom,
      },
      project: { findFirst: async () => ({ id: 'project-1' }) },
    },
  });
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).preview({
    actor,
    chatActor: projectActor,
    auditActor,
    shareId: '11111111-2222-4333-8444-123456789012',
    itemId: 'item-1',
    destinationRoomId: 'room-1',
    selection: titleSelection,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.snapshot.title, 'Selected title');
  assert.equal(transaction.auditRows.length, 1);
});

test('findIdempotent returns an exact stored result before live source checks and audits conflicts', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const existing = pendingShare(previewResult.value, {
    status: 'posted',
    chatMessageId: 'share-1',
    postedAt: now,
    version: 2,
    requestPayloadHash: 'c'.repeat(64),
  });
  const auditRows = [];
  const adapter = createPrismaKnowledgeShareAdapter(
    host({
      knowledgeShare: { findUnique: async () => existing },
      auditLog: {
        async create(input) {
          auditRows.push(input.data);
          return input.data;
        },
      },
    }),
  );
  const reused = await adapter.findIdempotent({
    actor,
    auditActor,
    requestKeyHash: 'a'.repeat(64),
    requestPayloadHash: 'c'.repeat(64),
  });
  assert.equal(reused.ok, true);
  assert.equal(reused.value.status, 'posted');
  assert.equal(reused.value.created, false);

  const conflict = await adapter.findIdempotent({
    actor,
    auditActor,
    requestKeyHash: 'a'.repeat(64),
    requestPayloadHash: 'd'.repeat(64),
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'idempotency_conflict');
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[0].metadata.resultCode, 'reused');
  assert.equal(auditRows[1].metadata.resultCode, undefined);
});

test('createPending reuses same actor/key/payload and audits conflicts without copying content', async () => {
  const resolvedTransaction = basicTransaction();
  const resolvedResult = await previewWith(resolvedTransaction);
  assert.equal(resolvedResult.ok, true);
  const existing = pendingShare(resolvedResult.value, {
    requestPayloadHash: 'c'.repeat(64),
  });
  const auditRows = [];
  const transaction = {
    knowledgeShare: {
      async findUnique() {
        return existing;
      },
    },
    auditLog: {
      async create(input) {
        auditRows.push(input.data);
        return input.data;
      },
    },
  };
  const adapter = createPrismaKnowledgeShareAdapter(host(transaction));
  const baseInput = {
    actor,
    chatActor,
    auditActor,
    itemId: 'item-1',
    destinationRoomId: 'room-1',
    selection: titleSelection,
    expectedBindingHash: resolvedResult.value.bindingHash,
    requestKeyHash: 'a'.repeat(64),
    requestPayloadHash: 'c'.repeat(64),
    shareId: 'share-new',
  };
  const reused = await adapter.createPending(baseInput);
  assert.equal(reused.ok, true);
  assert.equal(reused.value.created, false);
  assert.equal(reused.value.shareId, 'share-1');

  const conflict = await adapter.createPending({
    ...baseInput,
    requestPayloadHash: 'd'.repeat(64),
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'idempotency_conflict');
  assert.equal(auditRows.length, 2);
  for (const row of auditRows) {
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes('Selected title'), false);
    assert.equal(serialized.includes('a'.repeat(64)), false);
    assert.equal(row.action, 'knowledge_share_duplicate_detected');
  }
});

test('createPending returns a sanitized conflict when a preview share ID is rebound to another request key', async () => {
  const resolvedTransaction = basicTransaction();
  const resolvedResult = await previewWith(resolvedTransaction);
  assert.equal(resolvedResult.ok, true);
  const existing = pendingShare(resolvedResult.value, {
    id: '11111111-2222-4333-8444-123456789012',
    requestKeyHash: 'd'.repeat(64),
  });
  const auditRows = [];
  const transaction = {
    knowledgeShare: {
      async findUnique(input) {
        return 'id' in input.where ? existing : null;
      },
    },
    auditLog: {
      async create(input) {
        auditRows.push(input.data);
        return input.data;
      },
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).createPending({
    actor,
    chatActor,
    auditActor,
    itemId: 'item-1',
    destinationRoomId: 'room-1',
    selection: titleSelection,
    expectedBindingHash: resolvedResult.value.bindingHash,
    requestKeyHash: 'e'.repeat(64),
    requestPayloadHash: 'f'.repeat(64),
    shareId: existing.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'idempotency_conflict');
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'knowledge_share_duplicate_detected');
  assert.equal(JSON.stringify(auditRows[0]).includes('e'.repeat(64)), false);
});

test('postPending creates one generic text root and finalizes share/audit in the same serializable transaction', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const pending = pendingShare(previewResult.value);
  const events = [];
  let currentShare = pending;
  const transaction = basicTransaction({
    transaction: {
      knowledgeShare: {
        async findFirst() {
          return currentShare;
        },
        async update(input) {
          events.push(['share-update', input.data]);
          currentShare = {
            ...currentShare,
            chatMessageId: input.data.chatMessageId,
            status: input.data.status,
            failureCode: input.data.failureCode,
            postedAt: input.data.postedAt,
            version: currentShare.version + 1,
          };
          return currentShare;
        },
      },
      chatMessage: {
        async create(input) {
          events.push(['message-create', input.data]);
          return { ...input.data, createdAt: input.data.createdAt };
        },
      },
      auditLog: {
        async create(input) {
          events.push(['audit', input.data]);
          return input.data;
        },
      },
    },
  });
  const transactionCalls = [];
  const adapter = createPrismaKnowledgeShareAdapter(
    host(transaction, transactionCalls),
  );
  const result = await adapter.postPending({
    actor,
    chatActor,
    auditActor,
    shareId: pending.id,
    expectedBindingHash: previewResult.value.bindingHash,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(result.value.chatMessageId, pending.id);
  assert.deepEqual(
    events.map(([kind]) => kind),
    ['message-create', 'share-update', 'audit'],
  );
  assert.equal(events[0][1].id, pending.id);
  assert.equal(events[0][1].messageType, 'text');
  assert.equal(events[0][1].userId, chatActor.userId);
  assert.equal(events[0][1].body, 'Knowledge was shared.');
  assert.equal(events[0][1].parentMessageId, null);
  assert.equal(events[0][1].threadRootId, null);
  assert.equal(JSON.stringify(events[0][1]).includes('Selected title'), false);
  assert.equal(transactionCalls[0].isolationLevel, 'Serializable');
});

test('reconcile never creates a message and leaves an unbound pending result pending', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const pending = pendingShare(previewResult.value);
  let auditCount = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async () => pending,
      update: async () => {
        throw new Error('pending without an existing message must not update');
      },
    },
    chatMessage: {
      findFirst: async () => null,
      create: async () => {
        throw new Error('reconcile must not create a message');
      },
    },
    auditLog: {
      async create(input) {
        auditCount += 1;
        assert.equal(input.data.metadata.status, 'pending');
        return input.data;
      },
    },
    $queryRaw: async () => [],
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).reconcile({
    actor,
    chatActor,
    auditActor,
    shareId: pending.id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending');
  assert.equal(auditCount, 1);
});

test('reconcile finalizes only an existing exact generic root and does not create another message', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const pending = pendingShare(previewResult.value);
  let currentShare = pending;
  let createCalls = 0;
  let queryCalls = 0;
  const transaction = {
    knowledgeShare: {
      async findFirst() {
        return currentShare;
      },
      async update(input) {
        currentShare = {
          ...currentShare,
          status: 'posted',
          chatMessageId: input.data.chatMessageId,
          postedAt: input.data.postedAt,
          version: currentShare.version + 1,
        };
        return currentShare;
      },
    },
    chatMessage: {
      async create() {
        createCalls += 1;
      },
    },
    auditLog: { create: async (input) => input.data },
    $queryRaw: async (_query) => {
      queryCalls += 1;
      return queryCalls === 2 ? [{ id: pending.id, createdAt: now }] : [];
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).reconcile({
    actor,
    chatActor,
    auditActor,
    shareId: pending.id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(createCalls, 0);
});

test('reconcile audit reports failed and revoked terminal states exactly', async () => {
  for (const status of ['failed', 'revoked']) {
    const previewTransaction = basicTransaction();
    const previewResult = await previewWith(previewTransaction);
    assert.equal(previewResult.ok, true);
    const row = pendingShare(previewResult.value, {
      status,
      failureCode: status === 'failed' ? 'post_rejected' : null,
      failedAt: status === 'failed' ? now : null,
      revokedAt: status === 'revoked' ? now : null,
      revokedBy: status === 'revoked' ? actor.userId : null,
      version: 2,
    });
    const auditRows = [];
    const transaction = {
      knowledgeShare: { findFirst: async () => row },
      auditLog: {
        async create(input) {
          auditRows.push(input.data);
          return input.data;
        },
      },
      $queryRaw: async () => [],
    };
    const result = await createPrismaKnowledgeShareAdapter(
      host(transaction),
    ).reconcile({ actor, chatActor, auditActor, shareId: row.id });
    assert.equal(result.ok, true);
    assert.equal(result.value.status, status);
    assert.equal(auditRows[0].metadata.resultCode, status);
  }
});

test('revoke permits the sharer or source owner, preserves history, and hides outsiders', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const posted = pendingShare(previewResult.value, {
    status: 'posted',
    chatMessageId: 'share-1',
    postedAt: now,
    version: 2,
  });
  let updateData;
  const transaction = {
    knowledgeShare: {
      async findFirst(input) {
        assert.deepEqual(input.where, {
          id: posted.id,
          OR: [{ sharerUserId: 'owner-1' }, { sourceOwnerUserId: 'owner-1' }],
        });
        return posted;
      },
      async update(input) {
        updateData = input.data;
        return {
          ...posted,
          status: 'revoked',
          revokedAt: input.data.revokedAt,
          revokedBy: input.data.revokedBy,
          version: 3,
        };
      },
    },
    chatMessage: {
      update: async () => {
        throw new Error('revoke must preserve the Chat root/thread');
      },
      delete: async () => {
        throw new Error('revoke must not delete the Chat root/thread');
      },
    },
    knowledgeShareSnapshot: {
      update: async () => {
        throw new Error('revoke must preserve immutable snapshot content');
      },
      delete: async () => {
        throw new Error('revoke must preserve immutable snapshot content');
      },
    },
    auditLog: { create: async (input) => input.data },
    $queryRaw: async () => [],
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).revoke({ actor, auditActor, shareId: posted.id });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'revoked');
  assert.deepEqual(Object.keys(updateData).sort(), [
    'revokedAt',
    'revokedBy',
    'status',
    'updatedBy',
    'version',
  ]);
  assert.equal(updateData.status, 'revoked');
});

test('source owner can revoke a share created by another sharer while an outsider receives not found', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const posted = pendingShare(previewResult.value, {
    sourceOwnerUserId: 'source-owner',
    sharerUserId: 'delegated-sharer',
    status: 'posted',
    chatMessageId: 'share-1',
    postedAt: now,
    version: 2,
  });
  let current = posted;
  const transaction = {
    knowledgeShare: {
      async findFirst(input) {
        const allowed = input.where.OR?.some(
          (candidate) =>
            candidate.sharerUserId === 'source-owner' ||
            candidate.sourceOwnerUserId === 'source-owner',
        );
        return allowed ? current : null;
      },
      async update(input) {
        current = {
          ...current,
          status: 'revoked',
          revokedAt: input.data.revokedAt,
          revokedBy: input.data.revokedBy,
          version: 3,
        };
        return current;
      },
    },
    auditLog: { create: async (input) => input.data },
    $queryRaw: async () => [],
  };
  const adapter = createPrismaKnowledgeShareAdapter(host(transaction));
  const ownerResult = await adapter.revoke({
    actor: { ...actor, userId: 'source-owner' },
    auditActor,
    shareId: posted.id,
  });
  assert.equal(ownerResult.ok, true);
  assert.equal(ownerResult.value.status, 'revoked');

  const outsiderResult = await adapter.revoke({
    actor: { ...actor, userId: 'outsider' },
    auditActor,
    shareId: posted.id,
  });
  assert.equal(outsiderResult.ok, false);
  assert.equal(outsiderResult.error.code, 'not_found');
});

test('openSource requires both current room read ACL and current Knowledge visibility', async () => {
  const destinationRoom = room();
  const transaction = {
    knowledgeShare: {
      findFirst: async () => ({
        sourceKnowledgeItemId: 'item-1',
        destinationRoomId: destinationRoom.id,
      }),
    },
    chatRoom: {
      findUnique: async () => destinationRoom,
    },
    chatRoomMember: { findFirst: async () => null },
    knowledgeItem: {
      findFirst: async () => null,
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).openSource({ actor, chatActor, shareId: 'share-1' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
});

test('openSource preserves current project-claim room access without requiring a ProjectMember row', async () => {
  const destinationRoom = room({
    type: 'project',
    projectId: 'project-1',
  });
  const visibleItem = item();
  let knowledgeLookupCount = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async () => ({
        sourceKnowledgeItemId: 'item-1',
        destinationRoomId: destinationRoom.id,
      }),
    },
    chatRoom: {
      findUnique: async () => destinationRoom,
    },
    chatRoomMember: { findFirst: async () => null },
    project: {
      findFirst: async (query) => {
        assert.deepEqual(query.where, {
          id: 'project-1',
          deletedAt: null,
        });
        return { id: 'project-1' };
      },
    },
    knowledgeItem: {
      findFirst: async () => {
        knowledgeLookupCount += 1;
        return visibleItem;
      },
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).openSource({
    actor,
    chatActor: { ...chatActor, projectIds: ['project-1'] },
    shareId: 'share-1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.knowledgeItemId, visibleItem.id);
  assert.equal(knowledgeLookupCount, 1);
});

test('readRoomCard returns only the immutable selected snapshot for a current room viewer', async () => {
  const posted = postedCardShare();
  let shareReads = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async (query) => {
        shareReads += 1;
        if (query.select) {
          return {
            id: posted.id,
            status: posted.status,
            version: posted.version,
            selectionSchemaVersion: posted.selectionSchemaVersion,
            sourceKnowledgeItemId: posted.sourceKnowledgeItemId,
            destinationRoomId: posted.destinationRoomId,
          };
        }
        return posted;
      },
    },
    chatRoom: { findUnique: async () => room() },
    chatRoomMember: { findFirst: async () => null },
    knowledgeItem: { findFirst: async () => null },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).readRoomCard({ actor, chatActor, messageId: posted.chatMessageId });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(result.value.version, 2);
  assert.equal(result.value.canOpenSource, false);
  assert.equal(result.value.card.title, 'Selected title');
  assert.equal(result.value.card.canonicalUrl, 'https://example.test/selected');
  assert.deepEqual(result.value.card.labels, []);
  assert.deepEqual(result.value.card.annotations, []);
  assert.deepEqual(result.value.card.turns, []);
  assert.deepEqual(result.value.card.syntheses, []);
  assert.equal(shareReads, 2);
  assert.equal(
    JSON.stringify(result).includes('private-query-unselected-canary'),
    false,
  );
});

test('readRoomCard returns a content-free revoked placeholder without loading snapshot children', async () => {
  const revoked = postedCardShare({
    status: 'revoked',
    version: 3,
    revokedAt: now,
  });
  let shareReads = 0;
  let sourceReads = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async () => {
        shareReads += 1;
        return {
          id: revoked.id,
          status: revoked.status,
          version: revoked.version,
          selectionSchemaVersion: revoked.selectionSchemaVersion,
          sourceKnowledgeItemId: revoked.sourceKnowledgeItemId,
          destinationRoomId: revoked.destinationRoomId,
        };
      },
    },
    chatRoom: { findUnique: async () => room() },
    chatRoomMember: { findFirst: async () => null },
    knowledgeItem: {
      findFirst: async () => {
        sourceReads += 1;
        return item();
      },
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).readRoomCard({ actor, chatActor, messageId: revoked.chatMessageId });
  assert.deepEqual(result, {
    ok: true,
    value: {
      shareId: revoked.id,
      status: 'revoked',
      version: 3,
      schemaVersion: 1,
      card: null,
      canOpenSource: false,
    },
  });
  assert.equal(shareReads, 1);
  assert.equal(sourceReads, 0);
});

test('readRoomCard fails closed after a room becomes external-facing', async () => {
  const posted = postedCardShare();
  let detailReads = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async (query) => {
        if (query.select) {
          return {
            id: posted.id,
            status: posted.status,
            version: posted.version,
            selectionSchemaVersion: posted.selectionSchemaVersion,
            sourceKnowledgeItemId: posted.sourceKnowledgeItemId,
            destinationRoomId: posted.destinationRoomId,
          };
        }
        detailReads += 1;
        return posted;
      },
    },
    chatRoom: {
      findUnique: async () => room({ allowExternalUsers: true }),
    },
    chatRoomMember: { findFirst: async () => ({ role: 'member' }) },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).readRoomCard({ actor, chatActor, messageId: posted.chatMessageId });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
  assert.equal(detailReads, 0);
});

test('readRoomCard preserves current project-claim room access without requiring a ProjectMember row', async () => {
  const posted = postedCardShare({ destinationRoomId: 'project-room' });
  let detailReads = 0;
  let sourceReads = 0;
  const transaction = {
    knowledgeShare: {
      findFirst: async (query) => {
        if (query.select) {
          return {
            id: posted.id,
            status: posted.status,
            version: posted.version,
            selectionSchemaVersion: posted.selectionSchemaVersion,
            sourceKnowledgeItemId: posted.sourceKnowledgeItemId,
            destinationRoomId: posted.destinationRoomId,
          };
        }
        detailReads += 1;
        return posted;
      },
    },
    chatRoom: {
      findUnique: async () =>
        room({
          id: 'project-room',
          type: 'project',
          projectId: 'project-1',
        }),
    },
    chatRoomMember: { findFirst: async () => null },
    project: { findFirst: async () => ({ id: 'project-1' }) },
    knowledgeItem: {
      findFirst: async () => {
        sourceReads += 1;
        return item();
      },
    },
  };
  const result = await createPrismaKnowledgeShareAdapter(
    host(transaction),
  ).readRoomCard({
    actor,
    chatActor: { ...chatActor, projectIds: ['project-1'] },
    messageId: posted.chatMessageId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.card.title, 'Selected title');
  assert.equal(detailReads, 1);
  assert.equal(sourceReads, 1);
});

test('serializable mutations retry bounded transaction conflicts and propagate permanent failures', async () => {
  const previewTransaction = basicTransaction();
  const previewResult = await previewWith(previewTransaction);
  assert.equal(previewResult.ok, true);
  const pending = pendingShare(previewResult.value);
  let attempts = 0;
  const retrying = createPrismaKnowledgeShareAdapter({
    async $transaction(operation, options) {
      attempts += 1;
      assert.equal(options.isolationLevel, 'Serializable');
      if (attempts < 3) throw { code: 'P2034' };
      return operation({
        knowledgeShare: { findFirst: async () => pending },
        chatMessage: { findFirst: async () => null },
        auditLog: { create: async (input) => input.data },
        $queryRaw: async () => [],
      });
    },
  });
  const result = await retrying.reconcile({
    actor,
    chatActor,
    auditActor,
    shareId: pending.id,
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 3);

  const permanent = new Error('permanent');
  const noRetry = createPrismaKnowledgeShareAdapter({
    async $transaction() {
      throw permanent;
    },
  });
  await assert.rejects(
    () =>
      noRetry.reconcile({
        actor,
        chatActor,
        auditActor,
        shareId: pending.id,
      }),
    permanent,
  );
});
