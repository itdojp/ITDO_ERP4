import React, {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Alert, Button, Card, Select, StatusBadge, Textarea } from '../../ui';
import { fetchChatRooms } from '../room-chat/roomChatApi';
import type { ChatRoom } from '../room-chat/roomChatModel';
import {
  commitKnowledgeShare,
  createKnowledgeShareRequestKey,
  KnowledgeShareSafeError,
  listKnowledgeShareLabelAssignments,
  previewKnowledgeShare,
  reconcileKnowledgeShare,
  revokeKnowledgeShare,
} from '../knowledge-share/knowledgeShareApi';
import type {
  KnowledgeShareCard,
  KnowledgeShareCommit,
  KnowledgeShareLabelAssignmentOption,
  KnowledgeSharePreview,
  KnowledgeShareSelectionCategory,
  KnowledgeShareSelectionDraft,
  KnowledgeShareStatusResponse,
} from '../knowledge-share/knowledgeShareModel';
import {
  formatKnowledgeDateTime,
  type KnowledgeScope,
  type KnowledgeSnapshot,
} from './knowledgeHubModel';
import {
  getKnowledgeSynthesis,
  listKnowledgeAnnotations,
  listKnowledgeConversations,
  listKnowledgeConversationTurns,
  listKnowledgeSyntheses,
} from './knowledgeProvenanceApi';
import {
  knowledgeAnnotationKindLabels,
  knowledgeOriginLabels,
  knowledgeRoleLabels,
  type KnowledgeAnnotation,
  type KnowledgeConversation,
  type KnowledgeConversationTurn,
  type KnowledgeSynthesisDetail,
} from './knowledgeProvenanceModel';
import {
  hasUnsafeKnowledgeShareNoteCharacter,
  knowledgeShareRoomDisplayLabel,
  mergeKnowledgeShareCandidates,
  mergeKnowledgeShareSynthesisDetails,
} from './knowledgeSharePanelHelpers';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

type PagedCandidates<T> = {
  status: LoadStatus;
  items: T[];
  nextCursor: string | null;
  loadingMore: boolean;
  pageError: boolean;
};

type RoomCandidates = {
  status: LoadStatus;
  items: ChatRoom[];
};

type LabelCandidates = {
  status: LoadStatus;
  items: KnowledgeShareLabelAssignmentOption[];
};

type ConversationCandidate = {
  conversation: KnowledgeConversation;
  turns: KnowledgeConversationTurn[];
  turnStatus: LoadStatus;
  nextCursor: string | null;
  loadingMore: boolean;
  pageError: boolean;
};

type ShareDraft = {
  destinationRoomId: string;
  includeTitle: boolean;
  includeSourceType: boolean;
  includeCanonicalUrl: boolean;
  snapshotId: string;
  includeSnapshotProvenance: boolean;
  includeSnapshotExcerpt: boolean;
  labelAssignmentIds: string[];
  annotationIds: string[];
  conversationTurnIds: string[];
  synthesisIds: string[];
  includeSharerNote: boolean;
  sharerNote: string;
};

type ReadyPreview = {
  contextKey: string;
  draftRevision: number;
  destinationRoomId: string;
  destinationLabel: string;
  selection: KnowledgeShareSelectionDraft;
  value: KnowledgeSharePreview;
  requestKey: string;
};

type ShareLifecycle = {
  value: KnowledgeShareStatusResponse;
  created: boolean;
  reused: boolean;
  resultUnknown: boolean;
};

type Notice = {
  tone: 'success' | 'warning' | 'error' | 'info';
  text: string;
};

const emptyPagedCandidates = <T,>(): PagedCandidates<T> => ({
  status: 'idle',
  items: [],
  nextCursor: null,
  loadingMore: false,
  pageError: false,
});

const initialDraft = (): ShareDraft => ({
  destinationRoomId: '',
  includeTitle: true,
  includeSourceType: false,
  includeCanonicalUrl: false,
  snapshotId: '',
  includeSnapshotProvenance: false,
  includeSnapshotExcerpt: false,
  labelAssignmentIds: [],
  annotationIds: [],
  conversationTurnIds: [],
  synthesisIds: [],
  includeSharerNote: false,
  sharerNote: '',
});

const statusDictionary = {
  pending: { label: '確認待ち', tone: 'warning' },
  posted: { label: '投稿済み', tone: 'success' },
  failed: { label: '投稿失敗', tone: 'danger' },
  revoked: { label: '取り消し済み', tone: 'neutral' },
} as const;

const lifecycleHeadingLabels = {
  pending: '投稿確認中',
  posted: '投稿済み',
  failed: '投稿失敗',
  revoked: '取消済み',
} as const;

const selectionCategoryLabels: Record<KnowledgeShareSelectionCategory, string> =
  {
    title: 'タイトル',
    source_type: '情報源の種類',
    canonical_url: '共有可能URL',
    snapshot_provenance: 'snapshotの版・ハッシュ',
    snapshot_excerpt: 'snapshotの抜粋',
    label: 'ラベル',
    annotation: 'annotation',
    conversation_turn: '会話turn',
    synthesis: 'Synthesis',
    sharer_note: '共有者メモ',
  };

const sourceTypeLabels: Record<
  NonNullable<KnowledgeShareCard['sourceType']>,
  string
> = {
  x: 'X',
  threads: 'Threads',
  news: 'ニュース',
  web: 'Web',
  pdf: 'PDF',
  image: '画像',
  manual: '手動登録',
  other: 'その他',
};

const conversationSourceTypeLabels = {
  manual: '手動',
  json: 'JSON取込',
  markdown: '限定Markdown取込',
} as const;

const failureLabels = {
  source_unavailable: '共有元の状態を確認できませんでした。',
  room_unavailable: '共有先Chat roomを利用できませんでした。',
  post_rejected: 'Chatへの投稿が受け付けられませんでした。',
} as const;

const roomTypeLabels: Record<string, string> = {
  project: '案件ルーム',
  private_group: 'プライベートルーム',
  dm: 'ダイレクトメッセージ',
  company: '全社ルーム',
};

function safeShareErrorMessage(
  error: unknown,
  operation: 'preview' | 'commit',
) {
  if (!(error instanceof KnowledgeShareSafeError)) {
    return '共有処理を完了できませんでした。内容と現在の権限を確認してください。';
  }
  if (error.code === 'request_aborted') return '';
  if (
    error.code === 'preview_token_expired' ||
    error.code === 'preview_token_invalid' ||
    error.code === 'stale_preview'
  ) {
    return 'プレビューが無効になりました。最新の内容で再度プレビューしてください。';
  }
  if (
    error.code === 'forbidden' ||
    error.code === 'not_found' ||
    error.code === 'unauthorized'
  ) {
    return '共有元または共有先を確認できません。権限と現在の状態を確認してください。';
  }
  if (error.code === 'network_error') {
    return operation === 'commit'
      ? '送信結果を確認できません。同じ共有を自動再送していません。'
      : '通信に失敗しました。接続を確認して再度プレビューしてください。';
  }
  if (error.code === 'secure_request_key_unavailable') {
    return '安全な送信キーを生成できません。このブラウザ環境では共有を実行できません。';
  }
  if (error.code === 'share_post_failed') {
    return 'Chatへの投稿を完了できませんでした。同じ共有を自動再送していません。';
  }
  return '共有処理を完了できませんでした。内容と現在の権限を確認してください。';
}

