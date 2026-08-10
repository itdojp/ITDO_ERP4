import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeThreadPromotionTokenCodec } from '../dist/application/knowledge/knowledgeThreadPromotionToken.js';
import {
  createKnowledgeThreadPromotionUseCases,
  hashKnowledgeThreadPromotionRequestKey,
} from '../dist/application/knowledge/knowledgeThreadPromotionUseCases.js';

const actor = {
  userId: 'knowledge-user-synthetic',
  organizationId: 'organization-synthetic',
  groupAccountIds: ['organization-group-a', 'organization-group-b'],
  chat: {
    userId: 'chat-user-synthetic',
    roles: ['user'],
    projectIds: ['project-synthetic'],
    groupIds: ['chat-group-synthetic'],
    groupAccountIds: ['organization-group-a', 'organization-group-b'],
  },
};
const auditActor = {
  requestId: 'request-synthetic',
  source: 'agent',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
  authScopes: ['chat:read', 'knowledge:write'],
};
const rootMessageId = 'chat-root-synthetic';
const promotionId = '11111111-2222-4333-8444-123456789012';
const bindingHash = 'a'.repeat(64);
const createdAt = new Date('2026-08-10T06:00:00.000Z');

function personalRequest(overrides = {}) {
  return {
    selectedReplyMessageIds: ['reply-selected-2', 'reply-selected-1'],
    includeSharedCard: true,
    destination: {
      scope: 'personal',
      organizationGroupAccountIds: [],
    },
    synthesis: {
      title: 'Explicit synthesis',
      content: 'Only the explicitly selected replies are synthesized.',
      confidenceBasisPoints: 7500,
      unresolvedQuestions: ['What remains unresolved?'],
    },
    ...overrides,
  };
}

function selectedCard() {
  return {
    schemaVersion: 1,
    shareVersion: 3,
    title: 'Selected share title',
    sourceType: 'manual',
    snapshot: {
      version: 2,
      sha256: 'b'.repeat(64),
      excerpt: 'Selected excerpt',
    },
    sharerNote: 'Selected note',
    labels: [{ displayName: 'Selected label', ordinal: 0 }],
    annotations: [
      {
        revision: 2,
        kind: 'quote',
        origin: 'user',
        content: 'Selected annotation',
        ordinal: 0,
      },
    ],
    turns: [
      {
        role: 'assistant',
        origin: 'ai',
        content: 'Selected AI turn',
        name: null,
        occurredAt: new Date('2026-08-10T05:30:00.000Z'),
        ordinal: 0,
      },
    ],
    syntheses: [
      {
        version: 1,
        title: 'Selected conclusion',
        content: 'Selected synthesis content',
        confidenceBasisPoints: 8000,
        unresolvedQuestions: [],
        ordinal: 0,
      },
    ],
    selectedCategories: ['title', 'annotation', 'conversation_turn'],
  };
}

function resolved(request = personalRequest(), overrides = {}) {
  return {
    promotionId,
    rootMessageId,
    sourceRoomName: 'Synthetic room',
    sourceRoomType: 'private_group',
    sourceShareVersion: 3,
    sourceShareContentHash: 'c'.repeat(64),
    threadReplyCount: 4,
    selectedMessages: [
      {
        sourceMessageId: request.selectedReplyMessageIds[0],
        sourceActivitySequence: 102n,
        ordinal: 0,
        content: 'Second reply selected first',
        contentHash: 'd'.repeat(64),
        createdAt: new Date('2026-08-10T05:40:00.000Z'),
        authorCategory: 'user',
      },
      {
        sourceMessageId: request.selectedReplyMessageIds[1],
        sourceActivitySequence: 101n,
        ordinal: 1,
        content: 'First reply selected second',
        contentHash: 'e'.repeat(64),
        createdAt: new Date('2026-08-10T05:35:00.000Z'),
        authorCategory: 'user',
      },
    ],
    selectedShareCard: request.includeSharedCard ? selectedCard() : null,
    destination: structuredClone(request.destination),
    bindingHash,
    ...overrides,
  };
}

