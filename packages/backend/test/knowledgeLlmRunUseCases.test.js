import assert from 'node:assert/strict';
import test from 'node:test';

import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';
import {
  bindExternalLlmTextRequest,
  ExternalLlmProviderError,
} from '../dist/application/externalLlm/externalLlmPort.js';
import {
  createKnowledgeLlmRunService,
  KnowledgeLlmRunError,
} from '../dist/application/knowledge/knowledgeLlmRunUseCases.js';
import { KnowledgeLlmRunAccessError } from '../dist/application/knowledge/knowledgeLlmRunPorts.js';
import { createKnowledgeLlmRunTokenCodec } from '../dist/application/knowledge/knowledgeLlmRunToken.js';

const baseTime = new Date('2026-08-12T00:00:00.000Z');
const actor = {
  userId: 'synthetic-owner',
  organizationId: 'synthetic-organization',
  groupAccountIds: ['synthetic-group'],
};
const otherActor = {
  userId: 'synthetic-outsider',
  organizationId: 'synthetic-organization',
  groupAccountIds: ['synthetic-group'],
};
const auditActor = {
  requestId: 'synthetic-request',
  source: 'api',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
};
const modelCatalog = {
  version: 7,
  models: [
    {
      provider: 'stub',
      model: 'stub-v1',
      enabled: true,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 4096,
      inputCostMicrosPerMillion: 100_000n,
      outputCostMicrosPerMillion: 200_000n,
      currency: 'JPY',
      capabilities: ['text'],
    },
  ],
};
const openAiModelCatalog = {
  version: 8,
  models: [
    {
      provider: 'openai',
      model: 'synthetic-openai-compatible-v1',
      enabled: true,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 4096,
      inputCostMicrosPerMillion: 100_000n,
      outputCostMicrosPerMillion: 200_000n,
      currency: 'JPY',
      capabilities: ['text'],
    },
  ],
};
const sourceCounts = () => ({
  snapshot: 0,
  annotation_revision: 0,
  conversation_turn: 0,
  synthesis_version: 0,
  thread_promotion_message: 0,
});

function request(overrides = {}) {
  return {
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: modelCatalog.version,
    userPrompt: 'SYNTHETIC-USER-PROMPT',
    maxOutputTokens: 64,
    sources: [{ sourceType: 'snapshot', sourceId: 'selected-source-id' }],
    ...overrides,
  };
}

function budgetPreview(overrides = {}) {
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
        currency: 'JPY',
        softLimitMicros: 10_000n,
        hardLimitMicros: 20_000n,
        activeReservedMicros: 0n,
        settledActualMicros: 0n,
        heldMaximumMicros: 0n,
        requestsPerHour: 10,
        acceptedRequestsLastHour: 0,
      },
    ],
    ...overrides,
  };
}

function cloneProviderRequest(value) {
  return {
    ...value,
    contextSections:
      value.contextSections === undefined
        ? undefined
        : [...value.contextSections],
  };
}

class CapturingStubProvider {
  constructor(state, mode = 'reported') {
    this.state = state;
    this.mode = mode;
    this.stub = new StubExternalLlmTextAdapter();
  }

  bind(input) {
    this.state.providerBindCalls += 1;
    this.state.boundProviderRequests.push(cloneProviderRequest(input));
    return input.provider === 'stub'
      ? this.stub.bind(input)
      : bindExternalLlmTextRequest(input);
  }

  async prepare(input) {
    this.state.providerPrepareCalls += 1;
    this.state.preparedProviderRequests.push(cloneProviderRequest(input));
    if (this.mode === 'rejected_before_dispatch') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    const prepared =
      input.provider === 'stub'
        ? await this.stub.prepare(input)
        : {
            ...bindExternalLlmTextRequest(input),
            dispatch: async () => ({
              provider: 'openai',
              model: input.model,
              content: 'SYNTHETIC-OPENAI-COMPATIBLE-RESULT',
              usageStatus: 'reported',
              usage: { inputTokens: 12, outputTokens: 7 },
            }),
          };
    return {
      requestFingerprint: prepared.requestFingerprint,
      dispatch: async () => {
        this.state.providerDispatchCalls += 1;
        if (this.mode === 'timeout') {
          throw new ExternalLlmProviderError(
            'timeout_outcome_unknown',
            'unknown',
          );
        }
        if (
          [
            'provider_4xx',
            'provider_5xx',
            'malformed_response',
            'response_oversize',
            'empty_result',
          ].includes(this.mode)
        ) {
          throw new ExternalLlmProviderError(this.mode, 'known_response');
        }
        if (this.mode === 'acl_loss_after_dispatch') {
          this.state.currentAccess = false;
        }
        if (this.mode === 'missing_usage' || this.mode === 'invalid_usage') {
          return {
            provider: 'stub',
            model: input.model,
            content: 'SYNTHETIC-PROVIDER-RESULT',
            usageStatus: this.mode === 'invalid_usage' ? 'invalid' : 'missing',
            usage: null,
          };
        }
        if (
          this.mode === 'invalid_content' ||
          this.mode === 'non_string_content' ||
          this.mode === 'oversize_content'
        ) {
          const result = await prepared.dispatch();
          return {
            ...result,
            content:
              this.mode === 'invalid_content'
                ? 'SYNTHETIC\u0000INVALID'
                : this.mode === 'non_string_content'
                  ? { canary: 'SYNTHETIC-NON-STRING' }
                : 'x'.repeat(256 * 1024 + 1),
          };
        }
        return prepared.dispatch();
      },
    };
  }
}

