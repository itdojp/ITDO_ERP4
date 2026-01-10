import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api, apiResponse, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';

type ChatMessage = {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  tags?: string[];
  reactions?: Record<string, number | { count: number; userIds: string[] }>;
  mentions?: { userIds?: unknown; groupIds?: unknown } | null;
  mentionsAll?: boolean;
  ackRequest?: {
    id: string;
    requiredUserIds: unknown;
    dueAt?: string | null;
    acks?: { userId: string; ackedAt: string }[];
  } | null;
  attachments?: {
    id: string;
    originalName: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    createdAt: string;
  }[];
  createdAt: string;
};

type MentionCandidates = {
  users?: { userId: string; displayName?: string | null }[];
  groups?: { groupId: string }[];
  allowAll?: boolean;
};

const reactionOptions = ['👍', '🎉', '❤️', '😂', '🙏', '👀'];
const pageSize = 50;

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function parseUserIds(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getReactionCount(value: unknown) {
  if (typeof value === 'number') return value;
  if (
    value &&
    typeof value === 'object' &&
    'count' in value &&
    typeof (value as { count?: unknown }).count === 'number'
  ) {
    return (value as { count: number }).count;
  }
  return 0;
}

const markdownAllowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'a',
  'h1',
  'h2',
  'h3',
  'hr',
];

function transformLinkUri(uri?: string) {
  if (!uri) return '';
  const trimmed = uri.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    if (parsed.protocol === 'mailto:') return trimmed;
  } catch {
    // ignore
  }
  return '';
}

