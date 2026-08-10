import { api as requestApi, apiResponse } from '../../api';
import type {
  ChatAckRequestIdentity,
  ChatMessage,
  ChatRoom,
  ChatSearchItem,
  ChatThread,
} from './roomChatModel';
import {
  normalizeChatMessage,
  normalizeChatRoom,
  normalizeChatSearchItem,
  normalizeChatThread,
  normalizeAckRequest,
  normalizeMentionCandidates,
} from './roomChatModel';

export type NotificationSetting = {
  notifyAllPosts: boolean;
  notifyMentions: boolean;
  muteUntil: string | null;
};

export type AckPreview = {
  resolvedUserIds: string[];
  resolvedCount: number;
  exceedsLimit: boolean;
  invalidUserIds: string[];
  reason?: string;
};

const ackPreviewReasons = new Set([
  'required_users_empty',
  'required_users_inactive',
  'required_users_forbidden',
  'required_users_invalid',
  'room_group_required',
  'room_deleted',
]);

function normalizeAckPreviewIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid ack preview response');
  if (value.length > limit) throw new Error('Invalid ack preview response');
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('Invalid ack preview response');
    }
    const id = entry.trim();
    if (!id || Array.from(id).length > 200) {
      throw new Error('Invalid ack preview response');
    }
    return id;
  });
  return Array.from(new Set(normalized));
}

function normalizeAckPreview(value: unknown): AckPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid ack preview response');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.resolvedCount !== 'number' ||
    !Number.isSafeInteger(record.resolvedCount) ||
    record.resolvedCount < 0 ||
    typeof record.exceedsLimit !== 'boolean'
  ) {
    throw new Error('Invalid ack preview response');
  }
  const reason =
    typeof record.reason === 'string' && ackPreviewReasons.has(record.reason)
      ? record.reason
      : undefined;
  return {
    resolvedUserIds: normalizeAckPreviewIds(record.resolvedUserIds, 50),
    resolvedCount: record.resolvedCount,
    exceedsLimit: record.exceedsLimit,
    invalidUserIds: normalizeAckPreviewIds(record.invalidUserIds, 20),
    ...(reason ? { reason } : {}),
  };
}

export type RoomMessageQuery = {
  before?: string;
  limit: number;
  query?: string;
  tag?: string;
};

export type MessageBoundary = {
  through: string;
  throughMessageId: string;
};

export type ChatSearchPage = {
  items: ChatSearchItem[];
  nextBefore: string | null;
  nextBeforeId: string | null;
};

export type ChatMessageIdentity = Pick<
  ChatMessage,
  'id' | 'roomId' | 'parentMessageId' | 'threadRootId'
>;

const postWithoutViewWarning = {
  code: 'POST_WITHOUT_VIEW',
  message:
    '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
} as const;

class ChatRequestError extends Error {
  readonly isDefiniteFailure: boolean;
  readonly status: number | null;

  constructor(status: number | null) {
    super('Chat request failed');
    this.name = 'ChatRequestError';
    this.status = status;
    this.isDefiniteFailure = status !== null && status >= 400 && status < 500;
  }
}

function httpStatusFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : '';
  const statusMatch = message.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : NaN;
  return Number.isInteger(status) ? status : null;
}

export function isDefiniteChatRequestFailure(error: unknown): boolean {
  return error instanceof ChatRequestError && error.isDefiniteFailure;
}

export function isUnavailableChatRequestFailure(error: unknown): boolean {
  return (
    error instanceof ChatRequestError &&
    (error.status === 403 || error.status === 404)
  );
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return options
      ? await requestApi<T>(path, options)
      : await requestApi<T>(path);
  } catch (error) {
    // Existing shared callers retain their diagnostics contract. The chat UI
    // boundary never exposes request paths or backend bodies to its callers.
    throw new ChatRequestError(httpStatusFromError(error));
  }
}

