import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';

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

function selectedContext(representation, index = 0) {
  return {
    sourceType: 'conversation_turn',
    sourceId: `synthetic-turn-${index}`,
    exactSourceVersion: index + 1,
    exactSourceHash: String((index % 9) + 1).repeat(64),
    representation,
  };
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
  for (const model of [
    'stub\u00admodel',
    'stub\u200bmodel',
    'stub\u202emodel',
    `stub${String.fromCodePoint(0xe0001)}model`,
  ]) {
    assert.throws(
      () => parseKnowledgeLlmModelCatalog(catalog({ model })),
      /KNOWLEDGE_LLM_MODEL_CATALOG_JSON/,
    );
  }
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
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'K.example',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://k.example/v1',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS/,
  );
  assert.throws(
    () =>
      getKnowledgeLlmRuntimeConfig({
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'k.example',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://K.example/v1',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL/,
  );
  const ipv6 = getKnowledgeLlmRuntimeConfig({
    KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
    KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
    KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
    KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: '2606:4700:4700::1111',
    KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'https://[2606:4700:4700::1111]/v1',
  });
  assert.equal(ipv6.provider, 'openai');
  assert.deepEqual(ipv6.allowedHosts, ['2606:4700:4700::1111']);
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
        NODE_ENV: ' Production ',
        KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'openai',
        KNOWLEDGE_LLM_MODEL_CATALOG_JSON: openAiCatalog,
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY: 'synthetic-test-key',
        KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS: 'api.example.test',
        KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL: 'http://api.example.test/v1',
        KNOWLEDGE_EXTERNAL_LLM_ALLOW_HTTP: 'true',
      }),
    /KNOWLEDGE_EXTERNAL_LLM_ALLOW_HTTP/,
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
  const havanaAmbiguousMidnight = knowledgeLlmMonthlyPeriod(
    new Date('2020-11-15T12:00:00.000Z'),
    'America/Havana',
  );
  assert.equal(
    havanaAmbiguousMidnight.start.toISOString(),
    '2020-11-01T05:00:00.000Z',
  );
  assert.equal(
    havanaAmbiguousMidnight.end.toISOString(),
    '2020-12-01T05:00:00.000Z',
  );
  assert.throws(
    () => knowledgeLlmMonthlyPeriod(new Date(), 'Not/A_Zone'),
    /Invalid time zone/i,
  );
});

test('organization reservation fails closed when canonical organization differs', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  let called = false;
  const service = createKnowledgeLlmBudgetUseCases(
    {
      async reserve() {
        called = true;
        throw new Error('must not call');
      },
    },
    parseKnowledgeLlmModelCatalog(catalog()),
    new StubExternalLlmTextAdapter(),
    () => new Date('2026-08-12T00:00:00.000Z'),
  );
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
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: 'a'.repeat(64),
    systemPrompt: '',
    userPrompt: 'Synthetic prompt',
    selectedContextSources: [],
    reservationInputTokenFloor: 100,
    maxOutputTokens: 100,
    inputCostMicrosPerMillion: 100_000n,
    outputCostMicrosPerMillion: 0n,
    maximumCostMicros: 10n,
    currency: 'JPY',
    now: new Date('2026-08-11T00:00:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test('reservation rejects non-canonical actor and organization identifiers', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  let calls = 0;
  const service = createKnowledgeLlmBudgetUseCases(
    {
      async reserve() {
        calls += 1;
        throw new Error('must not call');
      },
    },
    parseKnowledgeLlmModelCatalog(catalog()),
    new StubExternalLlmTextAdapter(),
  );
  const base = {
    runId: 'canonical-actor-run',
    actor: { userId: 'canonical-user', groupAccountIds: [] },
    auditActor: {},
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: '9'.repeat(64),
    systemPrompt: '',
    userPrompt: 'Synthetic prompt',
    selectedContextSources: [],
    maxOutputTokens: 7,
  };

  for (const input of [
    {
      ...base,
      actor: { ...base.actor, userId: 'canonical-user\u200b' },
    },
    {
      ...base,
      actor: {
        ...base.actor,
        organizationId: 'canonical-org\u200b',
      },
      scope: 'organization',
      organizationId: 'canonical-org\u200b',
    },
  ]) {
    assert.deepEqual(await service.reserve(input), {
      ok: false,
      error: {
        status: 400,
        code: 'invalid_request',
        message: 'Invalid request',
      },
    });
  }
  assert.equal(calls, 0);
});