function makeRun(input) {
  return {
    id: input.runId,
    actorUserId: input.actor.userId,
    scope: input.scope,
    organizationId: input.organizationId,
    provider: input.provider,
    model: input.model,
    catalogVersion: input.catalogVersion,
    promptTemplateVersion: input.promptTemplateVersion,
    requestPayloadHash: input.requestPayloadHash,
    providerRequestHash: input.providerRequestHash,
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    maximumCostMicros: input.maximumCostMicros,
    softLimitWarning: false,
    actualInputTokens: null,
    actualOutputTokens: null,
    actualCostMicros: null,
    currency: input.currency,
    executionStatus: 'reserved',
    settlementStatus: 'reserved',
    failureCode: null,
    conversationId: null,
    assistantTurnId: null,
    resultContent: null,
    createdAt: new Date(input.now),
    dispatchedAt: null,
    completedAt: null,
  };
}

function createHarness(options = {}) {
  const state = {
    now: new Date(baseTime),
    nextRunId: 1,
    resolveCalls: 0,
    budgetPreviewCalls: 0,
    budgetPreviewInputs: [],
    budgetReserveCalls: 0,
    providerBindCalls: 0,
    providerPrepareCalls: 0,
    providerDispatchCalls: 0,
    authorizeCalls: 0,
    captureCalls: 0,
    finalizeCalls: 0,
    captureInputs: [],
    holdCalls: 0,
    reconcileCalls: 0,
    conversationTurnWrites: 0,
    previewAudits: [],
    authorizeInputs: [],
    finalizeInputs: [],
    holdInputs: [],
    boundProviderRequests: [],
    preparedProviderRequests: [],
    runsById: new Map(),
    runsByRequestKey: new Map(),
    outcomesByRunId: new Map(),
    budgetFailure: options.budgetFailure ?? null,
    resolveFailure: null,
    currentAccess: true,
    authorizeFailure: null,
    finalizeFailure: options.finalizeFailure ?? false,
    captureFailure: options.captureFailure ?? false,
    sources: new Map([
      [
        'selected-source-id',
        {
          sourceType: 'snapshot',
          sourceId: 'selected-source-id',
          exactSourceVersion: 3,
          exactSourceHash: 'a'.repeat(64),
          representation: 'SELECTED-CONTEXT',
        },
      ],
      [
        'unselected-source-id',
        {
          sourceType: 'snapshot',
          sourceId: 'unselected-source-id',
          exactSourceVersion: 9,
          exactSourceHash: 'b'.repeat(64),
          representation: 'UNSELECTED-CANARY',
        },
      ],
    ]),
  };

  const provider = new CapturingStubProvider(
    state,
    options.providerMode ?? 'reported',
  );

  const runPort = {
    async resolveContext(input) {
      state.resolveCalls += 1;
      if (state.resolveFailure) throw state.resolveFailure;
      const counts = sourceCounts();
      const sources = input.selectors.map((selector) => {
        const source = state.sources.get(selector.sourceId);
        if (!source || source.sourceType !== selector.sourceType) {
          throw new KnowledgeLlmRunAccessError('not_found');
        }
        counts[source.sourceType] += 1;
        return { ...source };
      });
      return { sources, sourceCounts: counts, selectedItemCount: 1 };
    },

    async budgetPreview(input) {
      state.budgetPreviewCalls += 1;
      state.budgetPreviewInputs.push(structuredClone(input));
      return budgetPreview(options.budgetPreview);
    },

    async writePreviewAudit(input) {
      state.previewAudits.push(structuredClone(input));
    },

    async findByRequestKey(input) {
      const found = state.runsByRequestKey.get(input.requestKeyHash);
      return found ? { ...found } : null;
    },

    async findOwned(input) {
      if (!state.currentAccess) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      const found = state.runsById.get(input.runId);
      return found?.actorUserId === input.actor.userId ? { ...found } : null;
    },

    async authorizeAndMarkDispatched(input) {
      state.authorizeCalls += 1;
      state.authorizeInputs.push(structuredClone(input));
      if (state.authorizeFailure) throw state.authorizeFailure;
      const run = state.runsById.get(input.runId);
      assert.ok(run);
      run.executionStatus = 'dispatched';
      run.dispatchedAt = new Date(state.now);
    },

    async captureProviderOutcome(input) {
      state.captureCalls += 1;
      state.captureInputs.push(structuredClone(input));
      if (state.captureFailure) throw new Error('synthetic_capture_failure');
      const existing = state.outcomesByRunId.get(input.runId);
      if (existing) {
        assert.deepEqual(existing, input.outcome);
        return;
      }
      state.outcomesByRunId.set(input.runId, structuredClone(input.outcome));
    },

    async finalizeCapturedOutcome(input) {
      state.finalizeCalls += 1;
      state.finalizeInputs.push(structuredClone(input));
      if (state.finalizeFailure) throw new Error('synthetic_finalize_failure');
      const run = state.runsById.get(input.runId);
      assert.ok(run);
      const outcome = state.outcomesByRunId.get(input.runId);
      assert.ok(outcome);
      if (outcome.status === 'invalid') {
        run.executionStatus = 'failed';
        run.settlementStatus = 'held_maximum';
        run.failureCode = outcome.failureCode;
      } else {
        run.executionStatus = 'result_ready';
        run.resultContent = outcome.normalizedContent;
        run.conversationId = 'synthetic-conversation';
        run.assistantTurnId = 'synthetic-assistant-turn';
        state.conversationTurnWrites += 2;
        if (outcome.status === 'valid') {
          run.settlementStatus = 'settled_actual';
          run.actualInputTokens = outcome.inputTokens;
          run.actualOutputTokens = outcome.outputTokens;
          run.actualCostMicros = 3n;
          run.failureCode = null;
        } else {
          run.settlementStatus = 'held_maximum';
          run.failureCode = outcome.failureCode;
        }
      }
      run.completedAt = new Date(state.now);
      return { ...run };
    },

    async holdResultUnknown(input) {
      state.holdCalls += 1;
      state.holdInputs.push(structuredClone(input));
      const run = state.runsById.get(input.runId);
      assert.ok(run);
      run.executionStatus = 'result_unknown';
      run.settlementStatus = 'held_maximum';
      run.failureCode = input.failureCode;
      run.completedAt = new Date(state.now);
      return { ...run };
    },

    async reconcile(input) {
      state.reconcileCalls += 1;
      const run = state.runsById.get(input.runId);
      if (!run || run.actorUserId !== input.actor.userId) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      if (
        run.executionStatus === 'result_unknown' &&
        state.outcomesByRunId.has(input.runId)
      ) {
        await runPort.finalizeCapturedOutcome(input);
      }
    },
  };

  const budgetPort = {
    async reserve(input) {
      state.budgetReserveCalls += 1;
      if (state.budgetFailure) return state.budgetFailure;
      const existing = state.runsByRequestKey.get(input.requestKeyHash);
      if (existing) {
        if (existing.requestPayloadHash !== input.requestPayloadHash) {
          return {
            ok: false,
            error: {
              status: 409,
              code: 'idempotency_conflict',
              message: 'Request conflict',
            },
          };
        }
        return {
          ok: true,
          value: {
            runId: existing.id,
            created: false,
            maximumCostMicros: existing.maximumCostMicros,
            currency: existing.currency,
            softLimitWarning: existing.softLimitWarning,
          },
        };
      }
      const run = makeRun(input);
      state.runsById.set(run.id, run);
      state.runsByRequestKey.set(input.requestKeyHash, run);
      return {
        ok: true,
        value: {
          runId: run.id,
          created: true,
          maximumCostMicros: run.maximumCostMicros,
          currency: run.currency,
          softLimitWarning: run.softLimitWarning,
        },
      };
    },
  };

  const tokenCodec = createKnowledgeLlmRunTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'synthetic-knowledge-llm-test-secret-0000000000000000',
    },
    now: () => new Date(state.now),
    randomId: () => {
      const suffix = String(state.nextRunId).padStart(12, '0');
      state.nextRunId += 1;
      return `00000000-0000-4000-8000-${suffix}`;
    },
  });
  const service = createKnowledgeLlmRunService({
    runtime: options.runtime ?? { provider: 'stub', catalog: modelCatalog },
    providerPort: options.providerPort === null ? null : provider,
    budgetPort,
    runPort,
    tokenCodec,
    clock: () => new Date(state.now),
  });
  return { state, service, provider, runPort, budgetPort, tokenCodec };
}

