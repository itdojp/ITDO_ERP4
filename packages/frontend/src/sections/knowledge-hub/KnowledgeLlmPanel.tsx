import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Alert, Button, Card, Input, Textarea } from '../../ui';
import {
  executeKnowledgeLlmRun,
  fetchKnowledgeLlmBudget,
  fetchKnowledgeLlmCatalog,
  fetchKnowledgeLlmContextCandidates,
  fetchKnowledgeLlmRun,
  previewKnowledgeLlmRun,
  reconcileKnowledgeLlmRun,
} from './knowledgeLlmApi';
import {
  formatKnowledgeLlmCost,
  knowledgeLlmSourceTypes,
  knowledgeLlmRunNeedsReconciliation,
  validateKnowledgeLlmRequest,
  type KnowledgeLlmCandidate,
  type KnowledgeLlmCatalog,
  type KnowledgeLlmContextCandidate,
  type KnowledgeLlmPreview,
  type KnowledgeLlmRequest,
  type KnowledgeLlmRun,
  type KnowledgeLlmSourceSelector,
} from './knowledgeLlmModel';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  createKnowledgeRequestKey,
  formatKnowledgeBytes,
  formatKnowledgeDateTime,
  isKnowledgeHubErrorCode,
  knowledgeHubErrorMessage,
  type KnowledgeScope,
} from './knowledgeHubModel';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const sourceTypeLabels = {
  snapshot: 'Snapshot',
  annotation_revision: '本人annotation',
  conversation_turn: '会話turn',
  synthesis_version: 'Synthesis version',
  thread_promotion_message: 'Chat promotion snapshot',
} as const;

const executionLabels = {
  reserved: '予算予約済み',
  dispatched: '送信済み・結果確認中',
  result_ready: '結果あり',
  failed: '失敗',
  result_unknown: '結果不明',
} as const;

const settlementLabels = {
  reserved: '予約中',
  settled_actual: '実績精算済み',
  released: '予約解放済み',
  held_maximum: '最大予約額を保持',
} as const;

function safeError(error: unknown) {
  if (
    error instanceof KnowledgeHubApiError &&
    isKnowledgeHubErrorCode(error.code)
  ) {
    return knowledgeHubErrorMessage(error.code);
  }
  return knowledgeHubErrorMessage('unknown_error');
}

function isAccessLoss(error: unknown) {
  return (
    error instanceof KnowledgeHubApiError &&
    (error.code === 'not_found' || error.status === 403 || error.status === 404)
  );
}

function modelIdentity(provider: string, model: string) {
  return `${encodeURIComponent(provider)}:${encodeURIComponent(model)}`;
}

type CandidateLoad = {
  candidates: KnowledgeLlmCandidate[];
  selectors: ReadonlyArray<{
    key: string;
    selector: KnowledgeLlmSourceSelector;
  }>;
};

type CandidateSelectorRegistry = {
  replace(entries: CandidateLoad['selectors']): void;
  resolve(keys: readonly string[]): KnowledgeLlmSourceSelector[];
  clear(): void;
};

const candidateSelectorStores = new WeakMap<
  object,
  ReadonlyMap<string, KnowledgeLlmSourceSelector>
>();

function createCandidateSelectorRegistry(): CandidateSelectorRegistry {
  const owner = {};
  candidateSelectorStores.set(owner, new Map());
  return {
    replace(entries) {
      candidateSelectorStores.set(
        owner,
        new Map(entries.map((entry) => [entry.key, entry.selector])),
      );
    },
    resolve(keys) {
      const store = candidateSelectorStores.get(owner);
      if (!store) return [];
      return keys.flatMap((key) => {
        const selector = store.get(key);
        return selector ? [selector] : [];
      });
    },
    clear() {
      candidateSelectorStores.set(owner, new Map());
    },
  };
}

