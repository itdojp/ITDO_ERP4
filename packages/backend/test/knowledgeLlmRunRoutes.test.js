import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { mapErrorToResponse } from '../dist/services/errors.js';
import { OpenAiCompatibleTextAdapter } from '../dist/adapters/externalLlm/openAiCompatibleTextAdapter.js';
import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';

process.env.DATABASE_URL ??=
  'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic?schema=public';

const now = '2026-08-12T09:00:00.000Z';

test('Knowledge route composition selects only the explicitly configured provider adapter', async () => {
  const { createKnowledgeLlmProviderPort } =
    await import('../dist/routes/knowledgeLlmRuns.js');
  assert.equal(
    createKnowledgeLlmProviderPort({ provider: 'disabled', catalog: null }),
    null,
  );
  assert.ok(
    createKnowledgeLlmProviderPort({
      provider: 'stub',
      catalog: { version: 1, models: [] },
    }) instanceof StubExternalLlmTextAdapter,
  );
  assert.ok(
    createKnowledgeLlmProviderPort({
      provider: 'openai',
      catalog: { version: 1, models: [] },
      apiKey: 'synthetic-route-only-key',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 120_000,
      allowedHosts: ['api.openai.com'],
      allowHttp: false,
      allowPrivateIp: false,
    }) instanceof OpenAiCompatibleTextAdapter,
  );
});

function user(overrides = {}) {
  return {
    userId: 'canonical-user',
    roles: ['user'],
    orgId: 'organization-safe',
    groupAccountIds: ['group-safe'],
    auth: {
      providerType: 'header',
      principalUserId: 'canonical-user',
      actorUserId: 'canonical-user',
      scopes: ['knowledge:write'],
      tokenId: 'opaque-token-id',
      audience: ['erp4'],
      expiresAt: 1_900_000_000,
    },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 1,
    userPrompt: 'Synthetic prompt',
    maxOutputTokens: 32,
    sources: [{ sourceType: 'snapshot', sourceId: 'snapshot-private' }],
    ...overrides,
  };
}

function budget() {
  return {
    configured: true,
    policyCount: 1,
    currency: 'JPY',
    softLimitWarning: false,
    hardLimitBlocked: false,
    rateBlocked: false,
    subjects: [
      {
        subjectType: 'user',
        softLimitMicros: '100',
        hardLimitMicros: '200',
        activeReservedMicros: '0',
        settledActualMicros: '0',
        heldMaximumMicros: '0',
        requestsPerHour: 10,
        acceptedRequestsLastHour: 0,
      },
    ],
  };
}

function run(overrides = {}) {
  return {
    id: 'safe-run-id',
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 1,
    promptTemplateVersion: 1,
    scope: 'personal',
    estimatedInputTokens: 80,
    maxOutputTokens: 32,
    maximumCostMicros: '2',
    actualInputTokens: 70,
    actualOutputTokens: 12,
    actualCostMicros: '1',
    currency: 'JPY',
    softLimitWarning: false,
    executionStatus: 'result_ready',
    settlementStatus: 'settled_actual',
    failureCode: null,
    result: 'Synthetic external LLM result.',
    conversationId: 'safe-conversation-id',
    createdAt: now,
    dispatchedAt: now,
    completedAt: now,
    ...overrides,
  };
}

function service(overrides = {}) {
  return {
    catalog: () => ({
      enabled: true,
      provider: 'stub',
      version: 1,
      models: [
        {
          provider: 'stub',
          model: 'stub-v1',
          maxInputTokens: 1000,
          maxOutputTokens: 128,
          inputCostMicrosPerMillion: '10',
          outputCostMicrosPerMillion: '20',
          currency: 'JPY',
        },
      ],
      apiKey: 'must-not-leak',
    }),
    budget: async () => budget(),
    preview: async () => ({
      runId: 'safe-run-id',
      provider: 'stub',
      model: 'stub-v1',
      catalogVersion: 1,
      promptTemplateVersion: 1,
      scope: 'personal',
      selectedSources: [
        {
          ordinal: 0,
          sourceType: 'snapshot',
          exactSourceVersion: 3,
          exactSourceHash: 'a'.repeat(64),
          byteLength: 25,
          content: 'Authorized selected text',
          sourceId: 'must-not-leak',
        },
      ],
      sourceCounts: {
        snapshot: 1,
        annotation_revision: 0,
        conversation_turn: 0,
        synthesis_version: 0,
        thread_promotion_message: 0,
      },
      selectedItemCount: 1,
      selectedSourceCount: 1,
      totalContextBytes: 32,
      estimatedInputTokens: 80,
      maxOutputTokens: 32,
      maximumCostMicros: '2',
      currency: 'JPY',
      budget: budget(),
      expiresAt: '2026-08-12T09:10:00.000Z',
      previewToken: 'opaque.preview.token',
      rawSourceId: 'must-not-leak',
      providerUrl: 'must-not-leak',
    }),
    execute: async () => ({
      created: true,
      reused: false,
      run: { ...run(), requestKeyHash: 'must-not-leak' },
    }),
    detail: async () => run(),
    reconcile: async () => run({ executionStatus: 'result_unknown' }),
    ...overrides,
  };
}