async function preview(harness, overrides = {}) {
  return harness.service.preview({
    actor: overrides.actor ?? actor,
    auditActor,
    request: request(overrides.request),
  });
}

async function execute(harness, previewResult, overrides = {}) {
  return harness.service.execute({
    actor: overrides.actor ?? actor,
    auditActor,
    request: request(overrides.request),
    previewToken: overrides.previewToken ?? previewResult.previewToken,
    requestKey: overrides.requestKey ?? 'SYNTHETIC-RAW-REQUEST-KEY',
    confirmed: overrides.confirmed ?? true,
  });
}

async function assertRejectCode(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof KnowledgeLlmRunError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

function stringLeaves(value) {
  if (typeof value === 'string') return [value];
  if (typeof value === 'bigint') return [value.toString()];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

test('disabled runtime performs no provider, budget, source, or audit work', async () => {
  const harness = createHarness({
    runtime: { provider: 'disabled', catalog: null },
  });

  await assertRejectCode(preview(harness), 503, 'knowledge_llm_disabled');
  assert.equal(harness.state.providerBindCalls, 0);
  assert.equal(harness.state.providerPrepareCalls, 0);
  assert.equal(harness.state.providerDispatchCalls, 0);
  assert.equal(harness.state.budgetReserveCalls, 0);
  assert.equal(harness.state.resolveCalls, 0);
  assert.deepEqual(harness.state.previewAudits, []);
});

test('enabled OpenAI-compatible runtime uses the same bounded run contract without fallback or retry', async () => {
  const harness = createHarness({
    runtime: {
      provider: 'openai',
      catalog: openAiModelCatalog,
      apiKey: 'synthetic-placeholder',
      baseUrl: 'https://synthetic.invalid/v1',
      timeoutMs: 1000,
      allowedHosts: ['synthetic.invalid'],
      allowHttp: false,
      allowPrivateIp: false,
    },
  });
  const requestOverrides = {
    provider: 'openai',
    model: 'synthetic-openai-compatible-v1',
    catalogVersion: openAiModelCatalog.version,
  };

  assert.deepEqual(harness.service.catalog(), {
    enabled: true,
    provider: 'openai',
    version: openAiModelCatalog.version,
    models: [
      {
        provider: 'openai',
        model: 'synthetic-openai-compatible-v1',
        maxInputTokens: 1_000_000,
        maxOutputTokens: 4096,
        inputCostMicrosPerMillion: '100000',
        outputCostMicrosPerMillion: '200000',
        currency: 'JPY',
      },
    ],
  });
  const previewResult = await preview(harness, { request: requestOverrides });
  const result = await execute(harness, previewResult, {
    request: requestOverrides,
  });

  assert.equal(result.run.executionStatus, 'result_ready');
  assert.equal(result.run.settlementStatus, 'settled_actual');
  assert.equal(result.run.result, 'SYNTHETIC-OPENAI-COMPATIBLE-RESULT');
  assert.equal(harness.state.providerPrepareCalls, 1);
  assert.equal(harness.state.providerDispatchCalls, 1);
  assert.equal(harness.state.captureCalls, 1);
  assert.equal(harness.state.finalizeCalls, 1);
});

test('budget summary rejects invalid personal and organization scope before repository access', async () => {
  const harness = createHarness();

  await assertRejectCode(
    harness.service.budget({
      actor,
      scope: 'personal',
      organizationId: actor.organizationId,
    }),
    400,
    'invalid_request',
  );
  await assertRejectCode(
    harness.service.budget({
      actor,
      scope: 'organization',
      organizationId: 'different-organization',
    }),
    400,
    'invalid_request',
  );
  assert.equal(harness.state.budgetPreviewCalls, 0);
});

test('budget summary remains model-independent while request preview binds catalog currency', async () => {
  const harness = createHarness();

  await harness.service.budget({
    actor,
    scope: 'personal',
    organizationId: null,
  });
  assert.equal(harness.state.budgetPreviewInputs[0].expectedCurrency, null);

  await preview(harness);
  assert.equal(harness.state.budgetPreviewInputs[1].expectedCurrency, 'JPY');
});

test('preview is mutation-free and binds only explicitly selected source context', async () => {
  const harness = createHarness();
  const result = await preview(harness);

  assert.equal(result.selectedSourceCount, 1);
  assert.equal(result.sourceCounts.snapshot, 1);
  assert.deepEqual(result.selectedSources, [
    {
      ordinal: 0,
      sourceType: 'snapshot',
      exactSourceVersion: 3,
      exactSourceHash: 'a'.repeat(64),
      byteLength: Buffer.byteLength('SELECTED-CONTEXT', 'utf8'),
      content: 'SELECTED-CONTEXT',
    },
  ]);
  assert.equal(JSON.stringify(result).includes('selected-source-id'), false);
  assert.equal(JSON.stringify(result).includes('UNSELECTED-CANARY'), false);
  assert.equal(harness.state.budgetReserveCalls, 0);
  assert.equal(harness.state.providerPrepareCalls, 0);
  assert.equal(harness.state.providerDispatchCalls, 0);
  assert.equal(harness.state.runsById.size, 0);
  assert.equal(harness.state.conversationTurnWrites, 0);
  assert.equal(harness.state.budgetPreviewInputs.length, 1);
  assert.equal(harness.state.budgetPreviewInputs[0].expectedCurrency, 'JPY');
  assert.ok(harness.state.boundProviderRequests.length > 0);
  for (const providerRequest of harness.state.boundProviderRequests) {
    assert.deepEqual(providerRequest.contextSections, ['SELECTED-CONTEXT']);
    assert.equal(
      JSON.stringify(providerRequest).includes('UNSELECTED-CANARY'),
      false,
    );
  }
});

test('execution requires explicit confirmation before reservation or dispatch', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);

  await assertRejectCode(
    execute(harness, previewResult, { confirmed: false }),
    400,
    'confirmation_required',
  );
  assert.equal(harness.state.budgetReserveCalls, 0);
  assert.equal(harness.state.providerPrepareCalls, 0);
  assert.equal(harness.state.providerDispatchCalls, 0);
});

