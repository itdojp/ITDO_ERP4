import type { AttachmentRecord } from '../../ui';
import { resolveAttachmentKind } from '../../utils/attachments';

export type ChatRoom = {
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

export type ChatAckRequestIdentity = {
  requestId: string;
  messageId: string;
  roomId: string;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  messageType: 'text';
  parentMessageId: string | null;
  threadRootId: string | null;
  userId: string;
  body: string | null;
  tags?: string[];
  reactions?: Record<string, number | { count: number; userIds: string[] }>;
  mentions?: { userIds?: unknown; groupIds?: unknown } | null;
  mentionsAll?: boolean;
  ackRequest?: {
    id: string;
    messageId: string;
    roomId: string;
    requiredUserIds: unknown;
    dueAt?: string | null;
    canceledAt?: string | null;
    canceledBy?: string | null;
    acks?: {
      id: string;
      requestId: string;
      userId: string;
      ackedAt: string;
    }[];
  } | null;
  attachments?: {
    id: string;
    originalName: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    createdAt: string;
  }[];
  createdAt: string;
  deleted: boolean;
  deletedAt: string | null;
  deletedReason: 'user_retract' | 'admin_moderation' | null;
  replyCount?: number;
  lastReplyAt?: string | null;
};

export type ChatSearchItem = {
  id: string;
  roomId: string;
  messageType: 'text';
  parentMessageId: string | null;
  threadRootId: string | null;
  userId: string;
  body: string;
  tags?: string[];
  createdAt: string;
  room: ChatRoom;
};

export type ChatThread = {
  root: ChatMessage & { replyCount: number; lastReplyAt: string | null };
  replies: ChatMessage[];
  replyCount: number;
  lastReplyAt: string | null;
  nextCursor: string | null;
};

export type MentionCandidates = {
  users?: { userId: string; displayName?: string | null }[];
  groups?: { groupId: string; displayName?: string | null }[];
  allowAll?: boolean;
};

export const reactionOptions = ['👍', '🎉', '❤️', '😂', '🙏', '👀'];
export const pageSize = 50;
export const threadPageSize = 50;

const mentionCandidateUserLimit = 50;
const mentionCandidateGroupLimit = 20;
const mentionCandidateIdMaxLength = 200;
const mentionCandidateDisplayNameMaxLength = 200;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableStringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function finiteNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeReactions(value: unknown): ChatMessage['reactions'] {
  const record = recordValue(value);
  if (!record) return undefined;
  const normalized: NonNullable<ChatMessage['reactions']> = {};
  for (const [emoji, raw] of Object.entries(record)) {
    if (!emoji || emoji.length > 32) continue;
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
      normalized[emoji] = raw;
      continue;
    }
    const reaction = recordValue(raw);
    if (!reaction) continue;
    const count = finiteNonNegativeInteger(reaction.count);
    const userIds = normalizeStringArray(reaction.userIds).slice(0, 200);
    normalized[emoji] = { count, userIds };
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeAckRequest(
  value: unknown,
  expected: ChatAckRequestIdentity,
): ChatMessage['ackRequest'] {
  const ack = recordValue(value);
  if (!ack) return null;
  const id = stringValue(ack.id);
  const messageId = stringValue(ack.messageId);
  const roomId = stringValue(ack.roomId);
  if (
    !id ||
    !messageId ||
    !roomId ||
    id !== expected.requestId ||
    messageId !== expected.messageId ||
    roomId !== expected.roomId
  ) {
    return null;
  }

  if (ack.acks !== undefined && ack.acks !== null && !Array.isArray(ack.acks)) {
    return null;
  }
  const acks: NonNullable<NonNullable<ChatMessage['ackRequest']>['acks']> = [];
  for (const entry of Array.isArray(ack.acks) ? ack.acks : []) {
    const row = recordValue(entry);
    if (!row) return null;
    const ackId = stringValue(row.id);
    const requestId = stringValue(row.requestId);
    const userId = stringValue(row.userId);
    const ackedAt = stringValue(row.ackedAt);
    if (!ackId || requestId !== id || !userId || !ackedAt) return null;
    acks.push({ id: ackId, requestId, userId, ackedAt });
  }
  return {
    id,
    messageId,
    roomId,
    requiredUserIds: normalizeStringArray(ack.requiredUserIds),
    dueAt: nullableStringValue(ack.dueAt),
    canceledAt: nullableStringValue(ack.canceledAt),
    canceledBy: nullableStringValue(ack.canceledBy),
    acks,
  };
}

function normalizeMentionCandidateString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeMentionCandidateDisplayName(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= mentionCandidateDisplayNameMaxLength
    ? normalized
    : undefined;
}

export function normalizeMentionCandidates(value: unknown): MentionCandidates {
  const candidates = recordValue(value);
  if (!candidates) return { users: [], groups: [] };

  const users: NonNullable<MentionCandidates['users']> = [];
  if (Array.isArray(candidates.users)) {
    for (const entry of candidates.users) {
      if (users.length >= mentionCandidateUserLimit) break;
      const user = recordValue(entry);
      if (!user) continue;
      const userId = normalizeMentionCandidateString(
        user.userId,
        mentionCandidateIdMaxLength,
      );
      const displayName = normalizeMentionCandidateDisplayName(
        user.displayName,
      );
      if (
        !userId ||
        (user.displayName !== undefined && displayName === undefined)
      ) {
        continue;
      }
      users.push({
        userId,
        ...(displayName !== undefined ? { displayName } : {}),
      });
    }
  }

  const groups: NonNullable<MentionCandidates['groups']> = [];
  if (Array.isArray(candidates.groups)) {
    for (const entry of candidates.groups) {
      if (groups.length >= mentionCandidateGroupLimit) break;
      const group = recordValue(entry);
      if (!group) continue;
      const groupId = normalizeMentionCandidateString(
        group.groupId,
        mentionCandidateIdMaxLength,
      );
      const displayName = normalizeMentionCandidateDisplayName(
        group.displayName,
      );
      if (
        !groupId ||
        (group.displayName !== undefined && displayName === undefined)
      ) {
        continue;
      }
      groups.push({
        groupId,
        ...(displayName !== undefined ? { displayName } : {}),
      });
    }
  }

  return {
    users,
    groups,
    ...(typeof candidates.allowAll === 'boolean'
      ? { allowAll: candidates.allowAll }
      : {}),
  };
}

function normalizeAttachments(value: unknown): ChatMessage['attachments'] {
  if (!Array.isArray(value)) return [];
  const normalized: NonNullable<ChatMessage['attachments']> = [];
  for (const entry of value) {
    const attachment = recordValue(entry);
    if (!attachment) continue;
    const id = stringValue(attachment.id);
    const originalName = stringValue(attachment.originalName);
    const createdAt = stringValue(attachment.createdAt);
    if (!id || !originalName || !createdAt) continue;
    normalized.push({
      id,
      originalName,
      mimeType: nullableStringValue(attachment.mimeType),
      sizeBytes:
        typeof attachment.sizeBytes === 'number' &&
        Number.isSafeInteger(attachment.sizeBytes) &&
        attachment.sizeBytes >= 0
          ? attachment.sizeBytes
          : null,
      createdAt,
    });
  }
  return normalized;
}

export function normalizeChatRoom(value: unknown): ChatRoom | null {
  const room = recordValue(value);
  if (!room) return null;
  const id = stringValue(room.id);
  const type = stringValue(room.type);
  const name = stringValue(room.name);
  if (!id || !type || !name) return null;
  return {
    id,
    type,
    name,
    isOfficial: typeof room.isOfficial === 'boolean' ? room.isOfficial : null,
    projectId: nullableStringValue(room.projectId),
    projectCode: nullableStringValue(room.projectCode),
    projectName: nullableStringValue(room.projectName),
    groupId: nullableStringValue(room.groupId),
    allowExternalUsers:
      typeof room.allowExternalUsers === 'boolean'
        ? room.allowExternalUsers
        : null,
    allowExternalIntegrations:
      typeof room.allowExternalIntegrations === 'boolean'
        ? room.allowExternalIntegrations
        : null,
    isMember: typeof room.isMember === 'boolean' ? room.isMember : null,
  };
}

export function normalizeChatMessage(value: unknown): ChatMessage | null {
  const message = recordValue(value);
  if (!message) return null;
  const id = stringValue(message.id);
  const roomId = stringValue(message.roomId);
  const userId = stringValue(message.userId);
  const createdAt = stringValue(message.createdAt);
  if (!id || !roomId || !userId || !createdAt) return null;
  // PR A added messageType additively. Omission remains compatible with
  // pre-thread responses, while every explicit non-text type fails closed.
  if (message.messageType !== undefined && message.messageType !== 'text') {
    return null;
  }
  const deleted = booleanValue(message.deleted) || message.deletedAt != null;
  if (!deleted && typeof message.body !== 'string') return null;
  const deletedReason =
    message.deletedReason === 'user_retract' ||
    message.deletedReason === 'admin_moderation'
      ? message.deletedReason
      : null;
  let ackRequest: ChatMessage['ackRequest'] = null;
  if (!deleted && message.ackRequest != null) {
    const rawAckRequest = recordValue(message.ackRequest);
    const requestId = rawAckRequest ? stringValue(rawAckRequest.id) : '';
    ackRequest = normalizeAckRequest(message.ackRequest, {
      requestId,
      messageId: id,
      roomId,
    });
    if (!ackRequest) return null;
  }
  const normalized: ChatMessage = {
    id,
    roomId,
    messageType: 'text',
    parentMessageId: nullableStringValue(message.parentMessageId),
    threadRootId: nullableStringValue(message.threadRootId),
    userId,
    body: deleted ? null : nullableStringValue(message.body),
    tags: deleted ? [] : normalizeStringArray(message.tags),
    reactions: deleted ? undefined : normalizeReactions(message.reactions),
    mentions: deleted
      ? null
      : (() => {
          const mentions = recordValue(message.mentions);
          return mentions
            ? {
                userIds: normalizeStringArray(mentions.userIds),
                groupIds: normalizeStringArray(mentions.groupIds),
              }
            : null;
        })(),
    mentionsAll: deleted ? false : booleanValue(message.mentionsAll),
    ackRequest,
    attachments: deleted ? [] : normalizeAttachments(message.attachments),
    createdAt,
    deleted,
    deletedAt: nullableStringValue(message.deletedAt),
    deletedReason,
  };
  if ('replyCount' in message) {
    normalized.replyCount = finiteNonNegativeInteger(message.replyCount);
  }
  if ('lastReplyAt' in message) {
    normalized.lastReplyAt = nullableStringValue(message.lastReplyAt);
  }
  return normalized;
}

export function normalizeChatSearchItem(value: unknown): ChatSearchItem | null {
  const item = recordValue(value);
  if (!item) return null;
  const room = normalizeChatRoom(item.room);
  const id = stringValue(item.id);
  const roomId = stringValue(item.roomId);
  const userId = stringValue(item.userId);
  const body = stringValue(item.body);
  const createdAt = stringValue(item.createdAt);
  if (!room || !id || !roomId || room.id !== roomId || !userId || !createdAt) {
    return null;
  }
  if (item.messageType !== undefined && item.messageType !== 'text') {
    return null;
  }
  return {
    id,
    roomId,
    messageType: 'text',
    parentMessageId: nullableStringValue(item.parentMessageId),
    threadRootId: nullableStringValue(item.threadRootId),
    userId,
    body,
    tags: normalizeStringArray(item.tags),
    createdAt,
    room,
  };
}

export function normalizeChatThread(value: unknown): ChatThread | null {
  const thread = recordValue(value);
  if (!thread) return null;
  const root = normalizeChatMessage(thread.root);
  if (!root || root.parentMessageId !== null || root.threadRootId !== null) {
    return null;
  }
  if (!Array.isArray(thread.replies)) return null;
  const replies: ChatMessage[] = [];
  for (const value of thread.replies) {
    const reply = normalizeChatMessage(value);
    if (
      !reply ||
      reply.parentMessageId !== root.id ||
      reply.threadRootId !== root.id ||
      reply.roomId !== root.roomId
    ) {
      return null;
    }
    replies.push(reply);
  }
  if (
    typeof thread.replyCount !== 'number' ||
    !Number.isSafeInteger(thread.replyCount) ||
    thread.replyCount < replies.length
  ) {
    return null;
  }
  const replyCount = thread.replyCount;
  const lastReplyAt = nullableStringValue(thread.lastReplyAt);
  return {
    root: { ...root, replyCount, lastReplyAt },
    replies,
    replyCount,
    lastReplyAt,
    nextCursor: nullableStringValue(thread.nextCursor),
  };
}

export function newestVisibleMessageBoundary(
  messages: ChatMessage[],
  options?: { excludeNewestTimestamp?: boolean },
) {
  const byTimestamp = new Map<number, ChatMessage[]>();
  for (const message of messages) {
    if (message.deleted) continue;
    const timestamp = Date.parse(message.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    const atTimestamp = byTimestamp.get(timestamp) ?? [];
    atTimestamp.push(message);
    byTimestamp.set(timestamp, atTimestamp);
  }

  // Message IDs are random UUIDs and do not encode the server-assigned
  // activitySequence. When multiple visible messages share a millisecond, no
  // client-side ordering can safely identify the newest one. Skip ambiguous
  // timestamp groups and advance only to the newest unique timestamp.
  const orderedTimestamps = [...byTimestamp.entries()].sort(
    ([left], [right]) => right - left,
  );
  const candidates = options?.excludeNewestTimestamp
    ? orderedTimestamps.slice(1)
    : orderedTimestamps;
  const selected = candidates.find(
    ([, atTimestamp]) => atTimestamp.length === 1,
  )?.[1][0];
  return selected
    ? { through: selected.createdAt, throughMessageId: selected.id }
    : null;
}

export function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseUserIds(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export function isAckRequest(
  value: ChatMessage['ackRequest'],
): value is NonNullable<ChatMessage['ackRequest']> {
  if (!value || typeof value !== 'object') return false;
  if (!('id' in value)) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0;
}

export function getReactionCount(value: unknown) {
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

export const markdownAllowedElements = [
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

export function transformLinkUri(uri?: string) {
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

export function sanitizeFilename(value: string) {
  return value.replace(/["\\\r\n]/g, '_').replace(/[/\\]/g, '_');
}

export function toAttachmentRecord(attachment: {
  id: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): AttachmentRecord {
  return {
    id: attachment.id,
    name: attachment.originalName,
    size: typeof attachment.sizeBytes === 'number' ? attachment.sizeBytes : 0,
    mimeType: attachment.mimeType || 'application/octet-stream',
    kind: resolveAttachmentKind(attachment.mimeType),
    status: 'uploaded',
  };
}

export function buildExcerpt(value: string, maxLength = 200) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

export function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

export function buildBeforeForCreatedAt(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 1).toISOString();
}

export function formatRoomLabel(room: ChatRoom, currentUserId: string) {
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

export function filterVisibleRoomsForUser(
  sourceRooms: ChatRoom[],
  canSeeAllMeta: boolean,
) {
  return canSeeAllMeta
    ? sourceRooms.filter((room) => room.isMember !== false)
    : sourceRooms;
}

export function buildDisplayedRooms(
  rooms: ChatRoom[],
  currentUserId: string,
  roomListScope: 'all' | 'ga_personal',
  roomListQuery: string,
) {
  const keyword = roomListQuery.trim().toLowerCase();
  return rooms
    .filter((room) => {
      if (roomListScope !== 'ga_personal') return true;
      return (
        room.type === 'private_group' &&
        room.isOfficial === true &&
        room.id.startsWith('pga_')
      );
    })
    .filter((room) => {
      if (!keyword) return true;
      const label = formatRoomLabel(room, currentUserId).toLowerCase();
      return (
        label.includes(keyword) ||
        room.name.toLowerCase().includes(keyword) ||
        room.type.toLowerCase().includes(keyword)
      );
    })
    .map((room) => ({
      ...room,
      label: `${room.type}: ${formatRoomLabel(room, currentUserId)}`,
    }));
}