function normalizedMessageOrThrow(value: unknown): ChatMessage {
  const normalized = normalizeChatMessage(value);
  if (!normalized) throw new Error('Invalid chat message response');
  return normalized;
}

function normalizedAckRequestOrThrow(
  value: unknown,
  expected: ChatAckRequestIdentity,
) {
  const normalized = normalizeAckRequest(value, expected);
  if (!normalized) {
    throw new Error('Invalid chat ack response');
  }
  return normalized;
}

function matchesMessageIdentity(
  message: ChatMessage,
  expected: ChatMessageIdentity,
): boolean {
  return (
    message.id === expected.id &&
    message.roomId === expected.roomId &&
    message.parentMessageId === expected.parentMessageId &&
    message.threadRootId === expected.threadRootId
  );
}

function isRootMessageForRoom(message: ChatMessage, roomId: string): boolean {
  return (
    message.roomId === roomId &&
    message.parentMessageId === null &&
    message.threadRootId === null
  );
}

function normalizedPostedMessageOrThrow(
  value: unknown,
  expected: { roomId: string; parentMessageId: string | null },
  invalidResponseMessage = 'Invalid posted chat message response',
) {
  const message = normalizedMessageOrThrow(value);
  if (
    message.roomId !== expected.roomId ||
    message.parentMessageId !== expected.parentMessageId ||
    message.threadRootId !== expected.parentMessageId
  ) {
    throw new Error(invalidResponseMessage);
  }
  const record = value as { warning?: unknown };
  const warning =
    record.warning && typeof record.warning === 'object'
      ? (record.warning as Record<string, unknown>)
      : null;
  return {
    ...message,
    ...(warning?.code === postWithoutViewWarning.code
      ? { warning: postWithoutViewWarning }
      : {}),
  };
}

export async function fetchChatRooms(options?: RequestInit) {
  const res = await api<{ items?: unknown[] }>('/chat-rooms', options);
  return Array.isArray(res.items)
    ? res.items
        .map(normalizeChatRoom)
        .filter((room): room is ChatRoom => room !== null)
    : [];
}

export async function fetchRoomNotificationSetting(
  roomId: string,
): Promise<NotificationSetting> {
  const res = await api<{
    notifyAllPosts?: boolean;
    notifyMentions?: boolean;
    muteUntil?: string | null;
  }>(`/chat-rooms/${roomId}/notification-setting`);
  return normalizeNotificationSetting(res);
}

export async function patchRoomNotificationSetting(
  roomId: string,
  setting: NotificationSetting,
): Promise<NotificationSetting> {
  const res = await api<{
    notifyAllPosts?: boolean;
    notifyMentions?: boolean;
    muteUntil?: string | null;
  }>(`/chat-rooms/${roomId}/notification-setting`, {
    method: 'PATCH',
    body: JSON.stringify(setting),
  });
  return normalizeNotificationSetting(res);
}

export async function fetchRoomUnreadState(
  roomId: string,
  signal?: AbortSignal,
) {
  const res = await api<{ unreadCount?: number; lastReadAt?: string | null }>(
    `/chat-rooms/${roomId}/unread`,
    { signal },
  );
  return {
    unreadCount: typeof res.unreadCount === 'number' ? res.unreadCount : 0,
    lastReadAt: typeof res.lastReadAt === 'string' ? res.lastReadAt : null,
  };
}

export async function markRoomRead(roomId: string, boundary?: MessageBoundary) {
  await api(`/chat-rooms/${roomId}/read`, {
    method: 'POST',
    ...(boundary
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(boundary),
        }
      : {}),
  });
}

export async function fetchRoomMessages(
  roomId: string,
  input: RoomMessageQuery,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  query.set('limit', String(input.limit));
  if (input.before) query.set('before', input.before);
  if (input.tag?.trim()) query.set('tag', input.tag.trim());
  if (input.query?.trim()) query.set('q', input.query.trim());

  const path = `/chat-rooms/${roomId}/messages?${query.toString()}`;
  const res = signal
    ? await api<{ items?: unknown[] }>(path, { signal })
    : await api<{ items?: unknown[] }>(path);
  if (!Array.isArray(res.items)) return [];
  return res.items.map((item) => {
    const message = normalizeChatMessage(item);
    if (!message || !isRootMessageForRoom(message, roomId)) {
      throw new Error('Invalid room message response');
    }
    return message;
  });
}