test('execution rejects control, directional, and ill-formed request keys before reservation', async () => {
  for (const requestKey of [
    'synthetic\nkey',
    'synthetic\u202ekey',
    `synthetic${String.fromCharCode(0xd800)}key`,
  ]) {
    const harness = createHarness();
    const previewResult = await preview(harness);
    await assertRejectCode(
      execute(harness, previewResult, { requestKey }),
      400,
      'invalid_request',
    );
    assert.equal(harness.state.budgetReserveCalls, 0);
    assert.equal(harness.state.providerDispatchCalls, 0);
  }
});

test('valid stub execution reserves, dispatches once, and persists reported usage', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  const result = await execute(harness, previewResult);

  assert.equal(result.created, true);
  assert.equal(result.reused, false);
  assert.equal(result.run.executionStatus, 'result_ready');
  assert.equal(result.run.settlementStatus, 'settled_actual');
  assert.equal(result.run.result, 'Synthetic ex');
  assert.equal(harness.state.budgetReserveCalls, 1);
  assert.equal(harness.state.providerPrepareCalls, 1);
  assert.equal(harness.state.providerDispatchCalls, 1);
  assert.equal(harness.state.authorizeCalls, 1);
  assert.equal(harness.state.captureCalls, 1);
  assert.equal(harness.state.finalizeCalls, 1);
  assert.equal(harness.state.holdCalls, 0);
  assert.equal(harness.state.conversationTurnWrites, 2);
  assert.deepEqual(harness.state.preparedProviderRequests[0].contextSections, [
    'SELECTED-CONTEXT',
  ]);
});

