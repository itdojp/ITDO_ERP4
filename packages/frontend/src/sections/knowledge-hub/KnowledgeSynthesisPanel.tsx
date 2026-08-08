import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';

import { Alert, Button, Card, Input, Textarea } from '../../ui';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  appendKnowledgeSynthesisVersion,
  createKnowledgeSynthesis,
  getKnowledgeSynthesis,
  listKnowledgeSyntheses,
  listKnowledgeSynthesisVersions,
} from './knowledgeProvenanceApi';
import {
  KNOWLEDGE_SYNTHESIS_MAX_BYTES,
  formatKnowledgeConfidence,
  knowledgeRelationLabels,
  utf8Length,
  type KnowledgeSynthesis,
  type KnowledgeSynthesisDetail,
  type KnowledgeSynthesisSource,
  type KnowledgeSynthesisSourceKind,
  type KnowledgeSynthesisVersion,
  type KnowledgeRelationType,
} from './knowledgeProvenanceModel';
import {
  isKnowledgeHubErrorCode,
  knowledgeHubErrorMessage,
} from './knowledgeHubModel';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

type VersionDraft = {
  content: string;
  confidencePercent: string;
  unresolvedQuestions: string;
};

type ValidVersionDraft = {
  content: string;
  confidenceBasisPoints: number | null;
  unresolvedQuestions: string[];
};

type VersionDraftField =
  'content' | 'confidencePercent' | 'unresolvedQuestions';

type VersionDraftErrors = Partial<Record<VersionDraftField, string>>;

const emptyVersionDraft: VersionDraft = {
  content: '',
  confidencePercent: '',
  unresolvedQuestions: '',
};

const scopeLabels = {
  personal: 'personal（個人）',
  organization: 'organization（組織）',
} as const;

const sourceKindLabels: Record<KnowledgeSynthesisSourceKind, string> = {
  item: 'ナレッジ項目',
  snapshot: 'スナップショット',
  annotation: '注釈',
  annotation_revision: '注釈の版',
  conversation: '会話',
  conversation_turn: '会話ターン',
  synthesis_version: '統合知の版',
};

function safeErrorMessage(error: unknown) {
  if (
    error instanceof KnowledgeHubApiError &&
    isKnowledgeHubErrorCode(error.code)
  ) {
    return knowledgeHubErrorMessage(error.code);
  }
  return knowledgeHubErrorMessage('unknown_error');
}

function validateVersionDraft(
  draft: VersionDraft,
):
  | { ok: true; value: ValidVersionDraft }
  | { ok: false; field: VersionDraftField; error: string } {
  if (!draft.content.trim()) {
    return {
      ok: false,
      field: 'content',
      error: '本文を入力してください。',
    };
  }
  if (utf8Length(draft.content) > KNOWLEDGE_SYNTHESIS_MAX_BYTES) {
    return {
      ok: false,
      field: 'content',
      error: '本文はUTF-8で256 KiB以内にしてください。',
    };
  }

  const confidenceText = draft.confidencePercent.trim();
  let confidenceBasisPoints: number | null = null;
  if (confidenceText) {
    const confidencePercent = Number(confidenceText);
    if (
      !Number.isFinite(confidencePercent) ||
      confidencePercent < 0 ||
      confidencePercent > 100
    ) {
      return {
        ok: false,
        field: 'confidencePercent',
        error: '確信度は0以上100以下の数値で入力してください。',
      };
    }
    confidenceBasisPoints = Math.round(confidencePercent * 100);
  }

  const unresolvedQuestions = draft.unresolvedQuestions
    .split(/\r?\n/u)
    .map((question) => question.trim())
    .filter(Boolean);
  if (unresolvedQuestions.length > 50) {
    return {
      ok: false,
      field: 'unresolvedQuestions',
      error: '未解決の質問は1行1件、50件以内で入力してください。',
    };
  }

  return {
    ok: true,
    value: {
      content: draft.content,
      confidenceBasisPoints,
      unresolvedQuestions,
    },
  };
}

function sortVersions(versions: KnowledgeSynthesisVersion[]) {
  return [...versions].sort((left, right) => right.version - left.version);
}

