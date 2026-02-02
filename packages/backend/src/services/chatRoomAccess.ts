import { prisma } from './db.js';
import { hasProjectAccess } from './rbac.js';

type ChatRoomBase = {
  id: string;
  type: string;
  groupId: string | null;
  viewerGroupIds?: unknown;
  posterGroupIds?: unknown;
  deletedAt: Date | null;
  allowExternalUsers: boolean;
};

type ChatRoomContentAccessResult =
  | { ok: true; room: ChatRoomBase; memberRole?: string }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'forbidden_project'
        | 'forbidden_room_member'
        | 'forbidden_external_room';
    };

export async function ensureChatRoomContentAccess(options: {
  roomId: string;
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  accessLevel?: 'read' | 'post';
  client?: typeof prisma;
}): Promise<ChatRoomContentAccessResult> {
  const client = options.client ?? prisma;
  const accessLevel = options.accessLevel ?? 'read';
  const groupIdSet = new Set(
    (Array.isArray(options.groupIds) ? options.groupIds : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );
  const groupAccountIdSet = new Set(
    (Array.isArray(options.groupAccountIds) ? options.groupAccountIds : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );

  const room = await client.chatRoom.findUnique({
    where: { id: options.roomId },
    select: {
      id: true,
      type: true,
      groupId: true,
      viewerGroupIds: true,
      posterGroupIds: true,
      deletedAt: true,
      allowExternalUsers: true,
    },
  });
  if (!room || room.deletedAt) {
    return { ok: false, reason: 'not_found' };
  }

  const normalizeRoomGroupIds = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  };
  const viewerGroupIds = normalizeRoomGroupIds(room.viewerGroupIds);
  const posterGroupIds = normalizeRoomGroupIds(room.posterGroupIds);
  const groupAccessSet = new Set([...groupIdSet, ...groupAccountIdSet]);
  // viewer/poster group ids are allow-lists that apply to all roles.
  if (
    viewerGroupIds.length > 0 &&
    !viewerGroupIds.some((groupId) => groupAccessSet.has(groupId))
  ) {
    return { ok: false, reason: 'forbidden_room_member' };
  }
  if (
    accessLevel === 'post' &&
    posterGroupIds.length > 0 &&
    !posterGroupIds.some((groupId) => groupAccessSet.has(groupId))
  ) {
    return { ok: false, reason: 'forbidden_room_member' };
  }

  if (room.type === 'project') {
    if (hasProjectAccess(options.roles, options.projectIds, room.id)) {
      return { ok: true, room };
    }
    if (room.allowExternalUsers) {
      const member = await client.chatRoomMember.findFirst({
        where: { roomId: room.id, userId: options.userId, deletedAt: null },
        select: { role: true },
      });
      if (!member) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      return { ok: true, room, memberRole: member.role };
    }
    return { ok: false, reason: 'forbidden_project' };
  }

  if (room.type === 'company') {
    return { ok: true, room };
  }

  if (room.type === 'department') {
    const groupId = typeof room.groupId === 'string' ? room.groupId.trim() : '';
    if (
      !groupId ||
      (!groupIdSet.has(groupId) && !groupAccountIdSet.has(groupId))
    ) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    return { ok: true, room };
  }

  const member = await client.chatRoomMember.findFirst({
    where: { roomId: room.id, userId: options.userId, deletedAt: null },
    select: { role: true },
  });
  if (!member) {
    return { ok: false, reason: 'forbidden_room_member' };
  }

  return { ok: true, room, memberRole: member.role };
}