test('same key and payload replay reuses one run without duplicate reservation, dispatch, or turns', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  const first = await execute(harness, previewResult);
  const before = {
    reservations: harness.state.budgetReserveCalls,
    prepares: harness.state.providerPrepareCalls,
    dispatches: harness.state.providerDispatchCalls,
    finalizations: harness.state.finalizeCalls,
    turns: harness.state.conversationTurnWrites,
  };

  const second = await execute(harness, previewResult);

  assert.equal(second.created, false);
  assert.equal(second.reused, true);
  assert.equal(second.run.id, first.run.id);
  assert.deepEqual(
    {
      reservations: harness.state.budgetReserveCalls,
      prepares: harness.state.providerPrepareCalls,
      dispatches: harness.state.providerDispatchCalls,
      finalizations: harness.state.finalizeCalls,
      turns: harness.state.conversationTurnWrites,
    },
    before,
  );
});

test('same key and payload reuse survives a fresh preview with a different reserved run id', async () => {
  const harness = createHarness();
  const firstPreview = await preview(harness);
  const first = await execute(harness, firstPreview);
  const secondPreview = await preview(harness);
  assert.notEqual(secondPreview.runId, firstPreview.runId);
  const before = {
    reservations: harness.state.budgetReserveCalls,
    prepares: harness.state.providerPrepareCalls,
    dispatches: harness.state.providerDispatchCalls,
    finalizations: harness.state.finalizeCalls,
    turns: harness.state.conversationTurnWrites,
  };

  const second = await execute(harness, secondPreview);

  assert.equal(second.created, false);
  assert.equal(second.reused, true);
  assert.equal(second.run.id, first.run.id);
  assert.deepEqual(
    {
      reservations: harness.state.budgetReserveCalls,
      prepares: harness.state.providerPrepareCalls,
      dispatches: harness.state.providerDispatchCalls,
      finalizations: harness.state.finalizeCalls,
      turns: harness.state.conversationTurnWrites,
    },
    before,
  );
});

