import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { getAuthState } from '../api';
import {
  Combobox,
  MentionComposer,
  type AttachmentRecord,
  type ComboboxItem,
  type MentionTarget,
  UndoToast,
} from '../ui';
import { copyToClipboard } from '../utils/clipboard';
import { buildOpenHash } from '../utils/deepLink';
import { resolveAttachmentKind } from '../utils/attachments';
import {
  WorkflowMetricGrid,
  WorkflowPageHeader,
  WorkflowPanel,
} from './workflowUx';
import {
  buildBeforeForCreatedAt,
  buildDisplayedRooms,
  buildExcerpt,
  escapeMarkdownLinkLabel,
  formatRoomLabel,
  isAckRequest,
  markdownAllowedElements,
  normalizeStringArray,
  parseTags,
  parseUserIds,
  sanitizeFilename,
  transformLinkUri,
  type ChatMessage,
  type ChatSearchItem,
} from './room-chat/roomChatModel';
import {
  ackRequest,
  cancelAckRequestById,
  createDmRoom,
  createPrivateGroupRoom,
  downloadMessageAttachment,
  inviteChatRoomMembers,
  postMessageReaction,
  postRoomAckRequest,
  postRoomMessage,
  previewRoomAckTargets,
  revokeAckRequest,
  summarizeRoomMessages,
  summarizeRoomMessagesWithExternalAi,
  uploadMessageAttachment,
} from './room-chat/roomChatApi';
import { RoomGlobalSearch } from './room-chat/RoomGlobalSearch';
import { RoomMessageList } from './room-chat/RoomMessageList';
import {
  useRoomChatAckCandidates,
  useRoomChatMentionCandidates,
} from './room-chat/useRoomChatCandidates';
import { useRoomChatGlobalSearch } from './room-chat/useRoomChatGlobalSearch';
import { useRoomChatMessages } from './room-chat/useRoomChatMessages';
import { useRoomChatNotificationSetting } from './room-chat/useRoomChatNotificationSetting';
import { useRoomChatRooms } from './room-chat/useRoomChatRooms';

