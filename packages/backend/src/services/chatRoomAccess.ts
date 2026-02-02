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
  | {
      ok: true;
      room: ChatRoomBase;
      memberRole?: string;
      postWithoutView?: boolean;
    }
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
  const isExternal = options.roles.includes('external_chat');
  const internalChatRoles = new Set(['admin', 'mgmt', 'exec', 'user', 'hr']);
  const hasInternalChatRole = options.roles.some((role) =>
    internalChatRoles.has(role),
  );
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
  const hasViewerAccess =
    viewerGroupIds.length === 0 ||
    viewerGroupIds.some((groupId) => groupAccessSet.has(groupId));
  const hasPosterAccess =
    posterGroupIds.length === 0
      ? hasViewerAccess
      : posterGroupIds.some((groupId) => groupAccessSet.has(groupId));
  if (accessLevel === 'read' && !hasViewerAccess) {
    return { ok: false, reason: 'forbidden_room_member' };
  }
  if (accessLevel === 'post' && !hasPosterAccess) {
    return { ok: false, reason: 'forbidden_room_member' };
  }

  if (room.type === 'project') {
    if (hasProjectAccess(options.roles, options.projectIds, room.id)) {
      return {
        ok: true,
        room,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
    if (isExternal && room.allowExternalUsers) {
      const member = await client.chatRoomMember.findFirst({
        where: { roomId: room.id, userId: options.userId, deletedAt: null },
        select: { role: true },
      });
      if (!member) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      return {
        ok: true,
        room,
        memberRole: member.role,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
    return { ok: false, reason: 'forbidden_project' };
  }

  if (isExternal && !room.allowExternalUsers) {
    return { ok: false, reason: 'forbidden_external_room' };
  }

  if (room.type === 'company') {
    if (!isExternal) {
      if (!hasInternalChatRole) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      return {
        ok: true,
        room,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
  }

  if (room.type === 'department') {
    if (!isExternal) {
      if (!hasInternalChatRole) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      const groupId =
        typeof room.groupId === 'string' ? room.groupId.trim() : '';
      if (
        !groupId ||
        (!groupIdSet.has(groupId) && !groupAccountIdSet.has(groupId))
      ) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      return {
        ok: true,
        room,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
  }

  const member = await client.chatRoomMember.findFirst({
    where: { roomId: room.id, userId: options.userId, deletedAt: null },
    select: { role: true },
  });
  if (!member) {
    return { ok: false, reason: 'forbidden_room_member' };
  }

  return {
    ok: true,
    room,
    memberRole: member.role,
    ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
      ? { postWithoutView: true }
      : {}),
  };
}