function commitRecord(overrides = {}) {
  return {
    promotionId,
    synthesisId: 'synthesis-created',
    synthesisVersionId: 'synthesis-version-created',
    synthesisVersion: 1,
    scope: 'personal',
    selectedMessageCount: 2,
    includesSharedCard: true,
    createdAt,
    created: true,
    ...overrides,
  };
}

function createHarness() {
  const state = {
    previewInputs: [],
    resolveInputs: [],
    replayInputs: [],
    commitInputs: [],
    requestLedger: new Map(),
    previewResult: null,
    resolveResult: null,
    commitResult: null,
    resolvedRequest: personalRequest(),
  };
  const store = {
    async preview(input) {
      state.previewInputs.push(structuredClone(input));
      return (
        state.previewResult ?? {
          ok: true,
          value: resolved(input.request),
        }
      );
    },
    async resolveForCommit(input) {
      state.resolveInputs.push(structuredClone(input));
      return (
        state.resolveResult ?? {
          ok: true,
          value: resolved(input.request),
        }
      );
    },
    async findIdempotent(input) {
      state.replayInputs.push(structuredClone(input));
      const existing = state.requestLedger.get(input.requestKeyHash);
      if (!existing) return { ok: true, value: null };
      if (existing.requestPayloadHash !== input.requestPayloadHash) {
        return {
          ok: false,
          error: {
            status: 409,
            code: 'idempotency_conflict',
            message: 'raw private conflict detail must not escape',
          },
        };
      }
      return {
        ok: true,
        value: { ...existing.record, created: false },
      };
    },
    async commit(input) {
      state.commitInputs.push(structuredClone(input));
      if (state.commitResult) return state.commitResult;
      const existing = state.requestLedger.get(input.requestKeyHash);
      if (existing) {
        if (existing.requestPayloadHash !== input.requestPayloadHash) {
          return {
            ok: false,
            error: {
              status: 409,
              code: 'idempotency_conflict',
              message: 'hidden conflict detail',
            },
          };
        }
        return { ok: true, value: { ...existing.record, created: false } };
      }
      const record = commitRecord({
        promotionId: input.promotionId,
        scope: input.request.destination.scope,
        selectedMessageCount: input.request.selectedReplyMessageIds.length,
        includesSharedCard: input.request.includeSharedCard,
      });
      state.requestLedger.set(input.requestKeyHash, {
        requestPayloadHash: input.requestPayloadHash,
        record,
      });
      return { ok: true, value: record };
    },
  };
  const tokenCodec = createKnowledgeThreadPromotionTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'thread-promotion-usecase-test-secret-000001',
    },
    now: () => createdAt,
    randomId: () => promotionId,
  });
  return {
    state,
    service: createKnowledgeThreadPromotionUseCases({ store, tokenCodec }),
  };
}

async function preview(harness, request = personalRequest()) {
  return harness.service.preview({
    actor,
    auditActor,
    rootMessageId,
    body: request,
  });
}

function commitBody(
  previewResult,
  request = personalRequest(),
  overrides = {},
) {
  return {
    ...request,
    previewToken: previewResult.value.previewToken,
    requestKey: 'request-key-synthetic',
    confirmed: true,
    organizationAudienceConfirmed: request.destination.scope === 'organization',
    ...overrides,
  };
}

