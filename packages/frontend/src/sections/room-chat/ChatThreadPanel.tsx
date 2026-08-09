import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MentionComposer, type MentionTarget } from '../../ui';
import {
  getReactionCount,
  isAckRequest,
  normalizeStringArray,
  parseTags,
  parseUserIds,
  reactionOptions,
  type ChatMessage,
  type ChatThread,
} from './roomChatModel';
import { useRoomChatMentionCandidates } from './useRoomChatCandidates';
import { useRoomChatThread, type ChatPostLifecycle } from './useRoomChatThread';

type Props = {
  messageId: string;
  roomId: string;
  expectedRootId: string;
  currentUserId: string;
  roles: string[];
  renderMessageBody: (text: string) => React.ReactNode;
  onClose: () => void;
  onRootUpdated: (root: ChatThread['root']) => void;
  onReadUpdated: (roomId: string) => void | Promise<void>;
  onAccessRevoked: (roomId: string, message: string) => void;
  onAccessCheckRequired: (roomId: string) => Promise<boolean>;
  postLifecycle?: ChatPostLifecycle;
  onPostLifecycleChange?: (lifecycle: ChatPostLifecycle) => void;
};

function safeDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function DeletedPlaceholder({ kind }: { kind: 'root' | 'reply' }) {
  return (
    <div
      role="status"
      aria-label={kind === 'root' ? '削除済みの親メッセージ' : '削除済みの返信'}
      style={{ color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}
    >
      {kind === 'root'
        ? '親メッセージは削除されています。返信履歴は保持されています。'
        : 'この返信は削除されています。'}
    </div>
  );
}

function ThreadMessageCard({
  message,
  kind,
  currentUserId,
  roles,
  isMutating,
  nowMs,
  renderMessageBody,
  onReaction,
  onAck,
  onRevokeAck,
  onCancelAck,
  onDelete,
}: {
  message: ChatMessage;
  kind: 'root' | 'reply';
  currentUserId: string;
  roles: string[];
  isMutating: boolean;
  nowMs: number;
  renderMessageBody: (text: string) => React.ReactNode;
  onReaction: (messageId: string, emoji: string) => void;
  onAck: (requestId: string) => void;
  onRevokeAck: (requestId: string) => void;
  onCancelAck: (requestId: string) => void;
  onDelete: (message: ChatMessage) => void;
}) {
  const ackRequest = isAckRequest(message.ackRequest)
    ? message.ackRequest
    : null;
  const requiredUserIds = normalizeStringArray(ackRequest?.requiredUserIds);
  const ackedUserIds = new Set(
    (ackRequest?.acks || []).map((ack) => ack.userId),
  );
  const canceled = Boolean(ackRequest?.canceledAt);
  const canAck =
    ackRequest &&
    !canceled &&
    requiredUserIds.includes(currentUserId) &&
    !ackedUserIds.has(currentUserId);
  const canRevoke =
    ackRequest &&
    !canceled &&
    requiredUserIds.includes(currentUserId) &&
    ackedUserIds.has(currentUserId);
  const canCancel =
    ackRequest &&
    !canceled &&
    (message.userId === currentUserId ||
      roles.includes('admin') ||
      roles.includes('mgmt'));
  const canDelete =
    !message.deleted &&
    (message.userId === currentUserId ||
      roles.includes('admin') ||
      roles.includes('mgmt'));
  const mentionedUserIds = normalizeStringArray(message.mentions?.userIds);
  const mentionedGroupIds = normalizeStringArray(message.mentions?.groupIds);
  const dueAt = ackRequest?.dueAt ? new Date(ackRequest.dueAt) : null;
  const overdue =
    dueAt &&
    !Number.isNaN(dueAt.getTime()) &&
    nowMs > dueAt.getTime() &&
    ackedUserIds.size < requiredUserIds.length &&
    !canceled;

  return (
    <article
      aria-label={kind === 'root' ? '親メッセージ' : '返信'}
      className="card"
      style={{ padding: 12, background: kind === 'root' ? '#f8fafc' : '#fff' }}
      data-thread-message-id={message.id}
    >
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>
          <span className="badge">{kind === 'root' ? '親' : '返信'}</span>{' '}
          <strong>{message.userId}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: '#475569' }}>
            {safeDate(message.createdAt)}
          </span>
        </div>
        {canDelete && (
          <button
            type="button"
            className="button secondary"
            disabled={isMutating}
            onClick={() => onDelete(message)}
            aria-label={`${kind === 'root' ? '親メッセージ' : '返信'}を削除`}
          >
            削除
          </button>
        )}
      </div>

      {message.deleted ? (
        <DeletedPlaceholder kind={kind} />
      ) : (
        <div style={{ marginTop: 8 }}>
          {renderMessageBody(message.body ?? '')}
        </div>
      )}

      {!message.deleted && message.tags && message.tags.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
          tags: {message.tags.map((tag) => `#${tag}`).join(' ')}
        </div>
      )}

      {!message.deleted &&
        (message.mentionsAll ||
          mentionedUserIds.length > 0 ||
          mentionedGroupIds.length > 0) && (
          <div
            className="row"
            aria-label="メンション"
            style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}
          >
            {message.mentionsAll && <span className="badge">@all</span>}
            {mentionedUserIds.map((userId) => (
              <span key={userId} className="badge">
                @{userId}
              </span>
            ))}
            {mentionedGroupIds.map((groupId) => (
              <span key={groupId} className="badge">
                @{groupId}
              </span>
            ))}
          </div>
        )}

      {!message.deleted && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {reactionOptions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="button secondary"
              disabled={isMutating}
              onClick={() => onReaction(message.id, emoji)}
              aria-label={`${kind}へ${emoji}リアクション`}
              style={{ padding: '2px 8px' }}
            >
              {emoji} {getReactionCount(message.reactions?.[emoji]) || ''}
            </button>
          ))}
        </div>
      )}

      {ackRequest && !message.deleted && (
        <section aria-label="確認依頼" style={{ marginTop: 10 }}>
          <span className="badge">確認依頼</span>
          <div style={{ marginTop: 4, fontSize: 12, color: '#475569' }}>
            確認済み {ackedUserIds.size}/{requiredUserIds.length}
            {overdue ? ' / 期限超過' : ''}
            {canceled ? ' / 撤回済み' : ''}
          </div>
          <div
            className="row"
            style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}
          >
            {canAck && (
              <button
                type="button"
                className="button"
                disabled={isMutating}
                onClick={() => onAck(ackRequest.id)}
              >
                OK
              </button>
            )}
            {canRevoke && (
              <button
                type="button"
                className="button secondary"
                disabled={isMutating}
                onClick={() => onRevokeAck(ackRequest.id)}
              >
                OK取消
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="button secondary"
                disabled={isMutating}
                onClick={() => onCancelAck(ackRequest.id)}
              >
                確認依頼を撤回
              </button>
            )}
          </div>
        </section>
      )}
    </article>
  );
}