test('reservation pricing is resolved from the enabled catalog, not caller fields', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  let received;
  const service = createKnowledgeLlmBudgetUseCases(
    {
      async reserve(input) {
        received = input;
        return {
          ok: true,
          value: {
            runId: input.runId,
            created: true,
            maximumCostMicros: input.maximumCostMicros,
            currency: input.currency,
            softLimitWarning: false,
          },
        };
      },
    },
    parseKnowledgeLlmModelCatalog(catalog()),
    new StubExternalLlmTextAdapter(),
    () => new Date('2026-08-12T00:00:00.000Z'),
  );
  const result = await service.reserve({
    runId: 'trusted-catalog-run',
    actor: { userId: 'synthetic-user', groupAccountIds: [] },
    auditActor: {},
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: 'd'.repeat(64),
    selectedContextFingerprint: 'f'.repeat(64), // ignored untrusted extra field
    systemPrompt: '',
    userPrompt: 'Synthetic prompt',
    selectedContextSources: [],
    reservationInputTokenFloor: 3,
    maxOutputTokens: 7,
    // Runtime JavaScript may still carry untrusted extra fields. The use case
    // reconstructs its port request and overwrites every pricing/time field.
    inputCostMicrosPerMillion: 0n,
    outputCostMicrosPerMillion: 0n,
    maximumCostMicros: 0n,
    currency: 'XXX',
    now: new Date('2026-08-11T00:00:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(received.inputCostMicrosPerMillion, 1_250_000n);
  assert.equal(received.outputCostMicrosPerMillion, 2_500_000n);
  assert.equal(received.maximumCostMicros, 138n);
  assert.equal(received.estimatedInputTokens, 96);
  assert.notEqual(received.requestPayloadHash, 'e'.repeat(64));
  assert.notEqual(received.selectedContextFingerprint, 'f'.repeat(64));
  assert.deepEqual(received.selectedContextSources, []);
  assert.match(received.providerRequestHash, /^[a-f0-9]{64}$/);
  assert.equal(
    received.providerRequestHash,
    new StubExternalLlmTextAdapter().bind({
      provider: 'stub',
      model: 'stub-v1',
      systemPrompt: '',
      userPrompt: 'Synthetic prompt',
      contextSections: [],
      inputTokenCeiling: 96,
      maxOutputTokens: 7,
      temperatureBasisPoints: 0,
    }).requestFingerprint,
  );
  assert.equal('systemPrompt' in received, false);
  assert.equal(received.userPrompt, 'Synthetic prompt');
  assert.equal(
    received.userPromptHash,
    createHash('sha256')
      .update('erp4:knowledge:llm-user-prompt:v1\0Synthetic prompt', 'utf8')
      .digest('hex'),
  );
  assert.equal(received.currency, 'JPY');
  assert.equal(received.now.toISOString(), '2026-08-12T00:00:00.000Z');
});

test('reservation rejects stale, disabled, unknown and over-limit catalog selections', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  const base = {
    runId: 'catalog-selection-run',
    actor: { userId: 'synthetic-user', groupAccountIds: [] },
    auditActor: {},
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: '1'.repeat(64),
    systemPrompt: '',
    userPrompt: 'Synthetic prompt',
    selectedContextSources: [],
    reservationInputTokenFloor: 3,
    maxOutputTokens: 7,
    now: new Date('2026-08-11T00:00:00.000Z'),
  };
  for (const candidate of [
    { catalog: null, input: base },
    {
      catalog: parseKnowledgeLlmModelCatalog(catalog()),
      input: { ...base, catalogVersion: 2 },
    },
    {
      catalog: parseKnowledgeLlmModelCatalog(catalog({ enabled: false })),
      input: base,
    },
    {
      catalog: parseKnowledgeLlmModelCatalog(catalog()),
      input: { ...base, model: 'unknown-model' },
    },
    {
      catalog: parseKnowledgeLlmModelCatalog(catalog({ maxInputTokens: 2 })),
      input: base,
    },
    {
      catalog: parseKnowledgeLlmModelCatalog(catalog({ maxOutputTokens: 6 })),
      input: base,
    },
  ]) {
    let called = false;
    const service = createKnowledgeLlmBudgetUseCases(
      {
        async reserve() {
          called = true;
          throw new Error('must not call');
        },
      },
      candidate.catalog,
      new StubExternalLlmTextAdapter(),
    );
    assert.deepEqual(await service.reserve(candidate.input), {
      ok: false,
      error: {
        status: 400,
        code: 'invalid_request',
        message: 'Invalid request',
      },
    });
    assert.equal(called, false);
  }
});

test('reservation derives a conservative floor from exact rendered prompts', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { parseKnowledgeLlmModelCatalog } = await configModule();
  let received;
  const service = createKnowledgeLlmBudgetUseCases(
    {
      async reserve(input) {
        received = input;
        return {
          ok: true,
          value: {
            runId: input.runId,
            created: true,
            maximumCostMicros: input.maximumCostMicros,
            currency: input.currency,
            softLimitWarning: false,
          },
        };
      },
    },
    parseKnowledgeLlmModelCatalog(catalog()),
    new StubExternalLlmTextAdapter(),
  );
  const result = await service.reserve({
    runId: 'prompt-bound-run',
    actor: { userId: 'synthetic-user', groupAccountIds: [] },
    auditActor: {},
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: '4'.repeat(64),
    systemPrompt: '12345',
    userPrompt: '67890',
    selectedContextSources: [selectedContext('A'), selectedContext('B', 1)],
    reservationInputTokenFloor: 1,
    maxOutputTokens: 7,
  });
  assert.equal(result.ok, true);
  assert.equal(received.estimatedInputTokens, 120);
  assert.equal(received.maximumCostMicros, 168n);
  assert.deepEqual(
    received.selectedContextSources.map((source) => ({
      ordinal: source.ordinal,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      exactSourceVersion: source.exactSourceVersion,
    })),
    [
      {
        ordinal: 0,
        sourceType: 'conversation_turn',
        sourceId: 'synthetic-turn-0',
        exactSourceVersion: 1,
      },
      {
        ordinal: 1,
        sourceType: 'conversation_turn',
        sourceId: 'synthetic-turn-1',
        exactSourceVersion: 2,
      },
    ],
  );
});