test('same request key with a different payload conflicts without another reservation or dispatch', async () => {
  const harness = createHarness();
  const firstPreview = await preview(harness);
  await execute(harness, firstPreview);
  const secondRequest = {
    userPrompt: 'DIFFERENT-SYNTHETIC-PROMPT',
  };
  const secondPreview = await preview(harness, { request: secondRequest });
  const before = {
    reservations: harness.state.budgetReserveCalls,
    prepares: harness.state.providerPrepareCalls,
    dispatches: harness.state.providerDispatchCalls,
    turns: harness.state.conversationTurnWrites,
  };

  await assertRejectCode(
    execute(harness, secondPreview, { request: secondRequest }),
    409,
    'idempotency_conflict',
  );
  assert.deepEqual(
    {
      reservations: harness.state.budgetReserveCalls,
      prepares: harness.state.providerPrepareCalls,
      dispatches: harness.state.providerDispatchCalls,
      turns: harness.state.conversationTurnWrites,
    },
    before,
  );
});

test('preview token rejects tampering, expiry, and actor mismatch before dispatch', async (t) => {
  await t.test('tampered token', async () => {
    const harness = createHarness();
    const previewResult = await preview(harness);
    const tampered = `${previewResult.previewToken.slice(0, -1)}${
      previewResult.previewToken.endsWith('A') ? 'B' : 'A'
    }`;
    await assertRejectCode(
      execute(harness, previewResult, { previewToken: tampered }),
      400,
      'preview_token_invalid',
    );
    assert.equal(harness.state.providerDispatchCalls, 0);
  });

  await t.test('expired token', async () => {
    const harness = createHarness();
    const previewResult = await preview(harness);
    harness.state.now = new Date(previewResult.expiresAt);
    await assertRejectCode(
      execute(harness, previewResult),
      409,
      'preview_token_expired',
    );
    assert.equal(harness.state.budgetReserveCalls, 0);
    assert.equal(harness.state.providerDispatchCalls, 0);
  });

  await t.test('actor mismatch', async () => {
    const harness = createHarness();
    const previewResult = await preview(harness);
    await assertRejectCode(
      execute(harness, previewResult, { actor: otherActor }),
      400,
      'preview_token_invalid',
    );
    assert.equal(harness.state.resolveCalls, 1);
    assert.equal(harness.state.providerDispatchCalls, 0);
  });
});

test('ACL loss and exact source change fail closed without reservation or dispatch', async (t) => {
  await t.test('ACL loss', async () => {
    const harness = createHarness();
    const previewResult = await preview(harness);
    harness.state.resolveFailure = new KnowledgeLlmRunAccessError('not_found');
    await assertRejectCode(execute(harness, previewResult), 404, 'not_found');
    assert.equal(harness.state.budgetReserveCalls, 0);
    assert.equal(harness.state.providerDispatchCalls, 0);
  });

  await t.test('source version and content become stale', async () => {
    const harness = createHarness();
    const previewResult = await preview(harness);
    harness.state.sources.set('selected-source-id', {
      ...harness.state.sources.get('selected-source-id'),
      exactSourceVersion: 4,
      exactSourceHash: 'c'.repeat(64),
      representation: 'CHANGED-SELECTED-CONTEXT',
    });
    await assertRejectCode(
      execute(harness, previewResult),
      409,
      'stale_preview',
    );
    assert.equal(harness.state.budgetReserveCalls, 0);
    assert.equal(harness.state.providerDispatchCalls, 0);
  });
});

test('ACL loss after dispatch permits accounting finalization but returns no result content', async () => {
  const harness = createHarness({ providerMode: 'acl_loss_after_dispatch' });
  const previewResult = await preview(harness);

  await assertRejectCode(execute(harness, previewResult), 404, 'not_found');
  const stored = [...harness.state.runsById.values()][0];
  assert.equal(stored.executionStatus, 'result_ready');
  assert.equal(stored.settlementStatus, 'settled_actual');
  assert.equal(harness.state.providerDispatchCalls, 1);
  assert.equal(harness.state.conversationTurnWrites, 2);
});

