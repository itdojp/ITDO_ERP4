import assert from 'node:assert/strict';
import test from 'node:test';

const configModule = () =>
  import('../dist/application/knowledge/knowledgeLlmConfig.js');
const budgetModule = () =>
  import('../dist/application/knowledge/knowledgeLlmBudgetUseCases.js');

function catalog(overrides = {}) {
  return JSON.stringify({
    version: 3,
    models: [
      {
        provider: 'stub',
        model: 'stub-v1',
        enabled: true,
        maxInputTokens: 1000000,
        maxOutputTokens: 4096,
        inputCostMicrosPerMillion: '1250000',
        outputCostMicrosPerMillion: '2500000',
        currency: 'JPY',
        capabilities: ['text'],
        ...overrides,
      },
    ],
  });
}

test('Knowledge external LLM is disabled independently of Chat settings', async () => {
  const { getKnowledgeLlmRuntimeConfig } = await configModule();
  assert.deepEqual(
    getKnowledgeLlmRuntimeConfig({
      CHAT_EXTERNAL_LLM_PROVIDER: 'stub',
      CHAT_EXTERNAL_LLM_MODEL: 'chat-only',
    }),
    { provider: 'disabled', catalog: null },
  );
});

test('model catalog is strict, versioned and uses integer price strings', async () => {
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  const parsed = parseKnowledgeLlmModelCatalog(catalog());
  assert.equal(parsed.version, 3);
  assert.equal(parsed.models[0].inputCostMicrosPerMillion, 1250000n);
  assert.equal(parsed.models[0].outputCostMicrosPerMillion, 2500000n);
  assert.throws(
    () => parseKnowledgeLlmModelCatalog(catalog({ unexpected: true })),
    /KNOWLEDGE_LLM_MODEL_CATALOG_JSON/,
  );
  assert.throws(
    () =>
      parseKnowledgeLlmModelCatalog(
        catalog({ inputCostMicrosPerMillion: 1.5 }),
      ),
    /KNOWLEDGE_LLM_MODEL_CATALOG_JSON/,
  );
  assert.throws(
    () =>
      parseKnowledgeLlmModelCatalog(
        catalog({ capabilities: ['text', 'image'] }),
      ),
    /KNOWLEDGE_LLM_MODEL_CATALOG_JSON/,
  );
});

test('maximum reservation rounds each integer cost component up', async () => {
  const {
    ceilCostMicros,
    maximumReservationMicros,
    parseKnowledgeLlmModelCatalog,
  } = await configModule();
  assert.equal(ceilCostMicros(1, 1n), 1n);
  const model = parseKnowledgeLlmModelCatalog(catalog()).models[0];
  assert.equal(
    maximumReservationMicros({
      model,
      estimatedInputTokens: 3,
      maxOutputTokens: 7,
    }),
    22n,
  );
});

test('openai runtime requires separate key and an allowlisted base host', async () => {
  const { getKnowledgeLlmRuntimeConfig } = await configModule();
  const openAiCatalog = catalog({ provider: 'openai' });
  assert.throws(
    () =>
      getKnowledgeLlmRuntimeConfig({
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        CHAT_EXTERNAL_LLM_OPENAI_API_KEY: 'chat-key-must-not-be-reused',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.example.test',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://api.example.test/v1',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY/,
  );
  const parsed = getKnowledgeLlmRuntimeConfig({
    KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
    KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
    KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
    KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.example.test',
    KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://api.example.test/v1',
  });
  assert.equal(parsed.provider, 'openai');
  assert.deepEqual(parsed.allowedHosts, ['api.example.test']);
  assert.throws(
    () =>
      getKnowledgeLlmRuntimeConfig({
        NODE_ENV: 'production',
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.example.test',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://api.example.test/v1',
        KNOWLEDGE_EXTERNAL_LLM_ALLOW_PRIVATE_IP: 'true',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_ALLOW_PRIVATE_IP/,
  );
  assert.throws(
    () =>
      getKnowledgeLlmRuntimeConfig({
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.example.test',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL:
          'https://api.example.test/v1?credential=forbidden',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL/,
  );
});

test('conservative estimate and timezone month boundary are deterministic', async () => {
  const { estimateKnowledgeLlmInputTokens } = await configModule();
  const { knowledgeLlmMonthlyPeriod } = await budgetModule();
  assert.equal(estimateKnowledgeLlmInputTokens(100, 3), 312);
  const tokyo = knowledgeLlmMonthlyPeriod(
    new Date('2026-08-11T04:00:00.000Z'),
    'Asia/Tokyo',
  );
  assert.equal(tokyo.start.toISOString(), '2026-07-31T15:00:00.000Z');
  assert.equal(tokyo.end.toISOString(), '2026-08-31T15:00:00.000Z');
  const newYork = knowledgeLlmMonthlyPeriod(
    new Date('2026-03-20T12:00:00.000Z'),
    'America/New_York',
  );
  assert.equal(newYork.start.toISOString(), '2026-03-01T05:00:00.000Z');
  assert.equal(newYork.end.toISOString(), '2026-04-01T04:00:00.000Z');
  assert.throws(
    () => knowledgeLlmMonthlyPeriod(new Date(), 'Not/A_Zone'),
    /Invalid time zone/i,
  );
});

test('organization reservation fails closed when canonical organization differs', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  let called = false;
  const service = createKnowledgeLlmBudgetUseCases({
    async reserve() {
      called = true;
      throw new Error('must not call');
    },
  });
  const result = await service.reserve({
    runId: 'synthetic-run',
    actor: {
      userId: 'synthetic-user',
      organizationId: 'current-org',
      groupAccountIds: [],
    },
    auditActor: {},
    scope: 'organization',
    organizationId: 'other-org',
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 1,
    promptTemplateVersion: 1,
    requestKeyHash: 'a'.repeat(64),
    requestPayloadHash: 'b'.repeat(64),
    selectedContextFingerprint: 'c'.repeat(64),
    estimatedInputTokens: 100,
    maxOutputTokens: 100,
    maximumCostMicros: 10n,
    currency: 'JPY',
    now: new Date('2026-08-11T00:00:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});