export function ChatThreadPanel({
  messageId,
  roomId,
  expectedRootId,
  currentUserId,
  roles,
  renderMessageBody,
  onClose,
  onRootUpdated,
  onReadUpdated,
  onAccessRevoked,
  onAccessCheckRequired,
  postLifecycle,
  onPostLifecycleChange,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [mentions, setMentions] = useState<MentionTarget[]>([]);
  const [ackGroups, setAckGroups] = useState<MentionTarget[]>([]);
  const [mentionAll, setMentionAll] = useState(false);
  const [ackMode, setAckMode] = useState(false);
  const [requiredUsers, setRequiredUsers] = useState('');
  const [nowMs, setNowMs] = useState(0);
  const { mentionCandidates, fetchMentionComposerCandidates } =
    useRoomChatMentionCandidates(roomId);
  const threadState = useRoomChatThread({
    roomId,
    expectedRootId,
    onRootUpdated,
    onReadUpdated,
    onAccessRevoked,
    onAccessCheckRequired,
    postLifecycle,
    onPostLifecycleChange,
  });

  const onCloseRef = useRef(onClose);
  const isMutatingRef = useRef(threadState.isMutating);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isMutatingRef.current = threadState.isMutating;
  }, [threadState.isMutating]);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    threadState.openThread(messageId).catch(() => undefined);
    // openThread changes as pages arrive; the exact target ID is the stable trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedRootId, messageId]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('[role="combobox"][aria-expanded="true"]')) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (!isMutatingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const mentionPayload = useMemo(() => {
    const userIds = mentions
      .filter((target) => target.kind === 'user')
      .map((target) => target.id)
      .slice(0, 50);
    const groupIds = mentions
      .filter((target) => target.kind === 'group')
      .map((target) => target.id)
      .slice(0, 20);
    return mentionAll || userIds.length || groupIds.length
      ? {
          userIds: userIds.length ? userIds : undefined,
          groupIds: groupIds.length ? groupIds : undefined,
          all: mentionAll || undefined,
        }
      : undefined;
  }, [mentionAll, mentions]);

  const resetComposer = () => {
    setBody('');
    setTags('');
    setMentions([]);
    setAckGroups([]);
    setMentionAll(false);
    setRequiredUsers('');
    setAckMode(false);
  };

  const submitReply = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      threadState.setMessage('返信本文を入力してください');
      return;
    }
    const requiredUserIds = Array.from(
      new Set(parseUserIds(requiredUsers)),
    ).slice(0, 50);
    const requiredGroupIds = Array.from(
      new Set(
        ackGroups
          .filter((target) => target.kind === 'group')
          .map((target) => target.id),
      ),
    ).slice(0, 20);
    if (
      ackMode &&
      requiredUserIds.length === 0 &&
      requiredGroupIds.length === 0
    ) {
      threadState.setMessage('確認対象（ユーザID/グループ）を入力してください');
      return;
    }
    const payload = {
      body: trimmed,
      tags: parseTags(tags).slice(0, 8),
      mentions: mentionPayload,
    };
    const success = ackMode
      ? await threadState.postAckReply({
          ...payload,
          requiredUserIds,
          requiredGroupIds,
        })
      : await threadState.postReply(payload);
    if (success) resetComposer();
  };

  const handleDelete = (message: ChatMessage) => {
    const canModerate = roles.includes('admin') || roles.includes('mgmt');
    const reason =
      message.userId === currentUserId
        ? 'user_retract'
        : canModerate
          ? 'admin_moderation'
          : null;
    if (!reason) return;
    if (!window.confirm('このメッセージを削除しますか。履歴は保持されます。')) {
      return;
    }
    threadState.deleteMessage(message.id, reason).catch(() => undefined);
  };

  const handleCancelAck = (requestId: string) => {
    const reason = window.prompt('撤回理由（任意）') ?? null;
    if (reason === null) return;
    threadState
      .cancelAck(requestId, reason.trim() || undefined)
      .catch(() => undefined);
  };

  const thread = threadState.thread;
  const interactionLocked =
    threadState.isMutating ||
    threadState.isLoading ||
    threadState.isLoadingMore ||
    threadState.submissionBlocked;
  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onMouseDown={(event) => {
        if (!threadState.isMutating && event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-thread-title"
        style={{
          width: '100vw',
          maxWidth: 620,
          height: '100%',
          overflowY: 'auto',
          background: '#f8fafc',
          padding: 'clamp(12px, 3vw, 24px)',
          boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div
          className="row"
          style={{ justifyContent: 'space-between', gap: 12 }}
        >
          <div>
            <h2 id="chat-thread-title" style={{ margin: 0 }}>
              スレッド
            </h2>
            {thread && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#475569' }}>
                返信 {thread.replyCount}件
                {thread.lastReplyAt
                  ? ` / 最終更新 ${safeDate(thread.lastReplyAt)}`
                  : ''}
              </div>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={threadState.isMutating}
            aria-label="スレッドを閉じる"
          >
            閉じる
          </button>
        </div>

        {threadState.isLoading && <p role="status">スレッドを読み込み中...</p>}
        {threadState.message && (
          <p role="status" style={{ color: '#475569' }}>
            {threadState.message}
          </p>
        )}

        {thread && (
          <>
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              <ThreadMessageCard
                message={thread.root}
                kind="root"
                currentUserId={currentUserId}
                roles={roles}
                isMutating={interactionLocked}
                nowMs={nowMs}
                renderMessageBody={renderMessageBody}
                onReaction={(id, emoji) =>
                  threadState.addReaction(id, emoji).catch(() => undefined)
                }
                onAck={(id) => threadState.ack(id).catch(() => undefined)}
                onRevokeAck={(id) =>
                  threadState.revokeAck(id).catch(() => undefined)
                }
                onCancelAck={handleCancelAck}
                onDelete={handleDelete}
              />
              <h3 style={{ marginBottom: 0 }}>返信</h3>
              {thread.replies.length === 0 && (
                <div className="card" style={{ padding: 12 }}>
                  返信はありません。
                </div>
              )}
              {thread.replies.map((reply) => (
                <ThreadMessageCard
                  key={reply.id}
                  message={reply}
                  kind="reply"
                  currentUserId={currentUserId}
                  roles={roles}
                  isMutating={interactionLocked}
                  nowMs={nowMs}
                  renderMessageBody={renderMessageBody}
                  onReaction={(id, emoji) =>
                    threadState.addReaction(id, emoji).catch(() => undefined)
                  }
                  onAck={(id) => threadState.ack(id).catch(() => undefined)}
                  onRevokeAck={(id) =>
                    threadState.revokeAck(id).catch(() => undefined)
                  }
                  onCancelAck={handleCancelAck}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {thread.nextCursor && (
              <button
                type="button"
                className="button secondary"
                style={{ marginTop: 12 }}
                disabled={interactionLocked}
                onClick={() => threadState.loadMore().catch(() => undefined)}
              >
                {threadState.isLoadingMore
                  ? '読み込み中...'
                  : '返信をさらに読み込む'}
              </button>
            )}

            <section
              aria-labelledby="chat-thread-reply-heading"
              className="card"
              style={{ marginTop: 16, padding: 12 }}
            >
              <h3 id="chat-thread-reply-heading" style={{ marginTop: 0 }}>
                返信を投稿
              </h3>
              {thread.root.deleted ? (
                <p role="status">削除済みの親メッセージには返信できません。</p>
              ) : (
                <>
                  <MentionComposer
                    body={body}
                    onBodyChange={setBody}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    groups={ackGroups}
                    onGroupsChange={setAckGroups}
                    requiredUsers={[]}
                    requiredRoles={[]}
                    fetchCandidates={fetchMentionComposerCandidates}
                    onSubmit={() => submitReply().catch(() => undefined)}
                    onCancel={resetComposer}
                    placeholder="返信を入力"
                    mentionPlaceholder="メンション対象を検索"
                    groupPlaceholder="確認対象グループ"
                    submitLabel={
                      threadState.isMutating
                        ? '送信中...'
                        : ackMode
                          ? '確認依頼として返信'
                          : '返信'
                    }
                    cancelLabel="クリア"
                    requiredSectionLabel="確認対象"
                    disabled={interactionLocked}
                    limits={{
                      maxBodyLength: 2000,
                      maxMentions: 70,
                      maxGroups: 20,
                    }}
                  />
                  {(mentionCandidates.allowAll ?? true) && (
                    <label style={{ display: 'block', marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={mentionAll}
                        onChange={(event) =>
                          setMentionAll(event.target.checked)
                        }
                        disabled={interactionLocked}
                      />{' '}
                      全員にメンション (@all)
                    </label>
                  )}
                  <label style={{ display: 'block', marginTop: 8 }}>
                    タグ（カンマ区切り）
                    <input
                      type="text"
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      disabled={interactionLocked}
                    />
                  </label>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={ackMode}
                      onChange={(event) => setAckMode(event.target.checked)}
                      disabled={interactionLocked}
                    />{' '}
                    確認依頼として返信
                  </label>
                  {ackMode && (
                    <label style={{ display: 'block', marginTop: 8 }}>
                      確認対象ユーザーID（カンマ区切り）
                      <input
                        type="text"
                        value={requiredUsers}
                        onChange={(event) =>
                          setRequiredUsers(event.target.value)
                        }
                        disabled={interactionLocked}
                        aria-describedby="chat-thread-ack-help"
                      />
                      <span
                        id="chat-thread-ack-help"
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: '#475569',
                        }}
                      >
                        現行のルーム確認依頼と同じ権限・通知契約を使用します。
                      </span>
                    </label>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