export const RoomChat: React.FC = () => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const authGroupIds = new Set(
    [
      ...(Array.isArray(auth?.groupIds) ? auth.groupIds : []),
      ...(Array.isArray(auth?.groupAccountIds) ? auth.groupAccountIds : []),
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const currentUserId = auth?.userId || 'demo-user';
  const canUseGeneralAffairsInbox = authGroupIds.has('general_affairs');
  const canSeeAllMeta =
    roles.includes('admin') || roles.includes('mgmt') || roles.includes('exec');

  const {
    rooms,
    roomId,
    setRoomId,
    roomMessage,
    setRoomMessage,
    selectedRoom,
    loadRooms,
    resolveProjectRoom,
  } = useRoomChatRooms({ canSeeAllMeta });
  const [postWarning, setPostWarning] = useState('');
  const [roomListScope, setRoomListScope] = useState<'all' | 'ga_personal'>(
    'all',
  );
  const [roomListQuery, setRoomListQuery] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [pendingOpenMessage, setPendingOpenMessage] = useState<{
    roomId: string;
    messageId: string;
    createdAt: string;
  } | null>(null);
  const currentRoomIdRef = useRef('');
  const skipNextRoomAutoLoadRef = useRef(false);
  const isPostingRef = useRef(false);

  useEffect(() => {
    currentRoomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    setPostWarning('');
  }, [roomId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId?: unknown }>).detail;
      const nextRoomId =
        detail && typeof detail.roomId === 'string' ? detail.roomId : '';
      if (!nextRoomId) return;
      setRoomListScope('all');
      setRoomListQuery('');
      setRoomId(nextRoomId);
    };
    window.addEventListener('erp4_open_room_chat', handler as EventListener);
    return () => {
      window.removeEventListener(
        'erp4_open_room_chat',
        handler as EventListener,
      );
    };
  }, [setRoomId]);

  const {
    items,
    setItems,
    hasMore,
    isLoading,
    isLoadingMore,
    message,
    setMessage,
    unreadCount,
    highlightSince,
    loadMessages,
  } = useRoomChatMessages({ roomId, filterQuery, filterTag });
  const [nowMs, setNowMs] = useState(0);
  const [summary, setSummary] = useState('');
  const [summaryProvider, setSummaryProvider] = useState('');
  const [summaryModel, setSummaryModel] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSummarizingExternal, setIsSummarizingExternal] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  const [body, setBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [tags, setTags] = useState('');
  const [ackTargets, setAckTargets] = useState('');
  const [ackTargetInput, setAckTargetInput] = useState('');
  const [ackTargetGroupIds, setAckTargetGroupIds] = useState('');
  const [ackTargetRoles, setAckTargetRoles] = useState('');
  const [ackTargetRoleInput, setAckTargetRoleInput] = useState('');
  const [ackPreview, setAckPreview] = useState<{
    resolvedUserIds: string[];
    resolvedCount: number;
    exceedsLimit: boolean;
    invalidUserIds: string[];
    reason?: string;
  } | null>(null);
  const [ackPreviewMessage, setAckPreviewMessage] = useState('');
  const [ackPreviewLoading, setAckPreviewLoading] = useState(false);
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [mentionGroupIds, setMentionGroupIds] = useState<string[]>([]);
  const [mentionAll, setMentionAll] = useState(false);
  const [mentionUserLabelOverrides, setMentionUserLabelOverrides] = useState<
    Record<string, string>
  >({});
  const [mentionGroupLabelOverrides, setMentionGroupLabelOverrides] = useState<
    Record<string, string>
  >({});
  const [ackGroupLabelOverrides, setAckGroupLabelOverrides] = useState<
    Record<string, string>
  >({});
  const { mentionCandidates, fetchMentionComposerCandidates } =
    useRoomChatMentionCandidates(roomId);
  const { ackCandidates, ackCandidateQuery, setAckCandidateQuery } =
    useRoomChatAckCandidates(roomId);
  const mentionUserLabelMap = useMemo(() => {
    return new Map(
      (mentionCandidates.users || []).map((user) => [
        user.userId,
        user.displayName ? user.displayName.trim() : '',
      ]),
    );
  }, [mentionCandidates.users]);
  const mentionGroupLabelMap = useMemo(() => {
    return new Map(
      (mentionCandidates.groups || []).map((group) => [
        group.groupId,
        group.displayName ? group.displayName.trim() : '',
      ]),
    );
  }, [mentionCandidates.groups]);
  const ackGroupLabelMap = useMemo(() => {
    return new Map(
      (ackCandidates.groups || []).map((group) => [
        group.groupId,
        group.displayName ? group.displayName.trim() : '',
      ]),
    );
  }, [ackCandidates.groups]);
  const formatAckGroupLabel = useCallback(
    (groupId: string) => {
      const label =
        ackGroupLabelOverrides[groupId] ||
        ackGroupLabelMap.get(groupId) ||
        mentionGroupLabelMap.get(groupId);
      return label ? label : groupId;
    },
    [ackGroupLabelMap, ackGroupLabelOverrides, mentionGroupLabelMap],
  );
  const formatAckGroupAria = useCallback(
    (groupId: string) => {
      const label =
        ackGroupLabelOverrides[groupId] ||
        ackGroupLabelMap.get(groupId) ||
        mentionGroupLabelMap.get(groupId);
      if (label && label !== groupId) {
        if (label.includes(groupId)) {
          return label;
        }
        return `${label} (${groupId})`;
      }
      return groupId;
    },
    [ackGroupLabelMap, ackGroupLabelOverrides, mentionGroupLabelMap],
  );
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [pendingUndoRevokeAck, setPendingUndoRevokeAck] = useState<{
    requestId: string;
  } | null>(null);

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
  const mentionTargets = useMemo<MentionTarget[]>(
    () =>
      [
        ...mentionUserIds.map((userId) => ({
          id: userId,
          kind: 'user' as const,
          label:
            mentionUserLabelOverrides[userId] ||
            mentionUserLabelMap.get(userId) ||
            userId,
        })),
        ...mentionGroupIds.map((groupId) => ({
          id: groupId,
          kind: 'group' as const,
          label:
            mentionGroupLabelOverrides[groupId] ||
            mentionGroupLabelMap.get(groupId) ||
            groupId,
        })),
      ].slice(0, 70),
    [
      mentionGroupIds,
      mentionGroupLabelMap,
      mentionGroupLabelOverrides,
      mentionUserIds,
      mentionUserLabelMap,
      mentionUserLabelOverrides,
    ],
  );
  const ackGroupTargets = useMemo<MentionTarget[]>(
    () =>
      ackTargetGroupIdList.map((groupId) => ({
        id: groupId,
        kind: 'group' as const,
        label: formatAckGroupLabel(groupId),
      })),
    [ackTargetGroupIdList, formatAckGroupLabel],
  );
  const requiredAckUsers = useMemo<MentionTarget[]>(
    () =>
      ackTargetUserIds.map((userId) => ({
        id: userId,
        kind: 'user' as const,
        label: userId,
      })),
    [ackTargetUserIds],
  );
  const requiredAckRoles = useMemo<MentionTarget[]>(
    () =>
      ackTargetRoleList.map((role) => ({
        id: role,
        kind: 'role' as const,
        label: role,
      })),
    [ackTargetRoleList],
  );
  const ackTargetUserItems = useMemo<ComboboxItem[]>(
    () =>
      (ackCandidates.users || []).map((user) => ({
        id: user.userId,
        value: user.userId,
        label: user.displayName
          ? `${user.displayName} (${user.userId})`
          : user.userId,
        description: user.displayName ? user.userId : undefined,
      })),
    [ackCandidates.users],
  );
  const ackTargetRoleItems = useMemo<ComboboxItem[]>(
    () =>
      ['admin', 'mgmt', 'exec', 'hr'].map((role) => ({
        id: role,
        value: role,
        label: role,
      })),
    [],
  );
  const composerAttachments = useMemo<AttachmentRecord[]>(
    () =>
      attachmentFile
        ? [
            {
              id: `composer-${attachmentFile.name}-${attachmentFile.size}`,
              name: attachmentFile.name,
              size: attachmentFile.size,
              mimeType: attachmentFile.type || 'application/octet-stream',
              kind: resolveAttachmentKind(attachmentFile.type),
              status: 'queued',
            },
          ]
        : [],
    [attachmentFile],
  );

  useEffect(() => {
    setAckPreview(null);
    setAckPreviewMessage('');
  }, [ackTargets, ackTargetGroupIds, ackTargetRoles, roomId]);

  const formatAckPreviewReason = (reason?: string) => {
    switch (reason) {
      case 'required_users_empty':
        return '確認対象が空です';
      case 'required_users_inactive':
        return '無効なユーザが含まれています';
      case 'required_users_forbidden':
        return '閲覧権限のないユーザが含まれています';
      case 'required_users_invalid':
        return '無効/権限外のユーザが含まれています';
      case 'room_group_required':
        return 'ルームのグループ設定が必要です';
      case 'room_deleted':
        return 'ルームが削除されています';
      default:
        return '';
    }
  };

  const ackPreviewReasonLabel = ackPreview
    ? formatAckPreviewReason(ackPreview.reason)
    : '';
  const ackPreviewInvalidLabel =
    ackPreview && ackPreview.invalidUserIds.length > 0
      ? ackPreview.invalidUserIds.length > 5
        ? `${ackPreview.invalidUserIds.slice(0, 5).join(', ')}...`
        : ackPreview.invalidUserIds.join(', ')
      : '';

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
        setRoomListScope('all');
        setRoomListQuery('');
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
  }, [setRoomId]);

  const {
    globalQuery,
    setGlobalQuery,
    globalItems,
    globalHasMore,
    globalMessage,
    globalLoading,
    loadGlobalSearch,
    clearGlobalSearch,
  } = useRoomChatGlobalSearch();

  const [pendingScrollMessageId, setPendingScrollMessageId] = useState('');
  const [highlightMessageId, setHighlightMessageId] = useState('');

  const {
    notificationSetting,
    setNotificationSetting,
    notificationSettingMessage,
    isNotificationSettingLoading,
    muteUntilInput,
    setMuteUntilInput,
    clearNotificationSetting,
    loadNotificationSetting,
    saveNotificationSetting,
    applyMutePreset,
  } = useRoomChatNotificationSetting({ roomId });

  const [createPrivateName, setCreatePrivateName] = useState('');
  const [createPrivateMembers, setCreatePrivateMembers] = useState('');
  const [createDmPartner, setCreateDmPartner] = useState('');
  const [inviteMembers, setInviteMembers] = useState('');

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      const projectId =
        detail && typeof detail.projectId === 'string' ? detail.projectId : '';
      if (!projectId) return;
      setRoomListScope('all');
      setRoomListQuery('');
      resolveProjectRoom(projectId)
        .then((resolved) => {
          if (resolved) setMessage('');
        })
        .catch(() => undefined);
    };
    window.addEventListener('erp4_open_project_chat', handler as EventListener);
    return () => {
      window.removeEventListener(
        'erp4_open_project_chat',
        handler as EventListener,
      );
    };
  }, [resolveProjectRoom, setMessage]);

  useEffect(() => {
    if (!pendingOpenMessage) return;
    if (pendingOpenMessage.roomId !== roomId) {
      if (pendingOpenMessage.roomId) {
        setRoomId(pendingOpenMessage.roomId);
      }
      return;
    }
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

  useEffect(() => {
    if (!roomId) {
      clearNotificationSetting();
      return;
    }
    loadNotificationSetting(roomId);
  }, [clearNotificationSetting, roomId, loadNotificationSetting]);

  const openSearchResult = (item: ChatSearchItem) => {
    setRoomId(item.room.id);
    setMessage('');
  };

  const downloadAttachment = async (
    attachmentId: string,
    originalName: string,
  ) => {
    const res = await downloadMessageAttachment(attachmentId);
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

  const buildMentionsPayload = () => {
    const users = Array.from(new Set(mentionUserIds))
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 50);
    const groups = Array.from(new Set(mentionGroupIds))
      .map((entry) => entry.trim())
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

  const resetMentionTargets = () => {
    setMentionUserIds([]);
    setMentionGroupIds([]);
    setMentionUserLabelOverrides({});
    setMentionGroupLabelOverrides({});
    setMentionAll(false);
  };

  const clearComposer = () => {
    setBody('');
    setTags('');
    setAttachmentFile(null);
    resetMentionTargets();
  };

  const handleMentionTargetsChange = useCallback((next: MentionTarget[]) => {
    const users = Array.from(
      new Set(
        next
          .filter((target) => target.kind === 'user')
          .map((target) => target.id.trim())
          .filter(Boolean),
      ),
    ).slice(0, 50);
    const groups = Array.from(
      new Set(
        next
          .filter((target) => target.kind === 'group')
          .map((target) => target.id.trim())
          .filter(Boolean),
      ),
    ).slice(0, 20);
    setMentionUserIds(users);
    setMentionGroupIds(groups);
    setMentionUserLabelOverrides(() => {
      const overrides: Record<string, string> = {};
      next
        .filter((target) => target.kind === 'user')
        .forEach((target) => {
          const id = target.id.trim();
          const label = target.label.trim();
          if (!id || !label) return;
          overrides[id] = label;
        });
      return overrides;
    });
    setMentionGroupLabelOverrides(() => {
      const overrides: Record<string, string> = {};
      next
        .filter((target) => target.kind === 'group')
        .forEach((target) => {
          const id = target.id.trim();
          const label = target.label.trim();
          if (!id || !label) return;
          overrides[id] = label;
        });
      return overrides;
    });
  }, []);

  const handleAckGroupTargetsChange = useCallback(
    (next: MentionTarget[]) => {
      const groupTargets = next
        .filter((target) => target.kind === 'group')
        .map((target) => ({
          id: target.id.trim(),
          label: target.label.trim(),
        }))
        .filter((target) => target.id.length > 0);
      const groups = Array.from(
        new Set(groupTargets.map((target) => target.id)),
      ).slice(0, 20);
      const groupSet = new Set(groups);
      setAckTargetGroupIds(groups.join(','));
      setAckGroupLabelOverrides((prev) => {
        const overrides: Record<string, string> = {};
        groupTargets.forEach((target) => {
          if (!groupSet.has(target.id)) return;
          if (!target.label) return;
          overrides[target.id] = target.label;
        });
        groups.forEach((groupId) => {
          if (!overrides[groupId] && prev[groupId]) {
            overrides[groupId] = prev[groupId];
          }
        });
        return overrides;
      });
    },
    [setAckGroupLabelOverrides, setAckTargetGroupIds],
  );

  const addAckTargetUser = (rawValue?: string) => {
    const value = (rawValue ?? ackTargetInput).trim();
    if (!value) return;
    setAckTargets((prev) => {
      const current = parseUserIds(prev);
      const next = Array.from(new Set([...current, value])).slice(0, 50);
      return next.join(',');
    });
    setAckTargetInput('');
    setAckCandidateQuery('');
  };

  const addAckTargetRole = (rawValue?: string) => {
    const value = (rawValue ?? ackTargetRoleInput).trim();
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
    setAckTargetGroupIds(
      current.filter((entry) => entry !== groupId).join(','),
    );
  };

  const removeAckTargetRole = (role: string) => {
    const current = parseUserIds(ackTargetRoles);
    setAckTargetRoles(current.filter((entry) => entry !== role).join(','));
  };

  const resetAckTargets = () => {
    setAckTargets('');
    setAckTargetInput('');
    setAckTargetGroupIds('');
    setAckGroupLabelOverrides({});
    setAckTargetRoles('');
    setAckTargetRoleInput('');
    setAckCandidateQuery('');
  };

  const previewAckTargets = useCallback(async () => {
    if (!roomId) return;
    setAckPreviewLoading(true);
    setAckPreview(null);
    setAckPreviewMessage('');
    const uniqueTargets = ackTargetUserIds;
    const uniqueGroupIds = ackTargetGroupIdList;
    const uniqueRoles = ackTargetRoleList;
    if (
      uniqueTargets.length === 0 &&
      uniqueGroupIds.length === 0 &&
      uniqueRoles.length === 0
    ) {
      setAckPreviewLoading(false);
      setAckPreviewMessage('確認対象を入力してください');
      return;
    }
    try {
      const res = await previewRoomAckTargets(roomId, {
        requiredUserIds: uniqueTargets,
        requiredGroupIds: uniqueGroupIds,
        requiredRoles: uniqueRoles,
      });
      setAckPreview(res);
    } catch (error) {
      console.error('確認対象の展開に失敗しました', error);
      setAckPreviewMessage('確認対象の展開に失敗しました');
    } finally {
      setAckPreviewLoading(false);
    }
  }, [ackTargetGroupIdList, ackTargetRoleList, ackTargetUserIds, roomId]);

  const postMessage = async (mode: 'message' | 'ack') => {
    if (!roomId) return;
    if (isPostingRef.current) return;
    if (!body.trim()) {
      setMessage('本文を入力してください');
      return;
    }
    if (mentionAll) {
      const ok = window.confirm('全員宛(@all)で投稿します。よろしいですか？');
      if (!ok) return;
    }
    try {
      isPostingRef.current = true;
      setIsPosting(true);
      setMessage('');
      const mentions = buildMentionsPayload();
      const basePayload: {
        body: string;
        tags?: string[];
        mentions?: {
          userIds?: string[];
          groupIds?: string[];
          all?: boolean;
        };
      } = {
        body: body.trim(),
        tags: tags.trim() ? parseTags(tags) : undefined,
        mentions,
      };
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
                setMessage(
                  '確認対象（ユーザID/グループ/ロール）を入力してください',
                );
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
      const created =
        mode === 'ack'
          ? await postRoomAckRequest(roomId, payload)
          : await postRoomMessage(roomId, payload);
      if (attachmentFile) {
        await uploadMessageAttachment(created.id, attachmentFile);
      }
      setPostWarning(created.warning?.message || '');
      setBody('');
      setTags('');
      resetAckTargets();
      resetMentionTargets();
      setAttachmentFile(null);
      await loadMessages();
    } catch (err) {
      console.error('Failed to post message.', err);
      setMessage('投稿に失敗しました');
    } finally {
      isPostingRef.current = false;
      setIsPosting(false);
    }
  };

  const addReaction = async (id: string, emoji: string) => {
    try {
      const updated = await postMessageReaction(id, emoji);
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch (err) {
      console.error('Failed to add reaction.', err);
      setMessage('リアクションの更新に失敗しました');
    }
  };

  const ack = async (requestId: string) => {
    try {
      const updated = await ackRequest(requestId);
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
      const updated = await revokeAckRequest(requestId);
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
      const updated = await cancelAckRequestById(requestId, reason);
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
      const created = await createPrivateGroupRoom({
        name: createPrivateName.trim(),
        memberUserIds: memberUserIds.length ? memberUserIds : undefined,
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
      const created = await createDmRoom(createDmPartner.trim());
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
      await inviteChatRoomMembers(roomId, userIds);
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
      const summaryText = await summarizeRoomMessages(roomId);
      setSummaryProvider('');
      setSummaryModel('');
      setSummary(summaryText);
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
      const res = await summarizeRoomMessagesWithExternalAi(roomId, {
        since: since.toISOString(),
        until: now.toISOString(),
      });
      setSummaryProvider(res.provider);
      setSummaryModel(res.model);
      setSummary(res.summary);
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
    if (canUseGeneralAffairsInbox) return;
    setRoomListScope('all');
  }, [canUseGeneralAffairsInbox]);

  const displayedRooms = buildDisplayedRooms(
    rooms,
    currentUserId,
    roomListScope,
    roomListQuery,
  );

  useEffect(() => {
    if (!rooms.length) {
      return;
    }
    const nextDisplayedRooms = buildDisplayedRooms(
      rooms,
      currentUserId,
      roomListScope,
      roomListQuery,
    );
    if (!roomId) {
      if (nextDisplayedRooms.length) {
        setRoomId(nextDisplayedRooms[0].id);
      }
      return;
    }

    const existsInAllRooms = rooms.some((room) => room.id === roomId);
    if (!existsInAllRooms) {
      if (nextDisplayedRooms.length) {
        setRoomId(nextDisplayedRooms[0].id);
      } else {
        setRoomId('');
      }
    }
  }, [currentUserId, roomId, roomListQuery, roomListScope, rooms, setRoomId]);

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

  const selectedRoomLabel = selectedRoom
    ? formatRoomLabel(selectedRoom, currentUserId)
    : roomId || '未選択';
  const activeAckTargetCount =
    ackTargetUserIds.length +
    ackTargetGroupIdList.length +
    ackTargetRoleList.length;
  const chatSummaryItems = [
    {
      label: '選択中ルーム',
      value: selectedRoomLabel,
      helper: selectedRoom
        ? `${selectedRoom.type}${selectedRoom.isMember === false ? ' / 非参加' : ''}`
        : 'ルームを選択すると投稿・検索・通知設定を操作できます。',
      tone: selectedRoom ? ('success' as const) : ('warning' as const),
    },
    {
      label: '未読',
      value: `${unreadCount}件`,
      helper: highlightSince
        ? `最終既読: ${highlightSince.toLocaleString()}`
        : '未読状態を読み込み中または未設定です。',
      tone: unreadCount > 0 ? ('warning' as const) : ('default' as const),
    },
    {
      label: '表示メッセージ',
      value: `${items.length}件`,
      helper: hasMore
        ? '追加読み込み可能です。'
        : '現在の条件で読み込んだ件数です。',
    },
    {
      label: '確認対象',
      value: `${activeAckTargetCount}件`,
      helper:
        activeAckTargetCount > 0
          ? '確認依頼の対象が設定されています。'
          : '必要に応じてユーザ・グループ・ロールを指定します。',
    },
    {
      label: '横断検索結果',
      value: `${globalItems.length}件`,
      helper: globalHasMore
        ? '横断検索に続きがあります。'
        : 'チャット全体の検索結果件数です。',
    },
  ];

  return (
    <div>
      <WorkflowPageHeader
        title="チャット（全社/部門/private_group/DM）"
        description="ルーム選択、投稿、確認依頼、通知設定、横断検索を同じ文脈で扱い、会話とガバナンス操作を分離して確認できます。"
      />
      <WorkflowMetricGrid
        ariaLabel="チャット運用サマリー"
        items={chatSummaryItems}
      />
      {roomMessage && <p>{roomMessage}</p>}
      <WorkflowPanel
        title="ルーム選択と要約"
        description="表示範囲、検索、選択中ルーム、未読、要約操作をまとめて確認します。"
      >
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {canUseGeneralAffairsInbox && (
            <label>
              表示範囲
              <select
                value={roomListScope}
                onChange={(e) =>
                  setRoomListScope(
                    e.target.value === 'ga_personal' ? 'ga_personal' : 'all',
                  )
                }
              >
                <option value="all">全ルーム</option>
                <option value="ga_personal">総務相談のみ</option>
              </select>
            </label>
          )}
          <label>
            ルーム検索
            <input
              type="text"
              value={roomListQuery}
              onChange={(e) => setRoomListQuery(e.target.value)}
              placeholder="ルーム名/種別"
            />
          </label>
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
          {selectedRoom?.allowExternalIntegrations === true && (
            <button
              className="button secondary"
              onClick={summarizeExternal}
              disabled={!roomId || isSummarizingExternal}
            >
              {isSummarizingExternal ? '外部要約中...' : '外部要約'}
            </button>
          )}
        </div>
      </WorkflowPanel>

      {roomId && notificationSetting && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <strong>通知設定</strong>
          {notificationSettingMessage && (
            <div style={{ marginTop: 8 }}>{notificationSettingMessage}</div>
          )}
          <div
            className="row"
            style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
          >
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={notificationSetting.notifyAllPosts}
                onChange={(e) =>
                  setNotificationSetting((prev) =>
                    prev ? { ...prev, notifyAllPosts: e.target.checked } : prev,
                  )
                }
                disabled={isNotificationSettingLoading}
              />
              全投稿通知
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={notificationSetting.notifyMentions}
                onChange={(e) =>
                  setNotificationSetting((prev) =>
                    prev ? { ...prev, notifyMentions: e.target.checked } : prev,
                  )
                }
                disabled={isNotificationSettingLoading}
              />
              メンション通知
            </label>
          </div>
          <div
            className="row"
            style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
          >
            <label>
              ミュート期限（任意）
              <input
                type="datetime-local"
                value={muteUntilInput}
                onChange={(e) => setMuteUntilInput(e.target.value)}
                disabled={isNotificationSettingLoading}
              />
            </label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                className="button secondary"
                type="button"
                onClick={() => applyMutePreset(10)}
                disabled={isNotificationSettingLoading}
              >
                10分
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => applyMutePreset(60)}
                disabled={isNotificationSettingLoading}
              >
                1時間
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => applyMutePreset(1440)}
                disabled={isNotificationSettingLoading}
              >
                1日
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => applyMutePreset(null)}
                disabled={isNotificationSettingLoading}
              >
                解除
              </button>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              className="button"
              type="button"
              onClick={saveNotificationSetting}
              disabled={isNotificationSettingLoading}
            >
              保存
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
            ルームごとの通知設定は保存後の投稿から反映されます。
          </div>
        </div>
      )}

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
          {postWarning && (
            <div style={{ marginTop: 8, color: '#b45309' }}>{postWarning}</div>
          )}
          <label
            className="row"
            style={{ gap: 6, marginTop: 8, alignItems: 'center' }}
          >
            <input
              type="checkbox"
              checked={showPreview}
              onChange={(e) => setShowPreview(e.target.checked)}
              disabled={isLoading || isPosting}
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
            <MentionComposer
              body={body}
              onBodyChange={setBody}
              mentions={mentionTargets}
              onMentionsChange={handleMentionTargetsChange}
              groups={ackGroupTargets}
              onGroupsChange={handleAckGroupTargetsChange}
              requiredUsers={requiredAckUsers}
              requiredRoles={requiredAckRoles}
              attachments={composerAttachments}
              onAddFiles={(files) => setAttachmentFile(files[0] || null)}
              onRemoveAttachment={() => setAttachmentFile(null)}
              fetchCandidates={fetchMentionComposerCandidates}
              onSubmit={() => postMessage('message')}
              onCancel={clearComposer}
              placeholder="Markdownで入力"
              mentionPlaceholder="メンション対象を検索（ユーザ/グループ）"
              groupPlaceholder="確認対象グループを検索"
              submitLabel={isPosting ? '送信中...' : '送信'}
              cancelLabel="クリア"
              requiredSectionLabel="確認依頼の対象"
              disabled={isLoading || isPosting}
              limits={{ maxBodyLength: 2000, maxMentions: 70, maxGroups: 20 }}
            />
            {(mentionCandidates.allowAll ?? true) && (
              <label>
                <input
                  type="checkbox"
                  checked={mentionAll}
                  onChange={(event) => setMentionAll(event.target.checked)}
                />{' '}
                全員にメンション (@all)
              </label>
            )}
            {mentionAll && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="badge"
                  aria-label="全員へのメンションを解除"
                  onClick={() => setMentionAll(false)}
                  style={{ cursor: 'pointer' }}
                >
                  @all ×
                </button>
                <button
                  className="button secondary"
                  onClick={resetMentionTargets}
                  type="button"
                >
                  メンション解除
                </button>
              </div>
            )}
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
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Combobox
                placeholder="確認対象: ユーザID (任意)"
                value={ackTargetInput}
                onChange={(value) => {
                  setAckTargetInput(value);
                  setAckCandidateQuery(value);
                }}
                items={ackTargetUserItems}
                onSelect={(item) => addAckTargetUser(item.value ?? item.id)}
                fullWidth
                inputProps={{ 'aria-label': '確認対象ユーザ追加' }}
              />
              <button
                className="button secondary"
                onClick={() => addAckTargetUser()}
                type="button"
              >
                確認対象追加
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {ackTargetUserIds.length}/50
              </span>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
              メッセージ作成欄の「確認対象グループを検索」でも追加できます（
              {ackTargetGroupIdList.length}/20）
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Combobox
                placeholder="確認対象: ロール (任意)"
                value={ackTargetRoleInput}
                onChange={(value) => setAckTargetRoleInput(value)}
                items={ackTargetRoleItems}
                onSelect={(item) => addAckTargetRole(item.value ?? item.id)}
                fullWidth
                inputProps={{ 'aria-label': '確認対象ロール追加' }}
              />
              <button
                className="button secondary"
                onClick={() => addAckTargetRole()}
                type="button"
              >
                ロール追加
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {ackTargetRoleList.length}/20
              </span>
            </div>
            <div
              className="row"
              style={{
                gap: 8,
                marginTop: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button
                className="button secondary"
                onClick={previewAckTargets}
                type="button"
                disabled={ackPreviewLoading}
              >
                対象者を確認
              </button>
              {ackPreviewLoading && (
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  確認中...
                </span>
              )}
              {ackPreview && (
                <span style={{ fontSize: 12, color: '#475569' }}>
                  展開対象: {ackPreview.resolvedCount}人
                  {ackPreview.exceedsLimit ? '（上限超過）' : ''}
                </span>
              )}
              {ackPreviewReasonLabel && (
                <span style={{ fontSize: 12, color: '#b45309' }}>
                  {ackPreviewReasonLabel}
                </span>
              )}
              {ackPreviewInvalidLabel && (
                <span style={{ fontSize: 12, color: '#b45309' }}>
                  無効: {ackPreviewInvalidLabel}
                </span>
              )}
              {ackPreviewMessage && (
                <span style={{ fontSize: 12, color: '#b45309' }}>
                  {ackPreviewMessage}
                </span>
              )}
            </div>
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
                    aria-label={`確認対象グループから除外: ${formatAckGroupAria(
                      groupId,
                    )}`}
                    onClick={() => removeAckTargetGroup(groupId)}
                    style={{ cursor: 'pointer' }}
                  >
                    group:{formatAckGroupLabel(groupId)} ×
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
                className="button secondary"
                onClick={() => postMessage('ack')}
                disabled={isLoading || isPosting}
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
      {pendingUndoRevokeAck && (
        <UndoToast
          title="OK取消を保留しています"
          description="数秒後に確定します。取り消す場合はUndoを押してください。"
          severity="warning"
          durationMs={5000}
          labels={{ undo: '取り消す' }}
          onUndo={() => {
            setPendingUndoRevokeAck(null);
            setMessage('OK取消を中止しました');
          }}
          onCommit={() => {
            const target = pendingUndoRevokeAck;
            if (!target) return;
            setPendingUndoRevokeAck(null);
            revokeAck(target.requestId).catch(() => undefined);
          }}
          onDismiss={() => {
            setPendingUndoRevokeAck(null);
          }}
        />
      )}

      <RoomMessageList
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        filterTag={filterTag}
        setFilterTag={setFilterTag}
        loadMessages={loadMessages}
        roomId={roomId}
        isLoading={isLoading}
        items={items}
        highlightSince={highlightSince}
        highlightMessageId={highlightMessageId}
        nowMs={nowMs}
        currentUserId={currentUserId}
        roles={roles}
        renderMessageBody={renderMessageBody}
        copyMessageLink={copyMessageLink}
        addReaction={addReaction}
        ack={ack}
        pendingUndoRevokeAck={pendingUndoRevokeAck}
        setPendingUndoRevokeAck={setPendingUndoRevokeAck}
        cancelAckRequest={cancelAckRequest}
        downloadAttachment={downloadAttachment}
        setMessage={setMessage}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
      />

      <RoomGlobalSearch
        globalQuery={globalQuery}
        setGlobalQuery={setGlobalQuery}
        loadGlobalSearch={loadGlobalSearch}
        globalLoading={globalLoading}
        clearGlobalSearch={clearGlobalSearch}
        globalMessage={globalMessage}
        globalItems={globalItems}
        globalHasMore={globalHasMore}
        openSearchResult={openSearchResult}
        currentUserId={currentUserId}
      />
    </div>
  );
};
