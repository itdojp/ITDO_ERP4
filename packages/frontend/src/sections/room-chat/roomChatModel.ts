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

export type ChatMessage = {
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

export type ChatSearchItem = {
  id: string;
  roomId: string;
  userId: string;
  body: string;
  tags?: string[];
  createdAt: string;
  room: ChatRoom;
};

export type MentionCandidates = {
  users?: { userId: string; displayName?: string | null }[];
  groups?: { groupId: string; displayName?: string | null }[];
  allowAll?: boolean;
};

export const reactionOptions = ['👍', '🎉', '❤️', '😂', '🙏', '👀'];
export const pageSize = 50;

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