function sanitizeFilename(value: string) {
  return value.replace(/["\\\r\n]/g, '_').replace(/[/\\]/g, '_');
}

export const ProjectChat: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || 'demo-project';
  const [projectId, setProjectId] = useState(defaultProjectId);
  const { projects, projectMessage } = useProjects({
    selectedProjectId: projectId,
    onSelect: setProjectId,
  });
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [ackTargets, setAckTargets] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const currentUserId = auth?.userId || 'demo-user';
  const [unreadCount, setUnreadCount] = useState(0);
  const [highlightSince, setHighlightSince] = useState<Date | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidates>(
    {},
  );
  const [mentionUserInput, setMentionUserInput] = useState('');
  const [mentionGroupInput, setMentionGroupInput] = useState('');
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [mentionGroupIds, setMentionGroupIds] = useState<string[]>([]);
  const [mentionAll, setMentionAll] = useState(false);

  const buildMentionsPayload = () => {
    const users = Array.from(new Set(mentionUserIds.map((id) => id.trim())))
      .filter(Boolean)
      .slice(0, 50);
    const groups = Array.from(new Set(mentionGroupIds.map((id) => id.trim())))
      .filter(Boolean)
      .slice(0, 20);
    if (!mentionAll && users.length === 0 && groups.length === 0) {
      return undefined;
    }
    return {
      userIds: users.length ? users : undefined,
      groupIds: groups.length ? groups : undefined,
      all: mentionAll || undefined,
    };
  };

  const resetMentions = () => {
    setMentionUserInput('');
    setMentionGroupInput('');
    setMentionUserIds([]);
    setMentionGroupIds([]);
    setMentionAll(false);
  };

  const uploadAttachment = async (messageId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    await api(`/chat-messages/${messageId}/attachments`, {
      method: 'POST',
      body: form,
    });
  };

  const downloadAttachment = async (
    attachmentId: string,
    originalName: string,
  ) => {
    const res = await apiResponse(`/chat-attachments/${attachmentId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`download failed (${res.status}) ${text}`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sanitizeFilename(originalName) || 'attachment';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const fetchUnreadState = async () => {
    const res = await api<{ unreadCount?: number; lastReadAt?: string | null }>(
      `/projects/${projectId}/chat-unread`,
    );
    const nextUnread =
      typeof res.unreadCount === 'number' ? res.unreadCount : 0;
    const lastReadAt =
      typeof res.lastReadAt === 'string' ? new Date(res.lastReadAt) : null;
    setUnreadCount(nextUnread);
    setHighlightSince(lastReadAt);
    return nextUnread;
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api<MentionCandidates>(
          `/projects/${projectId}/chat-mention-candidates`,
        );
        if (!cancelled) {
          setMentionCandidates(res || {});
        }
      } catch (error) {
        console.warn('メンション候補の取得に失敗しました', error);
        if (!cancelled) {
          setMentionCandidates({});
        }
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addMentionUser = () => {
    const value = mentionUserInput.trim();
    if (!value) return;
    setMentionUserIds((prev) =>
      prev.includes(value) ? prev : [...prev, value].slice(0, 50),
    );
    setMentionUserInput('');
  };

  const addMentionGroup = () => {
    const value = mentionGroupInput.trim();
    if (!value) return;
    setMentionGroupIds((prev) =>
      prev.includes(value) ? prev : [...prev, value].slice(0, 20),
    );
    setMentionGroupInput('');
  };

  const load = async () => {
    try {
      setIsLoading(true);
      let unreadBefore = 0;
      try {
        unreadBefore = await fetchUnreadState();
      } catch (error) {
        console.warn('未読状態の取得に失敗しました', error);
      }
      const query = new URLSearchParams({ limit: String(pageSize) });
      const trimmedTag = filterTag.trim();
      if (trimmedTag) {
        query.set('tag', trimmedTag);
      }
      const res = await api<{ items: ChatMessage[] }>(
        `/projects/${projectId}/chat-messages?${query.toString()}`,
      );
      setItems(res.items || []);
      setHasMore((res.items || []).length === pageSize);
      if (unreadBefore > 0) {
        try {
          await api(`/projects/${projectId}/chat-read`, { method: 'POST' });
          setUnreadCount(0);
        } catch (error) {
          console.warn('既読更新に失敗しました', error);
        }
      }
      setMessage('読み込みました');
    } catch (error) {
      console.error('チャットの取得に失敗しました', error);
      setMessage('読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    const lastItem = items[items.length - 1];
    if (!lastItem) return;
    try {
      setIsLoadingMore(true);
      const query = new URLSearchParams({
        limit: String(pageSize),
        before: lastItem.createdAt,
      });
      const trimmedTag = filterTag.trim();
      if (trimmedTag) {
        query.set('tag', trimmedTag);
      }
      const res = await api<{ items: ChatMessage[] }>(
        `/projects/${projectId}/chat-messages?${query.toString()}`,
      );
      const nextItems = res.items || [];
      setItems((prevItems) => [...prevItems, ...nextItems]);
      setHasMore(nextItems.length === pageSize);
    } catch (error) {
      console.error('追加読み込みに失敗しました', error);
      setMessage('追加読み込みに失敗しました');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const postMessage = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setMessage('メッセージを入力してください');
      return;
    }
    if (trimmedBody.length > 2000) {
      setMessage('メッセージは2000文字以内で入力してください');
      return;
    }
    const parsedTags = parseTags(tags);
    if (parsedTags.length > 8) {
      setMessage('タグは最大8件までです');
      return;
    }
    const invalidTag = parsedTags.find((tag) => tag.length > 32);
    if (invalidTag) {
      setMessage('タグは1つあたり32文字以内で入力してください');
      return;
    }
    if (mentionAll) {
      const ok = window.confirm('全員宛(@all)で投稿します。よろしいですか？');
      if (!ok) return;
    }
    try {
      setIsPosting(true);
      const mentions = buildMentionsPayload();
      const res = await apiResponse(`/projects/${projectId}/chat-messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: trimmedBody,
          tags: parsedTags,
          mentions,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 429) {
          setMessage('@all の投稿が制限されています。時間をおいてください。');
        } else if (res.status === 403) {
          setMessage('この操作は許可されていません');
        } else {
          setMessage('投稿に失敗しました');
        }
        console.error('チャット投稿に失敗しました', res.status, text);
        return;
      }
      const created = (await res.json().catch(() => ({}))) as ChatMessage;
      if (attachmentFile) {
        await uploadAttachment(created.id, attachmentFile);
      }
      setBody('');
      setTags('');
      setAttachmentFile(null);
      resetMentions();
      setMessage('投稿しました');
      await load();
    } catch (error) {
      console.error('チャットの投稿に失敗しました', error);
      setMessage('投稿に失敗しました');
    } finally {
      setIsPosting(false);
    }
  };

  const postAckRequest = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setMessage('メッセージを入力してください');
      return;
    }
    if (trimmedBody.length > 2000) {
      setMessage('メッセージは2000文字以内で入力してください');
      return;
    }
    const parsedTargets = parseUserIds(ackTargets);
    const uniqueTargets = Array.from(new Set(parsedTargets));
    if (!uniqueTargets.length) {
      setMessage('確認対象のユーザIDを入力してください');
      return;
    }
    if (uniqueTargets.length > 50) {
      setMessage('確認対象は最大50件までです');
      return;
    }
    const parsedTags = parseTags(tags);
    if (parsedTags.length > 8) {
      setMessage('タグは最大8件までです');
      return;
    }
    const invalidTag = parsedTags.find((tag) => tag.length > 32);
    if (invalidTag) {
      setMessage('タグは1つあたり32文字以内で入力してください');
      return;
    }
    if (mentionAll) {
      const ok = window.confirm('全員宛(@all)で投稿します。よろしいですか？');
      if (!ok) return;
    }
    try {
      setIsPosting(true);
      const mentions = buildMentionsPayload();
      const res = await apiResponse(
        `/projects/${projectId}/chat-ack-requests`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: trimmedBody,
            requiredUserIds: uniqueTargets,
            tags: parsedTags,
            mentions,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 429) {
          setMessage('@all の投稿が制限されています。時間をおいてください。');
        } else if (res.status === 403) {
          setMessage('この操作は許可されていません');
        } else {
          setMessage('確認依頼の投稿に失敗しました');
        }
        console.error('確認依頼の投稿に失敗しました', res.status, text);
        return;
      }
      const created = (await res.json().catch(() => ({}))) as ChatMessage;
      if (attachmentFile) {
        await uploadAttachment(created.id, attachmentFile);
      }
      setBody('');
      setTags('');
      setAckTargets('');
      setAttachmentFile(null);
      resetMentions();
      setMessage('確認依頼を投稿しました');
      await load();
    } catch (error) {
      console.error('確認依頼の投稿に失敗しました', error);
      setMessage('確認依頼の投稿に失敗しました');
    } finally {
      setIsPosting(false);
    }
  };

  const addReaction = async (id: string, emoji: string) => {
    try {
      const updated = await api<ChatMessage>(`/chat-messages/${id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setItems((prevItems) =>
        prevItems.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      console.error('リアクションに失敗しました', error);
      setMessage('リアクションに失敗しました');
    }
  };

  const ackRequest = async (requestId: string) => {
    try {
      const updated = await api<ChatMessage['ackRequest']>(
        `/chat-ack-requests/${requestId}/ack`,
        { method: 'POST' },
      );
      setItems((prevItems) =>
        prevItems.map((item) =>
          item.ackRequest?.id === requestId
            ? { ...item, ackRequest: updated || item.ackRequest }
            : item,
        ),
      );
    } catch (error) {
      console.error('確認の記録に失敗しました', error);
      setMessage('確認の記録に失敗しました');
    }
  };

  return (
    <div>
      <h2>
        プロジェクトチャット
        {unreadCount > 0 ? ` (未読 ${unreadCount})` : ''}
      </h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="案件選択"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">案件を選択</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} / {project.name}
            </option>
          ))}
        </select>
        <button
          className="button secondary"
          onClick={load}
          disabled={isLoading}
        >
          {isLoading ? '読み込み中...' : '読み込み'}
        </button>
        <input
          type="text"
          placeholder="タグで絞り込み (任意)"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          maxLength={32}
          style={{ minWidth: 200 }}
        />
      </div>
      <div style={{ marginTop: 4 }}>
        <small style={{ fontSize: 12, color: '#6b7280' }}>
          タグを変更した後は「読み込み」ボタンを押して絞り込みを適用します。
        </small>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      <div style={{ marginTop: 8 }}>
        <textarea
          placeholder="メッセージを書く"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          style={{ width: '100%', minHeight: 80 }}
        />
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="タグ (comma separated)"
          style={{ width: '100%', marginTop: 8 }}
        />
        <input
          aria-label="添付"
          type="file"
          onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
          style={{ width: '100%', marginTop: 8 }}
        />
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            aria-label="メンションユーザ"
            type="text"
            list="chat-mention-users"
            value={mentionUserInput}
            onChange={(e) => setMentionUserInput(e.target.value)}
            placeholder="メンション: ユーザID (任意)"
            style={{ flex: '1 1 240px' }}
          />
          <button
            className="button secondary"
            onClick={addMentionUser}
            type="button"
          >
            ユーザ追加
          </button>
        </div>
        <datalist id="chat-mention-users">
          {(mentionCandidates.users || []).map((user) => (
            <option
              key={user.userId}
              value={user.userId}
              label={user.displayName ? `${user.displayName}` : user.userId}
            />
          ))}
        </datalist>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            aria-label="メンショングループ"
            type="text"
            list="chat-mention-groups"
            value={mentionGroupInput}
            onChange={(e) => setMentionGroupInput(e.target.value)}
            placeholder="メンション: グループID (任意)"
            style={{ flex: '1 1 240px' }}
          />
          <button
            className="button secondary"
            onClick={addMentionGroup}
            type="button"
          >
            グループ追加
          </button>
        </div>
        <datalist id="chat-mention-groups">
          {(mentionCandidates.groups || []).map((group) => (
            <option key={group.groupId} value={group.groupId} />
          ))}
        </datalist>
        {(mentionCandidates.allowAll ?? true) && (
          <label style={{ display: 'block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={mentionAll}
              onChange={(e) => setMentionAll(e.target.checked)}
            />{' '}
            全員にメンション (@all)
          </label>
        )}
        {(mentionAll ||
          mentionUserIds.length > 0 ||
          mentionGroupIds.length > 0) && (
          <div
            className="row"
            style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}
          >
            {mentionAll && <span className="badge">@all</span>}
            {mentionUserIds.map((userId) => (
              <span key={userId} className="badge">
                @{userId}
              </span>
            ))}
            {mentionGroupIds.map((groupId) => (
              <span key={groupId} className="badge">
                @{groupId}
              </span>
            ))}
            <button
              className="button secondary"
              onClick={resetMentions}
              type="button"
            >
              メンション解除
            </button>
          </div>
        )}
        <input
          type="text"
          value={ackTargets}
          onChange={(e) => setAckTargets(e.target.value)}
          placeholder="確認対象ユーザID (comma separated)"
          style={{ width: '100%', marginTop: 8 }}
        />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="button" onClick={postMessage} disabled={isPosting}>
            {isPosting ? '投稿中...' : '投稿'}
          </button>
          <button
            className="button secondary"
            onClick={postAckRequest}
            disabled={isPosting}
          >
            {isPosting ? '投稿中...' : '確認依頼'}
          </button>
        </div>
      </div>
      {message && <p>{message}</p>}
      <ul className="list">
        {items.map((item) => {
          const reactions =
            item.reactions && typeof item.reactions === 'object'
              ? item.reactions
              : {};
          const reactionEntries = Object.entries(reactions).map(
            ([emoji, value]) => [emoji, getReactionCount(value)],
          );
          const requiredUserIds = normalizeStringArray(
            item.ackRequest?.requiredUserIds,
          );
          const ackedUserIds = normalizeStringArray(
            item.ackRequest?.acks?.map((ack) => ack.userId),
          );
          const mentionedUserIds = normalizeStringArray(item.mentions?.userIds);
          const mentionedGroupIds = normalizeStringArray(
            item.mentions?.groupIds,
          );
          const mentionAllFlag = item.mentionsAll === true;
          const requiredCount = requiredUserIds.length;
          const ackedCount = requiredUserIds.filter((userId) =>
            ackedUserIds.includes(userId),
          ).length;
          const canAck =
            item.ackRequest?.id &&
            requiredUserIds.includes(currentUserId) &&
            !ackedUserIds.includes(currentUserId);
          const isUnread =
            highlightSince &&
            new Date(item.createdAt).getTime() > highlightSince.getTime();
          return (
            <li
              key={item.id}
              style={isUnread ? { background: '#fef9c3' } : undefined}
            >
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {item.userId} / {new Date(item.createdAt).toLocaleString()}
              </div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                allowedElements={markdownAllowedElements}
                urlTransform={transformLinkUri}
                components={{
                  a: ({ node: _node, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer noopener" />
                  ),
                }}
              >
                {item.body}
              </ReactMarkdown>
              {(mentionAllFlag ||
                mentionedUserIds.length > 0 ||
                mentionedGroupIds.length > 0) && (
                <div
                  className="row"
                  style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}
                >
                  {mentionAllFlag && <span className="badge">@all</span>}
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
              {item.attachments && item.attachments.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>添付:</div>
                  <div
                    className="row"
                    style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}
                  >
                    {item.attachments.map((attachment) => (
                      <button
                        key={attachment.id}
                        className="button secondary"
                        onClick={() =>
                          downloadAttachment(
                            attachment.id,
                            attachment.originalName,
                          ).catch((error) => {
                            console.error(
                              '添付のダウンロードに失敗しました',
                              error,
                            );
                            setMessage('添付のダウンロードに失敗しました');
                          })
                        }
                      >
                        {attachment.originalName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {item.tags && item.tags.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {item.tags.map((tag) => (
                    <span key={tag} className="badge">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              {item.ackRequest?.id && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 10,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    確認状況: {ackedCount}/{requiredCount || 0}
                  </div>
                  {requiredCount > 0 && (
                    <div
                      className="row"
                      style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}
                    >
                      {requiredUserIds.map((userId) => (
                        <span key={userId} className="badge">
                          {userId}
                          {ackedUserIds.includes(userId) ? ' ✅' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {canAck && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="button"
                        onClick={() => ackRequest(item.ackRequest!.id)}
                      >
                        OK
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {reactionOptions.map((emoji) => (
                  <button
                    key={emoji}
                    className="button secondary"
                    onClick={() => addReaction(item.id, emoji)}
                  >
                    {emoji} {getReactionCount(reactions[emoji]) || ''}
                  </button>
                ))}
                {reactionEntries
                  .filter(([emoji]) => !reactionOptions.includes(emoji))
                  .map(([emoji, count]) => (
                    <span key={emoji} className="badge">
                      {emoji} {count}
                    </span>
                  ))}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li>メッセージなし</li>}
      </ul>
      {items.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            className="button secondary"
            onClick={loadMore}
            disabled={!hasMore || isLoadingMore}
          >
            {isLoadingMore ? '読み込み中...' : 'もっと読み込む'}
          </button>
        </div>
      )}
    </div>
  );
};