async function loadCandidates(input: {
  itemId: string;
  scope: KnowledgeScope;
  organizationId: string | null;
  signal: AbortSignal;
}): Promise<CandidateLoad> {
  const pages = await Promise.all(
    knowledgeLlmSourceTypes.map(async (sourceType) => {
      const items: KnowledgeLlmContextCandidate[] = [];
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      for (;;) {
        if (input.signal.aborted) return items;
        const result = await fetchKnowledgeLlmContextCandidates({
          itemId: input.itemId,
          scope: input.scope,
          organizationId: input.organizationId,
          sourceType,
          cursor,
          signal: input.signal,
        });
        if (input.signal.aborted) return items;
        items.push(...result.items);
        const nextCursor = result.nextCursor;
        if (!nextCursor) return items;
        if (seenCursors.has(nextCursor)) {
          throw new KnowledgeHubApiError('invalid_response', null);
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    }),
  );
  const candidates = pages.flat();
  const latestSnapshotVersion = candidates.reduce(
    (latest, candidate) =>
      candidate.sourceType === 'snapshot'
        ? Math.max(latest, candidate.exactSourceVersion)
        : latest,
    Number.NEGATIVE_INFINITY,
  );
  let defaultSnapshotSelected = false;
  const selectors: Array<CandidateLoad['selectors'][number]> = [];
  const views = candidates.map((candidate, index) => {
    const selectedByDefault =
      candidate.sourceType === 'snapshot' &&
      candidate.exactSourceVersion === latestSnapshotVersion &&
      !defaultSnapshotSelected;
    if (selectedByDefault) defaultSnapshotSelected = true;
    const key = `candidate-${index}`;
    selectors.push({
      key,
      selector: {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
      },
    });
    return {
      sourceType: candidate.sourceType,
      key,
      label: `${sourceTypeLabels[candidate.sourceType]} / exact version ${candidate.exactSourceVersion}`,
      detail: `${formatKnowledgeBytes(candidate.byteLength)} / ${formatKnowledgeDateTime(candidate.createdAt)}`,
      selectable: true,
      selectedByDefault,
    };
  });
  return { candidates: views, selectors };
}

export function KnowledgeLlmPanel(props: {
  itemId: string;
  itemScope: KnowledgeScope;
  organizationId: string | null;
  onCommitBusyChange?: (busy: boolean) => void;
}) {
  const { onCommitBusyChange } = props;
  const generationRef = useRef(0);
  const candidateSelectorRegistry = useMemo(
    () => createCandidateSelectorRegistry(),
    [],
  );
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const readAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [catalog, setCatalog] = useState<KnowledgeLlmCatalog | null>(null);
  const [budget, setBudget] = useState<Awaited<
    ReturnType<typeof fetchKnowledgeLlmBudget>
  > | null>(null);
  const [candidates, setCandidates] = useState<KnowledgeLlmCandidate[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [model, setModel] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('512');
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<KnowledgeLlmPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [commitAttempted, setCommitAttempted] = useState(false);
  const [run, setRun] = useState<KnowledgeLlmRun | null>(null);
  const [runLookupId, setRunLookupId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isCurrent = useCallback(
    (generation: number) => generationRef.current === generation,
    [],
  );

  const clearSensitiveResult = useCallback(() => {
    previewAbortRef.current?.abort();
    readAbortRef.current?.abort();
    setPreview(null);
    setConfirmed(false);
    setRequestKey(null);
    setCommitAttempted(false);
    setRun(null);
    setRunLookupId(null);
    setReused(false);
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    bootstrapAbortRef.current?.abort();
    previewAbortRef.current?.abort();
    readAbortRef.current?.abort();
    const controller = new AbortController();
    bootstrapAbortRef.current = controller;
    setStatus('loading');
    setCatalog(null);
    setBudget(null);
    candidateSelectorRegistry.clear();
    setCandidates([]);
    setSelectedKeys(new Set());
    setModel('');
    setPrompt('');
    setMaxOutputTokens('512');
    clearSensitiveResult();

    void (async () => {
      try {
        const nextCatalog = await fetchKnowledgeLlmCatalog(controller.signal);
        if (!isCurrent(generation) || controller.signal.aborted) return;
        setCatalog(nextCatalog);
        if (!nextCatalog.enabled) {
          setStatus('success');
          return;
        }
        if (
          nextCatalog.provider === null ||
          nextCatalog.version === null ||
          nextCatalog.models.length === 0
        ) {
          throw new KnowledgeHubApiError('invalid_response', 502);
        }
        const firstModel = nextCatalog.models[0];
        setModel(modelIdentity(firstModel.provider, firstModel.model));
        setMaxOutputTokens(String(Math.min(512, firstModel.maxOutputTokens)));
        const [nextBudget, nextCandidateLoad] = await Promise.all([
          fetchKnowledgeLlmBudget({
            scope: props.itemScope,
            organizationId: props.organizationId,
            signal: controller.signal,
          }),
          loadCandidates({
            itemId: props.itemId,
            scope: props.itemScope,
            organizationId: props.organizationId,
            signal: controller.signal,
          }),
        ]);
        if (!isCurrent(generation) || controller.signal.aborted) return;
        setBudget(nextBudget);
        candidateSelectorRegistry.replace(nextCandidateLoad.selectors);
        setCandidates(nextCandidateLoad.candidates);
        setSelectedKeys(
          new Set(
            nextCandidateLoad.candidates
              .filter((candidate) => candidate.selectedByDefault)
              .map((candidate) => candidate.key),
          ),
        );
        setStatus('success');
      } catch (loadError) {
        if (!isCurrent(generation) || controller.signal.aborted) return;
        controller.abort();
        setError(safeError(loadError));
        setStatus('error');
      }
    })();

    return () => {
      controller.abort();
      candidateSelectorRegistry.clear();
      previewAbortRef.current?.abort();
      readAbortRef.current?.abort();
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [
    candidateSelectorRegistry,
    clearSensitiveResult,
    isCurrent,
    props.itemId,
    props.itemScope,
    props.organizationId,
  ]);

  const selectedModel = catalog?.models.find(
    (entry) => modelIdentity(entry.provider, entry.model) === model,
  );
  const request = useMemo<KnowledgeLlmRequest | null>(() => {
    if (!catalog?.enabled || catalog.version === null || !selectedModel) {
      return null;
    }
    return {
      scope: props.itemScope,
      organizationId:
        props.itemScope === 'organization' ? props.organizationId : null,
      provider: selectedModel.provider,
      model: selectedModel.model,
      catalogVersion: catalog.version,
      userPrompt: prompt,
      maxOutputTokens: Number(maxOutputTokens),
      sources: candidateSelectorRegistry.resolve(
        candidates
          .filter((candidate) => selectedKeys.has(candidate.key))
          .map((candidate) => candidate.key),
      ),
    };
  }, [
    candidates,
    candidateSelectorRegistry,
    catalog,
    maxOutputTokens,
    prompt,
    props.itemScope,
    props.organizationId,
    selectedKeys,
    selectedModel,
  ]);
  const interactionBusy = previewing || committing || reading;

  const invalidateDraft = useCallback(() => {
    clearSensitiveResult();
  }, [clearSensitiveResult]);

  const toggleCandidate = (candidate: KnowledgeLlmCandidate) => {
    if (!candidate.selectable || interactionBusy) return;
    invalidateDraft();
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(candidate.key)) next.delete(candidate.key);
      else next.add(candidate.key);
      return next;
    });
  };

  const handlePreview = async () => {
    if (!request || !catalog) return;
    const validation = validateKnowledgeLlmRequest({ request, catalog });
    if (validation) {
      setError(validation);
      return;
    }
    const generation = generationRef.current;
    clearSensitiveResult();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewing(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setConfirmed(false);
    setRun(null);
    try {
      const next = await previewKnowledgeLlmRun(request, controller.signal);
      if (!isCurrent(generation) || controller.signal.aborted) return;
      let nextRequestKey: string;
      try {
        nextRequestKey = createKnowledgeRequestKey();
      } catch {
        setError(knowledgeHubErrorMessage('unknown_error'));
        return;
      }
      setPreview(next);
      setBudget(next.budget);
      setRequestKey(nextRequestKey);
      setCommitAttempted(false);
      setNotice('外部送信前のexact previewを作成しました。');
    } catch (previewError) {
      if (!isCurrent(generation) || controller.signal.aborted) return;
      if (isAccessLoss(previewError)) clearSensitiveResult();
      setError(safeError(previewError));
    } finally {
      if (isCurrent(generation)) setPreviewing(false);
    }
  };

  const handleExecute = async () => {
    if (!request || !preview || !requestKey || !confirmed || commitAttempted) {
      return;
    }
    const generation = generationRef.current;
    setCommitting(true);
    setCommitAttempted(true);
    setError(null);
    setNotice(null);
    onCommitBusyChange?.(true);
    try {
      const result = await executeKnowledgeLlmRun({
        request,
        previewToken: preview.previewToken,
        requestKey,
      });
      if (!isCurrent(generation)) return;
      setRun(result.run);
      setRunLookupId(result.run.id);
      setReused(result.reused);
      setNotice(
        result.reused
          ? '同じ実行結果を再利用しました。providerへ再送していません。'
          : '外部LLM実行の状態を確定しました。',
      );
    } catch (executeError) {
      if (!isCurrent(generation)) return;
      if (isAccessLoss(executeError)) {
        clearSensitiveResult();
        setError(safeError(executeError));
      } else {
        setRunLookupId(preview.runId);
        setError(
          executeError instanceof KnowledgeHubApiError &&
            executeError.code === 'network_error'
            ? '送信結果は不明です。自動再送せず「状態を確認」を実行してください。'
            : safeError(executeError),
        );
      }
    } finally {
      if (isCurrent(generation)) setCommitting(false);
      onCommitBusyChange?.(false);
    }
  };

  const readRun = async (reconcile: boolean) => {
    const target = run?.id ?? runLookupId;
    if (!target) return;
    const generation = generationRef.current;
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    setReading(true);
    setError(null);
    try {
      const next = reconcile
        ? await reconcileKnowledgeLlmRun(target, controller.signal)
        : await fetchKnowledgeLlmRun(target, controller.signal);
      if (!isCurrent(generation) || controller.signal.aborted) return;
      setRun(next);
      setRunLookupId(next.id);
      setNotice(
        reconcile
          ? '保存済み証跡だけで再照合しました。providerへ再送していません。'
          : '現在の実行状態を取得しました。',
      );
    } catch (readError) {
      if (!isCurrent(generation) || controller.signal.aborted) return;
      if (isAccessLoss(readError)) clearSensitiveResult();
      setError(safeError(readError));
    } finally {
      if (isCurrent(generation)) setReading(false);
    }
  };

  if (status === 'loading' || status === 'idle') {
    return <p role="status">外部LLM設定と送信候補を確認しています。</p>;
  }

  if (status === 'error') {
    return (
      <div className="knowledge-llm-panel" aria-label="外部LLM対話">
        <Alert variant="error">
          {error ?? knowledgeHubErrorMessage('unknown_error')}
        </Alert>
      </div>
    );
  }

  if (!catalog?.enabled) {
    return (
      <div className="knowledge-llm-panel" aria-label="外部LLM対話">
        <Alert variant="info">
          外部LLMは無効です。既定ではprovider requestを作成しません。
        </Alert>
        <p>有効化には管理者によるallowlist、予算、rate limit設定が必要です。</p>
      </div>
    );
  }

  return (
    <div className="knowledge-llm-panel" aria-label="外部LLM対話">
      <Alert variant="warning">
        選択したsourceと指示だけを外部providerへ送信します。非選択source、provider
        key、URL、private metadataは送信しません。
      </Alert>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      <Card padding="small">
        <h3>1. Providerと送信source</h3>
        <label>
          許可されたmodel
          <select
            aria-label="許可されたmodel"
            value={model}
            disabled={interactionBusy}
            onChange={(event) => {
              if (interactionBusy) return;
              invalidateDraft();
              const next = event.target.value;
              const definition = catalog.models.find(
                (entry) => modelIdentity(entry.provider, entry.model) === next,
              );
              setModel(next);
              if (definition) {
                setMaxOutputTokens(
                  String(Math.min(512, definition.maxOutputTokens)),
                );
              }
            }}
          >
            {catalog.models.map((entry) => (
              <option
                key={`${entry.provider}:${entry.model}`}
                value={modelIdentity(entry.provider, entry.model)}
              >
                {entry.provider} / {entry.model}
              </option>
            ))}
          </select>
        </label>
        <p>
          catalog version {catalog.version} / provider allowlist:{' '}
          {catalog.provider}
        </p>
        <fieldset disabled={interactionBusy}>
          <legend>外部送信するsource（既定は最新snapshotのみ）</legend>
          {candidates.length === 0 ? (
            <p>送信可能なready sourceがありません。</p>
          ) : (
            candidates.map((candidate) => (
              <label
                key={candidate.key}
                className="knowledge-llm-source-option"
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(candidate.key)}
                  disabled={!candidate.selectable || interactionBusy}
                  onChange={() => toggleCandidate(candidate)}
                />
                <span>
                  <strong>{candidate.label}</strong>
                  <small>{candidate.detail}</small>
                </span>
              </label>
            ))
          )}
        </fieldset>
        <p>
          選択 {selectedKeys.size}件 / 省略{' '}
          {Math.max(0, candidates.length - selectedKeys.size)}件
        </p>
      </Card>

      <Card padding="small">
        <h3>2. 指示と上限</h3>
        <Textarea
          label="外部LLMへの指示"
          value={prompt}
          onChange={(event) => {
            if (interactionBusy) return;
            invalidateDraft();
            setPrompt(event.target.value);
          }}
          disabled={interactionBusy}
          rows={5}
          maxLength={16 * 1024}
        />
        <Input
          label="最大出力token数"
          type="number"
          min="1"
          max={selectedModel?.maxOutputTokens ?? 4096}
          value={maxOutputTokens}
          onChange={(event) => {
            if (interactionBusy) return;
            invalidateDraft();
            setMaxOutputTokens(event.target.value);
          }}
          disabled={interactionBusy}
        />
        <p>
          user budget: {budget?.configured ? '設定済み' : '未設定'} / soft:{' '}
          {budget?.softLimitWarning ? '警告あり' : '警告なし'} / hard:{' '}
          {budget?.hardLimitBlocked ? '停止' : '利用可能'} / rate:{' '}
          {budget?.rateBlocked ? '停止' : '利用可能'}
        </p>
        <Button
          loading={previewing}
          disabled={interactionBusy}
          onClick={() => void handlePreview()}
        >
          外部送信内容をプレビュー
        </Button>
      </Card>

      {preview ? (
        <Card padding="small">
          <h3>3. Exact preview・明示confirm</h3>
          <p>
            推定input {preview.estimatedInputTokens} tokens / 最大output{' '}
            {preview.maxOutputTokens} tokens / 最大予約額{' '}
            {formatKnowledgeLlmCost(
              preview.maximumCostMicros,
              preview.currency,
            )}
          </p>
          <p>有効期限: {formatKnowledgeDateTime(preview.expiresAt)}</p>
          {preview.budget.softLimitWarning ? (
            <Alert variant="warning">soft limitを超える見込みです。</Alert>
          ) : null}
          {preview.budget.hardLimitBlocked || preview.budget.rateBlocked ? (
            <Alert variant="error">
              hard limitまたはrate limitにより、providerへ送信できません。
            </Alert>
          ) : null}
          <div className="knowledge-llm-exact-preview">
            {preview.selectedSources.map((source) => (
              <article key={`${source.sourceType}:${source.ordinal}`}>
                <h4>
                  {sourceTypeLabels[source.sourceType]} / exact version{' '}
                  {source.exactSourceVersion}
                </h4>
                <p>
                  {formatKnowledgeBytes(source.byteLength)} / SHA-256{' '}
                  <code>{source.exactSourceHash}</code>
                </p>
                <pre>{source.content}</pre>
              </article>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={interactionBusy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            上記のexact contentだけを外部providerへ送信することを確認しました
          </label>
          <Button
            loading={committing}
            disabled={
              !confirmed ||
              !requestKey ||
              commitAttempted ||
              interactionBusy ||
              !preview.budget.configured ||
              preview.budget.hardLimitBlocked ||
              preview.budget.rateBlocked
            }
            onClick={() => void handleExecute()}
          >
            明示confirmして1回だけ実行
          </Button>
        </Card>
      ) : null}

      {run || runLookupId ? (
        <Card padding="small">
          <h3>4. 実行状態・usage・cost provenance</h3>
          {run ? (
            <>
              <p>
                execution: {executionLabels[run.executionStatus]} / settlement:{' '}
                {settlementLabels[run.settlementStatus]}
              </p>
              <p>
                provider/model: {run.provider} / {run.model} / catalog version{' '}
                {run.catalogVersion}
              </p>
              <p>
                usage: input {run.actualInputTokens ?? '不明'} / output{' '}
                {run.actualOutputTokens ?? '不明'} / actual cost{' '}
                {formatKnowledgeLlmCost(run.actualCostMicros, run.currency)}
              </p>
              {run.settlementStatus === 'held_maximum' ? (
                <Alert variant="warning">
                  usageまたは結果の証跡が不明なため、最大予約額を保持しています。
                </Alert>
              ) : null}
              {run.executionStatus === 'result_unknown' ? (
                <Alert variant="warning">
                  provider結果は不明です。自動retryや別provider
                  fallbackは行いません。
                </Alert>
              ) : null}
              {run.result ? (
                <article aria-label="外部LLM結果">
                  <h4>外部LLM結果</h4>
                  <p>{run.result}</p>
                </article>
              ) : null}
              {run.conversationId ? (
                <p>Knowledge conversationへprovenance付きで保存済みです。</p>
              ) : null}
              {reused ? <p>idempotent replay: 既存runを再利用</p> : null}
            </>
          ) : (
            <Alert variant="warning">
              commit応答を確認できません。providerへ再送せず状態だけを取得できます。
            </Alert>
          )}
          <div className="knowledge-llm-run-actions">
            <Button
              variant="ghost"
              loading={reading}
              onClick={() => void readRun(false)}
            >
              状態を確認
            </Button>
            {run && knowledgeLlmRunNeedsReconciliation(run) ? (
              <Button
                variant="ghost"
                loading={reading}
                onClick={() => void readRun(true)}
              >
                保存済み証跡で再照合
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
