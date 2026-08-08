import React, {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  Select,
  Textarea,
} from '../../ui';
import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  formatKnowledgeDateTime,
  knowledgeHubErrorMessage,
} from './knowledgeHubModel';
import {
  createKnowledgeAnnotation,
  deleteKnowledgeAnnotation,
  getKnowledgeAnnotationCapabilities,
  listKnowledgeAnnotationRevisions,
  listKnowledgeAnnotations,
  reviseKnowledgeAnnotation,
} from './knowledgeProvenanceApi';
import {
  KNOWLEDGE_ANNOTATION_MAX_BYTES,
  knowledgeAnnotationKindLabels,
  knowledgeAnnotationKinds,
  knowledgeOriginLabels,
  knowledgeProvenanceOrigins,
  utf8Length,
  type KnowledgeAnnotation,
  type KnowledgeAnnotationKind,
  type KnowledgeAnnotationRevision,
  type KnowledgeProvenanceOrigin,
} from './knowledgeProvenanceModel';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

type AnnotationDraft = {
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
};

type EditDraft = AnnotationDraft & {
  annotationId: string;
};

type Notice = {
  variant: 'success' | 'error';
  message: string;
};

type MutationState =
  | { kind: 'create' }
  | { kind: 'revise' | 'delete'; annotationId: string }
  | null;

const scopeLabels = {
  personal: 'personal（個人）',
  organization: 'organization（組織）',
} as const;

function emptyDraft(): AnnotationDraft {
  return { kind: 'note', origin: 'user', content: '' };
}

function safeErrorMessage(error: unknown) {
  return knowledgeHubErrorMessage(
    error instanceof KnowledgeHubApiError ? error.code : 'unknown_error',
  );
}

function normalizedContent(content: string) {
  return content.trim();
}

function contentValidationMessage(content: string) {
  const normalized = normalizedContent(content);
  if (!normalized) return '内容を入力してください。';
  if (utf8Length(normalized) > KNOWLEDGE_ANNOTATION_MAX_BYTES) {
    return '内容はUTF-8で64 KiB以内にしてください。';
  }
  return '';
}

function ensureAnnotationForItem(
  annotation: KnowledgeAnnotation,
  itemId: string,
) {
  if (annotation.knowledgeItemId !== itemId) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return annotation;
}

function replaceAnnotation(
  annotations: KnowledgeAnnotation[],
  next: KnowledgeAnnotation,
) {
  return annotations.map((annotation) =>
    annotation.id === next.id ? next : annotation,
  );
}

function mergeUniqueById<T extends { id: string }>(current: T[], next: T[]) {
  const merged = [...current];
  const indexes = new Map(merged.map((entry, index) => [entry.id, index]));

  for (const entry of next) {
    const existingIndex = indexes.get(entry.id);
    if (existingIndex === undefined) {
      indexes.set(entry.id, merged.length);
      merged.push(entry);
    } else {
      merged[existingIndex] = entry;
    }
  }

  return merged;
}

