import { api, apiResponse } from '../../api';
import type {
  ChatMessage,
  ChatRoom,
  ChatSearchItem,
  MentionCandidates,
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

export type RoomMessageQuery = {
  before?: string;
  limit: number;
  query?: string;
  tag?: string;
};

export async function fetchChatRooms() {
  const res = await api<{ items?: ChatRoom[] }>('/chat-rooms');
  return Array.isArray(res.items) ? res.items : [];
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

export async function fetchRoomUnreadState(roomId: string) {
  const res = await api<{ unreadCount?: number; lastReadAt?: string | null }>(
    `/chat-rooms/${roomId}/unread`,
  );
  return {
    unreadCount: typeof res.unreadCount === 'number' ? res.unreadCount : 0,
    lastReadAt: typeof res.lastReadAt === 'string' ? res.lastReadAt : null,
  };
}

export async function markRoomRead(roomId: string) {
  await api(`/chat-rooms/${roomId}/read`, { method: 'POST' });
}

export async function fetchRoomMessages(
  roomId: string,
  input: RoomMessageQuery,
) {
  const query = new URLSearchParams();
  query.set('limit', String(input.limit));
  if (input.before) query.set('before', input.before);
  if (input.tag?.trim()) query.set('tag', input.tag.trim());
  if (input.query?.trim()) query.set('q', input.query.trim());

  const res = await api<{ items?: ChatMessage[] }>(
    `/chat-rooms/${roomId}/messages?${query.toString()}`,
  );
  return Array.isArray(res.items) ? res.items : [];
}

export async function searchChatMessages(input: {
  query: string;
  before?: string;
  limit: number;
}) {
  const query = new URLSearchParams();
  query.set('q', input.query.trim());
  query.set('limit', String(input.limit));
  if (input.before) query.set('before', input.before);
  const res = await api<{ items?: ChatSearchItem[] }>(
    `/chat-messages/search?${query.toString()}`,
  );
  return Array.isArray(res.items) ? res.items : [];
}

export async function fetchMentionCandidates(
  roomId: string,
  signal?: AbortSignal,
) {
  return api<MentionCandidates>(`/chat-rooms/${roomId}/mention-candidates`, {
    signal,
  });
}

export async function fetchAckCandidates(
  roomId: string,
  query: string,
  signal?: AbortSignal,
) {
  return api<MentionCandidates>(
    `/chat-rooms/${roomId}/ack-candidates?q=${encodeURIComponent(query)}`,
    { signal },
  );
}

export async function previewRoomAckTargets(
  roomId: string,
  input: {
    requiredUserIds: string[];
    requiredGroupIds: string[];
    requiredRoles: string[];
  },
) {
  return api<AckPreview>(`/chat-rooms/${roomId}/ack-requests/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
  return api<ChatMessage & { warning?: { code?: string; message?: string } }>(
    `/chat-rooms/${roomId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
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
  },
) {
  return api<ChatMessage & { warning?: { code?: string; message?: string } }>(
    `/chat-rooms/${roomId}/ack-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
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
  return apiResponse(`/chat-attachments/${attachmentId}`);
}

export async function postMessageReaction(messageId: string, emoji: string) {
  return api<ChatMessage>(`/chat-messages/${messageId}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
}

export async function ackRequest(requestId: string) {
  return api<ChatMessage['ackRequest']>(`/chat-ack-requests/${requestId}/ack`, {
    method: 'POST',
  });
}

export async function revokeAckRequest(requestId: string) {
  return api<ChatMessage['ackRequest']>(
    `/chat-ack-requests/${requestId}/revoke`,
    { method: 'POST' },
  );
}

export async function cancelAckRequestById(requestId: string, reason?: string) {
  return api<ChatMessage['ackRequest']>(
    `/chat-ack-requests/${requestId}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
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