function mergeSyntheses(
  current: KnowledgeSynthesis[],
  incoming: KnowledgeSynthesis[],
) {
  const merged = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

function mergeVersions(
  current: KnowledgeSynthesisVersion[],
  incoming: KnowledgeSynthesisVersion[],
) {
  const merged = new Map(current.map((entry) => [entry.version, entry]));
  for (const entry of incoming) {
    merged.set(entry.version, entry);
  }
  return sortVersions([...merged.values()]);
}

function upsertSynthesis(
  syntheses: KnowledgeSynthesis[],
  next: KnowledgeSynthesis,
) {
  return [next, ...syntheses.filter((entry) => entry.id !== next.id)];
}

function upsertVersion(
  versions: KnowledgeSynthesisVersion[],
  next: KnowledgeSynthesisVersion,
) {
  return mergeVersions(versions, [next]);
}

type AppendSourceInput = {
  kind: KnowledgeSynthesisSourceKind;
  sourceId: string;
  relationType: KnowledgeRelationType;
};

function appendSourcesFromCurrentItem(
  detail: KnowledgeSynthesisDetail,
  itemId: string,
  itemScope: 'personal' | 'organization',
): AppendSourceInput[] | null {
  if (detail.synthesis.scope !== itemScope) return null;
  const ordered = [...detail.currentVersion.sources].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  if (
    ordered.length === 0 ||
    ordered.some((source) => !source.accessible || source.sourceId === null) ||
    !ordered.some(
      (source) =>
        source.accessible &&
        source.kind === 'item' &&
        source.sourceId === itemId,
    )
  ) {
    return null;
  }
  return ordered.map((source) => ({
    kind: source.kind,
    sourceId: source.sourceId as string,
    relationType: source.relationType,
  }));
}

function ProvenanceList(props: {
  label: string;
  sources: KnowledgeSynthesisSource[];
}) {
  if (props.sources.length === 0) {
    return <p>根拠情報はありません。</p>;
  }

  return (
    <ul aria-label={props.label}>
      {props.sources.map((source, index) => (
        <li key={`${source.ordinal}-${index}`}>
          {source.accessible ? (
            <dl>
              <div>
                <dt>種類</dt>
                <dd>{sourceKindLabels[source.kind]}</dd>
              </div>
              <div>
                <dt>関係</dt>
                <dd>{knowledgeRelationLabels[source.relationType]}</dd>
              </div>
            </dl>
          ) : (
            <dl>
              <div>
                <dt>種類</dt>
                <dd>参照不可の根拠（詳細は非表示）</dd>
              </div>
              <div>
                <dt>関係</dt>
                <dd>{knowledgeRelationLabels[source.relationType]}</dd>
              </div>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

function Questions(props: { questions: string[] }) {
  return props.questions.length > 0 ? (
    <ul>
      {props.questions.map((question, index) => (
        <li key={`${index}-${question}`}>{question}</li>
      ))}
    </ul>
  ) : (
    <p>なし</p>
  );
}

function VersionSummary(props: {
  version: KnowledgeSynthesisVersion;
  provenanceLabel: string;
}) {
  const { version } = props;
  return (
    <article aria-label={`version ${version.version}`}>
      <h6>version {version.version}</h6>
      <dl>
        <div>
          <dt>確信度</dt>
          <dd>{formatKnowledgeConfidence(version.confidenceBasisPoints)}</dd>
        </div>
      </dl>
      <p>
        <strong>本文</strong>
      </p>
      <div className="knowledge-provenance-content">{version.content}</div>
      <p>
        <strong>未解決の質問</strong>
      </p>
      <Questions questions={version.unresolvedQuestions} />
      <p>
        <strong>根拠</strong>
      </p>
      <ProvenanceList label={props.provenanceLabel} sources={version.sources} />
    </article>
  );
}

export function KnowledgeSynthesisPanel(props: {
  itemId: string;
  itemScope: 'personal' | 'organization';
}): JSX.Element {
  const { itemId, itemScope } = props;
  const contextKey = JSON.stringify([itemId, itemScope]);
  const activeContextRef = useRef(contextKey);

  const mountedRef = useRef(true);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const versionPageRequestSequence = useRef(0);
  const createRequestSequence = useRef(0);
  const appendRequestSequence = useRef(0);
  const skipDetailLoadIdRef = useRef('');
  const selectedSynthesisIdRef = useRef('');

  const [stateContextKey, setStateContextKey] = useState(contextKey);
  const [syntheses, setSyntheses] = useState<KnowledgeSynthesis[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>('idle');
  const [listError, setListError] = useState('');
  const [listNextCursor, setListNextCursor] = useState<string | null>(null);
  const [listMoreBusy, setListMoreBusy] = useState(false);
  const [listMoreError, setListMoreError] = useState('');
  const [selectedSynthesisId, setSelectedSynthesisId] = useState('');

  const [detail, setDetail] = useState<KnowledgeSynthesisDetail | null>(null);
  const [versions, setVersions] = useState<KnowledgeSynthesisVersion[]>([]);
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('idle');
  const [detailError, setDetailError] = useState('');
  const [versionNextCursor, setVersionNextCursor] = useState<string | null>(
    null,
  );
  const [versionMoreBusy, setVersionMoreBusy] = useState(false);
  const [versionMoreError, setVersionMoreError] = useState('');

  const [title, setTitle] = useState('');
  const [createTitleError, setCreateTitleError] = useState('');
  const [createDraft, setCreateDraft] =
    useState<VersionDraft>(emptyVersionDraft);
  const [createDraftErrors, setCreateDraftErrors] =
    useState<VersionDraftErrors>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [createNotice, setCreateNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const [appendDraft, setAppendDraft] =
    useState<VersionDraft>(emptyVersionDraft);
  const [appendDraftErrors, setAppendDraftErrors] =
    useState<VersionDraftErrors>({});
  const [appendBusy, setAppendBusy] = useState(false);
  const [appendNotice, setAppendNotice] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  useLayoutEffect(() => {
    activeContextRef.current = contextKey;
  }, [contextKey]);

  useLayoutEffect(() => {
    selectedSynthesisIdRef.current = selectedSynthesisId;
  }, [selectedSynthesisId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestSequence.current += 1;
      detailRequestSequence.current += 1;
      versionPageRequestSequence.current += 1;
      createRequestSequence.current += 1;
      appendRequestSequence.current += 1;
    };
  }, []);

  const isCurrentContext = useCallback(
    (requestContext: string) =>
      mountedRef.current && activeContextRef.current === requestContext,
    [],
  );

  const loadSyntheses = useCallback(
    async (cursor: string | null = null, append = false) => {
      const requestContext = contextKey;
      const sequence = listRequestSequence.current + 1;
      listRequestSequence.current = sequence;
      if (append) {
        if (!cursor) {
          return;
        }
        setListMoreBusy(true);
        setListMoreError('');
      } else {
        setListStatus('loading');
        setListError('');
        setListNextCursor(null);
        setListMoreError('');
      }
      try {
        const page = await listKnowledgeSyntheses(cursor);
        if (
          !isCurrentContext(requestContext) ||
          listRequestSequence.current !== sequence
        ) {
          return;
        }
        setSyntheses((current) =>
          append
            ? mergeSyntheses(current, page.items)
            : mergeSyntheses([], page.items),
        );
        if (!append) {
          setSelectedSynthesisId((current) =>
            current && page.items.some((entry) => entry.id === current)
              ? current
              : '',
          );
        }
        setListNextCursor(page.nextCursor);
        setListStatus('success');
      } catch (error) {
        if (
          !isCurrentContext(requestContext) ||
          listRequestSequence.current !== sequence
        ) {
          return;
        }
        if (append) {
          setListMoreError(safeErrorMessage(error));
        } else {
          setSyntheses([]);
          setSelectedSynthesisId('');
          setListStatus('error');
          setListError(safeErrorMessage(error));
        }
      } finally {
        if (
          append &&
          isCurrentContext(requestContext) &&
          listRequestSequence.current === sequence
        ) {
          setListMoreBusy(false);
        }
      }
    },
    [contextKey, isCurrentContext],
  );

  const loadMoreSyntheses = useCallback(() => {
    if (!listNextCursor || listMoreBusy) {
      return;
    }
    void loadSyntheses(listNextCursor, true);
  }, [listMoreBusy, listNextCursor, loadSyntheses]);

  const loadDetail = useCallback(async () => {
    const synthesisId = selectedSynthesisId;
    const requestContext = contextKey;
    const sequence = detailRequestSequence.current + 1;
    detailRequestSequence.current = sequence;
    if (!synthesisId) {
      setDetail(null);
      setVersions([]);
      setVersionNextCursor(null);
      setVersionMoreBusy(false);
      setVersionMoreError('');
      setDetailStatus('idle');
      setDetailError('');
      return;
    }

    setDetail(null);
    setVersions([]);
    setDetailStatus('loading');
    setDetailError('');
    try {
      const [nextDetail, versionPage] = await Promise.all([
        getKnowledgeSynthesis(synthesisId),
        listKnowledgeSynthesisVersions(synthesisId),
      ]);
      if (
        !isCurrentContext(requestContext) ||
        detailRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      setDetail(nextDetail);
      setVersions(mergeVersions([], versionPage.items));
      setVersionNextCursor(versionPage.nextCursor);
      setVersionMoreError('');
      setDetailStatus('success');
    } catch (error) {
      if (
        !isCurrentContext(requestContext) ||
        detailRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      setDetail(null);
      setVersions([]);
      setVersionNextCursor(null);
      setDetailStatus('error');
      setDetailError(safeErrorMessage(error));
    }
  }, [contextKey, isCurrentContext, selectedSynthesisId]);

  const loadMoreVersions = useCallback(async () => {
    const synthesisId = selectedSynthesisId;
    const cursor = versionNextCursor;
    if (!synthesisId || !cursor || versionMoreBusy) {
      return;
    }
    const requestContext = contextKey;
    const sequence = versionPageRequestSequence.current + 1;
    versionPageRequestSequence.current = sequence;
    setVersionMoreBusy(true);
    setVersionMoreError('');
    try {
      const page = await listKnowledgeSynthesisVersions(synthesisId, cursor);
      if (
        !isCurrentContext(requestContext) ||
        versionPageRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      setVersions((current) => mergeVersions(current, page.items));
      setVersionNextCursor(page.nextCursor);
    } catch (error) {
      if (
        !isCurrentContext(requestContext) ||
        versionPageRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      setVersionMoreError(safeErrorMessage(error));
    } finally {
      if (
        isCurrentContext(requestContext) &&
        versionPageRequestSequence.current === sequence &&
        selectedSynthesisIdRef.current === synthesisId
      ) {
        setVersionMoreBusy(false);
      }
    }
  }, [
    contextKey,
    isCurrentContext,
    selectedSynthesisId,
    versionMoreBusy,
    versionNextCursor,
  ]);

  useEffect(() => {
    listRequestSequence.current += 1;
    detailRequestSequence.current += 1;
    versionPageRequestSequence.current += 1;
    createRequestSequence.current += 1;
    appendRequestSequence.current += 1;
    setSyntheses([]);
    setListStatus('idle');
    setListError('');
    setListNextCursor(null);
    setListMoreBusy(false);
    setListMoreError('');
    setSelectedSynthesisId('');
    setDetail(null);
    setVersions([]);
    setDetailStatus('idle');
    setDetailError('');
    setVersionNextCursor(null);
    setVersionMoreBusy(false);
    setVersionMoreError('');
    setTitle('');
    setCreateTitleError('');
    setCreateDraft(emptyVersionDraft);
    setCreateDraftErrors({});
    setCreateBusy(false);
    setCreateNotice(null);
    setAppendDraft(emptyVersionDraft);
    setAppendDraftErrors({});
    setAppendBusy(false);
    setAppendNotice(null);
    skipDetailLoadIdRef.current = '';
    setStateContextKey(contextKey);
    void loadSyntheses();
  }, [contextKey, loadSyntheses]);

  useEffect(() => {
    appendRequestSequence.current += 1;
    versionPageRequestSequence.current += 1;
    setAppendDraft(emptyVersionDraft);
    setAppendDraftErrors({});
    setAppendBusy(false);
    setAppendNotice(null);
    setVersionNextCursor(null);
    setVersionMoreBusy(false);
    setVersionMoreError('');
    if (skipDetailLoadIdRef.current === selectedSynthesisId) {
      skipDetailLoadIdRef.current = '';
      return;
    }
    void loadDetail();
  }, [loadDetail, selectedSynthesisId]);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateNotice(null);
    setCreateTitleError('');
    setCreateDraftErrors({});

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setCreateTitleError('タイトルを入力してください。');
      return;
    }
    if ([...normalizedTitle].length > 500) {
      setCreateTitleError('タイトルは500文字以内で入力してください。');
      return;
    }

    const validation = validateVersionDraft(createDraft);
    if (!validation.ok) {
      setCreateDraftErrors({ [validation.field]: validation.error });
      return;
    }

    const requestContext = contextKey;
    const sequence = createRequestSequence.current + 1;
    createRequestSequence.current = sequence;
    setCreateBusy(true);
    try {
      const created = await createKnowledgeSynthesis({
        scope: itemScope,
        title: normalizedTitle,
        ...validation.value,
        sources: [
          {
            kind: 'item',
            sourceId: itemId,
            relationType: 'primary',
          },
        ],
      });
      if (
        !isCurrentContext(requestContext) ||
        createRequestSequence.current !== sequence
      ) {
        return;
      }
      if (created.synthesis.scope !== itemScope) {
        setCreateNotice({
          tone: 'error',
          text: knowledgeHubErrorMessage('invalid_response'),
        });
        return;
      }
      listRequestSequence.current += 1;
      detailRequestSequence.current += 1;
      setSyntheses((current) => upsertSynthesis(current, created.synthesis));
      setListStatus('success');
      setListError('');
      skipDetailLoadIdRef.current = created.synthesis.id;
      setSelectedSynthesisId(created.synthesis.id);
      setDetail(created);
      setVersions([created.currentVersion]);
      setDetailStatus('success');
      setDetailError('');
      setTitle('');
      setCreateTitleError('');
      setCreateDraft(emptyVersionDraft);
      setCreateDraftErrors({});
      setCreateNotice({
        tone: 'success',
        text: `統合知 version ${created.synthesis.currentVersion} を作成しました。`,
      });
    } catch (error) {
      if (
        !isCurrentContext(requestContext) ||
        createRequestSequence.current !== sequence
      ) {
        return;
      }
      setCreateNotice({ tone: 'error', text: safeErrorMessage(error) });
    } finally {
      if (
        isCurrentContext(requestContext) &&
        createRequestSequence.current === sequence
      ) {
        setCreateBusy(false);
      }
    }
  };

  const submitAppend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppendNotice(null);
    if (!detail || detail.synthesis.id !== selectedSynthesisId) {
      setAppendNotice({
        tone: 'error',
        text: '版を追加する統合知を選択してください。',
      });
      return;
    }
    const preservedSources = appendSourcesFromCurrentItem(
      detail,
      itemId,
      itemScope,
    );
    if (!preservedSources) {
      setAppendNotice({
        tone: 'error',
        text: '選択中のKnowledgeItemとの関連または現在の根拠を確認できないため、版追加はできません。',
      });
      return;
    }

    setAppendDraftErrors({});
    const validation = validateVersionDraft(appendDraft);
    if (!validation.ok) {
      setAppendDraftErrors({ [validation.field]: validation.error });
      return;
    }

    const synthesisId = detail.synthesis.id;
    const requestContext = contextKey;
    const sequence = appendRequestSequence.current + 1;
    appendRequestSequence.current = sequence;
    detailRequestSequence.current += 1;
    setAppendBusy(true);
    try {
      const appended = await appendKnowledgeSynthesisVersion({
        synthesisId,
        expectedVersion: detail.synthesis.currentVersion,
        ...validation.value,
        sources: preservedSources,
      });
      if (
        !isCurrentContext(requestContext) ||
        appendRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      if (appended.synthesis.scope !== itemScope) {
        setAppendNotice({
          tone: 'error',
          text: knowledgeHubErrorMessage('invalid_response'),
        });
        return;
      }

      listRequestSequence.current += 1;
      setDetail(appended);
      setVersions((current) => upsertVersion(current, appended.currentVersion));
      setSyntheses((current) => upsertSynthesis(current, appended.synthesis));
      setListStatus('success');
      setListError('');
      setAppendDraft(emptyVersionDraft);
      setAppendDraftErrors({});
      setAppendNotice({
        tone: 'success',
        text: `version ${appended.synthesis.currentVersion} を追加しました。`,
      });

      try {
        const versionPage = await listKnowledgeSynthesisVersions(synthesisId);
        if (
          !isCurrentContext(requestContext) ||
          appendRequestSequence.current !== sequence ||
          selectedSynthesisIdRef.current !== synthesisId
        ) {
          return;
        }
        setVersions((current) => mergeVersions(current, versionPage.items));
        setVersionNextCursor(versionPage.nextCursor);
        setVersionMoreError('');
      } catch (error) {
        if (
          !isCurrentContext(requestContext) ||
          appendRequestSequence.current !== sequence ||
          selectedSynthesisIdRef.current !== synthesisId
        ) {
          return;
        }
        setAppendNotice({
          tone: 'warning',
          text: `版は追加されましたが、履歴を再取得できませんでした。${safeErrorMessage(error)}`,
        });
      }
    } catch (error) {
      if (
        !isCurrentContext(requestContext) ||
        appendRequestSequence.current !== sequence ||
        selectedSynthesisIdRef.current !== synthesisId
      ) {
        return;
      }
      setAppendNotice({ tone: 'error', text: safeErrorMessage(error) });
    } finally {
      if (
        isCurrentContext(requestContext) &&
        appendRequestSequence.current === sequence &&
        selectedSynthesisIdRef.current === synthesisId
      ) {
        setAppendBusy(false);
      }
    }
  };

  if (stateContextKey !== contextKey) {
    return (
      <section aria-labelledby="knowledge-synthesis-panel-heading">
        <h4 id="knowledge-synthesis-panel-heading">統合知</h4>
        <p role="status">選択項目を切り替えています。</p>
      </section>
    );
  }

  const appendAllowed = detail
    ? appendSourcesFromCurrentItem(detail, itemId, itemScope) !== null
    : false;

  return (
    <section aria-labelledby="knowledge-synthesis-panel-heading">
      <h4 id="knowledge-synthesis-panel-heading">統合知</h4>
      <p>
        選択中のKnowledgeItemを主根拠として、内容・確信度・未解決事項を版管理します。
      </p>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
        }}
      >
        <Card padding="medium">
          <section aria-labelledby="knowledge-synthesis-create-heading">
            <h5 id="knowledge-synthesis-create-heading">統合知を作成</h5>
            <Alert variant={itemScope === 'organization' ? 'warning' : 'info'}>
              作成scope: <strong>{scopeLabels[itemScope]}</strong>
              。選択中のKnowledgeItemのscopeに固定され、変更できません。
            </Alert>
            <form noValidate onSubmit={submitCreate}>
              <Input
                label="タイトル"
                aria-label="タイトル"
                value={title}
                maxLength={500}
                required
                error={createTitleError || undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setCreateTitleError('');
                }}
              />
              <Textarea
                label="本文"
                aria-label="本文"
                value={createDraft.content}
                rows={7}
                required
                helpText="UTF-8で最大256 KiBです。"
                error={createDraftErrors.content || undefined}
                onChange={(event) => {
                  setCreateDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }));
                  setCreateDraftErrors((current) => ({
                    ...current,
                    content: undefined,
                  }));
                }}
              />
              <Input
                label="確信度（%）"
                aria-label="確信度（%）"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={createDraft.confidencePercent}
                helpText="0から100。未設定の場合は空欄にします。"
                error={createDraftErrors.confidencePercent || undefined}
                onChange={(event) => {
                  setCreateDraft((current) => ({
                    ...current,
                    confidencePercent: event.target.value,
                  }));
                  setCreateDraftErrors((current) => ({
                    ...current,
                    confidencePercent: undefined,
                  }));
                }}
              />
              <Textarea
                label="未解決の質問"
                aria-label="未解決の質問"
                value={createDraft.unresolvedQuestions}
                rows={5}
                helpText="1行1件、最大50件です。"
                error={createDraftErrors.unresolvedQuestions || undefined}
                onChange={(event) => {
                  setCreateDraft((current) => ({
                    ...current,
                    unresolvedQuestions: event.target.value,
                  }));
                  setCreateDraftErrors((current) => ({
                    ...current,
                    unresolvedQuestions: undefined,
                  }));
                }}
              />
              <p>主根拠: 選択中のKnowledgeItem</p>
              {createNotice ? (
                <div aria-live="polite">
                  <Alert variant={createNotice.tone}>{createNotice.text}</Alert>
                </div>
              ) : null}
              <Button type="submit" loading={createBusy}>
                統合知を作成
              </Button>
            </form>
          </section>
        </Card>

        <Card padding="medium">
          <section aria-labelledby="knowledge-synthesis-list-heading">
            <h5 id="knowledge-synthesis-list-heading">統合知一覧</h5>
            <p>
              現在参照できる統合知を横断表示します。選択中のKnowledgeItemが現在版の根拠である統合知だけを更新できます。
            </p>
            <Button
              type="button"
              variant="ghost"
              size="small"
              loading={listStatus === 'loading'}
              onClick={() => void loadSyntheses()}
            >
              一覧を再読込
            </Button>
            {listStatus === 'loading' ? (
              <p role="status">統合知を読込中です。</p>
            ) : null}
            {listStatus === 'error' ? (
              <div aria-live="polite">
                <Alert variant="error">{listError}</Alert>
              </div>
            ) : null}
            {listStatus === 'success' && syntheses.length === 0 ? (
              <p>統合知はありません。</p>
            ) : null}
            {syntheses.length > 0 ? (
              <ul aria-label="統合知一覧">
                {syntheses.map((synthesis) => (
                  <li key={synthesis.id}>
                    <button
                      type="button"
                      aria-pressed={selectedSynthesisId === synthesis.id}
                      onClick={() => setSelectedSynthesisId(synthesis.id)}
                    >
                      <span>{synthesis.title}</span>
                      <span>
                        {scopeLabels[synthesis.scope]} / version{' '}
                        {synthesis.currentVersion}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {listMoreError ? (
              <div aria-live="polite">
                <Alert variant="error">{listMoreError}</Alert>
              </div>
            ) : null}
            {listNextCursor ? (
              <Button
                type="button"
                variant="ghost"
                size="small"
                loading={listMoreBusy}
                onClick={loadMoreSyntheses}
              >
                統合知をさらに読み込む
              </Button>
            ) : null}
          </section>
        </Card>
      </div>

      <Card padding="medium">
        <section aria-labelledby="knowledge-synthesis-detail-heading">
          <h5 id="knowledge-synthesis-detail-heading">統合知詳細</h5>
          {!selectedSynthesisId ? (
            <p>一覧から統合知を選択してください。</p>
          ) : null}
          {detailStatus === 'loading' ? (
            <p role="status">統合知の詳細と履歴を読込中です。</p>
          ) : null}
          {detailStatus === 'error' ? (
            <div aria-live="polite">
              <Alert variant="error">{detailError}</Alert>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void loadDetail()}
              >
                詳細を再読込
              </Button>
            </div>
          ) : null}
          {detailStatus === 'success' && detail ? (
            <div>
              <h6>{detail.synthesis.title}</h6>
              <dl>
                <div>
                  <dt>scope</dt>
                  <dd>{scopeLabels[detail.synthesis.scope]}</dd>
                </div>
                <div>
                  <dt>現在のversion</dt>
                  <dd>{detail.synthesis.currentVersion}</dd>
                </div>
                <div>
                  <dt>確信度</dt>
                  <dd>
                    {formatKnowledgeConfidence(
                      detail.currentVersion.confidenceBasisPoints,
                    )}
                  </dd>
                </div>
              </dl>
              <h6>現在の本文</h6>
              <div className="knowledge-provenance-content">
                {detail.currentVersion.content}
              </div>
              <h6>現在の未解決の質問</h6>
              <Questions
                questions={detail.currentVersion.unresolvedQuestions}
              />
              <h6>現在の根拠</h6>
              <ProvenanceList
                label="現在の版の根拠"
                sources={detail.currentVersion.sources}
              />

              {appendAllowed ? (
                <section aria-labelledby="knowledge-synthesis-append-heading">
                  <h6 id="knowledge-synthesis-append-heading">
                    新しいversionを追加
                  </h6>
                  <p>
                    追加scope: <strong>{scopeLabels[itemScope]}</strong> /
                    主根拠: 選択中のKnowledgeItem
                  </p>
                  <form noValidate onSubmit={submitAppend}>
                    <Textarea
                      label="追加する本文"
                      aria-label="追加する本文"
                      value={appendDraft.content}
                      rows={7}
                      required
                      helpText="UTF-8で最大256 KiBです。"
                      error={appendDraftErrors.content || undefined}
                      onChange={(event) => {
                        setAppendDraft((current) => ({
                          ...current,
                          content: event.target.value,
                        }));
                        setAppendDraftErrors((current) => ({
                          ...current,
                          content: undefined,
                        }));
                      }}
                    />
                    <Input
                      label="追加版の確信度（%）"
                      aria-label="追加版の確信度（%）"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={appendDraft.confidencePercent}
                      error={appendDraftErrors.confidencePercent || undefined}
                      onChange={(event) => {
                        setAppendDraft((current) => ({
                          ...current,
                          confidencePercent: event.target.value,
                        }));
                        setAppendDraftErrors((current) => ({
                          ...current,
                          confidencePercent: undefined,
                        }));
                      }}
                    />
                    <Textarea
                      label="追加版の未解決の質問"
                      aria-label="追加版の未解決の質問"
                      value={appendDraft.unresolvedQuestions}
                      rows={5}
                      helpText="1行1件、最大50件です。"
                      error={appendDraftErrors.unresolvedQuestions || undefined}
                      onChange={(event) => {
                        setAppendDraft((current) => ({
                          ...current,
                          unresolvedQuestions: event.target.value,
                        }));
                        setAppendDraftErrors((current) => ({
                          ...current,
                          unresolvedQuestions: undefined,
                        }));
                      }}
                    />
                    {appendNotice ? (
                      <div aria-live="polite">
                        <Alert variant={appendNotice.tone}>
                          {appendNotice.text}
                        </Alert>
                      </div>
                    ) : null}
                    <Button type="submit" loading={appendBusy}>
                      新しいversionを追加
                    </Button>
                  </form>
                </section>
              ) : (
                <Alert variant="warning">
                  この統合知は選択中のKnowledgeItemとの関連または現在の根拠を確認できないため、閲覧のみ可能です。
                </Alert>
              )}

              <section aria-labelledby="knowledge-synthesis-history-heading">
                <h6 id="knowledge-synthesis-history-heading">version履歴</h6>
                {versions.length === 0 ? (
                  <p>version履歴はありません。</p>
                ) : (
                  <div>
                    {versions.map((version) => (
                      <VersionSummary
                        key={version.id}
                        version={version}
                        provenanceLabel={`version ${version.version} の根拠`}
                      />
                    ))}
                  </div>
                )}
                {versionMoreError ? (
                  <div aria-live="polite">
                    <Alert variant="error">{versionMoreError}</Alert>
                  </div>
                ) : null}
                {versionNextCursor ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    loading={versionMoreBusy}
                    onClick={() => void loadMoreVersions()}
                  >
                    version履歴をさらに読み込む
                  </Button>
                ) : null}
              </section>
            </div>
          ) : null}
        </section>
      </Card>
    </section>
  );
}
