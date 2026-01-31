import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api, apiResponse, getAuthState } from '../api';
import { copyToClipboard } from '../utils/clipboard';
import { buildOpenHash } from '../utils/deepLink';

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  isOfficial?: boolean | null;
  projectId?: string | null;
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
    canceledAt?: string | null;
    canceledBy?: string | null;
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

type ChatSearchItem = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  tags?: string[];
  createdAt: string;
  room: ChatRoom;
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

function isAckRequest(
  value: ChatMessage['ackRequest'],
): value is NonNullable<ChatMessage['ackRequest']> {
  if (!value || typeof value !== 'object') return false;
  if (!('id' in value)) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0;
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

function buildExcerpt(value: string, maxLength = 200) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

function buildBeforeForCreatedAt(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 1).toISOString();
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
  const currentRoomIdRef = useRef('');
  const skipNextRoomAutoLoadRef = useRef(false);

  useEffect(() => {
    currentRoomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId?: unknown }>).detail;
      const nextRoomId =
        detail && typeof detail.roomId === 'string' ? detail.roomId : '';
      if (!nextRoomId) return;
      setRoomId(nextRoomId);
    };
    window.addEventListener('erp4_open_room_chat', handler as EventListener);
    return () => {
      window.removeEventListener(
        'erp4_open_room_chat',
        handler as EventListener,
      );
    };
  }, []);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) || null,
    [rooms, roomId],
  );

  const [items, setItems] = useState<ChatMessage[]>([]);
  const [nowMs, setNowMs] = useState(0);
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
  const [showPreview, setShowPreview] = useState(false);
  const [tags, setTags] = useState('');
  const [ackTargets, setAckTargets] = useState('');
  const [ackTargetInput, setAckTargetInput] = useState('');
  const [ackTargetGroupIds, setAckTargetGroupIds] = useState('');
  const [ackTargetGroupInput, setAckTargetGroupInput] = useState('');
  const [ackTargetRoles, setAckTargetRoles] = useState('');
  const [ackTargetRoleInput, setAckTargetRoleInput] = useState('');
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidates>(
    {},
  );
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const ackTargetUserIds = useMemo(
    () => Array.from(new Set(parseUserIds(ackTargets))),
    [ackTargets],
  );
  const ackTargetGroupIdList = useMemo(
    () => Array.from(new Set(parseUserIds(ackTargetGroupIds))),
    [ackTargetGroupIds],
  );
  const ackTargetRoleList = useMemo(
    () => Array.from(new Set(parseUserIds(ackTargetRoles))),
    [ackTargetRoles],
  );

  const hasActiveAckDeadline = useMemo(() => {
    return items.some((item) => {
      if (item.ackRequest?.canceledAt) return false;
      const dueAt = item.ackRequest?.dueAt
        ? new Date(item.ackRequest.dueAt)
        : null;
      if (!dueAt || Number.isNaN(dueAt.getTime())) return false;
      const requiredUserIds = item.ackRequest
        ? normalizeStringArray(item.ackRequest.requiredUserIds)
        : [];
      const requiredCount = requiredUserIds.length;
      if (requiredCount <= 0) return false;
      const ackedUserIds = new Set(
        (item.ackRequest?.acks || []).map((ack) => ack.userId),
      );
      const ackedCount = requiredUserIds.filter((userId) =>
        ackedUserIds.has(userId),
      ).length;
      return ackedCount < requiredCount;
    });
  }, [items]);

  useEffect(() => {
    if (!hasActiveAckDeadline) {
      setNowMs(0);
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [hasActiveAckDeadline]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          messageId?: unknown;
          roomId?: unknown;
          createdAt?: unknown;
        }>
      ).detail;
      const messageId =
        detail && typeof detail.messageId === 'string' ? detail.messageId : '';
      const targetRoomId =
        detail && typeof detail.roomId === 'string' ? detail.roomId : '';
      const createdAt =
        detail && typeof detail.createdAt === 'string' ? detail.createdAt : '';
      if (!messageId || !targetRoomId) return;

      const currentRoomId = currentRoomIdRef.current;
      const isRoomChange = targetRoomId !== currentRoomId;
      if (isRoomChange) {
        skipNextRoomAutoLoadRef.current = true;
        setRoomId(targetRoomId);
      } else {
        // 同一ルーム内の deep link では roomId の change が発生せず、
        // skip フラグが残ると「次のルーム切替」で自動ロードが抑止されてしまう。
        skipNextRoomAutoLoadRef.current = false;
      }
      setFilterQuery('');
      setFilterTag('');
      setPendingOpenMessage({ roomId: targetRoomId, messageId, createdAt });
    };

    window.addEventListener('erp4_open_chat_message', handler as EventListener);
    return () => {
      window.removeEventListener(
        'erp4_open_chat_message',
        handler as EventListener,
      );
    };
  }, []);

  const [globalQuery, setGlobalQuery] = useState('');
  const [globalItems, setGlobalItems] = useState<ChatSearchItem[]>([]);
  const [globalHasMore, setGlobalHasMore] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalLoading, setGlobalLoading] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const [highlightSince, setHighlightSince] = useState<Date | null>(null);
  const [pendingOpenMessage, setPendingOpenMessage] = useState<{
    roomId: string;
    messageId: string;
    createdAt: string;
  } | null>(null);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState('');
  const [highlightMessageId, setHighlightMessageId] = useState('');

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

  const loadMessages = async (options?: {
    append?: boolean;
    before?: string;
    query?: string;
    tag?: string;
  }) => {
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
        options?.before !== undefined
          ? options.before
          : append && items.length
            ? items[items.length - 1]?.createdAt
            : '';
      const query = new URLSearchParams();
      query.set('limit', String(pageSize));
      if (before) query.set('before', before);
      const effectiveTag = options?.tag !== undefined ? options.tag : filterTag;
      const effectiveQuery =
        options?.query !== undefined ? options.query : filterQuery;

      if (effectiveTag.trim()) query.set('tag', effectiveTag.trim());
      const trimmedQuery = effectiveQuery.trim();
      if (trimmedQuery && trimmedQuery.length < 2) {
        setMessage('検索語は2文字以上で入力してください');
        setHasMore(false);
        return;
      }
      if (trimmedQuery) query.set('q', trimmedQuery);

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

  useEffect(() => {
    if (!pendingOpenMessage) return;
    if (pendingOpenMessage.roomId !== roomId) return;
    const { messageId, createdAt } = pendingOpenMessage;
    setPendingOpenMessage(null);
    const before = buildBeforeForCreatedAt(createdAt);
    loadMessages({ before, query: '', tag: '' })
      .then(() => {
        setPendingScrollMessageId(messageId);
        setHighlightMessageId(messageId);
        window.setTimeout(() => setHighlightMessageId(''), 10_000);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenMessage, roomId]);

  useEffect(() => {
    if (!pendingScrollMessageId) return;
    if (!items.some((item) => item.id === pendingScrollMessageId)) return;
    const id = pendingScrollMessageId;
    setPendingScrollMessageId('');
    window.setTimeout(() => {
      const element = document.getElementById(`chat-message-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 0);
  }, [items, pendingScrollMessageId]);

  const openSearchResult = (item: ChatSearchItem) => {
    if (item.room.type === 'project' && item.room.projectId) {
      if (roles.includes('external_chat')) {
        setRoomId(item.room.id);
      } else {
        window.dispatchEvent(
          new CustomEvent('erp4_open_project_chat', {
            detail: { projectId: item.room.projectId },
          }),
        );
      }
      return;
    }
    setRoomId(item.room.id);
    setMessage('');
  };

  const loadGlobalSearch = async (options?: { append?: boolean }) => {
    const append = options?.append === true;
    const trimmed = globalQuery.trim();
    if (trimmed.length < 2) {
      setGlobalMessage('検索語は2文字以上で入力してください');
      return;
    }
    try {
      setGlobalLoading(true);
      setGlobalMessage('');
      const before =
        append && globalItems.length
          ? globalItems[globalItems.length - 1]?.createdAt
          : '';
      const query = new URLSearchParams();
      query.set('q', trimmed);
      query.set('limit', String(pageSize));
      if (before) query.set('before', before);
      const res = await api<{ items?: ChatSearchItem[] }>(
        `/chat-messages/search?${query.toString()}`,
      );
      const fetched = Array.isArray(res.items) ? res.items : [];
      setGlobalItems((prev) => (append ? [...prev, ...fetched] : fetched));
      setGlobalHasMore(fetched.length >= pageSize);
    } catch (err) {
      console.error('Failed to search chat messages.', err);
      setGlobalMessage('検索に失敗しました');
      if (!append) setGlobalItems([]);
      setGlobalHasMore(false);
    } finally {
      setGlobalLoading(false);
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

  const addAckTargetUser = () => {
    const value = ackTargetInput.trim();
    if (!value) return;
    setAckTargets((prev) => {
      const current = parseUserIds(prev);
      const next = Array.from(new Set([...current, value])).slice(0, 50);
      return next.join(',');
    });
    setAckTargetInput('');
  };

  const addAckTargetGroup = () => {
    const value = ackTargetGroupInput.trim();
    if (!value) return;
    setAckTargetGroupIds((prev) => {
      const current = parseUserIds(prev);
      const next = Array.from(new Set([...current, value])).slice(0, 20);
      return next.join(',');
    });
    setAckTargetGroupInput('');
  };

  const addAckTargetRole = () => {
    const value = ackTargetRoleInput.trim();
    if (!value) return;
    setAckTargetRoles((prev) => {
      const current = parseUserIds(prev);
      const next = Array.from(new Set([...current, value])).slice(0, 20);
      return next.join(',');
    });
    setAckTargetRoleInput('');
  };

  const removeAckTargetUser = (userId: string) => {
    const current = parseUserIds(ackTargets);
    setAckTargets(current.filter((entry) => entry !== userId).join(','));
  };

  const removeAckTargetGroup = (groupId: string) => {
    const current = parseUserIds(ackTargetGroupIds);
    setAckTargetGroupIds(current.filter((entry) => entry !== groupId).join(','));
  };

  const removeAckTargetRole = (role: string) => {
    const current = parseUserIds(ackTargetRoles);
    setAckTargetRoles(current.filter((entry) => entry !== role).join(','));
  };

  const resetAckTargets = () => {
    setAckTargets('');
    setAckTargetInput('');
    setAckTargetGroupIds('');
    setAckTargetGroupInput('');
    setAckTargetRoles('');
    setAckTargetRoleInput('');
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
              const required = Array.from(new Set(parseUserIds(ackTargets)));
              const groupIds = Array.from(
                new Set(parseUserIds(ackTargetGroupIds)),
              );
              const roles = Array.from(new Set(parseUserIds(ackTargetRoles)));
              if (
                required.length === 0 &&
                groupIds.length === 0 &&
                roles.length === 0
              ) {
                setMessage('確認対象（ユーザID/グループ/ロール）を入力してください');
                return null;
              }
              if (required.length > 50) {
                setMessage('確認対象は最大50件までです');
                return null;
              }
              if (groupIds.length > 20) {
                setMessage('確認対象グループは最大20件までです');
                return null;
              }
              if (roles.length > 20) {
                setMessage('確認対象ロールは最大20件までです');
                return null;
              }
              return {
                ...basePayload,
                ...(required.length ? { requiredUserIds: required } : {}),
                ...(groupIds.length ? { requiredGroupIds: groupIds } : {}),
                ...(roles.length ? { requiredRoles: roles } : {}),
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
      resetAckTargets();
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
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
    } catch (err) {
      console.error('Failed to ack request.', err);
      setMessage('OKの送信に失敗しました');
    }
  };

  const revokeAck = async (requestId: string) => {
    try {
      const updated = await api<ChatMessage['ackRequest']>(
        `/chat-ack-requests/${requestId}/revoke`,
        { method: 'POST' },
      );
      setItems((prev) =>
        prev.map((item) =>
          item.ackRequest?.id === requestId
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
      setMessage('OKを取り消しました');
    } catch (err) {
      console.error('Failed to revoke ack.', err);
      setMessage('OKの取り消しに失敗しました');
    }
  };

  const cancelAckRequest = async (requestId: string, reason?: string) => {
    try {
      const updated = await api<ChatMessage['ackRequest']>(
        `/chat-ack-requests/${requestId}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      setItems((prev) =>
        prev.map((item) =>
          item.ackRequest?.id === requestId
            ? {
                ...item,
                ackRequest: isAckRequest(updated) ? updated : item.ackRequest,
              }
            : item,
        ),
      );
      setMessage('確認依頼を撤回しました');
    } catch (err) {
      console.error('Failed to cancel ack request.', err);
      setMessage('確認依頼の撤回に失敗しました');
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
    if (skipNextRoomAutoLoadRef.current) {
      skipNextRoomAutoLoadRef.current = false;
      return;
    }
    loadMessages().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      setMentionCandidates({});
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api<MentionCandidates>(
          `/chat-rooms/${roomId}/mention-candidates`,
          { signal: controller.signal },
        );
        if (!cancelled) {
          setMentionCandidates(res || {});
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('メンション候補の取得に失敗しました', error);
        if (!cancelled) setMentionCandidates({});
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
    };
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

  const copyMessageLink = async (
    mode: 'url' | 'markdown',
    item: Pick<ChatMessage, 'id' | 'createdAt' | 'userId' | 'body'>,
  ) => {
    const hash = buildOpenHash({ kind: 'chat_message', id: item.id });
    const url = `/${hash}`;

    if (mode === 'url') {
      const ok = await copyToClipboard(url);
      setMessage(ok ? 'リンクURLをコピーしました' : 'コピーに失敗しました');
      return;
    }

    const roomLabel = selectedRoom
      ? formatRoomLabel(selectedRoom, currentUserId)
      : roomId;
    const label = escapeMarkdownLinkLabel(
      `${roomLabel} ${new Date(item.createdAt).toLocaleString()} ${item.userId}: ${buildExcerpt(item.body, 80)}`.trim(),
    );
    const markdown = `[${label}](${url})`;
    const ok = await copyToClipboard(markdown);
    setMessage(ok ? 'Markdownリンクをコピーしました' : 'コピーに失敗しました');
  };

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
          <label
            className="row"
            style={{ gap: 6, marginTop: 8, alignItems: 'center' }}
          >
            <input
              type="checkbox"
              checked={showPreview}
              onChange={(e) => setShowPreview(e.target.checked)}
              disabled={isLoading}
            />
            プレビュー
          </label>
          {showPreview && (
            <div
              role="region"
              aria-label="Markdownプレビュー"
              style={{
                marginTop: 8,
                padding: 10,
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                background: '#f8fafc',
              }}
            >
              <div style={{ fontSize: 12, color: '#64748b' }}>プレビュー</div>
              <div style={{ marginTop: 6 }}>
                {renderMessageBody(body.trim() ? body : '（空）')}
              </div>
            </div>
          )}
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
                確認対象グループ(requiredGroupIds)
                <input
                  type="text"
                  value={ackTargetGroupIds}
                  onChange={(e) => setAckTargetGroupIds(e.target.value)}
                  placeholder="group1,group2"
                />
              </label>
              <label>
                確認対象ロール(requiredRoles)
                <input
                  type="text"
                  value={ackTargetRoles}
                  onChange={(e) => setAckTargetRoles(e.target.value)}
                  placeholder="admin,mgmt"
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
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                aria-label="確認対象ユーザ追加"
                type="text"
                list="room-ack-target-users"
                value={ackTargetInput}
                onChange={(e) => setAckTargetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAckTargetUser();
                  }
                }}
                placeholder="確認対象: ユーザID (任意)"
                style={{ flex: '1 1 240px' }}
              />
              <button
                className="button secondary"
                onClick={addAckTargetUser}
                type="button"
              >
                確認対象追加
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {ackTargetUserIds.length}/50
              </span>
            </div>
            <datalist id="room-ack-target-users">
              {(mentionCandidates.users || []).map((user) => (
                <option
                  key={user.userId}
                  value={user.userId}
                  label={user.displayName ? `${user.displayName}` : user.userId}
                />
              ))}
            </datalist>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                aria-label="確認対象グループ追加"
                type="text"
                list="room-ack-target-groups"
                value={ackTargetGroupInput}
                onChange={(e) => setAckTargetGroupInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAckTargetGroup();
                  }
                }}
                placeholder="確認対象: グループID (任意)"
                style={{ flex: '1 1 240px' }}
              />
              <button
                className="button secondary"
                onClick={addAckTargetGroup}
                type="button"
              >
                グループ追加
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {ackTargetGroupIdList.length}/20
              </span>
            </div>
            <datalist id="room-ack-target-groups">
              {(mentionCandidates.groups || []).map((group) => (
                <option key={group.groupId} value={group.groupId} />
              ))}
            </datalist>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                aria-label="確認対象ロール追加"
                type="text"
                list="room-ack-target-roles"
                value={ackTargetRoleInput}
                onChange={(e) => setAckTargetRoleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAckTargetRole();
                  }
                }}
                placeholder="確認対象: ロール (任意)"
                style={{ flex: '1 1 240px' }}
              />
              <button
                className="button secondary"
                onClick={addAckTargetRole}
                type="button"
              >
                ロール追加
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {ackTargetRoleList.length}/20
              </span>
            </div>
            <datalist id="room-ack-target-roles">
              {['admin', 'mgmt', 'exec', 'hr'].map((role) => (
                <option key={role} value={role} />
              ))}
            </datalist>
            {(ackTargetUserIds.length > 0 ||
              ackTargetGroupIdList.length > 0 ||
              ackTargetRoleList.length > 0) && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {ackTargetUserIds.map((userId) => (
                  <button
                    key={userId}
                    type="button"
                    className="badge"
                    aria-label={`確認対象から除外: ${userId}`}
                    onClick={() => removeAckTargetUser(userId)}
                    style={{ cursor: 'pointer' }}
                  >
                    {userId} ×
                  </button>
                ))}
                {ackTargetGroupIdList.map((groupId) => (
                  <button
                    key={groupId}
                    type="button"
                    className="badge"
                    aria-label={`確認対象グループから除外: ${groupId}`}
                    onClick={() => removeAckTargetGroup(groupId)}
                    style={{ cursor: 'pointer' }}
                  >
                    group:{groupId} ×
                  </button>
                ))}
                {ackTargetRoleList.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="badge"
                    aria-label={`確認対象ロールから除外: ${role}`}
                    onClick={() => removeAckTargetRole(role)}
                    style={{ cursor: 'pointer' }}
                  >
                    role:{role} ×
                  </button>
                ))}
                <button
                  className="button secondary"
                  onClick={resetAckTargets}
                  type="button"
                >
                  確認対象クリア
                </button>
              </div>
            )}
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
                            onClick={() => {
                              if (!window.confirm('OKを取り消しますか？'))
                                return;
                              revokeAck(ackRequest.id).catch(() => undefined);
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

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <strong>横断検索（チャット全体）</strong>
        <div
          className="row"
          style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
        >
          <label>
            横断検索（本文）
            <input
              type="text"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="keyword"
            />
          </label>
          <button
            className="button secondary"
            onClick={() => loadGlobalSearch()}
            disabled={globalLoading}
          >
            検索
          </button>
          <button
            className="button secondary"
            onClick={() => {
              setGlobalQuery('');
              setGlobalItems([]);
              setGlobalHasMore(false);
              setGlobalMessage('');
            }}
            disabled={globalLoading}
          >
            クリア
          </button>
        </div>

        {globalMessage && (
          <div style={{ color: '#dc2626', marginTop: 6 }}>{globalMessage}</div>
        )}
        {globalLoading && <div style={{ marginTop: 8 }}>検索中...</div>}

        <div
          className="list"
          style={{ display: 'grid', gap: 8, marginTop: 12 }}
        >
          {globalItems.map((item) => {
            const createdAt = new Date(item.createdAt).toLocaleString();
            const roomLabel = formatRoomLabel(item.room, currentUserId);
            const excerpt = buildExcerpt(item.body);
            return (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{roomLabel}</strong>
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {createdAt} / {item.userId}
                    </div>
                    {excerpt && (
                      <div
                        style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                      >
                        {excerpt}
                      </div>
                    )}
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => openSearchResult(item)}
                  >
                    開く
                  </button>
                </div>
              </div>
            );
          })}
          {globalItems.length === 0 && !globalLoading && (
            <div className="card" style={{ padding: 12 }}>
              検索結果なし
            </div>
          )}
        </div>

        {globalHasMore && (
          <button
            className="button secondary"
            style={{ marginTop: 12 }}
            onClick={() => loadGlobalSearch({ append: true })}
            disabled={globalLoading}
          >
            さらに読み込む
          </button>
        )}
      </div>
    </div>
  );
};
