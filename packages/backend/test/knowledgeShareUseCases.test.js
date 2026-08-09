import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeShareTokenCodec } from '../dist/application/knowledge/knowledgeShareToken.js';
import {
  createKnowledgeShareUseCases,
  hashKnowledgeShareRequestKey,
} from '../dist/application/knowledge/knowledgeShareUseCases.js';

const actor = {
  userId: 'owner-synthetic',
  organizationId: 'org-synthetic',
  groupAccountIds: ['knowledge-group-synthetic'],
};
const chatActor = {
  canonicalUserId: actor.userId,
  userId: actor.userId,
  roles: ['user'],
  projectIds: ['project-synthetic'],
  groupIds: ['chat-group-synthetic'],
  groupAccountIds: [...actor.groupAccountIds],
};
const auditActor = {
  requestId: 'request-synthetic',
  source: 'agent',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
  authScopes: ['knowledge:write', 'chat:write'],
};
const itemId = 'item-synthetic';
const destinationRoomId = 'room-synthetic';
const bindingHash = 'b'.repeat(64);
const createdAt = new Date('2026-08-10T00:00:00.000Z');

function selection(overrides = {}) {
  return {
    includeTitle: true,
    includeSourceType: true,
    includeCanonicalUrl: false,
    snapshot: {
      snapshotId: 'snapshot-synthetic',
      includeProvenance: true,
      includeExcerpt: true,
    },
    labelAssignmentIds: ['assignment-selected'],
    annotations: [{ annotationId: 'annotation-selected', revision: 2 }],
    conversationTurnIds: ['turn-selected'],
    syntheses: [{ synthesisId: 'synthesis-selected', version: 3 }],
    sharerNote: 'Selected note',
    ...overrides,
  };
}

function card() {
  return {
    schemaVersion: 1,
    title: 'Selected title',
    sourceType: 'manual_note',
    snapshot: {
      sourceSnapshotId: 'snapshot-synthetic',
      version: 4,
      sha256: 'c'.repeat(64),
      excerpt: 'Selected excerpt',
    },
    sharerNote: 'Selected note',
    labels: [
      {
        sourceAssignmentId: 'assignment-selected',
        sourceLabelId: 'label-selected',
        sourceLabelVersion: 5,
        displayName: 'Selected label',
        ordinal: 0,
        contentHash: 'd'.repeat(64),
      },
    ],
    annotations: [
      {
        sourceAnnotationId: 'annotation-selected',
        sourceRevisionId: 'annotation-revision-selected',
        revision: 2,
        kind: 'quote',
        origin: 'user',
        content: 'Selected annotation',
        ordinal: 0,
        contentHash: 'e'.repeat(64),
      },
    ],
    turns: [
      {
        sourceConversationId: 'conversation-selected',
        sourceConversationVersion: 2,
        sourceTurnId: 'turn-selected',
        role: 'assistant',
        origin: 'ai',
        content: 'Selected AI turn',
        name: null,
        occurredAt: new Date('2026-08-09T23:00:00.000Z'),
        ordinal: 0,
        contentHash: 'f'.repeat(64),
      },
    ],
    syntheses: [
      {
        sourceSynthesisId: 'synthesis-selected',
        sourceSynthesisVersionId: 'synthesis-version-selected',
        version: 3,
        title: 'Selected synthesis',
        content: 'Selected conclusion',
        confidenceBasisPoints: 8000,
        unresolvedQuestions: ['Selected unresolved question'],
        ordinal: 0,
        contentHash: '1'.repeat(64),
      },
    ],
    selectedCategories: [
      'title',
      'source_type',
      'snapshot_provenance',
      'snapshot_excerpt',
      'label',
      'annotation',
      'conversation_turn',
      'synthesis',
      'sharer_note',
    ],
    omittedCategories: ['canonical_url'],
    contentHash: '2'.repeat(64),
  };
}

function resolved(overrides = {}) {
  return {
    sourceItemId: itemId,
    sourceOwnerUserId: actor.userId,
    sourceItemVersion: 7,
    sourceItemUpdatedAt: new Date('2026-08-09T22:00:00.000Z'),
    destinationRoomId,
    destinationRoomName: 'Synthetic room',
    destinationRoomType: 'private_group',
    snapshot: card(),
    selectionHash: '3'.repeat(64),
    bindingHash,
    ...overrides,
  };
}