test('reservation enforces raw user and selected-context byte limits independently', async () => {
  const { createKnowledgeLlmBudgetUseCases } = await budgetModule();
  const { knowledgeLlmLimits, parseKnowledgeLlmModelCatalog } =
    await configModule();
  let calls = 0;
  const service = createKnowledgeLlmBudgetUseCases(
    {
      async reserve() {
        calls += 1;
        throw new Error('must not call');
      },
    },
    parseKnowledgeLlmModelCatalog(catalog()),
    new StubExternalLlmTextAdapter(),
  );
  const base = {
    runId: 'prompt-limit-run',
    actor: { userId: 'synthetic-user', groupAccountIds: [] },
    auditActor: {},
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 3,
    promptTemplateVersion: 1,
    requestKeyHash: '7'.repeat(64),
    systemPrompt: '',
    userPrompt: 'Synthetic prompt',
    selectedContextSources: [],
    maxOutputTokens: 7,
  };
  const oversizedUser = await service.reserve({
    ...base,
    userPrompt: 'u'.repeat(knowledgeLlmLimits.userPromptBytes + 1),
  });
  assert.equal(oversizedUser.ok, false);
  const oversizedContext = await service.reserve({
    ...base,
    selectedContextSources: [
      selectedContext('c'.repeat(knowledgeLlmLimits.sourceBytes), 0),
      selectedContext('d'.repeat(knowledgeLlmLimits.sourceBytes), 1),
      selectedContext('e'.repeat(knowledgeLlmLimits.sourceBytes), 2),
      selectedContext('f'.repeat(knowledgeLlmLimits.sourceBytes), 3),
      selectedContext('g', 4),
    ],
  });
  assert.equal(oversizedContext.ok, false);
  assert.equal(calls, 0);
});
