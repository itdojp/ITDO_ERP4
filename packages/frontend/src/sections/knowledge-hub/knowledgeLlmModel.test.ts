import { describe, expect, it } from 'vitest';

import {
  formatKnowledgeLlmCost,
  knowledgeLlmRunIsPending,
  knowledgeLlmRunNeedsReconciliation,
  validateKnowledgeLlmRequest,
  type KnowledgeLlmCatalog,
  type KnowledgeLlmRequest,
  type KnowledgeLlmRun,
} from './knowledgeLlmModel';

const catalog: KnowledgeLlmCatalog = {
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
    },
  ],
};

const request: KnowledgeLlmRequest = {
  scope: 'personal',
  organizationId: null,
  provider: 'stub',
  model: 'stub-v1',
  catalogVersion: 7,
  userPrompt: '選択内容だけを検討してください。',
  maxOutputTokens: 128,
  sources: [{ sourceType: 'snapshot', sourceId: 'snapshot-internal' }],
};

const run: KnowledgeLlmRun = {
  id: 'run-internal',
  provider: 'stub',
  model: 'stub-v1',
  catalogVersion: 7,
  promptTemplateVersion: 1,
  scope: 'personal',
  estimatedInputTokens: 10,
  maxOutputTokens: 128,
  maximumCostMicros: '100',
  actualInputTokens: 10,
  actualOutputTokens: 4,
  actualCostMicros: '4',
  currency: 'JPY',
  softLimitWarning: false,
  executionStatus: 'result_ready',
  settlementStatus: 'settled_actual',
  failureCode: null,
  result: 'synthetic result',
  conversationId: 'conversation-internal',
  createdAt: '2026-08-13T00:00:00.000Z',
  dispatchedAt: '2026-08-13T00:00:01.000Z',
  completedAt: '2026-08-13T00:00:02.000Z',
};

describe('knowledgeLlmModel', () => {
  it('accepts an allowlisted bounded personal request', () => {
    expect(validateKnowledgeLlmRequest({ request, catalog })).toBeNull();
  });

  it('rejects disabled, unknown model, invalid scope, oversize prompt, and source bounds', () => {
    expect(
      validateKnowledgeLlmRequest({
        request,
        catalog: { enabled: false, provider: null, version: null, models: [] },
      }),
    ).toMatch('無効');
    expect(
      validateKnowledgeLlmRequest({
        request: { ...request, model: 'client-selected-model' },
        catalog,
      }),
    ).toMatch('許可');
    expect(
      validateKnowledgeLlmRequest({
        request: { ...request, organizationId: 'must-not-be-present' },
        catalog,
      }),
    ).toMatch('scope');
    expect(
      validateKnowledgeLlmRequest({
        request: { ...request, userPrompt: '界'.repeat(6_000) },
        catalog,
      }),
    ).toMatch('16 KiB');
    expect(
      validateKnowledgeLlmRequest({
        request: { ...request, sources: [] },
        catalog,
      }),
    ).toMatch('1件以上32件以内');
  });

  it('formats integer micro-units only and identifies held/unknown runs', () => {
    expect(formatKnowledgeLlmCost('123', 'JPY')).toBe('123 JPY micro-unit');
    expect(formatKnowledgeLlmCost('1.5', 'JPY')).toBe('-');
    expect(knowledgeLlmRunIsPending(run)).toBe(false);
    expect(
      knowledgeLlmRunIsPending({ ...run, executionStatus: 'reserved' }),
    ).toBe(true);
    expect(
      knowledgeLlmRunIsPending({ ...run, executionStatus: 'dispatched' }),
    ).toBe(true);
    expect(knowledgeLlmRunNeedsReconciliation(run)).toBe(false);
    expect(
      knowledgeLlmRunNeedsReconciliation({
        ...run,
        settlementStatus: 'held_maximum',
      }),
    ).toBe(true);
    expect(
      knowledgeLlmRunNeedsReconciliation({
        ...run,
        executionStatus: 'result_unknown',
      }),
    ).toBe(true);
    expect(
      knowledgeLlmRunNeedsReconciliation({
        ...run,
        executionStatus: 'reserved',
        settlementStatus: 'reserved',
      }),
    ).toBe(true);
    expect(
      knowledgeLlmRunNeedsReconciliation({
        ...run,
        executionStatus: 'dispatched',
        settlementStatus: 'reserved',
      }),
    ).toBe(true);
  });
});