function statusRecord(overrides = {}) {
  return {
    shareId: '11111111-2222-4333-8444-123456789012',
    status: 'pending',
    version: 1,
    chatMessageId: null,
    failureCode: null,
    createdAt,
    postedAt: null,
    failedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function previewBody(overrides = {}) {
  return {
    destinationRoomId,
    selection: selection(),
    ...overrides,
  };
}

function createHarness() {
  const state = {
    previewInputs: [],
    resolveInputs: [],
    replayInputs: [],
    pendingInputs: [],
    postInputs: [],
    notifyInputs: [],
    reconcileInputs: [],
    statusInputs: [],
    revokeInputs: [],
    openInputs: [],
    requests: new Map(),
    shares: new Map(),
    resolved: resolved(),
    previewResult: null,
    resolveResult: null,
    postResult: null,
    postThrows: false,
    notifyThrows: false,
    now: createdAt,
  };

  const store = {
    async preview(input) {
      state.previewInputs.push(structuredClone(input));
      return state.previewResult ?? { ok: true, value: state.resolved };
    },
    async resolveForCommit(input) {
      state.resolveInputs.push(structuredClone(input));
      return state.resolveResult ?? { ok: true, value: state.resolved };
    },
    async findIdempotent(input) {
      state.replayInputs.push(structuredClone(input));
      const existing = state.requests.get(input.requestKeyHash);
      if (!existing) return { ok: true, value: null };
      if (existing.requestPayloadHash !== input.requestPayloadHash) {
        return {
          ok: false,
          error: {
            status: 409,
            code: 'idempotency_conflict',
            message: 'must not be exposed',
          },
        };
      }
      return { ok: true, value: { ...existing.record, created: false } };
    },
    async createPending(input) {
      state.pendingInputs.push(structuredClone(input));
      const existing = state.requests.get(input.requestKeyHash);
      if (existing) {
        if (existing.requestPayloadHash !== input.requestPayloadHash) {
          return {
            ok: false,
            error: {
              status: 409,
              code: 'idempotency_conflict',
              message: 'must not be exposed',
            },
          };
        }
        return { ok: true, value: { ...existing.record, created: false } };
      }
      const record = statusRecord({ shareId: input.shareId });
      state.requests.set(input.requestKeyHash, {
        requestPayloadHash: input.requestPayloadHash,
        record,
      });
      state.shares.set(record.shareId, record);
      return { ok: true, value: { ...record, created: true } };
    },
    async findStatus(input) {
      state.statusInputs.push(structuredClone(input));
      const record = state.shares.get(input.shareId);
      return record
        ? { ok: true, value: record }
        : {
            ok: false,
            error: { status: 404, code: 'not_found', message: 'hidden' },
          };
    },
    async revoke(input) {
      state.revokeInputs.push(structuredClone(input));
      const existing = state.shares.get(input.shareId);
      if (!existing) {
        return {
          ok: false,
          error: { status: 404, code: 'not_found', message: 'hidden' },
        };
      }
      const revoked = statusRecord({
        ...existing,
        status: 'revoked',
        version: existing.version + 1,
        revokedAt: new Date('2026-08-10T00:05:00.000Z'),
      });
      state.shares.set(input.shareId, revoked);
      return { ok: true, value: revoked };
    },
    async openSource(input) {
      state.openInputs.push(structuredClone(input));
      return { ok: true, value: { knowledgeItemId: itemId } };
    },
  };

  const chatIntegration = {
    async postPending(input) {
      state.postInputs.push(structuredClone(input));
      if (state.postThrows) throw new Error('private downstream detail');
      if (state.postResult) return state.postResult;
      const posted = statusRecord({
        shareId: input.shareId,
        status: 'posted',
        version: 2,
        chatMessageId: 'message-synthetic',
        postedAt: new Date('2026-08-10T00:01:00.000Z'),
      });
      state.shares.set(input.shareId, posted);
      for (const request of state.requests.values()) {
        if (request.record.shareId === input.shareId) request.record = posted;
      }
      return { ok: true, value: posted };
    },
    async notifyPosted(input) {
      state.notifyInputs.push(structuredClone(input));
      if (state.notifyThrows) throw new Error('private notification detail');
    },
    async reconcile(input) {
      state.reconcileInputs.push(structuredClone(input));
      return {
        ok: true,
        value:
          state.shares.get(input.shareId) ??
          statusRecord({ shareId: input.shareId }),
      };
    },
  };

  const tokenCodec = createKnowledgeShareTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'knowledge-share-use-case-test-secret-00000001',
    },
    now: () => state.now,
    randomId: () => '11111111-2222-4333-8444-123456789012',
  });
  const service = createKnowledgeShareUseCases({
    store,
    chatIntegration,
    tokenCodec,
  });
  return { state, service };
}