async function build(
  routeService,
  requestUser = user(),
  routeDependencies = {},
) {
  const { registerKnowledgeLlmRunRoutes } =
    await import('../dist/routes/knowledgeLlmRuns.js');
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (fastifyRequest) => {
    fastifyRequest.user = requestUser;
  });
  await registerKnowledgeLlmRunRoutes(app, {
    service: routeService,
    ...routeDependencies,
  });
  await app.ready();
  return app;
}

test('context source page is item/scope bound, allowlisted, and cursor encoded', async (t) => {
  let listInput;
  let encodedInput;
  const candidateService = {
    list: async (input) => {
      listInput = input;
      return {
        ok: true,
        value: {
          items: [
            {
              sourceType: 'thread_promotion_message',
              sourceId: 'promotion-message-safe',
              exactSourceVersion: 2,
              byteLength: 42,
              createdAt: new Date(now),
              content: 'must-not-leak',
            },
          ],
          nextBoundary: { updatedAt: new Date(now), id: 'boundary-safe' },
        },
      };
    },
  };
  const cursor = {
    decodePage: () => {
      throw new Error('decode must not be called without a cursor');
    },
    encodePage: (input) => {
      encodedInput = input;
      return 'opaque-next-cursor';
    },
  };
  const app = await build(service(), user(), { candidateService, cursor });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item%2Fsafe/llm-context-sources?scope=personal&sourceType=thread_promotion_message&limit=25',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(listInput.actor.userId, 'canonical-user');
  assert.equal(listInput.itemId, 'item/safe');
  assert.equal(listInput.scope, 'personal');
  assert.equal(listInput.organizationId, null);
  assert.equal(listInput.sourceType, 'thread_promotion_message');
  assert.equal(listInput.limit, 25);
  assert.deepEqual(response.json(), {
    items: [
      {
        sourceType: 'thread_promotion_message',
        sourceId: 'promotion-message-safe',
        exactSourceVersion: 2,
        byteLength: 42,
        createdAt: now,
      },
    ],
    nextCursor: 'opaque-next-cursor',
  });
  assert.equal(encodedInput.kind, 'llm_context_sources');
  assert.equal(
    encodedInput.parentId,
    'item/safe\0personal\0\0thread_promotion_message',
  );
});

test('catalog and preview expose allowlisted fields only', async (t) => {
  let previewInput;
  const app = await build(
    service({
      preview: async (input) => {
        previewInput = input;
        return service().preview();
      },
    }),
  );
  t.after(() => app.close());

  const catalog = await app.inject({
    method: 'GET',
    url: '/knowledge/llm/catalog',
  });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(JSON.stringify(catalog.json()).includes('apiKey'), false);

  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/llm/runs/preview',
    payload: request(),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(previewInput.actor.userId, 'canonical-user');
  assert.equal(previewInput.request.organizationId, null);
  assert.equal(previewInput.request.sources[0].sourceId, 'snapshot-private');
  const text = JSON.stringify(response.json());
  assert.equal(text.includes('must-not-leak'), false);
  assert.equal(text.includes('rawSourceId'), false);
  assert.equal(text.includes('providerUrl'), false);
  assert.equal(text.includes('Authorized selected text'), true);
  assert.equal(response.json().selectedSources[0].sourceId, undefined);
});

test('execute forwards explicit confirmation and strips internal ledger fields', async (t) => {
  let executeInput;
  const app = await build(
    service({
      execute: async (input) => {
        executeInput = input;
        return service().execute();
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/llm/runs',
    payload: {
      ...request(),
      previewToken: 'opaque.preview.token',
      requestKey: 'opaque-request-key',
      confirmed: true,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(executeInput.confirmed, true);
  assert.equal(executeInput.requestKey, 'opaque-request-key');
  assert.equal(
    JSON.stringify(response.json()).includes('requestKeyHash'),
    false,
  );
});

test('route rejects unknown top-level and nested source fields', async (t) => {
  const app = await build(service());
  t.after(() => app.close());
  const topLevel = await app.inject({
    method: 'POST',
    url: '/knowledge/llm/runs/preview',
    payload: request({ providerUrl: 'https://invalid.example' }),
  });
  assert.equal(topLevel.statusCode, 400, topLevel.body);
  const nested = await app.inject({
    method: 'POST',
    url: '/knowledge/llm/runs/preview',
    payload: request({
      sources: [
        {
          sourceType: 'snapshot',
          sourceId: 'snapshot-private',
          content: 'must-not-be-accepted',
        },
      ],
    }),
  });
  assert.equal(nested.statusCode, 400, nested.body);
});

test('canonical Knowledge identity is required before run access', async (t) => {
  const app = await build(
    service(),
    user({
      auth: {
        providerType: 'oidc',
        identityId: '',
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/llm/catalog',
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().error.code, 'forbidden');
});