export function KnowledgeAnnotationPanel(props: {
  itemId: string;
  itemScope: 'personal' | 'organization';
}): JSX.Element {
  const { itemId, itemScope } = props;
  const headingId = useId();
  const [annotations, setAnnotations] = useState<KnowledgeAnnotation[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>('idle');
  const [listError, setListError] = useState('');
  const [listNextCursor, setListNextCursor] = useState<string | null>(null);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listPageError, setListPageError] = useState('');
  const [canManageAnnotations, setCanManageAnnotations] = useState<
    boolean | null
  >(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createDraft, setCreateDraft] = useState<AnnotationDraft>(emptyDraft);
  const [createContentError, setCreateContentError] = useState('');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editContentError, setEditContentError] = useState('');
  const [mutation, setMutation] = useState<MutationState>(null);

  const [historyAnnotationId, setHistoryAnnotationId] = useState<string | null>(
    null,
  );
  const [revisions, setRevisions] = useState<KnowledgeAnnotationRevision[]>([]);
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>('idle');
  const [historyError, setHistoryError] = useState('');
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(
    null,
  );
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyPageError, setHistoryPageError] = useState('');

  const itemGenerationRef = useRef(0);
  const listRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const historySelectionRef = useRef<string | null>(null);
  const canManageAnnotationsRef = useRef<boolean | null>(null);

  const loadAnnotations = useCallback(
    async (
      targetItemId: string,
      generation: number,
      cursor: string | null = null,
    ) => {
      const append = cursor !== null;
      const request = listRequestRef.current + 1;
      listRequestRef.current = request;
      if (append) {
        setListLoadingMore(true);
        setListPageError('');
      } else {
        setListStatus('loading');
        setListError('');
        setListNextCursor(null);
        setListLoadingMore(false);
        setListPageError('');
        canManageAnnotationsRef.current = null;
        setCanManageAnnotations(null);
      }
      try {
        const capabilities = append
          ? { canManageAnnotations: canManageAnnotationsRef.current === true }
          : await getKnowledgeAnnotationCapabilities(targetItemId).catch(
              () => ({ canManageAnnotations: false }),
            );
        const page = await listKnowledgeAnnotations(targetItemId, {
          cursor,
          includeDeleted: capabilities.canManageAnnotations,
        });
        if (
          itemGenerationRef.current !== generation ||
          listRequestRef.current !== request
        ) {
          return;
        }
        if (
          page.items.some(
            (annotation) => annotation.knowledgeItemId !== targetItemId,
          )
        ) {
          throw new KnowledgeHubApiError('invalid_response', null);
        }
        setAnnotations((current) =>
          mergeUniqueById(append ? current : [], page.items),
        );
        if (!append) {
          canManageAnnotationsRef.current = capabilities.canManageAnnotations;
          setCanManageAnnotations(capabilities.canManageAnnotations);
        }
        setListNextCursor(page.nextCursor);
        setListStatus('success');
      } catch (error) {
        if (
          itemGenerationRef.current !== generation ||
          listRequestRef.current !== request
        ) {
          return;
        }
        if (append) {
          setListPageError(safeErrorMessage(error));
        } else {
          setAnnotations([]);
          canManageAnnotationsRef.current = null;
          setCanManageAnnotations(null);
          setListNextCursor(null);
          setListStatus('error');
          setListError(safeErrorMessage(error));
        }
      } finally {
        if (
          itemGenerationRef.current === generation &&
          listRequestRef.current === request
        ) {
          setListLoadingMore(false);
        }
      }
    },
    [],
  );

  const loadHistory = useCallback(
    async (
      targetItemId: string,
      annotationId: string,
      generation: number,
      cursor: string | null = null,
    ) => {
      const append = cursor !== null;
      const request = historyRequestRef.current + 1;
      historyRequestRef.current = request;
      historySelectionRef.current = annotationId;
      setHistoryAnnotationId(annotationId);
      if (append) {
        setHistoryLoadingMore(true);
        setHistoryPageError('');
      } else {
        setHistoryStatus('loading');
        setHistoryError('');
        setRevisions([]);
        setHistoryNextCursor(null);
        setHistoryLoadingMore(false);
        setHistoryPageError('');
      }
      try {
        const page = await listKnowledgeAnnotationRevisions({
          itemId: targetItemId,
          annotationId,
          cursor,
        });
        if (
          itemGenerationRef.current !== generation ||
          historyRequestRef.current !== request ||
          historySelectionRef.current !== annotationId
        ) {
          return;
        }
        if (
          page.items.some((revision) => revision.annotationId !== annotationId)
        ) {
          throw new KnowledgeHubApiError('invalid_response', null);
        }
        setRevisions((current) =>
          mergeUniqueById(append ? current : [], page.items),
        );
        setHistoryNextCursor(page.nextCursor);
        setHistoryStatus('success');
      } catch (error) {
        if (
          itemGenerationRef.current !== generation ||
          historyRequestRef.current !== request ||
          historySelectionRef.current !== annotationId
        ) {
          return;
        }
        if (append) {
          setHistoryPageError(safeErrorMessage(error));
        } else {
          setRevisions([]);
          setHistoryNextCursor(null);
          setHistoryStatus('error');
          setHistoryError(safeErrorMessage(error));
        }
      } finally {
        if (
          itemGenerationRef.current === generation &&
          historyRequestRef.current === request &&
          historySelectionRef.current === annotationId
        ) {
          setHistoryLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const generation = itemGenerationRef.current + 1;
    itemGenerationRef.current = generation;
    setAnnotations([]);
    setListStatus('idle');
    setListError('');
    setListNextCursor(null);
    setListLoadingMore(false);
    setListPageError('');
    canManageAnnotationsRef.current = null;
    setCanManageAnnotations(null);
    setNotice(null);
    setCreateDraft(emptyDraft());
    setCreateContentError('');
    setEditDraft(null);
    setEditContentError('');
    setMutation(null);
    historySelectionRef.current = null;
    setHistoryAnnotationId(null);
    setRevisions([]);
    setHistoryStatus('idle');
    setHistoryError('');
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setHistoryPageError('');
    void loadAnnotations(itemId, generation);

    return () => {
      if (itemGenerationRef.current === generation) {
        itemGenerationRef.current += 1;
      }
      listRequestRef.current += 1;
      mutationRequestRef.current += 1;
      historyRequestRef.current += 1;
      historySelectionRef.current = null;
    };
  }, [itemId, loadAnnotations]);

  const reloadAnnotations = () => {
    setNotice(null);
    historyRequestRef.current += 1;
    historySelectionRef.current = null;
    setHistoryAnnotationId(null);
    setRevisions([]);
    setHistoryStatus('idle');
    setHistoryError('');
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setHistoryPageError('');
    void loadAnnotations(itemId, itemGenerationRef.current);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationMessage = contentValidationMessage(createDraft.content);
    setCreateContentError(validationMessage);
    setNotice(null);
    if (validationMessage || mutation || canManageAnnotations !== true) return;

    const generation = itemGenerationRef.current;
    const request = mutationRequestRef.current + 1;
    mutationRequestRef.current = request;
    const targetItemId = itemId;
    setMutation({ kind: 'create' });
    try {
      const created = await createKnowledgeAnnotation({
        itemId: targetItemId,
        kind: createDraft.kind,
        origin: createDraft.origin,
        content: normalizedContent(createDraft.content),
      });
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      const next = ensureAnnotationForItem(created, targetItemId);
      setAnnotations((current) => [
        next,
        ...current.filter((annotation) => annotation.id !== next.id),
      ]);
      setListStatus('success');
      setCreateDraft(emptyDraft());
      setCreateContentError('');
      setNotice({
        variant: 'success',
        message: 'アノテーションを作成しました。',
      });
    } catch (error) {
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      setNotice({ variant: 'error', message: safeErrorMessage(error) });
    } finally {
      if (
        itemGenerationRef.current === generation &&
        mutationRequestRef.current === request
      ) {
        setMutation(null);
      }
    }
  };

  const startEditing = (annotation: KnowledgeAnnotation) => {
    if (annotation.deletedAt || mutation || canManageAnnotations !== true)
      return;
    setNotice(null);
    setEditContentError('');
    setEditDraft({
      annotationId: annotation.id,
      kind: annotation.kind,
      origin: annotation.origin,
      content: annotation.revision.content,
    });
  };

  const submitRevision = async (
    event: FormEvent<HTMLFormElement>,
    annotation: KnowledgeAnnotation,
  ) => {
    event.preventDefault();
    if (
      !editDraft ||
      editDraft.annotationId !== annotation.id ||
      annotation.deletedAt ||
      canManageAnnotations !== true ||
      mutation
    ) {
      return;
    }

    const normalized = normalizedContent(editDraft.content);
    let validationMessage = contentValidationMessage(editDraft.content);
    if (
      !validationMessage &&
      normalized === annotation.revision.content &&
      editDraft.kind === annotation.kind &&
      editDraft.origin === annotation.origin
    ) {
      validationMessage =
        '現在の内容、種別、由来のいずれかを変更してください。';
    }
    setEditContentError(validationMessage);
    setNotice(null);
    if (validationMessage) return;

    const generation = itemGenerationRef.current;
    const request = mutationRequestRef.current + 1;
    mutationRequestRef.current = request;
    const targetItemId = itemId;
    setMutation({ kind: 'revise', annotationId: annotation.id });
    try {
      const revised = await reviseKnowledgeAnnotation({
        itemId: targetItemId,
        annotationId: annotation.id,
        expectedRevision: annotation.currentRevision,
        kind: editDraft.kind,
        origin: editDraft.origin,
        content: normalized,
      });
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      const next = ensureAnnotationForItem(revised, targetItemId);
      setAnnotations((current) => replaceAnnotation(current, next));
      setEditDraft(null);
      setEditContentError('');
      setNotice({
        variant: 'success',
        message: 'アノテーションを改訂しました。',
      });
      if (historySelectionRef.current === annotation.id) {
        void loadHistory(targetItemId, annotation.id, generation);
      }
    } catch (error) {
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      setNotice({ variant: 'error', message: safeErrorMessage(error) });
    } finally {
      if (
        itemGenerationRef.current === generation &&
        mutationRequestRef.current === request
      ) {
        setMutation(null);
      }
    }
  };

  const removeAnnotation = async (annotation: KnowledgeAnnotation) => {
    if (annotation.deletedAt || mutation || canManageAnnotations !== true)
      return;
    setNotice(null);
    const generation = itemGenerationRef.current;
    const request = mutationRequestRef.current + 1;
    mutationRequestRef.current = request;
    const targetItemId = itemId;
    setMutation({ kind: 'delete', annotationId: annotation.id });
    try {
      const removed = await deleteKnowledgeAnnotation({
        itemId: targetItemId,
        annotationId: annotation.id,
        expectedRevision: annotation.currentRevision,
      });
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      const next = ensureAnnotationForItem(removed, targetItemId);
      setAnnotations((current) => replaceAnnotation(current, next));
      if (editDraft?.annotationId === annotation.id) {
        setEditDraft(null);
        setEditContentError('');
      }
      setNotice({
        variant: 'success',
        message: 'アノテーションを削除しました。',
      });
    } catch (error) {
      if (
        itemGenerationRef.current !== generation ||
        mutationRequestRef.current !== request
      ) {
        return;
      }
      setNotice({ variant: 'error', message: safeErrorMessage(error) });
    } finally {
      if (
        itemGenerationRef.current === generation &&
        mutationRequestRef.current === request
      ) {
        setMutation(null);
      }
    }
  };

  const closeHistory = () => {
    historyRequestRef.current += 1;
    historySelectionRef.current = null;
    setHistoryAnnotationId(null);
    setRevisions([]);
    setHistoryStatus('idle');
    setHistoryError('');
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setHistoryPageError('');
  };

  const historyPanel = (annotation: KnowledgeAnnotation) => {
    if (historyAnnotationId !== annotation.id) return null;
    const retry = () =>
      void loadHistory(itemId, annotation.id, itemGenerationRef.current);

    let contents: JSX.Element;
    if (historyStatus === 'idle' || historyStatus === 'loading') {
      contents = (
        <AsyncStatePanel state="loading" loadingText="改訂履歴を取得中" />
      );
    } else if (historyStatus === 'error') {
      contents = (
        <AsyncStatePanel
          state="error"
          error={{
            title: '改訂履歴を取得できませんでした',
            detail: historyError,
            retryLabel: '再試行',
            onRetry: retry,
          }}
        />
      );
    } else if (revisions.length === 0) {
      contents = (
        <AsyncStatePanel
          state="empty"
          empty={{ title: '改訂履歴はありません' }}
        />
      );
    } else {
      contents = (
        <>
          <ol aria-label="改訂履歴一覧">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <article aria-label={`改訂 ${revision.revision}`}>
                  <h6>改訂 {revision.revision}</h6>
                  <dl className="knowledge-hub-provenance-grid">
                    <div>
                      <dt>種別</dt>
                      <dd>{knowledgeAnnotationKindLabels[revision.kind]}</dd>
                    </div>
                    <div>
                      <dt>由来</dt>
                      <dd>{knowledgeOriginLabels[revision.origin]}</dd>
                    </div>
                    <div>
                      <dt>作成日時</dt>
                      <dd>{formatKnowledgeDateTime(revision.createdAt)}</dd>
                    </div>
                  </dl>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{revision.content}</p>
                </article>
              </li>
            ))}
          </ol>
          {historyPageError ? (
            <Alert variant="error">{historyPageError}</Alert>
          ) : null}
          {historyNextCursor ? (
            <div className="knowledge-hub-form-actions">
              <Button
                type="button"
                size="small"
                variant="secondary"
                loading={historyLoadingMore}
                disabled={historyLoadingMore}
                onClick={() =>
                  void loadHistory(
                    itemId,
                    annotation.id,
                    itemGenerationRef.current,
                    historyNextCursor,
                  )
                }
              >
                さらに読み込む
              </Button>
            </div>
          ) : null}
        </>
      );
    }

    return (
      <section aria-label="アノテーションの改訂履歴">
        <div className="knowledge-hub-selected-summary">
          <h6>改訂履歴</h6>
          <Button
            type="button"
            size="small"
            variant="ghost"
            onClick={closeHistory}
          >
            履歴を閉じる
          </Button>
        </div>
        {contents}
      </section>
    );
  };

  const annotationList = (() => {
    if (listStatus === 'idle' || listStatus === 'loading') {
      return (
        <AsyncStatePanel state="loading" loadingText="アノテーションを取得中" />
      );
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: 'アノテーションを取得できませんでした',
            detail: listError,
            retryLabel: '再試行',
            onRetry: reloadAnnotations,
          }}
        />
      );
    }
    if (annotations.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'アノテーションはありません',
            description: '上のフォームから最初のアノテーションを作成できます。',
          }}
        />
      );
    }

    return (
      <div aria-label="アノテーション一覧">
        <div className="knowledge-hub-snapshot-list">
          {annotations.map((annotation, index) => {
            const deleted = annotation.deletedAt !== null;
            const editing = editDraft?.annotationId === annotation.id;
            const revising =
              mutation?.kind === 'revise' &&
              mutation.annotationId === annotation.id;
            const deleting =
              mutation?.kind === 'delete' &&
              mutation.annotationId === annotation.id;
            return (
              <Card
                key={annotation.id}
                role="article"
                aria-label={`アノテーション ${index + 1}`}
                variant="outlined"
                padding="medium"
              >
                <div className="knowledge-hub-selected-summary">
                  <div>
                    <h5>アノテーション {index + 1}</h5>
                    <span>現在の改訂: {annotation.currentRevision}</span>
                  </div>
                  <strong>{deleted ? '状態: 削除済み' : '状態: 有効'}</strong>
                </div>

                <dl className="knowledge-hub-provenance-grid">
                  <div>
                    <dt>種別</dt>
                    <dd>{knowledgeAnnotationKindLabels[annotation.kind]}</dd>
                  </div>
                  <div>
                    <dt>由来</dt>
                    <dd>{knowledgeOriginLabels[annotation.origin]}</dd>
                  </div>
                  <div>
                    <dt>スコープ</dt>
                    <dd>{scopeLabels[annotation.scope]}</dd>
                  </div>
                  <div>
                    <dt>更新日時</dt>
                    <dd>{formatKnowledgeDateTime(annotation.updatedAt)}</dd>
                  </div>
                  {deleted ? (
                    <div>
                      <dt>削除日時</dt>
                      <dd>{formatKnowledgeDateTime(annotation.deletedAt)}</dd>
                    </div>
                  ) : null}
                </dl>

                <p style={{ whiteSpace: 'pre-wrap' }}>
                  {annotation.revision.content}
                </p>

                {editing && !deleted ? (
                  <form
                    className="knowledge-hub-capture-form"
                    aria-label={`アノテーション ${index + 1} を改訂`}
                    onSubmit={(event) => void submitRevision(event, annotation)}
                  >
                    <Select
                      label="改訂後の種別"
                      value={editDraft.kind}
                      disabled={Boolean(mutation)}
                      onChange={(event) => {
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                kind: event.target
                                  .value as KnowledgeAnnotationKind,
                              }
                            : current,
                        );
                      }}
                    >
                      {knowledgeAnnotationKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {knowledgeAnnotationKindLabels[kind]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="改訂後の由来"
                      value={editDraft.origin}
                      disabled={Boolean(mutation)}
                      onChange={(event) => {
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                origin: event.target
                                  .value as KnowledgeProvenanceOrigin,
                              }
                            : current,
                        );
                      }}
                    >
                      {knowledgeProvenanceOrigins.map((origin) => (
                        <option key={origin} value={origin}>
                          {knowledgeOriginLabels[origin]}
                        </option>
                      ))}
                    </Select>
                    <Textarea
                      label="改訂後の内容"
                      value={editDraft.content}
                      rows={5}
                      required
                      fullWidth
                      disabled={Boolean(mutation)}
                      error={editContentError || undefined}
                      onChange={(event) => {
                        setEditDraft((current) =>
                          current
                            ? { ...current, content: event.target.value }
                            : current,
                        );
                        setEditContentError('');
                      }}
                    />
                    <div className="knowledge-hub-form-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={Boolean(mutation)}
                        onClick={() => {
                          setEditDraft(null);
                          setEditContentError('');
                        }}
                      >
                        キャンセル
                      </Button>
                      <Button
                        type="submit"
                        loading={revising}
                        disabled={Boolean(mutation)}
                      >
                        改訂を保存
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="knowledge-hub-snapshot-actions">
                    {canManageAnnotations ? (
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={deleted || Boolean(mutation)}
                        onClick={() => startEditing(annotation)}
                      >
                        改訂
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={
                        historyStatus === 'loading' &&
                        historyAnnotationId === annotation.id
                      }
                      onClick={() =>
                        void loadHistory(
                          itemId,
                          annotation.id,
                          itemGenerationRef.current,
                        )
                      }
                    >
                      改訂履歴
                    </Button>
                    {canManageAnnotations ? (
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        loading={deleting}
                        disabled={deleted || Boolean(mutation)}
                        onClick={() => void removeAnnotation(annotation)}
                      >
                        {deleted ? '削除済み' : '削除'}
                      </Button>
                    ) : null}
                  </div>
                )}

                {historyPanel(annotation)}
              </Card>
            );
          })}
        </div>
        {listPageError ? <Alert variant="error">{listPageError}</Alert> : null}
        {listNextCursor ? (
          <div className="knowledge-hub-form-actions">
            <Button
              type="button"
              size="small"
              variant="secondary"
              loading={listLoadingMore}
              disabled={listLoadingMore}
              onClick={() =>
                void loadAnnotations(
                  itemId,
                  itemGenerationRef.current,
                  listNextCursor,
                )
              }
            >
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </div>
    );
  })();

  const createDisabled =
    listStatus !== 'success' ||
    canManageAnnotations !== true ||
    Boolean(mutation);

  return (
    <section aria-labelledby={headingId}>
      <Card variant="outlined" padding="medium">
        <div className="knowledge-hub-selected-summary">
          <div>
            <h4 id={headingId}>アノテーション</h4>
            <span>対象スコープ: {scopeLabels[itemScope]}</span>
          </div>
          <Button
            type="button"
            size="small"
            variant="ghost"
            loading={listStatus === 'loading'}
            disabled={Boolean(mutation)}
            onClick={reloadAnnotations}
          >
            再読込
          </Button>
        </div>

        {notice ? (
          <Alert variant={notice.variant}>{notice.message}</Alert>
        ) : null}

        {listStatus === 'success' && canManageAnnotations === false ? (
          <Alert variant="info">
            このKnowledge
            itemのアノテーションは閲覧のみです。作成、改訂、削除はitem
            ownerだけが実行できます。
          </Alert>
        ) : null}

        {canManageAnnotations === true ? (
          <form
            className="knowledge-hub-capture-form"
            aria-label="アノテーションを作成"
            onSubmit={(event) => void submitCreate(event)}
          >
            <Select
              label="新規アノテーションの種別"
              value={createDraft.kind}
              disabled={createDisabled}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  kind: event.target.value as KnowledgeAnnotationKind,
                }))
              }
            >
              {knowledgeAnnotationKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {knowledgeAnnotationKindLabels[kind]}
                </option>
              ))}
            </Select>
            <Select
              label="新規アノテーションの由来"
              value={createDraft.origin}
              disabled={createDisabled}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  origin: event.target.value as KnowledgeProvenanceOrigin,
                }))
              }
            >
              {knowledgeProvenanceOrigins.map((origin) => (
                <option key={origin} value={origin}>
                  {knowledgeOriginLabels[origin]}
                </option>
              ))}
            </Select>
            <Textarea
              label="新規アノテーションの内容"
              value={createDraft.content}
              rows={5}
              required
              fullWidth
              disabled={createDisabled}
              error={createContentError || undefined}
              onChange={(event) => {
                setCreateDraft((current) => ({
                  ...current,
                  content: event.target.value,
                }));
                setCreateContentError('');
              }}
            />
            <div className="knowledge-hub-form-actions">
              <Button
                type="submit"
                loading={mutation?.kind === 'create'}
                disabled={createDisabled}
              >
                アノテーションを作成
              </Button>
            </div>
          </form>
        ) : null}

        {annotationList}
      </Card>
    </section>
  );
}
