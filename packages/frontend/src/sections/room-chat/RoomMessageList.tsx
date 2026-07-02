import type React from 'react';
import { AttachmentField } from '../../ui';
import {
  getReactionCount,
  normalizeStringArray,
  reactionOptions,
  toAttachmentRecord,
  type ChatMessage,
} from './roomChatModel';

type LoadMessagesOptions = {
  append?: boolean;
  before?: string;
  query?: string;
  tag?: string;
};

type AsyncVoid = void | Promise<void>;

type PendingUndoRevokeAck = { requestId: string } | null;

export type RoomMessageListProps = {
  filterQuery: string;
  setFilterQuery: React.Dispatch<React.SetStateAction<string>>;
  filterTag: string;
  setFilterTag: React.Dispatch<React.SetStateAction<string>>;
  loadMessages: (options?: LoadMessagesOptions) => Promise<void>;
  roomId: string;
  isLoading: boolean;
  items: ChatMessage[];
  highlightSince: Date | null;
  highlightMessageId: string;
  nowMs: number;
  currentUserId: string;
  roles: string[];
  renderMessageBody: (text: string) => React.ReactNode;
  copyMessageLink: (
    mode: 'url' | 'markdown',
    item: Pick<ChatMessage, 'id' | 'createdAt' | 'userId' | 'body'>,
  ) => AsyncVoid;
  addReaction: (id: string, emoji: string) => AsyncVoid;
  ack: (requestId: string) => AsyncVoid;
  pendingUndoRevokeAck: PendingUndoRevokeAck;
  setPendingUndoRevokeAck: React.Dispatch<
    React.SetStateAction<PendingUndoRevokeAck>
  >;
  cancelAckRequest: (requestId: string, reason?: string) => Promise<void>;
  downloadAttachment: (attachmentId: string, filename: string) => Promise<void>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  hasMore: boolean;
  isLoadingMore: boolean;
};