test('preview preserves explicit reply order and returns only safe exact content', async () => {
  const harness = createHarness();
  const result = await preview(harness);

  assert.equal(result.ok, true);
  assert.deepEqual(
    harness.state.previewInputs[0].request.selectedReplyMessageIds,
    ['reply-selected-2', 'reply-selected-1'],
  );
  assert.equal(harness.state.previewInputs[0].auditActor.userId, actor.userId);
  assert.deepEqual(result.value.selectedMessages, [
    {
      ordinal: 0,
      content: 'Second reply selected first',
      createdAt: '2026-08-10T05:40:00.000Z',
      authorCategory: 'user',
    },
    {
      ordinal: 1,
      content: 'First reply selected second',
      createdAt: '2026-08-10T05:35:00.000Z',
      authorCategory: 'user',
    },
  ]);
  assert.equal(result.value.selectedMessageCount, 2);
  assert.equal(result.value.omittedMessageCount, 2);
  assert.equal(result.value.sharedCard.title, 'Selected share title');
  assert.equal(result.value.requiresConfirmation, true);
  assert.equal(result.value.requiresOrganizationAudienceConfirmation, false);
  const serialized = JSON.stringify(result.value);
  for (const hidden of [
    'reply-selected-1',
    'reply-selected-2',
    'sourceShareContentHash',
    'sourceMessageId',
    bindingHash,
  ]) {
    assert.equal(serialized.includes(hidden), false);
  }
});

test('preview token contains no selected reply IDs, synthesis body or organization grant', async () => {
  const harness = createHarness();
  const result = await preview(harness);
  const decoded = Buffer.from(
    result.value.previewToken.split('.')[0],
    'base64url',
  ).toString('utf8');

  for (const privateValue of [
    ...personalRequest().selectedReplyMessageIds,
    personalRequest().synthesis.content,
    actor.userId,
    rootMessageId,
  ]) {
    assert.equal(decoded.includes(privateValue), false);
  }
});

test('commit re-resolves exact state and creates one synthesis v1', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  const result = await harness.service.commit({
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(previewResult),
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      promotionId,
      synthesisId: 'synthesis-created',
      synthesisVersionId: 'synthesis-version-created',
      synthesisVersion: 1,
      scope: 'personal',
      selectedMessageCount: 2,
      includesSharedCard: true,
      createdAt: '2026-08-10T06:00:00.000Z',
      created: true,
      reused: false,
    },
  });
  assert.equal(harness.state.resolveInputs.length, 1);
  assert.equal(harness.state.commitInputs.length, 1);
  const committed = harness.state.commitInputs[0];
  assert.equal(committed.expectedBindingHash, bindingHash);
  assert.match(committed.requestKeyHash, /^[a-f0-9]{64}$/);
  assert.match(committed.requestPayloadHash, /^[a-f0-9]{64}$/);
  assert.equal(
    committed.requestKeyHash.includes('request-key-synthetic'),
    false,
  );
  assert.equal(committed.auditActor.userId, actor.userId);
});

test('same key and payload reuses the existing promotion without another mutation', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  const input = {
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(previewResult),
  };

  const first = await harness.service.commit(input);
  const second = await harness.service.commit(input);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.value.created, false);
  assert.equal(second.value.reused, true);
  assert.equal(second.value.promotionId, first.value.promotionId);
  assert.equal(harness.state.commitInputs.length, 1);
  assert.equal(harness.state.resolveInputs.length, 1);
});

test('same request key with another payload returns a sanitized conflict', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  await harness.service.commit({
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(previewResult),
  });
  const changedRequest = personalRequest({
    synthesis: {
      ...personalRequest().synthesis,
      title: 'Different exact synthesis',
    },
  });
  const changedPreview = await preview(harness, changedRequest);
  const conflict = await harness.service.commit({
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(changedPreview, changedRequest),
  });

  assert.deepEqual(conflict, {
    ok: false,
    statusCode: 409,
    code: 'idempotency_conflict',
    message: 'Idempotency conflict',
  });
  assert.equal(JSON.stringify(conflict).includes('private conflict'), false);
  assert.equal(harness.state.commitInputs.length, 1);
});