export async function searchChatMessages(input: {
  query: string;
  before?: string;
  beforeId?: string;
  limit: number;
  signal?: AbortSignal;
}): Promise<ChatSearchPage> {
  const query = new URLSearchParams();
  query.set('q', input.query.trim());
  query.set('limit', String(input.limit));
  if (input.before) query.set('before', input.before);
  if (input.beforeId) query.set('beforeId', input.beforeId);
  const path = `/chat-messages/search?${query.toString()}`;
  const res = input.signal
    ? await api<{
        items?: unknown[];
        nextBefore?: unknown;
        nextBeforeId?: unknown;
      }>(path, { signal: input.signal })
    : await api<{
        items?: unknown[];
        nextBefore?: unknown;
        nextBeforeId?: unknown;
      }>(path);
  return {
    items: Array.isArray(res.items)
      ? res.items
          .map(normalizeChatSearchItem)
          .filter((item): item is ChatSearchItem => item !== null)
      : [],
    nextBefore: typeof res.nextBefore === 'string' ? res.nextBefore : null,
    nextBeforeId:
      typeof res.nextBeforeId === 'string' ? res.nextBeforeId : null,
  };
}

export async function fetchChatThread(
  messageId: string,
  input: { limit: number; cursor?: string; signal?: AbortSignal },
): Promise<ChatThread> {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) query.set('cursor', input.cursor);
  const response = await api<unknown>(
    `/chat-messages/${messageId}/thread?${query.toString()}`,
    { signal: input.signal },
  );
  const normalized = normalizeChatThread(response);
  if (!normalized) throw new Error('Invalid chat thread response');
  return normalized;
}