function isUncertainCommitError(error: unknown) {
  return (
    !(error instanceof KnowledgeShareSafeError) ||
    error.code === 'network_error' ||
    error.code === 'unknown_error'
  );
}

function confidenceLabel(value: number | null) {
  if (value === null) return '未設定';
  const percentage = value / 100;
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2)}%`;
}

function PreviewContent({ card }: { card: KnowledgeShareCard }) {
  const selected = new Set(card.selectedCategories);
  return (
    <div className="knowledge-share-preview-content">
      <dl>
        {selected.has('title') ? (
          <div>
            <dt>タイトル</dt>
            <dd>{card.title ?? '未設定'}</dd>
          </div>
        ) : null}
        {selected.has('source_type') && card.sourceType !== null ? (
          <div>
            <dt>情報源の種類</dt>
            <dd>{sourceTypeLabels[card.sourceType]}</dd>
          </div>
        ) : null}
        {selected.has('canonical_url') && card.canonicalUrl !== null ? (
          <div>
            <dt>共有可能URL</dt>
            <dd>
              <a
                href={card.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {card.canonicalUrl}
              </a>
            </dd>
          </div>
        ) : null}
        {selected.has('snapshot_provenance') &&
        card.snapshot?.version !== undefined &&
        card.snapshot.sha256 !== undefined ? (
          <>
            <div>
              <dt>snapshot version</dt>
              <dd>{card.snapshot.version}</dd>
            </div>
            <div>
              <dt>snapshot hash</dt>
              <dd>
                <code>{card.snapshot.sha256}</code>
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {selected.has('snapshot_excerpt') &&
      card.snapshot?.excerpt !== undefined ? (
        <section>
          <h6>snapshot抜粋</h6>
          <blockquote className="knowledge-provenance-content">
            {card.snapshot.excerpt}
          </blockquote>
        </section>
      ) : null}

      {selected.has('label') ? (
        <section>
          <h6>ラベル</h6>
          <ul aria-label="共有されるラベル">
            {card.labels.map((label, index) => (
              <li key={`${index}-${label.displayName}`}>{label.displayName}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected.has('annotation') ? (
        <section>
          <h6>annotation</h6>
          <ol aria-label="共有されるannotation">
            {card.annotations.map((annotation, index) => (
              <li key={index}>
                <strong>
                  {knowledgeAnnotationKindLabels[annotation.kind]} /{' '}
                  {knowledgeOriginLabels[annotation.origin]} / revision{' '}
                  {annotation.revision}
                </strong>
                <div className="knowledge-provenance-content">
                  {annotation.content}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {selected.has('conversation_turn') ? (
        <section>
          <h6>会話turn</h6>
          <ol aria-label="共有される会話turn">
            {card.turns.map((turn, index) => (
              <li key={index}>
                <strong>
                  {knowledgeRoleLabels[turn.role]} /{' '}
                  {knowledgeOriginLabels[turn.origin]}
                  {turn.name ? ` / ${turn.name}` : ''}
                </strong>
                {turn.occurredAt ? (
                  <div>
                    発生日時: {formatKnowledgeDateTime(turn.occurredAt)}
                  </div>
                ) : null}
                <div className="knowledge-provenance-content">
                  {turn.content}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {selected.has('synthesis') ? (
        <section>
          <h6>Synthesis</h6>
          <ol aria-label="共有されるSynthesis">
            {card.syntheses.map((synthesis, index) => (
              <li key={index}>
                <strong>
                  {synthesis.title} / version {synthesis.version}
                </strong>
                <div>
                  確信度: {confidenceLabel(synthesis.confidenceBasisPoints)}
                </div>
                <div className="knowledge-provenance-content">
                  {synthesis.content}
                </div>
                {synthesis.unresolvedQuestions.length > 0 ? (
                  <>
                    <p>未解決事項</p>
                    <ul>
                      {synthesis.unresolvedQuestions.map(
                        (question, questionIndex) => (
                          <li key={questionIndex}>{question}</li>
                        ),
                      )}
                    </ul>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {selected.has('sharer_note') && card.sharerNote !== null ? (
        <section>
          <h6>共有者メモ</h6>
          <div className="knowledge-provenance-content">{card.sharerNote}</div>
        </section>
      ) : null}

      <section>
        <h6>省略するカテゴリ</h6>
        <ul aria-label="共有されない項目">
          {card.omittedCategories.map((category) => (
            <li key={category}>{selectionCategoryLabels[category]}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function KnowledgeSharePanel(props: {
  itemId: string;
  itemLabel: string;
  itemScope: KnowledgeScope;
  snapshots: readonly KnowledgeSnapshot[];
}): JSX.Element {
  const { itemId, itemLabel, itemScope, snapshots } = props;
  const contextKey = JSON.stringify([itemId, itemScope]);
  const headingId = useId();

  const mountedRef = useRef(false);
  const activeContextRef = useRef(contextKey);
  const contextGenerationRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const previewSequenceRef = useRef(0);
  const commitSequenceRef = useRef(0);
  const statusSequenceRef = useRef(0);
  const turnSequencesRef = useRef(new Map<string, number>());
  const candidateAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);

  const [candidateReload, setCandidateReload] = useState(0);
  const [stateContextKey, setStateContextKey] = useState(contextKey);
  const [rooms, setRooms] = useState<RoomCandidates>({
    status: 'idle',
    items: [],
  });
  const [labels, setLabels] = useState<LabelCandidates>({
    status: 'idle',
    items: [],
  });
  const [annotations, setAnnotations] =
    useState<PagedCandidates<KnowledgeAnnotation>>(emptyPagedCandidates);
  const [conversations, setConversations] =
    useState<PagedCandidates<ConversationCandidate>>(emptyPagedCandidates);
  const [syntheses, setSyntheses] =
    useState<PagedCandidates<KnowledgeSynthesisDetail>>(emptyPagedCandidates);

  const [draft, setDraft] = useState<ShareDraft>(initialDraft);
  const [draftError, setDraftError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [readyPreview, setReadyPreview] = useState<ReadyPreview | null>(null);
  const [exactConfirmed, setExactConfirmed] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitAttempted, setCommitAttempted] = useState(false);
  const [uncertainCommit, setUncertainCommit] = useState(false);
  const [lifecycle, setLifecycle] = useState<ShareLifecycle | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useLayoutEffect(() => {
    activeContextRef.current = contextKey;
  }, [contextKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      contextGenerationRef.current += 1;
      previewSequenceRef.current += 1;
      commitSequenceRef.current += 1;
      statusSequenceRef.current += 1;
      candidateAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      statusAbortRef.current?.abort();
    };
  }, []);

  const isCurrentContext = useCallback(
    (requestContext: string, generation: number) =>
      mountedRef.current &&
      activeContextRef.current === requestContext &&
      contextGenerationRef.current === generation,
    [],
  );

  const loadConversationTurns = useCallback(
    async (
      conversationId: string,
      requestContext: string,
      generation: number,
      cursor: string | null = null,
      append = false,
      signal?: AbortSignal,
    ) => {
      const previousSequence =
        turnSequencesRef.current.get(conversationId) ?? 0;
      const sequence = previousSequence + 1;
      turnSequencesRef.current.set(conversationId, sequence);
      setConversations((current) => ({
        ...current,
        items: current.items.map((candidate) =>
          candidate.conversation.id === conversationId
            ? {
                ...candidate,
                turnStatus: append ? candidate.turnStatus : 'loading',
                loadingMore: append,
                pageError: false,
              }
            : candidate,
        ),
      }));
      try {
        const page = await listKnowledgeConversationTurns(
          conversationId,
          cursor,
          signal,
        );
        if (
          !isCurrentContext(requestContext, generation) ||
          turnSequencesRef.current.get(conversationId) !== sequence
        ) {
          return;
        }
        const exactTurns = page.items.filter(
          (turn) => turn.conversationId === conversationId,
        );
        setConversations((current) => ({
          ...current,
          items: current.items.map((candidate) =>
            candidate.conversation.id === conversationId
              ? {
                  ...candidate,
                  turns: (append
                    ? mergeKnowledgeShareCandidates(candidate.turns, exactTurns)
                    : exactTurns
                  ).sort((left, right) => left.sequence - right.sequence),
                  turnStatus: 'success',
                  nextCursor: page.nextCursor,
                  loadingMore: false,
                  pageError: false,
                }
              : candidate,
          ),
        }));
      } catch {
        if (
          signal?.aborted ||
          !isCurrentContext(requestContext, generation) ||
          turnSequencesRef.current.get(conversationId) !== sequence
        ) {
          return;
        }
        setConversations((current) => ({
          ...current,
          items: current.items.map((candidate) =>
            candidate.conversation.id === conversationId
              ? {
                  ...candidate,
                  turns: append ? candidate.turns : [],
                  turnStatus: append ? candidate.turnStatus : 'error',
                  loadingMore: false,
                  pageError: append,
                }
              : candidate,
          ),
        }));
      }
    },
    [isCurrentContext],
  );

  useEffect(() => {
    const requestContext = contextKey;
    const generation = contextGenerationRef.current + 1;
    contextGenerationRef.current = generation;
    draftRevisionRef.current += 1;
    previewSequenceRef.current += 1;
    commitSequenceRef.current += 1;
    statusSequenceRef.current += 1;
    turnSequencesRef.current.clear();

    candidateAbortRef.current?.abort();
    previewAbortRef.current?.abort();
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    candidateAbortRef.current = controller;

    setStateContextKey(contextKey);
    setRooms({ status: 'loading', items: [] });
    setLabels({ status: 'loading', items: [] });
    setAnnotations({
      ...emptyPagedCandidates<KnowledgeAnnotation>(),
      status: 'loading',
    });
    setConversations({
      ...emptyPagedCandidates<ConversationCandidate>(),
      status: 'loading',
    });
    setSyntheses({
      ...emptyPagedCandidates<KnowledgeSynthesisDetail>(),
      status: 'loading',
    });
    setDraft(initialDraft());
    setDraftError('');
    setPreviewBusy(false);
    setReadyPreview(null);
    setExactConfirmed(false);
    setCommitBusy(false);
    setCommitAttempted(false);
    setUncertainCommit(false);
    setLifecycle(null);
    setStatusBusy(false);
    setNotice(null);

    void fetchChatRooms({ signal: controller.signal })
      .then((items) => {
        if (!isCurrentContext(requestContext, generation)) return;
        setRooms({
          status: 'success',
          items: items.filter((room) => room.isMember !== false),
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (!isCurrentContext(requestContext, generation)) return;
        setRooms({ status: 'error', items: [] });
      });

    void listKnowledgeShareLabelAssignments(itemId, {
      signal: controller.signal,
    })
      .then((items) => {
        if (!isCurrentContext(requestContext, generation)) return;
        setLabels({
          status: 'success',
          items,
        });
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          (error instanceof KnowledgeShareSafeError &&
            error.code === 'request_aborted') ||
          !isCurrentContext(requestContext, generation)
        ) {
          return;
        }
        setLabels({ status: 'error', items: [] });
      });

    void listKnowledgeAnnotations(itemId, { signal: controller.signal })
      .then((page) => {
        if (!isCurrentContext(requestContext, generation)) return;
        setAnnotations({
          status: 'success',
          items: page.items.filter(
            (annotation) =>
              annotation.knowledgeItemId === itemId &&
              annotation.scope === itemScope &&
              annotation.deletedAt === null &&
              annotation.revision.annotationId === annotation.id &&
              annotation.revision.revision === annotation.currentRevision,
          ),
          nextCursor: page.nextCursor,
          loadingMore: false,
          pageError: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (!isCurrentContext(requestContext, generation)) return;
        setAnnotations({
          ...emptyPagedCandidates<KnowledgeAnnotation>(),
          status: 'error',
        });
      });

    void listKnowledgeConversations({
      knowledgeItemId: itemId,
      signal: controller.signal,
    })
      .then((page) => {
        if (!isCurrentContext(requestContext, generation)) return;
        const candidates = page.items
          .filter((conversation) =>
            conversation.items.some(
              (relation) => relation.knowledgeItemId === itemId,
            ),
          )
          .map((conversation) => ({
            conversation,
            turns: [],
            turnStatus: 'loading' as const,
            nextCursor: null,
            loadingMore: false,
            pageError: false,
          }));
        setConversations({
          status: 'success',
          items: candidates,
          nextCursor: page.nextCursor,
          loadingMore: false,
          pageError: false,
        });
        for (const candidate of candidates) {
          void loadConversationTurns(
            candidate.conversation.id,
            requestContext,
            generation,
            null,
            false,
            controller.signal,
          );
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (!isCurrentContext(requestContext, generation)) return;
        setConversations({
          ...emptyPagedCandidates<ConversationCandidate>(),
          status: 'error',
        });
      });

    void listKnowledgeSyntheses(null, controller.signal)
      .then(async (page) => {
        const details = await Promise.all(
          page.items.map(async (synthesis) => {
            if (synthesis.scope !== itemScope) return null;
            try {
              const detail = await getKnowledgeSynthesis(
                synthesis.id,
                controller.signal,
              );
              const exactVersion =
                detail.synthesis.id === synthesis.id &&
                detail.synthesis.scope === itemScope &&
                detail.synthesis.currentVersion === synthesis.currentVersion &&
                detail.currentVersion.synthesisId === synthesis.id &&
                detail.currentVersion.version === synthesis.currentVersion;
              const currentItemSource = detail.currentVersion.sources.some(
                (source) =>
                  source.accessible &&
                  source.kind === 'item' &&
                  source.sourceId === itemId,
              );
              return exactVersion && currentItemSource ? detail : null;
            } catch {
              return null;
            }
          }),
        );
        if (!isCurrentContext(requestContext, generation)) return;
        setSyntheses({
          status: 'success',
          items: details.filter(
            (detail): detail is KnowledgeSynthesisDetail => detail !== null,
          ),
          nextCursor: page.nextCursor,
          loadingMore: false,
          pageError: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (!isCurrentContext(requestContext, generation)) return;
        setSyntheses({
          ...emptyPagedCandidates<KnowledgeSynthesisDetail>(),
          status: 'error',
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    candidateReload,
    contextKey,
    isCurrentContext,
    itemId,
    itemScope,
    loadConversationTurns,
  ]);

  const visibleSnapshots = useMemo(
    () =>
      snapshots
        .filter(
          (snapshot) =>
            snapshot.knowledgeItemId === itemId && snapshot.status === 'ready',
        )
        .sort((left, right) => right.version - left.version),
    [itemId, snapshots],
  );

  const contextIsVisible = stateContextKey === contextKey;
  const visibleRooms = contextIsVisible ? rooms.items : [];
  const visibleLabels = contextIsVisible ? labels.items : [];
  const visibleAnnotations = contextIsVisible ? annotations.items : [];
  const visibleConversations = contextIsVisible ? conversations.items : [];
  const visibleSyntheses = contextIsVisible ? syntheses.items : [];

  const invalidatePreview = useCallback(() => {
    draftRevisionRef.current += 1;
    previewSequenceRef.current += 1;
    commitSequenceRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setReadyPreview(null);
    setExactConfirmed(false);
    setPreviewBusy(false);
    setCommitBusy(false);
    setCommitAttempted(false);
    setDraftError('');
    setNotice(null);
  }, []);

  const changeDraft = useCallback(
    (change: (current: ShareDraft) => ShareDraft) => {
      invalidatePreview();
      setDraft(change);
    },
    [invalidatePreview],
  );

  useEffect(() => {
    if (
      draft.snapshotId &&
      !visibleSnapshots.some((snapshot) => snapshot.id === draft.snapshotId)
    ) {
      changeDraft((current) => ({
        ...current,
        snapshotId: '',
        includeSnapshotProvenance: false,
        includeSnapshotExcerpt: false,
      }));
    }
  }, [changeDraft, draft.snapshotId, visibleSnapshots]);

  const toggleBoundedId = (
    field:
      | 'labelAssignmentIds'
      | 'annotationIds'
      | 'conversationTurnIds'
      | 'synthesisIds',
    id: string,
    maximum: number,
  ) => {
    changeDraft((current) => {
      const selected = current[field];
      if (selected.includes(id)) {
        return {
          ...current,
          [field]: selected.filter((entry) => entry !== id),
        };
      }
      if (selected.length >= maximum) return current;
      return { ...current, [field]: [...selected, id] };
    });
  };

  const buildSelection = ():
    | { ok: true; value: KnowledgeShareSelectionDraft }
    | { ok: false; message: string } => {
    const destinationRoom = visibleRooms.find(
      (room) => room.id === draft.destinationRoomId,
    );
    if (!destinationRoom) {
      return { ok: false, message: '共有先Chat roomを選択してください。' };
    }
    const snapshot = visibleSnapshots.find(
      (candidate) => candidate.id === draft.snapshotId,
    );
    const selectedSnapshot =
      snapshot &&
      (draft.includeSnapshotProvenance || draft.includeSnapshotExcerpt)
        ? {
            snapshotId: snapshot.id,
            includeProvenance: draft.includeSnapshotProvenance,
            includeExcerpt: draft.includeSnapshotExcerpt,
          }
        : null;

    const selectedLabels = visibleLabels
      .filter((label) => draft.labelAssignmentIds.includes(label.assignmentId))
      .map((label) => label.assignmentId);
    const selectedAnnotations = visibleAnnotations
      .filter((annotation) => draft.annotationIds.includes(annotation.id))
      .map((annotation) => ({
        annotationId: annotation.id,
        revision: annotation.currentRevision,
      }));
    const visibleTurns = visibleConversations.flatMap(
      (conversation) => conversation.turns,
    );
    const selectedTurns = visibleTurns
      .filter((turn) => draft.conversationTurnIds.includes(turn.id))
      .map((turn) => turn.id);
    const selectedSyntheses = visibleSyntheses
      .filter((detail) => draft.synthesisIds.includes(detail.synthesis.id))
      .map((detail) => ({
        synthesisId: detail.synthesis.id,
        version: detail.synthesis.currentVersion,
      }));

    const note = draft.includeSharerNote ? draft.sharerNote.trim() : '';
    if (new TextEncoder().encode(note).byteLength > 4096) {
      return {
        ok: false,
        message: '共有者メモはUTF-8で4 KiB以内にしてください。',
      };
    }
    if (note && hasUnsafeKnowledgeShareNoteCharacter(note)) {
      return {
        ok: false,
        message: '共有者メモに使用できない制御文字が含まれています。',
      };
    }

    if (
      !draft.includeTitle &&
      !draft.includeSourceType &&
      !draft.includeCanonicalUrl &&
      selectedSnapshot === null &&
      selectedLabels.length === 0 &&
      selectedAnnotations.length === 0 &&
      selectedTurns.length === 0 &&
      selectedSyntheses.length === 0 &&
      !note
    ) {
      return { ok: false, message: '共有する項目を1つ以上選択してください。' };
    }

    return {
      ok: true,
      value: {
        includeTitle: draft.includeTitle,
        includeSourceType: draft.includeSourceType,
        includeCanonicalUrl: draft.includeCanonicalUrl,
        snapshot: selectedSnapshot,
        labelAssignmentIds: selectedLabels,
        annotations: selectedAnnotations,
        conversationTurnIds: selectedTurns,
        syntheses: selectedSyntheses,
        sharerNote: note || null,
      },
    };
  };

  const submitPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewBusy || commitBusy || lifecycle || uncertainCommit) return;
    setDraftError('');
    setNotice(null);
    const selection = buildSelection();
    if (!selection.ok) {
      setDraftError(selection.message);
      return;
    }

    const selectedRoom = visibleRooms.find(
      (room) => room.id === draft.destinationRoomId,
    );
    if (!selectedRoom) {
      setDraftError('共有先Chat roomを選択してください。');
      return;
    }
    const roomIndex = visibleRooms.indexOf(selectedRoom);
    const destinationLabel = knowledgeShareRoomDisplayLabel(
      selectedRoom,
      roomIndex,
    );
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    const revision = draftRevisionRef.current;
    const sequence = previewSequenceRef.current + 1;
    previewSequenceRef.current = sequence;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setReadyPreview(null);
    setExactConfirmed(false);
    // A deliberate new preview starts a new, user-driven commit attempt. This
    // does not apply to an uncertain transport result, which is blocked above.
    setCommitAttempted(false);
    setPreviewBusy(true);

    try {
      const value = await previewKnowledgeShare(
        {
          itemId,
          destinationRoomId: selectedRoom.id,
          selection: selection.value,
        },
        { signal: controller.signal },
      );
      if (
        !isCurrentContext(requestContext, generation) ||
        previewSequenceRef.current !== sequence ||
        draftRevisionRef.current !== revision
      ) {
        return;
      }
      if (
        value.destinationRoom.name !== selectedRoom.name ||
        value.destinationRoom.type !== selectedRoom.type
      ) {
        throw new KnowledgeShareSafeError('invalid_response', null);
      }
      const requestKey = createKnowledgeShareRequestKey();
      setReadyPreview({
        contextKey: requestContext,
        draftRevision: revision,
        destinationRoomId: selectedRoom.id,
        destinationLabel,
        selection: selection.value,
        value,
        requestKey,
      });
      setNotice({
        tone: 'info',
        text: 'サーバーが返した共有先と共有内容を確認してください。',
      });
    } catch (error) {
      if (
        !isCurrentContext(requestContext, generation) ||
        previewSequenceRef.current !== sequence ||
        (error instanceof KnowledgeShareSafeError &&
          error.code === 'request_aborted')
      ) {
        return;
      }
      const message = safeShareErrorMessage(error, 'preview');
      if (message) setNotice({ tone: 'error', text: message });
      setReadyPreview(null);
      setExactConfirmed(false);
    } finally {
      if (
        isCurrentContext(requestContext, generation) &&
        previewSequenceRef.current === sequence
      ) {
        setPreviewBusy(false);
      }
    }
  };

  const commitPreview = async () => {
    if (
      !readyPreview ||
      !exactConfirmed ||
      commitBusy ||
      commitAttempted ||
      readyPreview.contextKey !== contextKey ||
      readyPreview.draftRevision !== draftRevisionRef.current
    ) {
      return;
    }
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    const sequence = commitSequenceRef.current + 1;
    commitSequenceRef.current = sequence;
    setCommitAttempted(true);
    setCommitBusy(true);
    setNotice(null);
    try {
      const result: KnowledgeShareCommit = await commitKnowledgeShare({
        itemId,
        destinationRoomId: readyPreview.destinationRoomId,
        selection: readyPreview.selection,
        previewToken: readyPreview.value.previewToken,
        requestKey: readyPreview.requestKey,
      });
      if (
        !isCurrentContext(requestContext, generation) ||
        commitSequenceRef.current !== sequence
      ) {
        return;
      }
      setReadyPreview(null);
      setExactConfirmed(false);
      setLifecycle({
        value: result,
        created: result.created,
        reused: result.reused,
        resultUnknown: result.resultUnknown,
      });
      setNotice({
        tone:
          result.status === 'failed'
            ? 'error'
            : result.status === 'pending'
              ? 'warning'
              : 'success',
        text: result.reused
          ? '同一操作の既存共有を再利用しました。'
          : result.resultUnknown
            ? '送信結果が未確定です。自動再送せず、状態照合を待っています。'
            : result.status === 'posted'
              ? '共有を新規作成しました。'
              : result.status === 'failed'
                ? 'Chatへの投稿を完了できませんでした。自動再投稿は行いません。'
                : '共有処理を受け付けました。自動再送せず、状態を照合できます。',
      });
    } catch (error) {
      if (
        !isCurrentContext(requestContext, generation) ||
        commitSequenceRef.current !== sequence
      ) {
        return;
      }
      setReadyPreview(null);
      setExactConfirmed(false);
      const uncertain = isUncertainCommitError(error);
      setUncertainCommit(uncertain);
      setNotice({
        tone: 'error',
        text: uncertain
          ? `${safeShareErrorMessage(error, 'commit')} 安全に照合する識別子を取得できないため、この画面からの追加送信を停止しました。`
          : safeShareErrorMessage(error, 'commit'),
      });
    } finally {
      if (
        isCurrentContext(requestContext, generation) &&
        commitSequenceRef.current === sequence
      ) {
        setCommitBusy(false);
      }
    }
  };

  const reconcilePending = async () => {
    if (!lifecycle || lifecycle.value.status !== 'pending' || statusBusy)
      return;
    const shareId = lifecycle.value.shareId;
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    const sequence = statusSequenceRef.current + 1;
    statusSequenceRef.current = sequence;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setStatusBusy(true);
    setNotice(null);
    try {
      const value = await reconcileKnowledgeShare(shareId, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        !isCurrentContext(requestContext, generation) ||
        statusSequenceRef.current !== sequence
      ) {
        return;
      }
      if (value.shareId !== shareId) throw new Error('status_mismatch');
      setLifecycle((current) =>
        current ? { ...current, value, resultUnknown: false } : current,
      );
      setNotice({
        tone:
          value.status === 'posted'
            ? 'success'
            : value.status === 'failed'
              ? 'error'
              : 'warning',
        text:
          value.status === 'pending'
            ? '状態は引き続き確認待ちです。再投稿は行っていません。'
            : value.status === 'posted'
              ? '既存のChat投稿を照合し、投稿済みを確認しました。'
              : value.status === 'failed'
                ? '既存の共有処理は失敗状態です。再投稿は行っていません。'
                : '共有は取り消し済みです。',
      });
    } catch {
      if (
        controller.signal.aborted ||
        !isCurrentContext(requestContext, generation) ||
        statusSequenceRef.current !== sequence
      ) {
        return;
      }
      setNotice({
        tone: 'error',
        text: '状態を照合できませんでした。再投稿は行っていません。',
      });
    } finally {
      if (
        isCurrentContext(requestContext, generation) &&
        statusSequenceRef.current === sequence
      ) {
        setStatusBusy(false);
      }
    }
  };

  const revokeShare = async () => {
    if (!lifecycle || lifecycle.value.status === 'revoked' || statusBusy)
      return;
    const shareId = lifecycle.value.shareId;
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    const sequence = statusSequenceRef.current + 1;
    statusSequenceRef.current = sequence;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setStatusBusy(true);
    setNotice(null);
    try {
      const value = await revokeKnowledgeShare(shareId, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        !isCurrentContext(requestContext, generation) ||
        statusSequenceRef.current !== sequence
      ) {
        return;
      }
      if (value.shareId !== shareId) throw new Error('status_mismatch');
      setLifecycle((current) =>
        current ? { ...current, value, resultUnknown: false } : current,
      );
      setNotice({
        tone: 'success',
        text: 'Chat共有を取り消しました。共有内容は表示されません。',
      });
    } catch {
      if (
        controller.signal.aborted ||
        !isCurrentContext(requestContext, generation) ||
        statusSequenceRef.current !== sequence
      ) {
        return;
      }
      setNotice({
        tone: 'error',
        text: '共有を取り消せませんでした。権限と現在の状態を確認してください。',
      });
    } finally {
      if (
        isCurrentContext(requestContext, generation) &&
        statusSequenceRef.current === sequence
      ) {
        setStatusBusy(false);
      }
    }
  };

  const resetForAnotherShare = () => {
    draftRevisionRef.current += 1;
    setDraft(initialDraft());
    setDraftError('');
    setReadyPreview(null);
    setExactConfirmed(false);
    setCommitAttempted(false);
    setUncertainCommit(false);
    setLifecycle(null);
    setNotice(null);
  };

  const loadMoreAnnotations = async () => {
    const cursor = annotations.nextCursor;
    if (!cursor || annotations.loadingMore) return;
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    setAnnotations((current) => ({
      ...current,
      loadingMore: true,
      pageError: false,
    }));
    try {
      const signal = candidateAbortRef.current?.signal;
      const page = await listKnowledgeAnnotations(itemId, { cursor, signal });
      if (!isCurrentContext(requestContext, generation)) return;
      setAnnotations((current) => ({
        ...current,
        items: mergeKnowledgeShareCandidates(
          current.items,
          page.items.filter(
            (annotation) =>
              annotation.knowledgeItemId === itemId &&
              annotation.scope === itemScope &&
              annotation.deletedAt === null &&
              annotation.revision.annotationId === annotation.id &&
              annotation.revision.revision === annotation.currentRevision,
          ),
        ),
        nextCursor: page.nextCursor,
        loadingMore: false,
        pageError: false,
      }));
    } catch {
      if (candidateAbortRef.current?.signal.aborted) return;
      if (!isCurrentContext(requestContext, generation)) return;
      setAnnotations((current) => ({
        ...current,
        loadingMore: false,
        pageError: true,
      }));
    }
  };

  const loadMoreConversations = async () => {
    const cursor = conversations.nextCursor;
    if (!cursor || conversations.loadingMore) return;
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    setConversations((current) => ({
      ...current,
      loadingMore: true,
      pageError: false,
    }));
    try {
      const page = await listKnowledgeConversations({
        knowledgeItemId: itemId,
        cursor,
        signal: candidateAbortRef.current?.signal,
      });
      if (!isCurrentContext(requestContext, generation)) return;
      const currentIds = new Set(
        conversations.items.map((candidate) => candidate.conversation.id),
      );
      const nextCandidates = page.items
        .filter(
          (conversation) =>
            !currentIds.has(conversation.id) &&
            conversation.items.some(
              (relation) => relation.knowledgeItemId === itemId,
            ),
        )
        .map((conversation) => ({
          conversation,
          turns: [],
          turnStatus: 'loading' as const,
          nextCursor: null,
          loadingMore: false,
          pageError: false,
        }));
      setConversations((current) => ({
        ...current,
        items: [...current.items, ...nextCandidates],
        nextCursor: page.nextCursor,
        loadingMore: false,
        pageError: false,
      }));
      for (const candidate of nextCandidates) {
        void loadConversationTurns(
          candidate.conversation.id,
          requestContext,
          generation,
          null,
          false,
          candidateAbortRef.current?.signal,
        );
      }
    } catch {
      if (candidateAbortRef.current?.signal.aborted) return;
      if (!isCurrentContext(requestContext, generation)) return;
      setConversations((current) => ({
        ...current,
        loadingMore: false,
        pageError: true,
      }));
    }
  };

  const loadMoreSyntheses = async () => {
    const cursor = syntheses.nextCursor;
    if (!cursor || syntheses.loadingMore) return;
    const requestContext = contextKey;
    const generation = contextGenerationRef.current;
    setSyntheses((current) => ({
      ...current,
      loadingMore: true,
      pageError: false,
    }));
    try {
      const signal = candidateAbortRef.current?.signal;
      const page = await listKnowledgeSyntheses(cursor, signal);
      const details = await Promise.all(
        page.items.map(async (synthesis) => {
          if (synthesis.scope !== itemScope) return null;
          try {
            const detail = await getKnowledgeSynthesis(synthesis.id, signal);
            const exactVersion =
              detail.synthesis.id === synthesis.id &&
              detail.synthesis.scope === itemScope &&
              detail.synthesis.currentVersion === synthesis.currentVersion &&
              detail.currentVersion.synthesisId === synthesis.id &&
              detail.currentVersion.version === synthesis.currentVersion;
            const currentItemSource = detail.currentVersion.sources.some(
              (source) =>
                source.accessible &&
                source.kind === 'item' &&
                source.sourceId === itemId,
            );
            return exactVersion && currentItemSource ? detail : null;
          } catch {
            return null;
          }
        }),
      );
      if (!isCurrentContext(requestContext, generation)) return;
      setSyntheses((current) => ({
        ...current,
        items: mergeKnowledgeShareSynthesisDetails(
          current.items,
          details.filter(
            (detail): detail is KnowledgeSynthesisDetail => detail !== null,
          ),
        ),
        nextCursor: page.nextCursor,
        loadingMore: false,
        pageError: false,
      }));
    } catch {
      if (candidateAbortRef.current?.signal.aborted) return;
      if (!isCurrentContext(requestContext, generation)) return;
      setSyntheses((current) => ({
        ...current,
        loadingMore: false,
        pageError: true,
      }));
    }
  };

  const candidateError =
    rooms.status === 'error' ||
    labels.status === 'error' ||
    annotations.status === 'error' ||
    conversations.status === 'error' ||
    syntheses.status === 'error';
  const fieldsDisabled = commitBusy || Boolean(lifecycle) || uncertainCommit;
  const selectedDraftRoom = visibleRooms.find(
    (room) => room.id === draft.destinationRoomId,
  );

  return (
    <section
      aria-labelledby={headingId}
      className="knowledge-share-panel knowledge-share-panel-mobile"
    >
      <h4 id={headingId}>Chatへ選択共有</h4>
      <p>
        <strong>{itemLabel}</strong>
        のfieldを選び、共有先とサーバー生成previewを確認してから投稿します。
      </p>
      <Alert variant="warning">
        タイトルだけが安全な既定選択です。privateなラベル、annotation、会話turn、
        Synthesis、snapshot、情報源、URL、メモは明示選択しない限り共有しません。
      </Alert>

      {candidateError ? (
        <Alert variant="warning">
          一部の共有候補を取得できませんでした。取得できていない項目は共有対象になりません。
          <div>
            <Button
              type="button"
              variant="outline"
              size="small"
              onClick={() => setCandidateReload((current) => current + 1)}
              disabled={fieldsDisabled}
            >
              候補を再取得
            </Button>
          </div>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant={notice.tone}>
          <span aria-live="polite">{notice.text}</span>
        </Alert>
      ) : null}

      {uncertainCommit ? (
        <Alert variant="error" title="送信結果を安全に確認できません">
          送信結果を安全に照合できないため、このitemを表示している間は追加送信を停止しています。
          Chat側を確認し、必要に応じてitemを選択し直してください。
        </Alert>
      ) : null}

      {lifecycle ? (
        <Card padding="small">
          <section aria-labelledby={`${headingId}-status`}>
            <h5 id={`${headingId}-status`}>
              {lifecycleHeadingLabels[lifecycle.value.status]}
            </h5>
            <p aria-live="polite">
              <StatusBadge
                status={lifecycle.value.status}
                dictionary={statusDictionary}
                ariaLabel={`共有状態: ${statusDictionary[lifecycle.value.status].label}`}
              />
            </p>
            <dl>
              <div>
                <dt>処理結果</dt>
                <dd>
                  {lifecycle.reused
                    ? '既存共有を再利用（重複投稿なし）'
                    : '新しい共有を作成'}
                </dd>
              </div>
              {lifecycle.value.status === 'failed' &&
              lifecycle.value.failureCode ? (
                <div>
                  <dt>失敗理由</dt>
                  <dd>{failureLabels[lifecycle.value.failureCode]}</dd>
                </div>
              ) : null}
            </dl>
            <div>
              {lifecycle.value.status === 'pending' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reconcilePending()}
                  disabled={statusBusy}
                  loading={statusBusy}
                >
                  既存投稿を読取専用で照合
                </Button>
              ) : null}{' '}
              {lifecycle.value.status === 'pending' ||
              lifecycle.value.status === 'posted' ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void revokeShare()}
                  disabled={statusBusy}
                >
                  共有を取り消す
                </Button>
              ) : null}{' '}
              {lifecycle.value.status !== 'pending' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForAnotherShare}
                  disabled={statusBusy}
                >
                  別の共有を準備
                </Button>
              ) : null}
            </div>
          </section>
        </Card>
      ) : null}

      <form
        className="knowledge-share-panel-responsive-grid"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
          gap: '1rem',
        }}
        aria-describedby={draftError ? `${headingId}-draft-error` : undefined}
        onSubmit={(event) => void submitPreview(event)}
        noValidate
      >
        <fieldset disabled={fieldsDisabled}>
          <legend>共有先</legend>
          <Select
            label="共有先Chatルーム"
            value={draft.destinationRoomId}
            onChange={(event) =>
              changeDraft((current) => ({
                ...current,
                destinationRoomId: event.target.value,
              }))
            }
            disabled={fieldsDisabled || rooms.status === 'loading'}
            fullWidth
          >
            <option value="">選択してください</option>
            {visibleRooms.map((room, index) => (
              <option key={room.id} value={room.id}>
                {knowledgeShareRoomDisplayLabel(room, index)}（
                {roomTypeLabels[room.type] ?? 'Chat room'}）
              </option>
            ))}
          </Select>
          {rooms.status === 'loading' ? (
            <p role="status">Chat roomを読み込み中です。</p>
          ) : rooms.status === 'success' && visibleRooms.length === 0 ? (
            <p>共有可能なChat roomはありません。</p>
          ) : null}
          {selectedDraftRoom?.allowExternalUsers === true ? (
            <p role="alert">
              このChat
              roomは外部参加者を許可しています。初期契約では共有できないため、previewとcommitでserverがcurrent
              audienceを最終確認します。
            </p>
          ) : null}
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>基本項目</legend>
          <label>
            <input
              type="checkbox"
              checked={draft.includeTitle}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeTitle: event.target.checked,
                }))
              }
            />{' '}
            タイトル
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.includeSourceType}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeSourceType: event.target.checked,
                }))
              }
            />{' '}
            ソース種別
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.includeCanonicalUrl}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeCanonicalUrl: event.target.checked,
                }))
              }
            />{' '}
            安全化URL
          </label>
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>snapshot（既定では共有しない）</legend>
          <Select
            label="共有するready snapshot"
            value={draft.snapshotId}
            onChange={(event) =>
              changeDraft((current) => ({
                ...current,
                snapshotId: event.target.value,
                includeSnapshotProvenance: false,
                includeSnapshotExcerpt: false,
              }))
            }
            fullWidth
          >
            <option value="">共有しない</option>
            {visibleSnapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.originalName} / version {snapshot.version} /{' '}
                {formatKnowledgeDateTime(snapshot.capturedAt)}
              </option>
            ))}
          </Select>
          <label>
            <input
              type="checkbox"
              checked={draft.includeSnapshotProvenance}
              disabled={!draft.snapshotId || fieldsDisabled}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeSnapshotProvenance: event.target.checked,
                }))
              }
            />{' '}
            snapshot provenance（version・SHA-256）
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.includeSnapshotExcerpt}
              disabled={!draft.snapshotId || fieldsDisabled}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeSnapshotExcerpt: event.target.checked,
                }))
              }
            />{' '}
            snapshot抜粋
          </label>
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>ラベル（最大20件、既定では共有しない）</legend>
          {labels.status === 'loading' ? (
            <p role="status">ラベル候補を読み込み中です。</p>
          ) : visibleLabels.length > 0 ? (
            <ul aria-label="共有候補ラベル">
              {visibleLabels.map((label) => {
                const selected = draft.labelAssignmentIds.includes(
                  label.assignmentId,
                );
                return (
                  <li key={label.assignmentId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={
                          fieldsDisabled ||
                          (!selected && draft.labelAssignmentIds.length >= 20)
                        }
                        onChange={() =>
                          toggleBoundedId(
                            'labelAssignmentIds',
                            label.assignmentId,
                            20,
                          )
                        }
                      />{' '}
                      {label.displayName}（
                      {label.scope === 'personal' ? '個人' : '組織'}ラベル）
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>共有可能なラベル候補はありません。</p>
          )}
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>annotation（最大20件、既定では共有しない）</legend>
          {annotations.status === 'loading' ? (
            <p role="status">annotation候補を読み込み中です。</p>
          ) : visibleAnnotations.length > 0 ? (
            <ul aria-label="共有候補annotation">
              {visibleAnnotations.map((annotation) => {
                const selected = draft.annotationIds.includes(annotation.id);
                return (
                  <li key={annotation.id}>
                    <article>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={
                            fieldsDisabled ||
                            (!selected && draft.annotationIds.length >= 20)
                          }
                          onChange={() =>
                            toggleBoundedId('annotationIds', annotation.id, 20)
                          }
                        />{' '}
                        {knowledgeAnnotationKindLabels[annotation.kind]} /{' '}
                        {knowledgeOriginLabels[annotation.origin]} / revision{' '}
                        {annotation.currentRevision}
                      </label>
                      <div className="knowledge-provenance-content">
                        {annotation.revision.content}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>共有可能なannotation候補はありません。</p>
          )}
          {annotations.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="small"
              onClick={() => void loadMoreAnnotations()}
              disabled={annotations.loadingMore}
              loading={annotations.loadingMore}
            >
              annotation候補をさらに読み込む
            </Button>
          ) : null}
          {annotations.pageError ? (
            <p role="alert">追加のannotation候補を取得できませんでした。</p>
          ) : null}
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>conversation turn</legend>
          <p>最大50件。既定では共有しません。</p>
          {conversations.status === 'loading' ? (
            <p role="status">会話候補を読み込み中です。</p>
          ) : visibleConversations.length > 0 ? (
            <ul aria-label="共有候補会話">
              {visibleConversations.map((candidate) => (
                <li key={candidate.conversation.id}>
                  <article>
                    <h6>
                      {candidate.conversation.title}（
                      {conversationSourceTypeLabels[
                        candidate.conversation.sourceType
                      ] ?? '取込'}
                      ）
                    </h6>
                    {candidate.turnStatus === 'loading' ? (
                      <p role="status">turn候補を読み込み中です。</p>
                    ) : candidate.turnStatus === 'error' ? (
                      <p role="alert">turn候補を取得できませんでした。</p>
                    ) : candidate.turns.length > 0 ? (
                      <ol>
                        {candidate.turns.map((turn) => {
                          const selected = draft.conversationTurnIds.includes(
                            turn.id,
                          );
                          return (
                            <li key={turn.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={
                                    fieldsDisabled ||
                                    (!selected &&
                                      draft.conversationTurnIds.length >= 50)
                                  }
                                  onChange={() =>
                                    toggleBoundedId(
                                      'conversationTurnIds',
                                      turn.id,
                                      50,
                                    )
                                  }
                                />{' '}
                                {candidate.conversation.title} /{' '}
                                {knowledgeRoleLabels[turn.role]} /{' '}
                                {knowledgeOriginLabels[turn.origin]} / turn{' '}
                                {turn.sequence}
                              </label>
                              <div className="knowledge-provenance-content">
                                {turn.content}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p>共有可能なturnはありません。</p>
                    )}
                    {candidate.nextCursor ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="small"
                        disabled={candidate.loadingMore}
                        loading={candidate.loadingMore}
                        onClick={() =>
                          void loadConversationTurns(
                            candidate.conversation.id,
                            contextKey,
                            contextGenerationRef.current,
                            candidate.nextCursor,
                            true,
                            candidateAbortRef.current?.signal,
                          )
                        }
                      >
                        turn候補をさらに読み込む
                      </Button>
                    ) : null}
                    {candidate.pageError ? (
                      <p role="alert">追加のturn候補を取得できませんでした。</p>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <p>共有可能な会話候補はありません。</p>
          )}
          {conversations.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="small"
              onClick={() => void loadMoreConversations()}
              disabled={conversations.loadingMore}
              loading={conversations.loadingMore}
            >
              会話候補をさらに読み込む
            </Button>
          ) : null}
          {conversations.pageError ? (
            <p role="alert">追加の会話候補を取得できませんでした。</p>
          ) : null}
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>Synthesis（最大10件、既定では共有しない）</legend>
          {syntheses.status === 'loading' ? (
            <p role="status">Synthesis候補を読み込み中です。</p>
          ) : visibleSyntheses.length > 0 ? (
            <ul aria-label="共有候補Synthesis">
              {visibleSyntheses.map((detail) => {
                const { synthesis, currentVersion } = detail;
                const selected = draft.synthesisIds.includes(synthesis.id);
                return (
                  <li key={synthesis.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={
                          fieldsDisabled ||
                          (!selected && draft.synthesisIds.length >= 10)
                        }
                        onChange={() =>
                          toggleBoundedId('synthesisIds', synthesis.id, 10)
                        }
                      />{' '}
                      {synthesis.title} / version {synthesis.currentVersion}
                    </label>
                    <div className="knowledge-provenance-content">
                      {currentVersion.content}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>共有可能なSynthesis候補はありません。</p>
          )}
          {syntheses.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="small"
              onClick={() => void loadMoreSyntheses()}
              disabled={syntheses.loadingMore}
              loading={syntheses.loadingMore}
            >
              Synthesis候補をさらに読み込む
            </Button>
          ) : null}
          {syntheses.pageError ? (
            <p role="alert">追加のSynthesis候補を取得できませんでした。</p>
          ) : null}
        </fieldset>

        <fieldset disabled={fieldsDisabled}>
          <legend>共有者メモ（既定では共有しない）</legend>
          <label>
            <input
              type="checkbox"
              checked={draft.includeSharerNote}
              onChange={(event) =>
                changeDraft((current) => ({
                  ...current,
                  includeSharerNote: event.target.checked,
                }))
              }
            />{' '}
            共有者メモを含める
          </label>
          <Textarea
            label="共有者メモ本文"
            description="明示選択した場合だけ共有されます。UTF-8で4 KiBまで。"
            value={draft.sharerNote}
            onChange={(event) =>
              changeDraft((current) => ({
                ...current,
                sharerNote: event.target.value,
              }))
            }
            disabled={fieldsDisabled || !draft.includeSharerNote}
            rows={4}
            fullWidth
          />
        </fieldset>

        {draftError ? (
          <p id={`${headingId}-draft-error`} role="alert">
            {draftError}
          </p>
        ) : null}
        {!lifecycle && !uncertainCommit ? (
          <Button
            type="submit"
            variant="primary"
            disabled={previewBusy || commitBusy || rooms.status === 'loading'}
            loading={previewBusy}
          >
            共有内容をプレビュー
          </Button>
        ) : null}
      </form>

      {readyPreview && readyPreview.contextKey === contextKey ? (
        <Card padding="small">
          <section aria-labelledby={`${headingId}-preview`}>
            <h5 id={`${headingId}-preview`}>共有内容の最終確認</h5>
            <dl>
              <div>
                <dt>共有先</dt>
                <dd>{readyPreview.destinationLabel}</dd>
              </div>
              <div>
                <dt>preview有効期限</dt>
                <dd>{formatKnowledgeDateTime(readyPreview.value.expiresAt)}</dd>
              </div>
            </dl>
            <PreviewContent card={readyPreview.value.card} />
            <label>
              <input
                type="checkbox"
                checked={exactConfirmed}
                onChange={(event) => setExactConfirmed(event.target.checked)}
                disabled={commitBusy || commitAttempted}
              />{' '}
              上記の共有先と共有内容が完全に一致することを確認しました
            </label>
            <div>
              <Button
                type="button"
                variant="primary"
                onClick={() => void commitPreview()}
                disabled={!exactConfirmed || commitBusy || commitAttempted}
                loading={commitBusy}
              >
                確認した内容をChatへ共有
              </Button>
            </div>
          </section>
        </Card>
      ) : null}
    </section>
  );
}