async function preview(harness, body = previewBody()) {
  const result = await harness.service.preview({
    actor,
    chatActor,
    auditActor,
    itemId,
    body,
  });
  assert.equal(result.ok, true);
  return result.value;
}

function commitBody(previewValue, overrides = {}) {
  return {
    destinationRoomId,
    selection: selection(),
    previewToken: previewValue.previewToken,
    requestKey: 'request-key-synthetic',
    confirmed: true,
    ...overrides,
  };
}

async function commit(harness, previewValue, overrides = {}) {
  return harness.service.commit({
    actor,
    chatActor,
    auditActor,
    itemId,
    body: commitBody(previewValue, overrides),
  });
}

test('preview validates source and room, issues an exact token and exposes only selected card fields', async () => {
  const harness = createHarness();
  const value = await preview(harness);

  assert.equal(harness.state.previewInputs.length, 1);
  assert.equal(
    harness.state.previewInputs[0].shareId,
    '11111111-2222-4333-8444-123456789012',
  );
  assert.equal(harness.state.previewInputs[0].auditActor.userId, actor.userId);
  assert.equal(value.destinationRoom.name, 'Synthetic room');
  assert.equal(value.requiresConfirmation, true);
  assert.equal(value.expiresAt, '2026-08-10T00:10:00.000Z');
  assert.deepEqual(value.card.labels, [
    { displayName: 'Selected label', ordinal: 0 },
  ]);
  assert.equal(value.card.turns[0].content, 'Selected AI turn');

  const serialized = JSON.stringify(value);
  for (const internalValue of [
    'item-synthetic',
    'snapshot-synthetic',
    'assignment-selected',
    'label-selected',
    'annotation-selected',
    'annotation-revision-selected',
    'conversation-selected',
    'turn-selected',
    'synthesis-selected',
    'synthesis-version-selected',
    card().contentHash,
  ]) {
    assert.equal(serialized.includes(internalValue), false);
  }
});

test('preview exposes snapshot provenance and excerpt only when each field is selected', async () => {
  const excerptOnly = createHarness();
  excerptOnly.state.resolved = resolved({
    snapshot: {
      ...card(),
      selectedCategories: ['snapshot_excerpt'],
      omittedCategories: [
        'title',
        'source_type',
        'canonical_url',
        'snapshot_provenance',
        'label',
        'annotation',
        'conversation_turn',
        'synthesis',
        'sharer_note',
      ],
    },
  });
  const excerptValue = await preview(excerptOnly);
  assert.deepEqual(excerptValue.card.snapshot, {
    excerpt: 'Selected excerpt',
  });

  const provenanceOnly = createHarness();
  provenanceOnly.state.resolved = resolved({
    snapshot: {
      ...card(),
      selectedCategories: ['snapshot_provenance'],
      omittedCategories: [
        'title',
        'source_type',
        'canonical_url',
        'snapshot_excerpt',
        'label',
        'annotation',
        'conversation_turn',
        'synthesis',
        'sharer_note',
      ],
    },
  });
  const provenanceValue = await preview(provenanceOnly);
  assert.deepEqual(provenanceValue.card.snapshot, {
    version: 4,
    sha256: 'c'.repeat(64),
  });
});