export async function postThreadReply(
  expected: { rootMessageId: string; roomId: string },
  payload: {
    body: string;
    tags?: string[];
    mentions?: {
      userIds?: string[];
      groupIds?: string[];
      all?: boolean;
    };
  },
) {
  const response = await api<unknown>(
    `/chat-messages/${expected.rootMessageId}/replies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return normalizedPostedMessageOrThrow(
    response,
    {
      roomId: expected.roomId,
      parentMessageId: expected.rootMessageId,
    },
    'Invalid thread reply response',
  );
}

export async function deleteChatMessage(
  messageId: string,
  reason: 'user_retract' | 'admin_moderation',
) {
  await api(`/chat-messages/${messageId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function fetchMentionCandidates(
  roomId: string,
  signal?: AbortSignal,
) {
  const response = await api<unknown>(
    `/chat-rooms/${roomId}/mention-candidates`,
    { signal },
  );
  return normalizeMentionCandidates(response);
}

export async function fetchAckCandidates(
  roomId: string,
  query: string,
  signal?: AbortSignal,
) {
  const response = await api<unknown>(
    `/chat-rooms/${roomId}/ack-candidates?q=${encodeURIComponent(query)}`,
    { signal },
  );
  return normalizeMentionCandidates(response);
}

export async function previewRoomAckTargets(
  roomId: string,
  input: {
    requiredUserIds: string[];
    requiredGroupIds: string[];
    requiredRoles: string[];
  },
) {
  const response = await api<unknown>(
    `/chat-rooms/${roomId}/ack-requests/preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return normalizeAckPreview(response);
}

export async function postRoomMessage(
  roomId: string,
  payload: {
    body: string;
    tags?: string[];
    mentions?: {
      userIds?: string[];
      groupIds?: string[];
      all?: boolean;
    };
  },
) {
  const response = await api<unknown>(`/chat-rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return normalizedPostedMessageOrThrow(response, {
    roomId,
    parentMessageId: null,
  });
}

export async function postRoomAckRequest(
  roomId: string,
  payload: {
    body: string;
    tags?: string[];
    mentions?: {
      userIds?: string[];
      groupIds?: string[];
      all?: boolean;
    };
    requiredUserIds?: string[];
    requiredGroupIds?: string[];
    requiredRoles?: string[];
    parentMessageId?: string;
  },
) {
  const response = await api<unknown>(`/chat-rooms/${roomId}/ack-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return normalizedPostedMessageOrThrow(response, {
    roomId,
    parentMessageId: payload.parentMessageId ?? null,
  });
}

export async function uploadMessageAttachment(messageId: string, file: File) {
  const form = new FormData();
  form.append('file', file, file.name);
  await api(`/chat-messages/${messageId}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export async function downloadMessageAttachment(attachmentId: string) {
  try {
    const response = await apiResponse(`/chat-attachments/${attachmentId}`);
    if (!response.ok) throw new ChatRequestError(response.status);
    return response;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    throw new ChatRequestError(httpStatusFromError(error));
  }
}

export async function postMessageReaction(
  expected: ChatMessageIdentity,
  emoji: string,
) {
  const response = await api<unknown>(
    `/chat-messages/${expected.id}/reactions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    },
  );
  const normalized = normalizedMessageOrThrow(response);
  if (!matchesMessageIdentity(normalized, expected)) {
    throw new Error('Invalid chat reaction response');
  }
  return normalized;
}

export async function ackRequest(expected: ChatAckRequestIdentity) {
  const response = await api<unknown>(
    `/chat-ack-requests/${expected.requestId}/ack`,
    {
      method: 'POST',
    },
  );
  return normalizedAckRequestOrThrow(response, expected);
}

export async function revokeAckRequest(expected: ChatAckRequestIdentity) {
  const response = await api<unknown>(
    `/chat-ack-requests/${expected.requestId}/revoke`,
    {
      method: 'POST',
    },
  );
  return normalizedAckRequestOrThrow(response, expected);
}

export async function cancelAckRequestById(
  expected: ChatAckRequestIdentity,
  reason?: string,
) {
  const response = await api<unknown>(
    `/chat-ack-requests/${expected.requestId}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  return normalizedAckRequestOrThrow(response, expected);
}

export async function createPrivateGroupRoom(input: {
  name: string;
  memberUserIds?: string[];
}) {
  return api<ChatRoom>('/chat-rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'private_group',
      name: input.name,
      memberUserIds: input.memberUserIds,
    }),
  });
}

export async function createDmRoom(partnerUserId: string) {
  return api<ChatRoom>('/chat-rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'dm',
      partnerUserId,
    }),
  });
}

export async function inviteChatRoomMembers(roomId: string, userIds: string[]) {
  await api(`/chat-rooms/${roomId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
}

export async function summarizeRoomMessages(roomId: string) {
  const res = await api<{ summary?: string }>(`/chat-rooms/${roomId}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 120 }),
  });
  return typeof res.summary === 'string' ? res.summary : '';
}

export async function summarizeRoomMessagesWithExternalAi(
  roomId: string,
  input: { since: string; until: string },
) {
  const res = await api<{
    summary?: string;
    provider?: string;
    model?: string;
  }>(`/chat-rooms/${roomId}/ai-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 120,
      since: input.since,
      until: input.until,
    }),
  });
  return {
    summary: typeof res.summary === 'string' ? res.summary : '',
    provider: typeof res.provider === 'string' ? res.provider : 'external',
    model: typeof res.model === 'string' ? res.model : '',
  };
}

function normalizeNotificationSetting(input: {
  notifyAllPosts?: boolean;
  notifyMentions?: boolean;
  muteUntil?: string | null;
}): NotificationSetting {
  return {
    notifyAllPosts: input.notifyAllPosts !== false,
    notifyMentions: input.notifyMentions !== false,
    muteUntil: input.muteUntil ?? null,
  };
}
