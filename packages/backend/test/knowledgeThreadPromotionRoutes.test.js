import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import {
  knowledgeThreadPromotionCommitResponse,
  knowledgeThreadPromotionPreviewResponse,
  registerKnowledgeThreadPromotionRoutes,
} from '../dist/routes/knowledgeThreadPromotions.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const timestamp = '2026-08-10T01:00:00.000Z';

function requestUser(overrides = {}) {
  return {
    userId: 'chat-user-1',
    roles: ['user'],
    orgId: 'org-1',
    projectIds: ['project-1'],
    groupIds: ['Knowledge'],
    groupAccountIds: ['group-1'],
    auth: {
      providerType: 'header',
      principalUserId: 'principal-1',
      actorUserId: 'chat-user-1',
      scopes: ['knowledge:write'],
      tokenId: 'token-1',
      audience: ['erp4-agent'],
      expiresAt: 1_900_000_000,
    },
    ...overrides,
  };
}

function requestBody(overrides = {}) {
  return {
    selectedReplyMessageIds: ['reply-private-1'],
    includeSharedCard: false,
    destination: {
      scope: 'personal',
      organizationGroupAccountIds: [],
    },
    synthesis: {
      title: 'Synthetic synthesis',
      content: 'Only selected reply content.',
      confidenceBasisPoints: 7500,
      unresolvedQuestions: ['Synthetic question'],
    },
    ...overrides,
  };
}

function previewValue(overrides = {}) {
  return {
    sourceThread: {
      roomName: 'Synthetic room',
      roomType: 'private_group',
      replyCount: 2,
    },
    selectedMessages: [
      {
        ordinal: 0,
        content: 'Selected reply',
        createdAt: timestamp,
        authorCategory: 'user',
        sourceMessageId: 'must-not-leak',
      },
    ],
    selectedMessageCount: 1,
    omittedMessageCount: 1,
    sharedCard: null,
    destination: { scope: 'personal', organizationGroupCount: 0 },
    synthesis: requestBody().synthesis,
    previewToken: 'opaque.preview.token',
    expiresAt: '2026-08-10T01:10:00.000Z',
    requiresConfirmation: true,
    requiresOrganizationAudienceConfirmation: false,
    sourceRoomId: 'must-not-leak',
    requestKey: 'must-not-leak',
    ...overrides,
  };
}

function sharedCardValue() {
  return {
    schemaVersion: 1,
    shareVersion: 2,
    title: 'Selected card title',
    labels: [],
    annotations: [],
    turns: [],
    syntheses: [],
    selectedCategories: ['title'],
    omittedCategories: [
      'source_type',
      'canonical_url',
      'snapshot_provenance',
      'snapshot_excerpt',
      'label',
      'annotation',
      'conversation_turn',
      'synthesis',
      'sharer_note',
    ],
  };
}

function commitValue(overrides = {}) {
  return {
    promotionId: 'promotion-safe-id',
    synthesisId: 'synthesis-safe-id',
    synthesisVersionId: 'version-safe-id',
    synthesisVersion: 1,
    scope: 'personal',
    selectedMessageCount: 1,
    includesSharedCard: false,
    createdAt: timestamp,
    created: true,
    reused: false,
    sourceRoomId: 'must-not-leak',
    requestKeyHash: 'a'.repeat(64),
    ...overrides,
  };
}

function service(overrides = {}) {
  return {
    preview: async () => ({ ok: true, value: previewValue() }),
    commit: async () => ({ ok: true, value: commitValue() }),
    ...overrides,
  };
}

async function build(routeService, user = requestUser()) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = user;
  });
  await registerKnowledgeThreadPromotionRoutes(app, {
    service: routeService,
  });
  await app.ready();
  return app;
}

test('preview passes canonical Knowledge and Chat claims and returns only allowlisted fields', async (t) => {
  let call;
  const app = await build(
    service({
      preview: async (input) => {
        call = input;
        return { ok: true, value: previewValue() };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/chat-messages/root-1/promote-to-knowledge/preview',
    payload: requestBody(),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(call.actor.userId, 'chat-user-1');
  assert.deepEqual(call.actor.chat, {
    userId: 'chat-user-1',
    roles: ['user'],
    projectIds: ['project-1'],
    groupIds: ['Knowledge'],
    groupAccountIds: ['group-1'],
  });
  assert.equal(call.rootMessageId, 'root-1');
  const text = JSON.stringify(response.json());
  assert.equal(text.includes('must-not-leak'), false);
  assert.equal(text.includes('sourceMessageId'), false);
  assert.equal(text.includes('sourceRoomId'), false);
  assert.equal(text.includes('requestKey'), false);
  assert.equal(response.json().selectedMessages[0].content, 'Selected reply');
});

test('commit requires exact confirmed body and maps created/reused response', async (t) => {
  let call;
  const app = await build(
    service({
      commit: async (input) => {
        call = input;
        return { ok: true, value: commitValue() };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/chat-messages/root-1/promote-to-knowledge',
    payload: {
      ...requestBody(),
      previewToken: 'opaque.preview.token',
      requestKey: 'opaque-request-key',
      confirmed: true,
      organizationAudienceConfirmed: false,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(call.rootMessageId, 'root-1');
  assert.deepEqual(response.json(), knowledgeThreadPromotionCommitResponse(commitValue()));
  assert.equal(JSON.stringify(response.json()).includes('must-not-leak'), false);
});

test('route rejects unknown fields and normalizes service not-found', async (t) => {
  const app = await build(
    service({
      preview: async () => ({
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      }),
    }),
  );
  t.after(() => app.close());
  const unknown = await app.inject({
    method: 'POST',
    url: '/chat-messages/root-1/promote-to-knowledge/preview',
    payload: { ...requestBody(), providerKey: 'private' },
  });
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(unknown.body.includes('private'), false);
  const missing = await app.inject({
    method: 'POST',
    url: '/chat-messages/root-1/promote-to-knowledge/preview',
    payload: requestBody(),
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(missing.json().error.code, 'not_found');
});

test('preview response mapper strips internal source and provider fields', () => {
  const response = knowledgeThreadPromotionPreviewResponse(previewValue());
  const text = JSON.stringify(response);
  assert.equal(text.includes('must-not-leak'), false);
  assert.equal(text.includes('provider'), false);
  assert.equal(response.omittedMessageCount, 1);
});

test('preview maps an included share card with the complete selection summary', async (t) => {
  const app = await build(
    service({
      preview: async () => ({
        ok: true,
        value: previewValue({ sharedCard: sharedCardValue() }),
      }),
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/chat-messages/root-1/promote-to-knowledge/preview',
    payload: requestBody({ includeSharedCard: true }),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().sharedCard.omittedCategories, [
    'source_type',
    'canonical_url',
    'snapshot_provenance',
    'snapshot_excerpt',
    'label',
    'annotation',
    'conversation_turn',
    'synthesis',
    'sharer_note',
  ]);
});
