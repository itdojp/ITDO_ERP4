import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api, apiResponse, getAuthState } from '../api';

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  isOfficial?: boolean | null;
  projectCode?: string | null;
  projectName?: string | null;
  groupId?: string | null;
  allowExternalUsers?: boolean | null;
  allowExternalIntegrations?: boolean | null;
  isMember?: boolean | null;
};

type ChatMessage = {
  id: string;
  roomId: string;
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

const reactionOptions = ['👍', '🎉', '❤️', '😂', '🙏', '👀'];
const pageSize = 50;

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseUserIds(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
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

function formatRoomLabel(room: ChatRoom, currentUserId: string) {
  if (room.type === 'project') {
    if (room.projectCode && room.projectName) {
      return `${room.projectCode} / ${room.projectName}`;
    }
    if (room.projectCode) return room.projectCode;
    return room.name;
  }
  if (room.type !== 'dm') return room.name;
  const parts = room.name.startsWith('dm:')
    ? room.name.slice(3).split(':')
    : [];
  if (parts.length >= 2) {
    const [a, b] = parts;
    if (a === currentUserId) return b;
    if (b === currentUserId) return a;
    return `${a} / ${b}`;
  }
  return room.name;
}

export const RoomChat: React.FC = () => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const currentUserId = auth?.userId || 'demo-user';
  const canSeeAllMeta =
    roles.includes('admin') || roles.includes('mgmt') || roles.includes('exec');

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomId, setRoomId] = useState('');
  const [roomMessage, setRoomMessage] = useState('');

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) || null,
    [rooms, roomId],
  );

  const [items, setItems] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryProvider, setSummaryProvider] = useState('');
  const [summaryModel, setSummaryModel] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSummarizingExternal, setIsSummarizingExternal] = useState(false);

  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [ackTargets, setAckTargets] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [filterTag, setFilterTag] = useState('');

  const [unreadCount, setUnreadCount] = useState(0);
  const [highlightSince, setHighlightSince] = useState<Date | null>(null);

  const [createPrivateName, setCreatePrivateName] = useState('');
  const [createPrivateMembers, setCreatePrivateMembers] = useState('');
  const [createDmPartner, setCreateDmPartner] = useState('');
  const [inviteMembers, setInviteMembers] = useState('');

  const loadRooms = async () => {
    try {
      const res = await api<{ items?: ChatRoom[] }>('/chat-rooms');
      const items = Array.isArray(res.items) ? res.items : [];
      const showProjectRooms = roles.includes('external_chat');
      const visibleRooms = showProjectRooms
        ? items
        : items.filter((room) => room.type !== 'project');
      const joinedRooms = canSeeAllMeta
        ? visibleRooms.filter((room) => room.isMember !== false)
        : visibleRooms;
      setRooms(joinedRooms);
      setRoomMessage('');
      if (!roomId && joinedRooms.length) {
        setRoomId(joinedRooms[0].id);
      } else if (roomId && !joinedRooms.some((room) => room.id === roomId)) {
        setRoomId(joinedRooms[0]?.id || '');
      }
    } catch (err) {
      console.error('Failed to load chat rooms.', err);
      setRooms([]);
      setRoomMessage('ルーム一覧の取得に失敗しました');
    }
  };

  const fetchUnreadState = async (targetRoomId: string) => {
    const res = await api<{ unreadCount?: number; lastReadAt?: string | null }>(
      `/chat-rooms/${targetRoomId}/unread`,
    );
    const nextUnread =
      typeof res.unreadCount === 'number' ? res.unreadCount : 0;
    const lastReadAt =
      typeof res.lastReadAt === 'string' ? new Date(res.lastReadAt) : null;
    setUnreadCount(nextUnread);
    setHighlightSince(lastReadAt);
    return nextUnread;
  };

  const markRead = async (targetRoomId: string) => {
    try {
      await api(`/chat-rooms/${targetRoomId}/read`, { method: 'POST' });
    } catch (err) {
      console.warn('Failed to mark read.', err);
    }
  };

  const loadMessages = async (options?: { append?: boolean }) => {
    if (!roomId) return;
    const append = options?.append === true;
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setItems([]);
      }
      setMessage('');

      const before =
        append && items.length ? items[items.length - 1]?.createdAt : '';
      const query = new URLSearchParams();
      query.set('limit', String(pageSize));
      if (before) query.set('before', before);
      if (filterTag.trim()) query.set('tag', filterTag.trim());

      const res = await api<{ items?: ChatMessage[] }>(
        `/chat-rooms/${roomId}/messages?${query.toString()}`,
      );
      const fetched = Array.isArray(res.items) ? res.items : [];
      if (append) {
        setItems((prev) => [...prev, ...fetched]);
      } else {
        setItems(fetched);
      }
      setHasMore(fetched.length === pageSize);

      await fetchUnreadState(roomId);
      await markRead(roomId);
    } catch (err) {
      console.error('Failed to load room messages.', err);
      setMessage('メッセージの取得に失敗しました');
      setHasMore(false);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
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

  const postMessage = async (mode: 'message' | 'ack') => {
    if (!roomId) return;
    if (!body.trim()) {
      setMessage('本文を入力してください');
      return;
    }
    try {
      setIsLoading(true);
      setMessage('');
      const basePayload: { body: string; tags?: string[] } = {
        body: body.trim(),
        tags: tags.trim() ? parseTags(tags) : undefined,
      };
      const endpoint = `/chat-rooms/${roomId}/${
        mode === 'ack' ? 'ack-requests' : 'messages'
      }`;
      const payload =
        mode === 'ack'
          ? (() => {
              const required = parseUserIds(ackTargets);
              if (required.length === 0) {
                setMessage('確認対象（requiredUserIds）を入力してください');
                return null;
              }
              return {
                ...basePayload,
                requiredUserIds: required,
              };
            })()
          : basePayload;
      if (!payload) return;
      const created = await api<ChatMessage>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (attachmentFile) {
        await uploadAttachment(created.id, attachmentFile);
      }
      setBody('');
      setTags('');
      setAckTargets('');
      setAttachmentFile(null);
      await loadMessages();
    } catch (err) {
      console.error('Failed to post message.', err);
      setMessage('投稿に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const addReaction = async (id: string, emoji: string) => {
    try {
      const updated = await api<ChatMessage>(`/chat-messages/${id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch (err) {
      console.error('Failed to add reaction.', err);
      setMessage('リアクションの更新に失敗しました');
    }
  };

  const ack = async (requestId: string) => {
    try {
      const updated = await api<ChatMessage['ackRequest']>(
        `/chat-ack-requests/${requestId}/ack`,
        { method: 'POST' },
      );
      setItems((prev) =>
        prev.map((item) =>
          item.ackRequest?.id === requestId
            ? { ...item, ackRequest: updated || null }
            : item,
        ),
      );
    } catch (err) {
      console.error('Failed to ack request.', err);
      setMessage('OKの送信に失敗しました');
    }
  };

  const createPrivateGroup = async () => {
    try {
      setRoomMessage('');
      const memberUserIds = parseUserIds(createPrivateMembers);
      const created = await api<ChatRoom>('/chat-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'private_group',
          name: createPrivateName.trim(),
          memberUserIds: memberUserIds.length ? memberUserIds : undefined,
        }),
      });
      setCreatePrivateName('');
      setCreatePrivateMembers('');
      await loadRooms();
      setRoomId(created.id);
    } catch (err) {
      console.error('Failed to create private group.', err);
      setRoomMessage('private_groupの作成に失敗しました');
    }
  };

  const createDm = async () => {
    try {
      setRoomMessage('');
      const created = await api<ChatRoom>('/chat-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dm',
          partnerUserId: createDmPartner.trim(),
        }),
      });
      setCreateDmPartner('');
      await loadRooms();
      setRoomId(created.id);
    } catch (err) {
      console.error('Failed to create DM.', err);
      setRoomMessage('DMの作成に失敗しました');
    }
  };

  const invite = async () => {
    if (!roomId) return;
    try {
      setRoomMessage('');
      const userIds = parseUserIds(inviteMembers);
      if (userIds.length === 0) {
        setRoomMessage('追加するユーザIDを入力してください');
        return;
      }
      await api(`/chat-rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      setInviteMembers('');
      setRoomMessage('メンバーを追加しました');
    } catch (err) {
      console.error('Failed to invite members.', err);
      setRoomMessage('メンバー追加に失敗しました');
    }
  };

  const summarize = async () => {
    if (!roomId) return;
    try {
      setIsSummarizing(true);
      setMessage('');
      const res = await api<{ summary?: string }>(
        `/chat-rooms/${roomId}/summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 120 }),
        },
      );
      setSummaryProvider('');
      setSummaryModel('');
      setSummary(typeof res.summary === 'string' ? res.summary : '');
    } catch (err) {
      console.error('Failed to summarize room messages.', err);
      setMessage('要約の生成に失敗しました');
    } finally {
      setIsSummarizing(false);
    }
  };

  const summarizeExternal = async () => {
    if (!roomId) return;
    if (selectedRoom?.allowExternalIntegrations !== true) return;
    if (roles.includes('external_chat')) return;

    const ok = window.confirm(
      [
        '外部LLMへ送信して要約します（本文のみ。添付は送信しません）。',
        '送信範囲: 直近120件 / 過去7日間',
        '続行しますか？',
      ].join('\n'),
    );
    if (!ok) return;

    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    try {
      setIsSummarizingExternal(true);
      setMessage('');
      const res = await api<{
        summary?: string;
        provider?: string;
        model?: string;
      }>(`/chat-rooms/${roomId}/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 120,
          since: since.toISOString(),
          until: now.toISOString(),
        }),
      });
      setSummaryProvider(
        typeof res.provider === 'string' ? res.provider : 'external',
      );
      setSummaryModel(typeof res.model === 'string' ? res.model : '');
      setSummary(typeof res.summary === 'string' ? res.summary : '');
    } catch (err) {
      console.error('Failed to generate external summary.', err);
      setMessage('外部要約の生成に失敗しました');
    } finally {
      setIsSummarizingExternal(false);
    }
  };

  useEffect(() => {
    loadRooms().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roomId) return;
    setSummary('');
    setSummaryProvider('');
    setSummaryModel('');
    loadMessages().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const displayedRooms = useMemo(() => {
    return rooms.map((room) => ({
      ...room,
      label: `${room.type}: ${formatRoomLabel(room, currentUserId)}`,
    }));
  }, [rooms, currentUserId]);

  const renderMessageBody = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      allowedElements={markdownAllowedElements}
      urlTransform={transformLinkUri}
    >
      {text}
    </ReactMarkdown>
  );

  return (
    <div>
      <h2>チャット（全社/部門/private_group/DM）</h2>
      {roomMessage && <p>{roomMessage}</p>}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>
          ルーム
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">(未選択)</option>
            {displayedRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" onClick={() => loadRooms()}>
          再読込
        </button>
        <span className="badge">Unread {unreadCount}</span>
        <button
          className="button secondary"
          onClick={summarize}
          disabled={!roomId || isSummarizing}
        >
          {isSummarizing ? '要約中...' : '要約'}
        </button>
        {selectedRoom?.allowExternalIntegrations === true &&
          !roles.includes('external_chat') && (
            <button
              className="button secondary"
              onClick={summarizeExternal}
              disabled={!roomId || isSummarizingExternal}
            >
              {isSummarizingExternal ? '外部要約中...' : '外部要約'}
            </button>
          )}
      </div>

      {summary && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {summaryProvider
              ? `要約（外部: ${summaryProvider}${summaryModel ? ` / ${summaryModel}` : ''}）`
              : '要約（スタブ）'}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{summary}</pre>
        </div>
      )}

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <strong>作成（MVP）</strong>
        <div
          className="row"
          style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
        >
          <label>
            private_group 名
            <input
              type="text"
              value={createPrivateName}
              onChange={(e) => setCreatePrivateName(e.target.value)}
              placeholder="例: 雑談"
            />
          </label>
          <label>
            初期メンバー(userId,任意)
            <input
              type="text"
              value={createPrivateMembers}
              onChange={(e) => setCreatePrivateMembers(e.target.value)}
              placeholder="user1,user2"
            />
          </label>
          <button
            className="button"
            onClick={createPrivateGroup}
            disabled={!createPrivateName.trim()}
          >
            private_group作成
          </button>
        </div>
        <div
          className="row"
          style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
        >
          <label>
            DM 相手(userId)
            <input
              type="text"
              value={createDmPartner}
              onChange={(e) => setCreateDmPartner(e.target.value)}
              placeholder="user2"
            />
          </label>
          <button
            className="button"
            onClick={createDm}
            disabled={!createDmPartner.trim()}
          >
            DM作成
          </button>
        </div>
      </div>

      {selectedRoom?.type === 'private_group' && roomId && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <strong>招待（private_group）</strong>
          <div
            className="row"
            style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
          >
            <label>
              追加ユーザID
              <input
                type="text"
                value={inviteMembers}
                onChange={(e) => setInviteMembers(e.target.value)}
                placeholder="user3,user4"
              />
            </label>
            <button
              className="button"
              onClick={invite}
              disabled={!inviteMembers.trim()}
            >
              追加
            </button>
          </div>
        </div>
      )}

      {roomId && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <strong>投稿</strong>
          {message && <div style={{ marginTop: 8 }}>{message}</div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Markdownで入力"
              rows={4}
            />
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <label>
                tags
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="tag1,tag2"
                />
              </label>
              <label>
                確認対象(requiredUserIds)
                <input
                  type="text"
                  value={ackTargets}
                  onChange={(e) => setAckTargets(e.target.value)}
                  placeholder="user1,user2"
                />
              </label>
              <label>
                添付
                <input
                  type="file"
                  onChange={(e) =>
                    setAttachmentFile(e.target.files?.[0] || null)
                  }
                />
              </label>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <button
                className="button"
                onClick={() => postMessage('message')}
                disabled={isLoading}
              >
                送信
              </button>
              <button
                className="button secondary"
                onClick={() => postMessage('ack')}
                disabled={isLoading}
              >
                確認依頼
              </button>
              <button
                className="button secondary"
                onClick={() => loadMessages()}
                disabled={isLoading}
              >
                再読込
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <strong>一覧</strong>
        <div
          className="row"
          style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
        >
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
        </div>

        {isLoading && <div style={{ marginTop: 8 }}>読み込み中...</div>}
        {!isLoading && items.length === 0 && (
          <div style={{ marginTop: 8 }}>メッセージなし</div>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {items.map((item) => {
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const createdAt = new Date(item.createdAt).toLocaleString();
            const isHighlighted =
              highlightSince && new Date(item.createdAt) > highlightSince;
            const ackRequest = item.ackRequest;
            const requiredUserIds = ackRequest
              ? normalizeStringArray(ackRequest.requiredUserIds)
              : [];
            const ackedUserIds = new Set(
              (ackRequest?.acks || []).map((ack) => ack.userId),
            );
            const canAck =
              ackRequest &&
              requiredUserIds.includes(currentUserId) &&
              !ackedUserIds.has(currentUserId);

            return (
              <div
                key={item.id}
                className="card"
                style={{
                  padding: 12,
                  borderColor: isHighlighted ? '#f59e0b' : undefined,
                }}
              >
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{item.userId}</strong>
                    <span
                      style={{ marginLeft: 8, fontSize: 12, color: '#475569' }}
                    >
                      {createdAt}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
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
                <div style={{ marginTop: 8 }}>
                  {renderMessageBody(item.body)}
                </div>
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
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      required: {requiredUserIds.join(', ') || '-'}
                    </div>
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      acked: {Array.from(ackedUserIds).join(', ') || '-'}
                    </div>
                    {canAck && (
                      <button
                        className="button"
                        style={{ marginTop: 6 }}
                        onClick={() => ack(ackRequest.id)}
                      >
                        OK
                      </button>
                    )}
                  </div>
                )}
                {Array.isArray(item.attachments) &&
                  item.attachments.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="badge">添付</div>
                      <ul style={{ marginTop: 6 }}>
                        {item.attachments.map((att) => (
                          <li key={att.id}>
                            <button
                              className="button secondary"
                              onClick={() =>
                                downloadAttachment(
                                  att.id,
                                  att.originalName,
                                ).catch((err) => {
                                  console.error(err);
                                  setMessage(
                                    '添付のダウンロードに失敗しました',
                                  );
                                })
                              }
                            >
                              ダウンロード
                            </button>{' '}
                            {att.originalName}
                          </li>
                        ))}
                      </ul>
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
    </div>
  );
};
