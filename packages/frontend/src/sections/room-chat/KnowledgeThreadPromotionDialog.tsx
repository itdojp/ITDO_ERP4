import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import {
  commitKnowledgeThreadPromotion,
  createKnowledgeShareRequestKey,
  KnowledgeShareSafeError,
  previewKnowledgeThreadPromotion,
} from '../knowledge-share/knowledgeShareApi';
import {
  buildKnowledgeThreadPromotionRequest,
  type KnowledgeShareRoomCard,
  type KnowledgeThreadPromotionCommit,
  type KnowledgeThreadPromotionPreview,
  type KnowledgeThreadPromotionRequest,
} from '../knowledge-share/knowledgeShareModel';
import { KnowledgeShareSelectedContent } from './KnowledgeShareCard';
import type { ChatMessage } from './roomChatModel';

type DestinationScope = 'personal' | 'organization';

type ReadyPreview = {
  contextKey: string;
  generation: number;
  request: KnowledgeThreadPromotionRequest;
  preview: KnowledgeThreadPromotionPreview;
  requestKey: string;
};

type Notice = {
  tone: 'error' | 'success' | 'warning' | 'info';
  text: string;
};

const maximumSelectedReplies = 100;

function promotionErrorMessage(error: unknown) {
  if (!(error instanceof KnowledgeShareSafeError)) {
    return 'ナレッジ化の処理に失敗しました。入力と権限を確認してください。';
  }
  switch (error.code) {
    case 'request_aborted':
      return '';
    case 'secure_request_key_unavailable':
      return '安全な操作識別子を生成できません。ブラウザを再読み込みしてください。';
    case 'organization_confirmation_required':
      return '組織共有範囲の追加確認が必要です。';
    case 'preview_token_expired':
    case 'preview_token_invalid':
    case 'stale_preview':
      return 'プレビューが失効しました。最新の内容で再度プレビューしてください。';
    case 'idempotency_conflict':
    case 'promotion_conflict':
      return '同じ操作識別子を別の内容には使用できません。再度プレビューしてください。';
    case 'not_found':
    case 'forbidden':
    case 'unauthorized':
    case 'external_audience_not_supported':
      return 'このスレッドはナレッジ化できません。現在の権限と共有範囲を確認してください。';
    case 'network_error':
      return '通信に失敗しました。自動再試行は行っていません。状態を確認してから操作してください。';
    case 'invalid_request':
      return '入力内容が要件を満たしていません。';
    case 'invalid_response':
    case 'unknown_error':
    case 'share_post_failed':
      return 'ナレッジ化の処理に失敗しました。入力と権限を確認してください。';
  }
}

function parseOrganizationGrantIds(value: string) {
  return value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseUnresolvedQuestions(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function confidenceBasisPoints(value: string): number | null | undefined {
  if (!value.trim()) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(value.trim())) return undefined;
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return undefined;
  }
  return Math.round(percentage * 100);
}

function safeDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hidden &&
      !element.matches(':disabled') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

function isEligibleRoot(
  roomId: string,
  root: ChatMessage,
  knowledgeShare: KnowledgeShareRoomCard,
) {
  return (
    Boolean(roomId) &&
    root.roomId === roomId &&
    root.parentMessageId === null &&
    root.threadRootId === null &&
    !root.deleted &&
    knowledgeShare.status === 'posted' &&
    knowledgeShare.card !== null
  );
}

function activeDirectReplies(
  roomId: string,
  rootMessageId: string,
  replies: readonly ChatMessage[],
) {
  const seen = new Set<string>();
  return replies.filter((reply) => {
    const active =
      reply.roomId === roomId &&
      reply.parentMessageId === rootMessageId &&
      reply.threadRootId === rootMessageId &&
      reply.messageType === 'text' &&
      !reply.deleted &&
      reply.deletedAt === null &&
      reply.body !== null &&
      !seen.has(reply.id);
    if (active) seen.add(reply.id);
    return active;
  });
}

function resultNotice(result: KnowledgeThreadPromotionCommit): Notice {
  return result.reused
    ? {
        tone: 'warning',
        text: '同一内容の既存ナレッジ統合を再利用しました。',
      }
    : {
        tone: 'success',
        text: '新しいナレッジ統合を作成しました。',
      };
}