test('commit requires explicit confirmation, verifies the exact preview and posts a pending share once', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);

  const notConfirmed = await commit(harness, previewValue, {
    confirmed: false,
  });
  assert.deepEqual(notConfirmed, {
    ok: false,
    statusCode: 400,
    code: 'invalid_request',
    message: 'Invalid request',
  });
  assert.equal(harness.state.pendingInputs.length, 0);

  const result = await commit(harness, previewValue);
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(result.value.created, true);
  assert.equal(result.value.reused, false);
  assert.equal(result.value.resultUnknown, false);
  assert.equal(harness.state.pendingInputs.length, 1);
  assert.equal(harness.state.postInputs.length, 1);
  assert.equal(harness.state.notifyInputs.length, 1);
  assert.equal(
    harness.state.pendingInputs[0].shareId,
    harness.state.previewInputs[0].shareId,
  );
  assert.equal(harness.state.pendingInputs[0].expectedBindingHash, bindingHash);
  assert.equal(harness.state.postInputs[0].expectedBindingHash, bindingHash);
  assert.equal(harness.state.notifyInputs[0].chatActor.userId, actor.userId);
});

test('request key hashing is actor scoped, deterministic and opaque', () => {
  const rawKey = 'private-request-key-canary';
  const hash = hashKnowledgeShareRequestKey(actor, rawKey);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(rawKey), false);
  assert.equal(hash, hashKnowledgeShareRequestKey(actor, rawKey));
  assert.notEqual(
    hash,
    hashKnowledgeShareRequestKey({ ...actor, userId: 'other-owner' }, rawKey),
  );
  assert.notEqual(hash, hashKnowledgeShareRequestKey(actor, `${rawKey}-2`));
});

test('notification failure after a committed post does not roll back the posted share', async () => {
  const harness = createHarness();
  harness.state.notifyThrows = true;
  const previewValue = await preview(harness);
  const result = await commit(harness, previewValue);
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(result.value.resultUnknown, false);
  assert.equal(harness.state.notifyInputs.length, 1);
});

test('same key and payload reuses the existing share without reposting', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const first = await commit(harness, previewValue);
  const second = await commit(harness, previewValue);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.value.shareId, first.value.shareId);
  assert.equal(second.value.created, false);
  assert.equal(second.value.reused, true);
  assert.equal(harness.state.postInputs.length, 1);
  assert.equal(harness.state.notifyInputs.length, 1);
});

test('same key and payload replays a committed result before token expiry, stale source, or current ACL checks', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const first = await commit(harness, previewValue);
  assert.equal(first.ok, true);

  harness.state.now = new Date('2026-08-10T00:11:00.000Z');
  harness.state.resolveResult = {
    ok: false,
    error: { status: 404, code: 'not_found', message: 'current ACL lost' },
  };
  const replay = await commit(harness, previewValue);

  assert.equal(replay.ok, true);
  assert.equal(replay.value.shareId, first.value.shareId);
  assert.equal(replay.value.status, 'posted');
  assert.equal(replay.value.created, false);
  assert.equal(replay.value.reused, true);
  assert.equal(harness.state.resolveInputs.length, 1);
  assert.equal(harness.state.replayInputs.length, 2);
  assert.equal(harness.state.postInputs.length, 1);
});

test('same key with a different exact payload returns a sanitized conflict without posting', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  assert.equal((await commit(harness, previewValue)).ok, true);

  harness.state.resolved = resolved({ bindingHash: '9'.repeat(64) });
  const secondPreview = await preview(harness, {
    destinationRoomId,
    selection: selection({ includeCanonicalUrl: true }),
  });
  const conflict = await commit(harness, secondPreview, {
    selection: selection({ includeCanonicalUrl: true }),
  });

  assert.deepEqual(conflict, {
    ok: false,
    statusCode: 409,
    code: 'idempotency_conflict',
    message: 'Idempotency conflict',
  });
  assert.equal(harness.state.postInputs.length, 1);
  assert.equal(JSON.stringify(conflict).includes('must not be exposed'), false);
});

test('an unknown post exception leaves the new share pending and exposes no downstream detail', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  harness.state.postThrows = true;

  const result = await commit(harness, previewValue);

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending');
  assert.equal(result.value.resultUnknown, true);
  assert.equal(result.value.chatMessageId, null);
  assert.equal(
    JSON.stringify(result).includes('private downstream detail'),
    false,
  );
});

test('a deterministic post failure is returned through the sanitized port contract', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  harness.state.postResult = {
    ok: false,
    error: {
      status: 502,
      code: 'share_post_failed',
      message: 'provider private failure',
    },
  };

  const result = await commit(harness, previewValue);

  assert.deepEqual(result, {
    ok: false,
    statusCode: 502,
    code: 'share_post_failed',
    message: 'Share post failed',
  });
  assert.equal(
    JSON.stringify(result).includes('provider private failure'),
    false,
  );
});