test('budget hard-limit and rate-limit failures propagate before provider dispatch', async (t) => {
  for (const failure of [
    { status: 409, code: 'budget_hard_limit' },
    { status: 429, code: 'rate_limit' },
  ]) {
    await t.test(failure.code, async () => {
      const harness = createHarness({
        budgetFailure: {
          ok: false,
          error: {
            ...failure,
            message: 'Synthetic budget rejection',
          },
        },
      });
      const previewResult = await preview(harness);
      await assertRejectCode(
        execute(harness, previewResult),
        failure.status,
        failure.code,
      );
      assert.equal(harness.state.budgetReserveCalls, 1);
      assert.equal(harness.state.providerDispatchCalls, 0);
      assert.equal(harness.state.conversationTurnWrites, 0);
    });
  }
});

test('provider pre-dispatch rejection is external failure without reservation or dispatch', async () => {
  const harness = createHarness({ providerMode: 'rejected_before_dispatch' });
  const previewResult = await preview(harness);

  await assertRejectCode(
    execute(harness, previewResult),
    503,
    'rejected_before_dispatch',
  );
  assert.equal(harness.state.providerPrepareCalls, 1);
  assert.equal(harness.state.budgetReserveCalls, 0);
  assert.equal(harness.state.providerDispatchCalls, 0);
  assert.equal(harness.state.conversationTurnWrites, 0);
});

test('provider outcome unknown and finalization failure hold the maximum reservation without result', async (t) => {
  for (const scenario of [
    {
      name: 'provider outcome unknown',
      options: { providerMode: 'timeout' },
      failureCode: 'timeout_outcome_unknown',
    },
    {
      name: 'outcome capture failure',
      options: { captureFailure: true },
      failureCode: 'finalization_failed',
    },
    {
      name: 'result finalization failure',
      options: { finalizeFailure: true },
      failureCode: 'finalization_failed',
    },
  ]) {
    await t.test(scenario.name, async () => {
      const harness = createHarness(scenario.options);
      const previewResult = await preview(harness);
      const result = await execute(harness, previewResult);

      assert.equal(result.run.executionStatus, 'result_unknown');
      assert.equal(result.run.settlementStatus, 'held_maximum');
      assert.equal(result.run.failureCode, scenario.failureCode);
      assert.equal(harness.state.holdCalls, 1);
      assert.equal(harness.state.conversationTurnWrites, 0);
      assert.equal(harness.state.providerDispatchCalls, 1);
    });
  }
});

test('known provider failures are captured once and terminate failed without retry or fallback', async (t) => {
  for (const failureCode of [
    'provider_4xx',
    'provider_5xx',
    'malformed_response',
    'response_oversize',
    'empty_result',
  ]) {
    await t.test(failureCode, async () => {
      const harness = createHarness({ providerMode: failureCode });
      const previewResult = await preview(harness);
      const result = await execute(harness, previewResult);

      assert.equal(result.run.executionStatus, 'failed');
      assert.equal(result.run.settlementStatus, 'held_maximum');
      assert.equal(result.run.failureCode, failureCode);
      assert.equal(result.run.result, null);
      assert.equal(harness.state.providerPrepareCalls, 1);
      assert.equal(harness.state.providerDispatchCalls, 1);
      assert.equal(harness.state.captureCalls, 1);
      assert.equal(harness.state.finalizeCalls, 1);
      assert.equal(harness.state.holdCalls, 0);
      assert.equal(harness.state.conversationTurnWrites, 0);
    });
  }
});

test('valid result with missing or invalid usage is retained with maximum reservation held', async (t) => {
  for (const [providerMode, expectedFailureCode] of [
    ['missing_usage', 'usage_missing'],
    ['invalid_usage', 'usage_invalid'],
  ]) {
    await t.test(providerMode, async () => {
      const harness = createHarness({ providerMode });
      const previewResult = await preview(harness);
      const result = await execute(harness, previewResult);

      assert.equal(result.run.executionStatus, 'result_ready');
      assert.equal(result.run.settlementStatus, 'held_maximum');
      assert.equal(result.run.failureCode, expectedFailureCode);
      assert.equal(result.run.result, 'SYNTHETIC-PROVIDER-RESULT');
      assert.equal(harness.state.captureCalls, 1);
      assert.equal(
        harness.state.captureInputs[0].outcome.failureCode,
        expectedFailureCode,
      );
      assert.equal(harness.state.holdCalls, 0);
      assert.equal(harness.state.conversationTurnWrites, 2);
      assert.equal(harness.state.providerDispatchCalls, 1);
    });
  }
});