export function KnowledgeThreadPromotionDialog(props: {
  open: boolean;
  roomId: string;
  root: ChatMessage;
  replies: readonly ChatMessage[];
  knowledgeShare: KnowledgeShareRoomCard;
  onClose: () => void;
  onCommitted?: (result: KnowledgeThreadPromotionCommit) => void;
}) {
  const { open, roomId, root, replies, knowledgeShare, onClose, onCommitted } =
    props;
  const activeReplies = useMemo(
    () => activeDirectReplies(roomId, root.id, replies),
    [replies, roomId, root.id],
  );
  const activeReplyKey = JSON.stringify(
    activeReplies.map((reply) => [
      reply.id,
      reply.body,
      reply.createdAt,
      reply.userId,
      reply.roomId,
      reply.parentMessageId,
      reply.threadRootId,
    ]),
  );
  const activeReplyIds = useMemo(
    () =>
      new Set<string>(
        (JSON.parse(activeReplyKey) as Array<[string]>).map(
          ([messageId]) => messageId,
        ),
      ),
    [activeReplyKey],
  );
  const contextKey = JSON.stringify([
    roomId,
    root,
    knowledgeShare,
    activeReplyKey,
  ]);
  const eligible = isEligibleRoot(roomId, root, knowledgeShare);

  const [selectedReplyIds, setSelectedReplyIds] = useState<string[]>([]);
  const [includeSharedCard, setIncludeSharedCard] = useState(false);
  const [destinationScope, setDestinationScope] =
    useState<DestinationScope>('personal');
  const [organizationGrantInput, setOrganizationGrantInput] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [confidencePercent, setConfidencePercent] = useState('');
  const [unresolvedQuestions, setUnresolvedQuestions] = useState('');
  const [readyPreview, setReadyPreview] = useState<ReadyPreview | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [organizationAudienceConfirmed, setOrganizationAudienceConfirmed] =
    useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitAttempted, setCommitAttempted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [commitResult, setCommitResult] =
    useState<KnowledgeThreadPromotionCommit | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const contextKeyRef = useRef(contextKey);
  const mountedRef = useRef(true);
  const commitInFlightRef = useRef(false);

  useLayoutEffect(() => {
    contextKeyRef.current = contextKey;
  }, [contextKey]);

  const invalidatePreview = useCallback((clearNotice = true) => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setReadyPreview(null);
    setPreviewConfirmed(false);
    setOrganizationAudienceConfirmed(false);
    setIsPreviewing(false);
    setCommitAttempted(false);
    setCommitResult(null);
    if (clearNotice) setNotice(null);
  }, []);

  const resetDialog = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    commitInFlightRef.current = false;
    setSelectedReplyIds([]);
    setIncludeSharedCard(false);
    setDestinationScope('personal');
    setOrganizationGrantInput('');
    setTitle('');
    setContent('');
    setConfidencePercent('');
    setUnresolvedQuestions('');
    setReadyPreview(null);
    setPreviewConfirmed(false);
    setOrganizationAudienceConfirmed(false);
    setIsPreviewing(false);
    setIsCommitting(false);
    setCommitAttempted(false);
    setNotice(null);
    setCommitResult(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      commitInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    resetDialog();
  }, [contextKey, open, resetDialog]);

  useEffect(() => {
    if (!open) return;
    setSelectedReplyIds((current) =>
      current.filter((messageId) => activeReplyIds.has(messageId)),
    );
    invalidatePreview();
  }, [activeReplyIds, invalidatePreview, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  const changeDraft = (change: () => void) => {
    invalidatePreview();
    change();
  };

  const closeDialog = () => {
    if (commitInFlightRef.current) return;
    resetDialog();
    onClose();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (!commitInFlightRef.current) {
        event.preventDefault();
        closeDialog();
      }
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = focusableElements(panelRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const toggleReply = (messageId: string, checked: boolean) => {
    invalidatePreview();
    setSelectedReplyIds((current) => {
      if (!checked) return current.filter((id) => id !== messageId);
      if (
        current.includes(messageId) ||
        current.length >= maximumSelectedReplies
      ) {
        return current;
      }
      return [...current, messageId];
    });
  };

  const moveReply = (messageId: string, direction: -1 | 1) => {
    invalidatePreview();
    setSelectedReplyIds((current) => {
      const index = current.indexOf(messageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const buildRequest = ():
    | { ok: true; request: KnowledgeThreadPromotionRequest }
    | { ok: false; message: string } => {
    if (!eligible) {
      return {
        ok: false,
        message: 'この共有スレッドはナレッジ化できません。',
      };
    }
    if (selectedReplyIds.length === 0) {
      return { ok: false, message: '返信を1件以上選択してください。' };
    }
    if (selectedReplyIds.some((messageId) => !activeReplyIds.has(messageId))) {
      return {
        ok: false,
        message: '返信一覧が更新されました。選択内容を確認してください。',
      };
    }
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return { ok: false, message: 'タイトルを入力してください。' };
    }
    if (!content.trim()) {
      return { ok: false, message: '統合内容を入力してください。' };
    }
    const confidence = confidenceBasisPoints(confidencePercent);
    if (confidence === undefined) {
      return {
        ok: false,
        message: '確信度は0から100まで、小数点以下2桁以内で入力してください。',
      };
    }
    const grants = parseOrganizationGrantIds(organizationGrantInput);
    if (new Set(grants).size !== grants.length) {
      return {
        ok: false,
        message: '組織共有グループIDを重複なく入力してください。',
      };
    }
    if (destinationScope === 'organization' && grants.length === 0) {
      return {
        ok: false,
        message: '組織共有にはグループgrantを1件以上入力してください。',
      };
    }
    if (destinationScope === 'personal' && grants.length > 0) {
      return {
        ok: false,
        message: '個人scopeでは組織共有グループを指定できません。',
      };
    }
    const questions = parseUnresolvedQuestions(unresolvedQuestions);
    const request = buildKnowledgeThreadPromotionRequest({
      selectedReplyMessageIds: selectedReplyIds,
      includeSharedCard,
      destination:
        destinationScope === 'personal'
          ? { scope: 'personal', organizationGroupAccountIds: [] }
          : {
              scope: 'organization',
              organizationGroupAccountIds: grants,
            },
      synthesis: {
        title: normalizedTitle,
        content,
        confidenceBasisPoints: confidence,
        unresolvedQuestions: questions,
      },
    });
    return request
      ? { ok: true, request }
      : {
          ok: false,
          message: '入力内容が上限または形式要件を満たしていません。',
        };
  };

  const previewPromotion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    invalidatePreview();
    const validation = buildRequest();
    if (!validation.ok) {
      setNotice({ tone: 'error', text: validation.message });
      return;
    }

    let requestKey: string;
    try {
      requestKey = createKnowledgeShareRequestKey();
    } catch (error) {
      setNotice({ tone: 'error', text: promotionErrorMessage(error) });
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const targetContextKey = contextKey;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsPreviewing(true);
    setNotice(null);
    try {
      const preview = await previewKnowledgeThreadPromotion(
        {
          rootMessageId: root.id,
          request: validation.request,
          expectedReplies: validation.request.selectedReplyMessageIds.map(
            (messageId) => {
              const reply = activeReplies.find(
                (candidate) => candidate.id === messageId,
              );
              if (!reply || reply.body === null) {
                throw new KnowledgeShareSafeError('invalid_request', null);
              }
              return {
                messageId: reply.id,
                content: reply.body,
                createdAt: reply.createdAt,
              };
            },
          ),
        },
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        generationRef.current !== generation ||
        contextKeyRef.current !== targetContextKey
      ) {
        return;
      }
      setReadyPreview({
        contextKey: targetContextKey,
        generation,
        request: validation.request,
        preview,
        requestKey,
      });
      setPreviewConfirmed(false);
      setNotice({
        tone: 'info',
        text: 'プレビューを確認し、問題がなければナレッジ化を確定してください。',
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        generationRef.current !== generation ||
        contextKeyRef.current !== targetContextKey
      ) {
        return;
      }
      const message = promotionErrorMessage(error);
      if (message) setNotice({ tone: 'error', text: message });
    } finally {
      if (
        mountedRef.current &&
        generationRef.current === generation &&
        contextKeyRef.current === targetContextKey
      ) {
        setIsPreviewing(false);
      }
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const commitPromotion = async () => {
    const ready = readyPreview;
    if (
      !ready ||
      ready.contextKey !== contextKey ||
      ready.generation !== generationRef.current ||
      commitInFlightRef.current
    ) {
      return;
    }
    if (
      !previewConfirmed ||
      (ready.preview.requiresOrganizationAudienceConfirmation &&
        !organizationAudienceConfirmed)
    ) {
      setNotice({
        tone: 'error',
        text: !previewConfirmed
          ? 'プレビュー内容を確認し、確認欄を選択してください。'
          : '組織共有範囲を確認し、確認欄を選択してください。',
      });
      return;
    }

    commitInFlightRef.current = true;
    setIsCommitting(true);
    setCommitAttempted(true);
    setNotice(null);
    try {
      const result = await commitKnowledgeThreadPromotion({
        rootMessageId: root.id,
        request: ready.request,
        previewToken: ready.preview.previewToken,
        requestKey: ready.requestKey,
        organizationAudienceConfirmed:
          ready.preview.requiresOrganizationAudienceConfirmation &&
          organizationAudienceConfirmed,
      });
      if (
        !mountedRef.current ||
        generationRef.current !== ready.generation ||
        contextKeyRef.current !== ready.contextKey
      ) {
        return;
      }
      setReadyPreview(null);
      setPreviewConfirmed(false);
      setOrganizationAudienceConfirmed(false);
      setCommitAttempted(false);
      setNotice(resultNotice(result));
      setCommitResult(result);
      onCommitted?.(result);
    } catch (error) {
      if (
        !mountedRef.current ||
        generationRef.current !== ready.generation ||
        contextKeyRef.current !== ready.contextKey
      ) {
        return;
      }
      setNotice({ tone: 'error', text: promotionErrorMessage(error) });
      setPreviewConfirmed(false);
      if (
        error instanceof KnowledgeShareSafeError &&
        (error.code === 'preview_token_expired' ||
          error.code === 'preview_token_invalid' ||
          error.code === 'stale_preview' ||
          error.code === 'promotion_conflict' ||
          error.code === 'idempotency_conflict')
      ) {
        generationRef.current += 1;
        setReadyPreview(null);
        setPreviewConfirmed(false);
        setOrganizationAudienceConfirmed(false);
      }
    } finally {
      commitInFlightRef.current = false;
      if (
        mountedRef.current &&
        generationRef.current === ready.generation &&
        contextKeyRef.current === ready.contextKey
      ) {
        setIsCommitting(false);
      }
    }
  };

  if (!open) return null;

  const preview =
    readyPreview?.contextKey === contextKey ? readyPreview.preview : null;
  const interactionLocked = isCommitting;
  const noticeColor =
    notice?.tone === 'error'
      ? '#b91c1c'
      : notice?.tone === 'success'
        ? '#166534'
        : '#475569';

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) closeDialog();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="knowledge-thread-promotion-title"
        aria-describedby="knowledge-thread-promotion-description"
        onKeyDown={handleDialogKeyDown}
        style={{
          width: '100vw',
          maxWidth: 720,
          height: '100%',
          overflowY: 'auto',
          background: '#f8fafc',
          padding: 'clamp(12px, 3vw, 24px)',
          boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div
          className="row"
          style={{
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'start',
          }}
        >
          <div>
            <h2 id="knowledge-thread-promotion-title" style={{ margin: 0 }}>
              スレッドをナレッジ化
            </h2>
            <p
              id="knowledge-thread-promotion-description"
              style={{ margin: '6px 0 0', color: '#475569' }}
            >
              選択した返信だけを、新しい統合知version 1へ保存します。
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="button secondary"
            aria-label="ナレッジ化ダイアログを閉じる"
            disabled={isCommitting}
            onClick={closeDialog}
            style={{ minHeight: 44 }}
          >
            閉じる
          </button>
        </div>

        {!eligible ? (
          <p role="status" style={{ color: '#b91c1c' }}>
            この共有スレッドはナレッジ化できません。
          </p>
        ) : (
          <form onSubmit={(event) => void previewPromotion(event)}>
            <fieldset
              disabled={interactionLocked}
              style={{ border: 0, padding: 0, margin: '20px 0 0' }}
            >
              <legend style={{ fontWeight: 700 }}>返信の選択と順序</legend>
              <p style={{ color: '#475569', marginTop: 6 }}>
                初期選択はありません。最大100件を選択し、保存順を明示してください。
              </p>
              {activeReplies.length === 0 ? (
                <p role="status">選択できる返信はありません。</p>
              ) : (
                <ol
                  style={{
                    display: 'grid',
                    gap: 10,
                    paddingInlineStart: 0,
                    listStyle: 'none',
                  }}
                >
                  {activeReplies.map((reply, replyIndex) => {
                    const selectedIndex = selectedReplyIds.indexOf(reply.id);
                    const selected = selectedIndex >= 0;
                    return (
                      <li
                        key={reply.id}
                        className="card"
                        style={{ padding: 12, overflow: 'hidden' }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'start',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={
                              interactionLocked ||
                              (!selected &&
                                selectedReplyIds.length >=
                                  maximumSelectedReplies)
                            }
                            aria-label={`返信 ${replyIndex + 1}を選択`}
                            onChange={(event) =>
                              toggleReply(reply.id, event.target.checked)
                            }
                          />
                          <span style={{ minWidth: 0 }}>
                            <span
                              style={{
                                display: 'block',
                                fontSize: 12,
                                color: '#475569',
                              }}
                            >
                              投稿者区分: 利用者 /{' '}
                              {safeDateTime(reply.createdAt)}
                              {selected ? ` / 保存順 ${selectedIndex + 1}` : ''}
                            </span>
                            <span
                              style={{
                                display: 'block',
                                marginTop: 6,
                                overflowWrap: 'anywhere',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {reply.body}
                            </span>
                          </span>
                        </label>
                        {selected ? (
                          <div
                            className="row"
                            style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}
                          >
                            <button
                              type="button"
                              className="button secondary"
                              disabled={
                                interactionLocked || selectedIndex === 0
                              }
                              aria-label={`返信 ${replyIndex + 1}を保存順で上へ移動`}
                              onClick={() => moveReply(reply.id, -1)}
                              style={{ minHeight: 40 }}
                            >
                              上へ
                            </button>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={
                                interactionLocked ||
                                selectedIndex === selectedReplyIds.length - 1
                              }
                              aria-label={`返信 ${replyIndex + 1}を保存順で下へ移動`}
                              onClick={() => moveReply(reply.id, 1)}
                              style={{ minHeight: 40 }}
                            >
                              下へ
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </fieldset>

            <fieldset
              disabled={interactionLocked}
              style={{ margin: '20px 0 0', padding: 12 }}
            >
              <legend style={{ fontWeight: 700 }}>保存先</legend>
              <label style={{ display: 'block' }}>
                <input
                  type="radio"
                  name="knowledge-promotion-scope"
                  value="personal"
                  checked={destinationScope === 'personal'}
                  onChange={() =>
                    changeDraft(() => {
                      setDestinationScope('personal');
                      setOrganizationGrantInput('');
                    })
                  }
                />{' '}
                personal（個人、既定）
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                <input
                  type="radio"
                  name="knowledge-promotion-scope"
                  value="organization"
                  checked={destinationScope === 'organization'}
                  onChange={() =>
                    changeDraft(() => setDestinationScope('organization'))
                  }
                />{' '}
                organization（組織）
              </label>
              {destinationScope === 'organization' ? (
                <label style={{ display: 'block', marginTop: 12 }}>
                  組織共有グループID（1行またはカンマ区切り）
                  <textarea
                    aria-label="組織共有グループID"
                    value={organizationGrantInput}
                    rows={3}
                    onChange={(event) =>
                      changeDraft(() =>
                        setOrganizationGrantInput(event.target.value),
                      )
                    }
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </label>
              ) : null}
            </fieldset>

            <fieldset
              disabled={interactionLocked}
              style={{ margin: '20px 0 0', padding: 12 }}
            >
              <legend style={{ fontWeight: 700 }}>作成内容</legend>
              <label style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={includeSharedCard}
                  onChange={(event) =>
                    changeDraft(() =>
                      setIncludeSharedCard(event.target.checked),
                    )
                  }
                />{' '}
                共有カードの選択内容も含める
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                タイトル
                <input
                  type="text"
                  aria-label="ナレッジ化タイトル"
                  value={title}
                  maxLength={500}
                  required
                  onChange={(event) =>
                    changeDraft(() => setTitle(event.target.value))
                  }
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                統合内容
                <textarea
                  aria-label="ナレッジ化内容"
                  value={content}
                  rows={8}
                  required
                  onChange={(event) =>
                    changeDraft(() => setContent(event.target.value))
                  }
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                確信度（0〜100%、任意）
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="確信度"
                  value={confidencePercent}
                  onChange={(event) =>
                    changeDraft(() => setConfidencePercent(event.target.value))
                  }
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                未解決の質問（1行1件）
                <textarea
                  aria-label="未解決の質問"
                  value={unresolvedQuestions}
                  rows={4}
                  onChange={(event) =>
                    changeDraft(() =>
                      setUnresolvedQuestions(event.target.value),
                    )
                  }
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </label>
            </fieldset>

            <button
              type="submit"
              className="button"
              disabled={isPreviewing || isCommitting}
              style={{ minHeight: 44, marginTop: 16, width: '100%' }}
            >
              {isPreviewing ? 'プレビュー中...' : 'ナレッジ化内容をプレビュー'}
            </button>
          </form>
        )}

        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            style={{ color: noticeColor }}
          >
            {notice.text}
          </p>
        ) : null}

        {preview ? (
          <section
            aria-labelledby="knowledge-thread-promotion-preview-title"
            className="card"
            style={{ marginTop: 20, padding: 12 }}
          >
            <h3
              id="knowledge-thread-promotion-preview-title"
              style={{ marginTop: 0 }}
            >
              ナレッジ化プレビュー
            </h3>
            <dl style={{ display: 'grid', gap: 8 }}>
              <div>
                <dt>ルーム</dt>
                <dd style={{ margin: 0 }}>{preview.sourceThread.roomName}</dd>
              </div>
              <div>
                <dt>選択した返信</dt>
                <dd style={{ margin: 0 }}>{preview.selectedMessageCount}件</dd>
              </div>
              <div>
                <dt>含めない返信</dt>
                <dd style={{ margin: 0 }}>{preview.omittedMessageCount}件</dd>
              </div>
              <div>
                <dt>保存先</dt>
                <dd style={{ margin: 0 }}>
                  {preview.destination.scope === 'personal'
                    ? 'personal（個人）'
                    : `organization（${preview.destination.organizationGroupCount}グループ）`}
                </dd>
              </div>
              <div>
                <dt>共有カード</dt>
                <dd style={{ margin: 0 }}>
                  {preview.sharedCard ? '含める' : '含めない'}
                </dd>
              </div>
              <div>
                <dt>タイトル</dt>
                <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
                  {preview.synthesis.title}
                </dd>
              </div>
              <div>
                <dt>統合内容</dt>
                <dd
                  style={{
                    margin: 0,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {preview.synthesis.content}
                </dd>
              </div>
              <div>
                <dt>確信度</dt>
                <dd style={{ margin: 0 }}>
                  {preview.synthesis.confidenceBasisPoints === null
                    ? '未設定'
                    : `${(preview.synthesis.confidenceBasisPoints / 100).toFixed(2)}%`}
                </dd>
              </div>
              <div>
                <dt>有効期限</dt>
                <dd style={{ margin: 0 }}>{safeDateTime(preview.expiresAt)}</dd>
              </div>
            </dl>
            <h4>保存する返信（順序どおり）</h4>
            <ol style={{ display: 'grid', gap: 8, paddingInlineStart: 24 }}>
              {preview.selectedMessages.map((message) => (
                <li
                  key={message.ordinal}
                  style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                >
                  <div>
                    投稿者区分: 利用者 / 投稿日時:{' '}
                    {safeDateTime(message.createdAt)}
                  </div>
                  <div>{message.content}</div>
                </li>
              ))}
            </ol>
            {preview.sharedCard ? (
              <section aria-labelledby="knowledge-thread-promotion-card-title">
                <h4 id="knowledge-thread-promotion-card-title">
                  保存する知識共有カード
                </h4>
                <p>共有版: {preview.sharedCard.shareVersion}</p>
                <div
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <KnowledgeShareSelectedContent card={preview.sharedCard} />
                </div>
              </section>
            ) : null}
            {preview.synthesis.unresolvedQuestions.length > 0 ? (
              <>
                <h4>未解決の質問</h4>
                <ul style={{ paddingInlineStart: 24 }}>
                  {preview.synthesis.unresolvedQuestions.map(
                    (question, index) => (
                      <li key={`${question}-${index}`}>{question}</li>
                    ),
                  )}
                </ul>
              </>
            ) : null}
            {preview.requiresOrganizationAudienceConfirmation ? (
              <label
                style={{
                  display: 'block',
                  border: '1px solid #f59e0b',
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={organizationAudienceConfirmed}
                  disabled={isCommitting}
                  onChange={(event) => {
                    setOrganizationAudienceConfirmed(event.target.checked);
                    setNotice(null);
                  }}
                />{' '}
                指定した組織グループへ追加共有されることを確認しました
              </label>
            ) : null}
            <label
              style={{
                display: 'block',
                border: '1px solid #64748b',
                borderRadius: 8,
                padding: 12,
                marginTop: 12,
              }}
            >
              <input
                type="checkbox"
                checked={previewConfirmed}
                disabled={isCommitting}
                onChange={(event) => {
                  setPreviewConfirmed(event.target.checked);
                  setNotice(null);
                }}
              />{' '}
              選択・省略・保存内容を確認しました
            </label>
            <button
              type="button"
              className="button"
              disabled={
                isCommitting ||
                !previewConfirmed ||
                (preview.requiresOrganizationAudienceConfirmation &&
                  !organizationAudienceConfirmed)
              }
              onClick={() => void commitPromotion()}
              style={{ minHeight: 44, marginTop: 16, width: '100%' }}
            >
              {isCommitting
                ? '確定中...'
                : commitAttempted
                  ? '同じ操作識別子で確定を再実行'
                  : 'ナレッジ化を確定'}
            </button>
          </section>
        ) : null}
        {commitResult ? (
          <section
            role="status"
            aria-labelledby="knowledge-thread-promotion-result-title"
            className="card"
            style={{ marginTop: 20, padding: 12 }}
          >
            <h3 id="knowledge-thread-promotion-result-title">
              ナレッジ化結果と来歴
            </h3>
            <dl style={{ display: 'grid', gap: 8 }}>
              <div>
                <dt>処理結果</dt>
                <dd style={{ margin: 0 }}>
                  {commitResult.reused ? '既存結果を再利用' : '新規作成'}
                </dd>
              </div>
              <div>
                <dt>保存範囲</dt>
                <dd style={{ margin: 0 }}>
                  {commitResult.scope === 'personal' ? '個人' : '組織'}
                </dd>
              </div>
              <div>
                <dt>統合版</dt>
                <dd style={{ margin: 0 }}>{commitResult.synthesisVersion}</dd>
              </div>
              <div>
                <dt>保存した返信</dt>
                <dd style={{ margin: 0 }}>
                  {commitResult.selectedMessageCount}件
                </dd>
              </div>
              <div>
                <dt>知識共有カード</dt>
                <dd style={{ margin: 0 }}>
                  {commitResult.includesSharedCard ? '含む' : '含まない'}
                </dd>
              </div>
              <div>
                <dt>作成日時</dt>
                <dd style={{ margin: 0 }}>
                  <time dateTime={commitResult.createdAt}>
                    {safeDateTime(commitResult.createdAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </section>
        ) : null}
      </section>
    </div>
  );
}