test('commit rejects stale, actor-mismatched and tampered preview tokens', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  harness.state.resolved = resolved({ bindingHash: '8'.repeat(64) });

  const stale = await commit(harness, previewValue);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'stale_preview');
  assert.equal(stale.statusCode, 409);
  assert.equal(harness.state.pendingInputs.length, 0);

  harness.state.resolved = resolved();
  const tampered = await commit(harness, previewValue, {
    previewToken: `${previewValue.previewToken}x`,
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'preview_token_invalid');

  const otherActor = { ...actor, userId: 'other-owner' };
  const actorMismatch = await harness.service.commit({
    actor: otherActor,
    chatActor: {
      ...chatActor,
      canonicalUserId: otherActor.userId,
      userId: otherActor.userId,
    },
    auditActor,
    itemId,
    body: commitBody(previewValue),
  });
  assert.equal(actorMismatch.ok, false);
  assert.equal(actorMismatch.code, 'preview_token_invalid');
});

test('strict normalization rejects unknown keys, duplicates, empty selections, controls and limits before store access', async () => {
  const invalidBodies = [
    { ...previewBody(), unknown: true },
    previewBody({ selection: { ...selection(), unknown: true } }),
    previewBody({
      selection: selection({
        snapshot: { ...selection().snapshot, unknown: true },
      }),
    }),
    previewBody({
      selection: selection({
        labelAssignmentIds: ['duplicate', 'duplicate'],
      }),
    }),
    previewBody({
      selection: selection({
        annotations: [
          { annotationId: 'duplicate', revision: 1 },
          { annotationId: 'duplicate', revision: 1 },
        ],
      }),
    }),
    previewBody({
      selection: selection({
        conversationTurnIds: ['duplicate', 'duplicate'],
      }),
    }),
    previewBody({
      selection: selection({
        syntheses: [
          { synthesisId: 'duplicate', version: 1 },
          { synthesisId: 'duplicate', version: 1 },
        ],
      }),
    }),
    previewBody({
      selection: selection({
        snapshot: {
          snapshotId: 'snapshot',
          includeProvenance: false,
          includeExcerpt: false,
        },
      }),
    }),
    previewBody({
      selection: selection({
        includeTitle: false,
        includeSourceType: false,
        includeCanonicalUrl: false,
        snapshot: null,
        labelAssignmentIds: [],
        annotations: [],
        conversationTurnIds: [],
        syntheses: [],
        sharerNote: null,
      }),
    }),
    previewBody({ destinationRoomId: 'room\ncontrol' }),
    previewBody({ selection: selection({ sharerNote: 'note\u202ewarning' }) }),
    previewBody({
      selection: selection({ sharerNote: 'x'.repeat(4097) }),
    }),
    previewBody({
      selection: selection({
        labelAssignmentIds: Array.from(
          { length: 21 },
          (_, index) => `l-${index}`,
        ),
      }),
    }),
  ];

  for (const body of invalidBodies) {
    const harness = createHarness();
    const result = await harness.service.preview({
      actor,
      chatActor,
      auditActor,
      itemId,
      body,
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 400,
      code: 'invalid_request',
      message: 'Invalid request',
    });
    assert.equal(harness.state.previewInputs.length, 0);
  }
});

test('commit rejects unknown keys, control characters and oversized request keys before mutation', async () => {
  const invalidOverrides = [
    { unknown: true },
    { requestKey: 'key\ncontrol' },
    { requestKey: 'k'.repeat(201) },
    { requestKey: ' trailing ' },
  ];

  for (const overrides of invalidOverrides) {
    const harness = createHarness();
    const previewValue = await preview(harness);
    const result = await commit(harness, previewValue, overrides);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_request');
    assert.equal(harness.state.pendingInputs.length, 0);
  }
});