test('invalid or oversized provider content is never persisted as a successful result', async (t) => {
  for (const providerMode of [
    'invalid_content',
    'non_string_content',
    'oversize_content',
  ]) {
    await t.test(providerMode, async () => {
      const harness = createHarness({ providerMode });
      const previewResult = await preview(harness);
      const result = await execute(harness, previewResult);

      assert.equal(result.run.executionStatus, 'failed');
      assert.equal(result.run.settlementStatus, 'held_maximum');
      assert.equal(
        result.run.failureCode,
        providerMode === 'oversize_content'
          ? 'response_oversize'
          : 'malformed_response',
      );
      assert.equal(result.run.result, null);
      assert.equal(harness.state.captureCalls, 1);
      assert.equal(harness.state.finalizeCalls, 1);
      assert.equal(harness.state.conversationTurnWrites, 0);
      assert.equal(harness.state.providerDispatchCalls, 1);
    });
  }
});

test('reconcile delegates once to the run port and returns its allowlisted view', async () => {
  const harness = createHarness({ providerMode: 'timeout' });
  const previewResult = await preview(harness);
  const executed = await execute(harness, previewResult);

  const result = await harness.service.reconcile({
    actor,
    auditActor,
    runId: executed.run.id,
  });

  assert.equal(harness.state.reconcileCalls, 1);
  assert.equal(result.id, executed.run.id);
  assert.equal(result.executionStatus, 'result_unknown');
  assert.equal(harness.state.providerDispatchCalls, 1);
});

test('reconcile finalizes a saved local outcome without redispatch', async () => {
  const harness = createHarness({ finalizeFailure: true });
  const previewResult = await preview(harness);
  const executed = await execute(harness, previewResult);
  assert.equal(executed.run.executionStatus, 'result_unknown');
  assert.equal(executed.run.failureCode, 'finalization_failed');
  assert.equal(harness.state.providerDispatchCalls, 1);
  assert.equal(harness.state.captureCalls, 1);

  harness.state.finalizeFailure = false;
  const reconciled = await harness.service.reconcile({
    actor,
    auditActor,
    runId: executed.run.id,
  });

  assert.equal(reconciled.executionStatus, 'result_ready');
  assert.equal(reconciled.settlementStatus, 'settled_actual');
  assert.equal(reconciled.result, 'Synthetic ex');
  assert.equal(harness.state.providerDispatchCalls, 1);
  assert.equal(harness.state.captureCalls, 1);
  assert.equal(harness.state.conversationTurnWrites, 2);
});

test('reconcile remains available after the provider runtime is disabled', async () => {
  const harness = createHarness({ providerMode: 'timeout' });
  const previewResult = await preview(harness);
  const executed = await execute(harness, previewResult);
  const disabledService = createKnowledgeLlmRunService({
    runtime: { provider: 'disabled', catalog: null },
    providerPort: null,
    budgetPort: harness.budgetPort,
    runPort: harness.runPort,
    tokenCodec: harness.tokenCodec,
    clock: () => new Date(harness.state.now),
  });

  const result = await disabledService.reconcile({
    actor,
    auditActor,
    runId: executed.run.id,
  });

  assert.equal(harness.state.reconcileCalls, 1);
  assert.equal(result.id, executed.run.id);
  assert.equal(harness.state.providerDispatchCalls, 1);
});

test('preview audit input excludes raw prompt, result, request key, source ID, and context', async () => {
  const harness = createHarness();
  const previewResult = await preview(harness);
  await execute(harness, previewResult, {
    requestKey: 'RAW-REQUEST-KEY-CANARY',
  });

  assert.equal(harness.state.previewAudits.length, 1);
  const leaves = stringLeaves(harness.state.previewAudits);
  for (const forbidden of [
    'SYNTHETIC-USER-PROMPT',
    'Synthetic ex',
    'SYNTHETIC-PROVIDER-RESULT',
    'RAW-REQUEST-KEY-CANARY',
    'selected-source-id',
    'SELECTED-CONTEXT',
    'UNSELECTED-CANARY',
  ]) {
    assert.equal(
      leaves.some((value) => value.includes(forbidden)),
      false,
      `audit input must not contain ${forbidden}`,
    );
  }
  assert.deepEqual(Object.keys(harness.state.previewAudits[0]).sort(), [
    'actor',
    'auditActor',
    'catalogVersion',
    'currency',
    'estimatedInputTokens',
    'maxOutputTokens',
    'maximumCostMicros',
    'model',
    'provider',
    'runId',
    'scope',
    'sourceCounts',
  ]);
});
