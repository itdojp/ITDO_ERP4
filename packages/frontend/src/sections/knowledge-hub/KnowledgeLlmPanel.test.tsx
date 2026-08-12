import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  executeKnowledgeLlmRun: vi.fn(),
  fetchKnowledgeLlmBudget: vi.fn(),
  fetchKnowledgeLlmCatalog: vi.fn(),
  fetchKnowledgeLlmRun: vi.fn(),
  getKnowledgeSynthesis: vi.fn(),
  listKnowledgeAnnotations: vi.fn(),
  listKnowledgeConversations: vi.fn(),
  listKnowledgeConversationTurns: vi.fn(),
  listKnowledgeSyntheses: vi.fn(),
  previewKnowledgeLlmRun: vi.fn(),
  reconcileKnowledgeLlmRun: vi.fn(),
}));

vi.mock('./knowledgeLlmApi', () => ({
  executeKnowledgeLlmRun: apiMocks.executeKnowledgeLlmRun,
  fetchKnowledgeLlmBudget: apiMocks.fetchKnowledgeLlmBudget,
  fetchKnowledgeLlmCatalog: apiMocks.fetchKnowledgeLlmCatalog,
  fetchKnowledgeLlmRun: apiMocks.fetchKnowledgeLlmRun,
  previewKnowledgeLlmRun: apiMocks.previewKnowledgeLlmRun,
  reconcileKnowledgeLlmRun: apiMocks.reconcileKnowledgeLlmRun,
}));

vi.mock('./knowledgeProvenanceApi', () => ({
  getKnowledgeSynthesis: apiMocks.getKnowledgeSynthesis,
  listKnowledgeAnnotations: apiMocks.listKnowledgeAnnotations,
  listKnowledgeConversations: apiMocks.listKnowledgeConversations,
  listKnowledgeConversationTurns: apiMocks.listKnowledgeConversationTurns,
  listKnowledgeSyntheses: apiMocks.listKnowledgeSyntheses,
}));

import { KnowledgeLlmPanel } from './KnowledgeLlmPanel';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import type { KnowledgeSnapshot } from './knowledgeHubModel';
import type { KnowledgeLlmRun } from './knowledgeLlmModel';

const timestamp = '2026-08-13T00:00:00.000Z';
const catalog = {
  enabled: true,
  provider: 'stub' as const,
  version: 7,
  models: [
    {
      provider: 'stub' as const,
      model: 'stub-v1',
      maxInputTokens: 4096,
      maxOutputTokens: 512,
      inputCostMicrosPerMillion: '1000',
      outputCostMicrosPerMillion: '2000',
      currency: 'JPY',
    },
  ],
};
const budget = {
  configured: true,
  policyCount: 1,
  currency: 'JPY',
  softLimitWarning: false,
  hardLimitBlocked: false,
  rateBlocked: false,
  subjects: [],
};