test('raw request keys do not cross the persistence or integration ports', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const rawKey = 'raw-private-request-key-canary';
  const result = await commit(harness, previewValue, { requestKey: rawKey });

  assert.equal(result.ok, true);
  assert.equal(
    JSON.stringify(harness.state.pendingInputs).includes(rawKey),
    false,
  );
  assert.equal(
    JSON.stringify(harness.state.postInputs).includes(rawKey),
    false,
  );
  assert.match(harness.state.pendingInputs[0].requestKeyHash, /^[a-f0-9]{64}$/);
  assert.match(
    harness.state.pendingInputs[0].requestPayloadHash,
    /^[a-f0-9]{64}$/,
  );
});

test('missing principal or a mismatched Chat actor fails closed without port access', async () => {
  for (const context of [
    {
      actor: { ...actor, userId: '' },
      chatActor: { ...chatActor, canonicalUserId: '', userId: '' },
    },
    { actor, chatActor: { ...chatActor, canonicalUserId: 'other-owner' } },
    { actor, chatActor: { ...chatActor, roles: ['user', 'user'] } },
  ]) {
    const harness = createHarness();
    const result = await harness.service.preview({
      ...context,
      auditActor,
      itemId,
      body: previewBody(),
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 404,
      code: 'not_found',
      message: 'Not found',
    });
    assert.equal(harness.state.previewInputs.length, 0);
  }
});

test('canonical Knowledge identity may use a distinct server-resolved Chat identity', async () => {
  const harness = createHarness();
  const result = await harness.service.preview({
    actor,
    chatActor: { ...chatActor, userId: 'legacy-chat-owner' },
    auditActor,
    itemId,
    body: previewBody(),
  });
  assert.equal(result.ok, true);
  assert.equal(
    harness.state.previewInputs[0].chatActor.canonicalUserId,
    actor.userId,
  );
  assert.equal(
    harness.state.previewInputs[0].chatActor.userId,
    'legacy-chat-owner',
  );
});

test('status, revoke and source-open delegate through bounded fail-closed ports', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const committed = await commit(harness, previewValue);
  const shareId = committed.value.shareId;

  const status = await harness.service.status({ actor, chatActor, shareId });
  assert.equal(status.ok, true);
  assert.equal(status.value.status, 'posted');

  const source = await harness.service.openSource({
    actor,
    chatActor,
    shareId,
  });
  assert.deepEqual(source, {
    ok: true,
    value: { knowledgeItemId: itemId },
  });

  const revoked = await harness.service.revoke({
    actor,
    auditActor,
    shareId,
  });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.value.status, 'revoked');
  assert.equal(harness.state.revokeInputs[0].auditActor.userId, actor.userId);

  const invalid = await harness.service.status({
    actor,
    chatActor,
    shareId: 'share\u202ebad',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid_request');
});

test('reconcile invokes only the read-only reconciliation port and never reposts', async () => {
  const harness = createHarness();
  const shareId = '11111111-2222-4333-8444-123456789012';
  harness.state.shares.set(shareId, statusRecord({ shareId }));

  const result = await harness.service.reconcile({
    actor,
    chatActor,
    auditActor,
    shareId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'pending');
  assert.equal(harness.state.reconcileInputs.length, 1);
  assert.equal(harness.state.postInputs.length, 0);
  assert.equal(harness.state.pendingInputs.length, 0);
  assert.equal(
    harness.state.reconcileInputs[0].auditActor.userId,
    actor.userId,
  );
});

test('reconcile retries only the idempotent notification effect for an already posted share', async () => {
  const harness = createHarness();
  const shareId = '11111111-2222-4333-8444-123456789012';
  harness.state.shares.set(
    shareId,
    statusRecord({
      shareId,
      status: 'posted',
      version: 2,
      chatMessageId: shareId,
      postedAt: createdAt,
    }),
  );

  const result = await harness.service.reconcile({
    actor,
    chatActor,
    auditActor,
    shareId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'posted');
  assert.equal(harness.state.postInputs.length, 0);
  assert.equal(harness.state.notifyInputs.length, 1);
});

test('port failures are normalized and never expose adapter messages', async () => {
  const harness = createHarness();
  harness.state.previewResult = {
    ok: false,
    error: {
      status: 404,
      code: 'not_found',
      message: 'private source identifier',
    },
  };

  const result = await harness.service.preview({
    actor,
    chatActor,
    auditActor,
    itemId,
    body: previewBody(),
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  });
  assert.equal(
    JSON.stringify(result).includes('private source identifier'),
    false,
  );
});
