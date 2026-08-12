import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({ apiResponse: vi.fn() }));
vi.mock('../../api', () => ({ apiResponse }));

import {
  executeKnowledgeLlmRun,
  fetchKnowledgeLlmBudget,
  fetchKnowledgeLlmCatalog,
  fetchKnowledgeLlmRun,
  previewKnowledgeLlmRun,
  reconcileKnowledgeLlmRun,
} from './knowledgeLlmApi';
import type { KnowledgeLlmRequest } from './knowledgeLlmModel';

const timestamp = '2026-08-13T00:00:00.000Z';
const request: KnowledgeLlmRequest = {
  scope: 'personal',
  organizationId: null,
  provider: 'stub',
  model: 'stub-v1',
  catalogVersion: 7,
  userPrompt: 'synthetic prompt',
  maxOutputTokens: 128,
  sources: [{ sourceType: 'snapshot', sourceId: 'snapshot-internal' }],
};

const budget = {
  configured: true,
  policyCount: 1,
  currency: 'JPY',
  softLimitWarning: false,
  hardLimitBlocked: false,
  rateBlocked: false,
  subjects: [
    {
      subjectType: 'user',
      softLimitMicros: '1000',
      hardLimitMicros: '2000',
      activeReservedMicros: '0',
      settledActualMicros: '10',
      heldMaximumMicros: '0',
      requestsPerHour: 10,
      acceptedRequestsLastHour: 1,
      subjectId: 'must-drop',
    },
  ],
  providerKey: 'must-drop',
};

const run = {
  id: 'run-internal',
  provider: 'stub',
  model: 'stub-v1',
  catalogVersion: 7,
  promptTemplateVersion: 1,
  scope: 'personal',
  estimatedInputTokens: 12,
  maxOutputTokens: 128,
  maximumCostMicros: '100',
  actualInputTokens: 12,
  actualOutputTokens: 4,
  actualCostMicros: '4',
  currency: 'JPY',
  softLimitWarning: false,
  executionStatus: 'result_ready',
  settlementStatus: 'settled_actual',
  failureCode: null,
  result: 'synthetic result',
  conversationId: 'conversation-internal',
  createdAt: timestamp,
  dispatchedAt: timestamp,
  completedAt: timestamp,
  providerUrl: 'https://private.invalid/v1',
  providerRequestId: 'must-drop',
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => apiResponse.mockReset());

describe('knowledgeLlmApi', () => {
  it('normalizes catalog and budget allowlists and binds the organization query', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({
          enabled: true,
          provider: 'stub',
          version: 7,
          models: [
            {
              provider: 'stub',
              model: 'stub-v1',
              maxInputTokens: 4096,
              maxOutputTokens: 512,
              inputCostMicrosPerMillion: '1000',
              outputCostMicrosPerMillion: '2000',
              currency: 'JPY',
              baseUrl: 'must-drop',
            },
          ],
          apiKey: 'must-drop',
        }),
      )
      .mockResolvedValueOnce(response(budget));

    const catalog = await fetchKnowledgeLlmCatalog();
    const normalizedBudget = await fetchKnowledgeLlmBudget({
      scope: 'organization',
      organizationId: 'org/internal',
    });

    expect(catalog).not.toHaveProperty('apiKey');
    expect(catalog.models[0]).not.toHaveProperty('baseUrl');
    expect(normalizedBudget).not.toHaveProperty('providerKey');
    expect(normalizedBudget.subjects[0]).not.toHaveProperty('subjectId');
    expect(apiResponse.mock.calls[1][0]).toBe(
      '/knowledge/llm/budget?scope=organization&organizationId=org%2Finternal',
    );
  });

  it('previews and executes an exact one-shot payload without copying response internals', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({
          runId: 'run-internal',
          provider: 'stub',
          model: 'stub-v1',
          catalogVersion: 7,
          promptTemplateVersion: 1,
          scope: 'personal',
          selectedSources: [
            {
              ordinal: 0,
              sourceType: 'snapshot',
              exactSourceVersion: 3,
              exactSourceHash: 'a'.repeat(64),
              byteLength: 20,
              content: 'selected only',
              sourceId: 'must-drop',
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
          totalContextBytes: 20,
          estimatedInputTokens: 12,
          maxOutputTokens: 128,
          maximumCostMicros: '100',
          currency: 'JPY',
          budget,
          expiresAt: timestamp,
          previewToken: 'opaque-token',
          rawPrompt: 'must-drop',
        }),
      )
      .mockResolvedValueOnce(
        response({
          created: true,
          reused: false,
          run,
          requestKey: 'must-drop',
        }),
      );

    const preview = await previewKnowledgeLlmRun(request);
    const executed = await executeKnowledgeLlmRun({
      request,
      previewToken: preview.previewToken,
      requestKey: 'opaque-request-key',
    });

    expect(preview.selectedSources[0]).not.toHaveProperty('sourceId');
    expect(preview).not.toHaveProperty('rawPrompt');
    expect(executed.run).not.toHaveProperty('providerUrl');
    expect(executed.run).not.toHaveProperty('providerRequestId');
    expect(executed).not.toHaveProperty('requestKey');
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      ...request,
      previewToken: 'opaque-token',
      requestKey: 'opaque-request-key',
      confirmed: true,
    });
  });

  it('loads and reconciles by encoded run ID without exposing unknown response fields', async () => {
    apiResponse.mockImplementation(async () => response(run));
    const controller = new AbortController();
    const loaded = await fetchKnowledgeLlmRun('run/one', controller.signal);
    const reconciled = await reconcileKnowledgeLlmRun(
      'run/one',
      controller.signal,
    );
    expect(loaded).toEqual(reconciled);
    expect(apiResponse.mock.calls[0][0]).toBe('/knowledge/llm/runs/run%2Fone');
    expect(apiResponse.mock.calls[1][0]).toBe(
      '/knowledge/llm/runs/run%2Fone/reconcile',
    );
    expect(apiResponse.mock.calls[1][1].method).toBe('POST');
  });

  it('fails closed on invalid provider/status/hash and normalizes 403/404 identically', async () => {
    apiResponse.mockResolvedValueOnce(
      response({
        enabled: true,
        provider: 'arbitrary',
        version: 1,
        models: [],
      }),
    );
    await expect(fetchKnowledgeLlmCatalog()).rejects.toMatchObject({
      code: 'invalid_response',
    });

    apiResponse.mockResolvedValueOnce(
      response(
        { error: { code: 'forbidden', message: 'private detail' } },
        403,
      ),
    );
    await expect(fetchKnowledgeLlmRun('hidden')).rejects.toMatchObject({
      code: 'not_found',
      status: 403,
    });

    apiResponse.mockResolvedValueOnce(
      response({ ...run, executionStatus: 'provider-internal-status' }),
    );
    await expect(fetchKnowledgeLlmRun('run')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