test('organization promotion requires explicit grants and additional confirmation', async () => {
  const request = personalRequest({
    destination: {
      scope: 'organization',
      organizationGroupAccountIds: [
        'organization-group-b',
        'organization-group-a',
      ],
    },
  });
  const harness = createHarness();
  const previewResult = await preview(harness, request);

  assert.equal(previewResult.ok, true);
  assert.deepEqual(
    harness.state.previewInputs[0].request.destination
      .organizationGroupAccountIds,
    ['organization-group-a', 'organization-group-b'],
  );
  assert.equal(
    previewResult.value.requiresOrganizationAudienceConfirmation,
    true,
  );
  const rejected = await harness.service.commit({
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(previewResult, request, {
      organizationAudienceConfirmed: false,
    }),
  });
  assert.deepEqual(rejected, {
    ok: false,
    statusCode: 400,
    code: 'organization_confirmation_required',
    message: 'Organization audience confirmation is required',
  });
  assert.equal(harness.state.commitInputs.length, 0);
});

test('strict request validation rejects unknown fields, duplicate replies and invalid scope data', async () => {
  const invalidRequests = [
    { ...personalRequest(), unknown: true },
    personalRequest({ selectedReplyMessageIds: [] }),
    personalRequest({
      selectedReplyMessageIds: ['reply-selected', 'reply-selected'],
    }),
    personalRequest({
      selectedReplyMessageIds: Array.from(
        { length: 101 },
        (_, index) => `reply-${index}`,
      ),
    }),
    personalRequest({
      destination: {
        scope: 'personal',
        organizationGroupAccountIds: ['must-be-empty'],
      },
    }),
    personalRequest({
      destination: {
        scope: 'organization',
        organizationGroupAccountIds: [],
      },
    }),
    personalRequest({
      synthesis: {
        ...personalRequest().synthesis,
        confidenceBasisPoints: 10001,
      },
    }),
    personalRequest({
      synthesis: { ...personalRequest().synthesis, unknown: 'private' },
    }),
  ];

  for (const body of invalidRequests) {
    const result = await createHarness().service.preview({
      actor,
      auditActor,
      rootMessageId,
      body,
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 400,
      code: 'invalid_request',
      message: 'Invalid request',
    });
  }
});

test('organization grants must be an explicit subset of the canonical actor groups', async () => {
  const result = await createHarness().service.preview({
    actor,
    auditActor,
    rootMessageId,
    body: personalRequest({
      destination: {
        scope: 'organization',
        organizationGroupAccountIds: [
          'organization-group-a',
          'organization-group-not-held',
        ],
      },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 400,
    code: 'invalid_request',
    message: 'Invalid request',
  });
});

test('missing Chat actor context and unauthorized port results fail closed', async () => {
  const harness = createHarness();
  const noChat = await harness.service.preview({
    actor: { ...actor, chat: undefined },
    auditActor,
    rootMessageId,
    body: personalRequest(),
  });
  assert.deepEqual(noChat, {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  });

  harness.state.previewResult = {
    ok: false,
    error: { status: 404, code: 'not_found', message: 'raw root detail' },
  };
  const hidden = await preview(harness);
  assert.deepEqual(hidden, {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  });
  assert.equal(JSON.stringify(hidden).includes('raw root'), false);
});

test('changed exact reply/share state is reported as stale preview before mutation', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  harness.state.resolveResult = {
    ok: true,
    value: resolved(personalRequest(), { bindingHash: 'f'.repeat(64) }),
  };
  const result = await harness.service.commit({
    actor,
    auditActor,
    rootMessageId,
    body: commitBody(previewResult),
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 409,
    code: 'stale_preview',
    message: 'Preview is stale',
  });
  assert.equal(harness.state.commitInputs.length, 0);
});

test('request-key hashing is actor scoped, deterministic and opaque', () => {
  const requestKey = 'opaque-request-key-synthetic';
  const hash = hashKnowledgeThreadPromotionRequestKey(actor, requestKey);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashKnowledgeThreadPromotionRequestKey(actor, requestKey));
  assert.notEqual(
    hash,
    hashKnowledgeThreadPromotionRequestKey(
      { ...actor, userId: 'another-knowledge-user' },
      requestKey,
    ),
  );
  assert.equal(hash.includes(requestKey), false);
});