function snapshot(id: string, version: number): KnowledgeSnapshot {
  return {
    id,
    knowledgeItemId: 'item-1',
    version,
    status: 'ready',
    captureMethod: 'text',
    sourceUrl: null,
    originalName: `snapshot-${version}.txt`,
    contentType: 'text/plain',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    failureCode: null,
    capturedAt: timestamp,
    capturedBy: 'actor',
    readyAt: timestamp,
    failedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function run(overrides: Partial<KnowledgeLlmRun> = {}): KnowledgeLlmRun {
  return {
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
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-internal',
    provider: 'stub' as const,
    model: 'stub-v1',
    catalogVersion: 7,
    promptTemplateVersion: 1,
    scope: 'personal' as const,
    selectedSources: [
      {
        ordinal: 0,
        sourceType: 'snapshot' as const,
        exactSourceVersion: 3,
        exactSourceHash: 'a'.repeat(64),
        byteLength: 18,
        content: 'SELECTED-SNAPSHOT',
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
    totalContextBytes: 18,
    estimatedInputTokens: 12,
    maxOutputTokens: 128,
    maximumCostMicros: '100',
    currency: 'JPY',
    budget,
    expiresAt: '2026-08-13T00:10:00.000Z',
    previewToken: 'opaque-preview-token',
    ...overrides,
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof KnowledgeLlmPanel>> = {},
) {
  return render(
    <KnowledgeLlmPanel
      itemId="item-1"
      itemScope="personal"
      organizationId={null}
      snapshots={[snapshot('snapshot-old', 2), snapshot('snapshot-latest', 3)]}
      {...props}
    />,
  );
}

async function previewDefaultSource() {
  await screen.findByText('Snapshot version 3');
  fireEvent.change(screen.getByLabelText('外部LLMへの指示'), {
    target: { value: '選択内容だけを検討してください。' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: '外部送信内容をプレビュー' }),
  );
  await screen.findByRole('heading', { name: '3. Exact preview・明示confirm' });
}

beforeEach(() => {
  apiMocks.fetchKnowledgeLlmCatalog.mockResolvedValue(catalog);
  apiMocks.fetchKnowledgeLlmBudget.mockResolvedValue(budget);
  apiMocks.listKnowledgeAnnotations.mockResolvedValue({
    items: [
      {
        id: 'annotation-internal',
        knowledgeItemId: 'item-1',
        scope: 'personal',
        kind: 'note',
        origin: 'user',
        currentRevision: 1,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: {
          id: 'annotation-revision-internal',
          annotationId: 'annotation-internal',
          revision: 1,
          kind: 'note',
          origin: 'user',
          content: 'UNSELECTED-ANNOTATION-CANARY',
          createdAt: timestamp,
        },
      },
    ],
    nextCursor: null,
  });
  apiMocks.listKnowledgeConversations.mockResolvedValue({
    items: [
      {
        id: 'conversation-internal',
        title: 'Synthetic conversation',
        sourceType: 'manual',
        provider: null,
        model: null,
        capturedAt: timestamp,
        importedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [],
      },
    ],
    nextCursor: null,
  });
  apiMocks.listKnowledgeConversationTurns.mockResolvedValue({
    items: [
      {
        id: 'turn-ai-internal',
        conversationId: 'conversation-internal',
        sequence: 1,
        role: 'assistant',
        origin: 'ai',
        content: 'UNSELECTED-AI-CANARY',
        name: null,
        occurredAt: null,
        createdAt: timestamp,
      },
      {
        id: 'turn-system-internal',
        conversationId: 'conversation-internal',
        sequence: 2,
        role: 'system',
        origin: 'system',
        content: 'UNSELECTED-SYSTEM-CANARY',
        name: null,
        occurredAt: null,
        createdAt: timestamp,
      },
    ],
    nextCursor: null,
  });
  apiMocks.listKnowledgeSyntheses.mockResolvedValue({
    items: [
      {
        id: 'synthesis-internal',
        scope: 'personal',
        title: 'Synthetic synthesis',
        currentVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    nextCursor: null,
  });
  apiMocks.getKnowledgeSynthesis.mockResolvedValue({
    synthesis: {
      id: 'synthesis-internal',
      scope: 'personal',
      title: 'Synthetic synthesis',
      currentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    currentVersion: {
      id: 'synthesis-version-internal',
      synthesisId: 'synthesis-internal',
      version: 1,
      content: 'UNSELECTED-SYNTHESIS-CANARY',
      unresolvedQuestions: [],
      confidenceBasisPoints: 8000,
      createdAt: timestamp,
      sources: [
        {
          id: 'source-internal',
          kind: 'item',
          sourceId: 'item-1',
          relationType: 'primary',
          ordinal: 0,
          accessible: true,
          createdAt: timestamp,
        },
      ],
    },
  });
  apiMocks.previewKnowledgeLlmRun.mockResolvedValue(preview());
  apiMocks.executeKnowledgeLlmRun.mockResolvedValue({
    created: true,
    reused: false,
    run: run(),
  });
  apiMocks.fetchKnowledgeLlmRun.mockResolvedValue(run());
  apiMocks.reconcileKnowledgeLlmRun.mockResolvedValue(run());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgeLlmPanel', () => {
  it('keeps the default-disabled boundary and does not load context or budget', async () => {
    apiMocks.fetchKnowledgeLlmCatalog.mockResolvedValue({
      enabled: false,
      provider: null,
      version: null,
      models: [],
    });
    renderPanel();
    expect(await screen.findByText(/外部LLMは無効です/)).toBeInTheDocument();
    expect(apiMocks.fetchKnowledgeLlmBudget).not.toHaveBeenCalled();
    expect(apiMocks.listKnowledgeAnnotations).not.toHaveBeenCalled();
    expect(apiMocks.previewKnowledgeLlmRun).not.toHaveBeenCalled();
  });

  it('selects only the latest ready snapshot by default and executes once after exact confirm', async () => {
    const onBusy = vi.fn();
    renderPanel({ onCommitBusyChange: onBusy });
    expect(
      await screen.findByRole('checkbox', {
        name: /Synthetic conversation \/ system turn 2/,
      }),
    ).toBeDisabled();
    await previewDefaultSource();

    expect(apiMocks.previewKnowledgeLlmRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ sourceType: 'snapshot', sourceId: 'snapshot-latest' }],
      }),
      expect.any(AbortSignal),
    );
    expect(screen.getByText('SELECTED-SNAPSHOT')).toBeInTheDocument();
    expect(screen.queryByText(/UNSELECTED-.*-CANARY/)).not.toBeInTheDocument();
    expect(screen.queryByText('opaque-preview-token')).not.toBeInTheDocument();
    expect(screen.queryByText('snapshot-latest')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    );
    expect(await screen.findByText('synthetic result')).toBeInTheDocument();
    expect(apiMocks.executeKnowledgeLlmRun).toHaveBeenCalledTimes(1);
    expect(onBusy).toHaveBeenNthCalledWith(1, true);
    expect(onBusy).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('conversation-internal')).not.toBeInTheDocument();
  });

  it('purges the previous run reference before creating a new preview', async () => {
    renderPanel();
    await previewDefaultSource();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    );
    expect(await screen.findByText('synthetic result')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '外部送信内容をプレビュー' }),
    );
    await waitFor(() => {
      expect(apiMocks.previewKnowledgeLlmRun).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText('synthetic result')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '状態を確認' }),
    ).not.toBeInTheDocument();
  });

  it('purges exact preview and result when current source access is lost', async () => {
    apiMocks.fetchKnowledgeLlmRun.mockRejectedValue(
      new KnowledgeHubApiError('not_found', 404),
    );
    renderPanel();
    await previewDefaultSource();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    );
    expect(await screen.findByText('synthetic result')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '状態を確認' }));
    expect(
      await screen.findByText(
        '対象が見つからないか、現在の権限では参照できません。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('synthetic result')).not.toBeInTheDocument();
    expect(screen.queryByText('SELECTED-SNAPSHOT')).not.toBeInTheDocument();
  });

  it('shows soft warning and blocks execution for hard/rate limits', async () => {
    apiMocks.previewKnowledgeLlmRun.mockResolvedValue(
      preview({
        budget: {
          ...budget,
          softLimitWarning: true,
          hardLimitBlocked: true,
        },
      }),
    );
    renderPanel();
    await previewDefaultSource();
    expect(screen.getByText(/soft limitを超える見込み/)).toBeInTheDocument();
    expect(screen.getByText(/providerへ送信できません/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    expect(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    ).toBeDisabled();
    expect(apiMocks.executeKnowledgeLlmRun).not.toHaveBeenCalled();
  });

  it('keeps maximum reservation for usage unknown and reconciles without redispatch', async () => {
    const held = run({
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicros: null,
      settlementStatus: 'held_maximum',
    });
    apiMocks.executeKnowledgeLlmRun.mockResolvedValue({
      created: true,
      reused: false,
      run: held,
    });
    apiMocks.reconcileKnowledgeLlmRun.mockResolvedValue(held);
    renderPanel();
    await previewDefaultSource();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    );
    expect(
      await screen.findByText(/最大予約額を保持しています/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '保存済み証跡で再照合' }),
    );
    await waitFor(() => {
      expect(apiMocks.reconcileKnowledgeLlmRun).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.executeKnowledgeLlmRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/providerへ再送していません/)).toBeInTheDocument();
  });

  it('drops a stale bootstrap response after the selected item changes', async () => {
    let resolveFirst: ((value: typeof catalog) => void) | undefined;
    apiMocks.fetchKnowledgeLlmCatalog
      .mockImplementationOnce(
        () =>
          new Promise<typeof catalog>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        enabled: false,
        provider: null,
        version: null,
        models: [],
      });
    const view = renderPanel();
    view.rerender(
      <KnowledgeLlmPanel
        itemId="item-2"
        itemScope="personal"
        organizationId={null}
        snapshots={[]}
      />,
    );
    expect(await screen.findByText(/外部LLMは無効です/)).toBeInTheDocument();
    resolveFirst?.(catalog);
    await Promise.resolve();
    expect(screen.getByText(/外部LLMは無効です/)).toBeInTheDocument();
    expect(apiMocks.fetchKnowledgeLlmBudget).not.toHaveBeenCalled();
  });

  it('drops a stale preview response after the selected item changes', async () => {
    let resolvePreview:
      ((value: ReturnType<typeof preview>) => void) | undefined;
    apiMocks.fetchKnowledgeLlmCatalog
      .mockResolvedValueOnce(catalog)
      .mockResolvedValueOnce({
        enabled: false,
        provider: null,
        version: null,
        models: [],
      });
    apiMocks.previewKnowledgeLlmRun.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof preview>>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const view = renderPanel();
    await screen.findByText('Snapshot version 3');
    fireEvent.change(screen.getByLabelText('外部LLMへの指示'), {
      target: { value: '選択内容だけを検討してください。' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '外部送信内容をプレビュー' }),
    );
    view.rerender(
      <KnowledgeLlmPanel
        itemId="item-2"
        itemScope="personal"
        organizationId={null}
        snapshots={[]}
      />,
    );
    expect(await screen.findByText(/外部LLMは無効です/)).toBeInTheDocument();
    resolvePreview?.(
      preview({
        selectedSources: [
          {
            ordinal: 0,
            sourceType: 'snapshot',
            exactSourceVersion: 3,
            exactSourceHash: 'a'.repeat(64),
            byteLength: 13,
            content: 'STALE-PREVIEW',
          },
        ],
      }),
    );
    await Promise.resolve();
    expect(screen.queryByText('STALE-PREVIEW')).not.toBeInTheDocument();
  });

  it('drops stale run lookup and reconcile responses after the selected item changes', async () => {
    const held = run({ settlementStatus: 'held_maximum' });
    apiMocks.executeKnowledgeLlmRun.mockResolvedValue({
      created: true,
      reused: false,
      run: held,
    });
    apiMocks.fetchKnowledgeLlmCatalog
      .mockResolvedValueOnce(catalog)
      .mockResolvedValueOnce({
        enabled: false,
        provider: null,
        version: null,
        models: [],
      });
    let resolveReconcile: ((value: KnowledgeLlmRun) => void) | undefined;
    apiMocks.reconcileKnowledgeLlmRun.mockImplementationOnce(
      () =>
        new Promise<KnowledgeLlmRun>((resolve) => {
          resolveReconcile = resolve;
        }),
    );
    const view = renderPanel();
    await previewDefaultSource();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /上記のexact contentだけを外部providerへ送信/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '明示confirmして1回だけ実行' }),
    );
    await screen.findByText('synthetic result');
    fireEvent.click(
      screen.getByRole('button', { name: '保存済み証跡で再照合' }),
    );
    view.rerender(
      <KnowledgeLlmPanel
        itemId="item-2"
        itemScope="personal"
        organizationId={null}
        snapshots={[]}
      />,
    );
    expect(await screen.findByText(/外部LLMは無効です/)).toBeInTheDocument();
    resolveReconcile?.(run({ result: 'STALE-RECONCILE-RESULT' }));
    await Promise.resolve();
    expect(
      screen.queryByText('STALE-RECONCILE-RESULT'),
    ).not.toBeInTheDocument();
  });

  it('shows a sanitized load error instead of raw provider details', async () => {
    apiMocks.fetchKnowledgeLlmCatalog.mockRejectedValue(
      new KnowledgeHubApiError('unknown_error', 502),
    );
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '処理を完了できませんでした。再試行してください。',
    );
    expect(screen.queryByText(/provider|502|API key/)).not.toBeInTheDocument();
  });
});