export function RoomMessageList({
  filterQuery,
  setFilterQuery,
  filterTag,
  setFilterTag,
  loadMessages,
  roomId,
  isLoading,
  items,
  highlightSince,
  highlightMessageId,
  nowMs,
  currentUserId,
  roles,
  renderMessageBody,
  copyMessageLink,
  addReaction,
  ack,
  pendingUndoRevokeAck,
  setPendingUndoRevokeAck,
  cancelAckRequest,
  downloadAttachment,
  setMessage,
  hasMore,
  isLoadingMore,
}: RoomMessageListProps) {
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <strong>一覧</strong>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <label>
          検索（本文）
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="keyword"
          />
        </label>
        <label>
          タグ絞り込み
          <input
            type="text"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            placeholder="tag"
          />
        </label>
        <button
          className="button secondary"
          onClick={() => loadMessages()}
          disabled={!roomId || isLoading}
        >
          適用
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setFilterQuery('');
            setFilterTag('');
            loadMessages({ query: '', tag: '' }).catch(() => undefined);
          }}
          disabled={!roomId || isLoading}
        >
          クリア
        </button>
      </div>

      {isLoading && <div style={{ marginTop: 8 }}>読み込み中...</div>}
      {!isLoading && items.length === 0 && (
        <div style={{ marginTop: 8 }}>メッセージなし</div>
      )}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {items.map((item) => {
          const tags = Array.isArray(item.tags) ? item.tags : [];
          const mentionedUserIds = normalizeStringArray(item.mentions?.userIds);
          const mentionedGroupIds = normalizeStringArray(
            item.mentions?.groupIds,
          );
          const mentionAllFlag = item.mentionsAll === true;
          const createdAt = new Date(item.createdAt).toLocaleString();
          const isUnread =
            highlightSince && new Date(item.createdAt) > highlightSince;
          const isTarget = highlightMessageId === item.id;
          const ackRequest = item.ackRequest;
          const requiredUserIds = ackRequest
            ? normalizeStringArray(ackRequest.requiredUserIds)
            : [];
          const ackedUserIds = new Set(
            (ackRequest?.acks || []).map((ack) => ack.userId),
          );
          const isCanceled = Boolean(ackRequest?.canceledAt);
          const canceledAtLabel = ackRequest?.canceledAt
            ? new Date(ackRequest.canceledAt).toLocaleString()
            : '';
          const dueAt = ackRequest?.dueAt ? new Date(ackRequest.dueAt) : null;
          const dueAtLabel =
            dueAt && !Number.isNaN(dueAt.getTime())
              ? dueAt.toLocaleString()
              : '';
          const ackedCount = requiredUserIds.filter((userId) =>
            ackedUserIds.has(userId),
          ).length;
          const requiredCount = requiredUserIds.length;
          const isOverdue =
            Boolean(dueAtLabel) &&
            !isCanceled &&
            requiredCount > 0 &&
            ackedCount < requiredCount &&
            dueAt &&
            nowMs > 0 &&
            dueAt.getTime() < nowMs;
          const canAck =
            ackRequest &&
            !isCanceled &&
            requiredUserIds.includes(currentUserId) &&
            !ackedUserIds.has(currentUserId);
          const canRevoke =
            ackRequest &&
            !isCanceled &&
            requiredUserIds.includes(currentUserId) &&
            ackedUserIds.has(currentUserId);
          const canCancel =
            ackRequest &&
            !isCanceled &&
            (item.userId === currentUserId ||
              roles.includes('admin') ||
              roles.includes('mgmt'));

          return (
            <div
              key={item.id}
              id={`chat-message-${item.id}`}
              className="card"
              style={{
                padding: 12,
                borderColor: isUnread ? '#f59e0b' : undefined,
                outline: isTarget ? '2px solid #f59e0b' : undefined,
                outlineOffset: isTarget ? 2 : undefined,
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{item.userId}</strong>
                  <span
                    style={{ marginLeft: 8, fontSize: 12, color: '#475569' }}
                  >
                    {createdAt}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="button secondary"
                    aria-label="発言リンクURLをコピー"
                    onClick={() => copyMessageLink('url', item)}
                    style={{ padding: '2px 8px' }}
                  >
                    URL
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    aria-label="発言リンクMarkdownをコピー"
                    onClick={() => copyMessageLink('markdown', item)}
                    style={{ padding: '2px 8px' }}
                  >
                    MD
                  </button>
                  {reactionOptions.map((emoji) => (
                    <button
                      key={emoji}
                      className="button secondary"
                      onClick={() => addReaction(item.id, emoji)}
                      style={{ padding: '2px 8px' }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 8 }}>{renderMessageBody(item.body)}</div>
              {(mentionAllFlag ||
                mentionedUserIds.length > 0 ||
                mentionedGroupIds.length > 0) && (
                <div
                  className="row"
                  style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}
                >
                  {mentionAllFlag && (
                    <span className="badge" aria-label="全員へのメンション">
                      @all
                    </span>
                  )}
                  {mentionedUserIds.map((userId) => (
                    <span
                      key={userId}
                      className="badge"
                      aria-label={`メンション対象ユーザ: ${userId}`}
                    >
                      @{userId}
                    </span>
                  ))}
                  {mentionedGroupIds.map((groupId) => (
                    <span
                      key={groupId}
                      className="badge"
                      aria-label={`メンション対象グループ: ${groupId}`}
                    >
                      @{groupId}
                    </span>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                  tags: {tags.map((tag) => `#${tag}`).join(' ')}
                </div>
              )}
              {item.reactions && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                  {Object.entries(item.reactions).map(([emoji, val]) => (
                    <span key={emoji} style={{ marginRight: 8 }}>
                      {emoji} {getReactionCount(val)}
                    </span>
                  ))}
                </div>
              )}
              {ackRequest && (
                <div style={{ marginTop: 10 }}>
                  <div className="badge">確認依頼</div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    required: {requiredUserIds.join(', ') || '-'}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    acked: {Array.from(ackedUserIds).join(', ') || '-'}
                  </div>
                  {dueAtLabel && (
                    <div
                      style={{
                        fontSize: 12,
                        color: isOverdue ? '#dc2626' : '#475569',
                        marginTop: 4,
                      }}
                    >
                      期限: {dueAtLabel}
                      {isOverdue ? ' (期限超過)' : ''}
                    </div>
                  )}
                  {isCanceled && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#475569',
                        marginTop: 4,
                      }}
                    >
                      撤回: {canceledAtLabel}
                      {ackRequest.canceledBy
                        ? ` / ${ackRequest.canceledBy}`
                        : ''}
                    </div>
                  )}
                  {(canAck || canRevoke || canCancel) && (
                    <div
                      className="row"
                      style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}
                    >
                      {canAck && (
                        <button
                          className="button"
                          onClick={() => ack(ackRequest.id)}
                        >
                          OK
                        </button>
                      )}
                      {canRevoke && (
                        <button
                          className="button secondary"
                          disabled={!!pendingUndoRevokeAck}
                          onClick={() => {
                            if (pendingUndoRevokeAck) {
                              return;
                            }
                            setPendingUndoRevokeAck({
                              requestId: ackRequest.id,
                            });
                          }}
                        >
                          OK取消
                        </button>
                      )}
                      {canCancel && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            const reason =
                              window.prompt('撤回理由（任意）') ?? null;
                            if (reason === null) return;
                            cancelAckRequest(
                              ackRequest.id,
                              reason.trim() || undefined,
                            ).catch(() => undefined);
                          }}
                        >
                          撤回
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {Array.isArray(item.attachments) &&
                item.attachments.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <AttachmentField
                      attachments={item.attachments.map((attachment) =>
                        toAttachmentRecord(attachment),
                      )}
                      labels={{
                        title: '添付',
                        selectPreview: 'ダウンロード',
                      }}
                      onSelectPreview={(attachmentId) => {
                        const target = item.attachments?.find(
                          (attachment) => attachment.id === attachmentId,
                        );
                        if (!target) return;
                        downloadAttachment(
                          target.id,
                          target.originalName,
                        ).catch((error: unknown) => {
                          console.error(error);
                          setMessage('添付のダウンロードに失敗しました');
                        });
                      }}
                    />
                  </div>
                )}
            </div>
          );
        })}
      </div>
      {hasMore && roomId && (
        <button
          className="button secondary"
          style={{ marginTop: 12 }}
          onClick={() => loadMessages({ append: true })}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? '読み込み中...' : 'さらに読み込む'}
        </button>
      )}
    </div>
  );
}
