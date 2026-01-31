import { prisma } from './db.js';
import { hasProjectAccess } from './rbac.js';

type ChatRoomBase = {
  id: string;
  type: string;
  groupId: string | null;
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
}): Promise<ChatRoomContentAccessResult> {
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

  const room = await prisma.chatRoom.findUnique({
    where: { id: options.roomId },
    select: {
      id: true,
      type: true,
      groupId: true,
      deletedAt: true,
      allowExternalUsers: true,
    },
  });
  if (!room || room.deletedAt) {
    return { ok: false, reason: 'not_found' };
  }

  if (room.type === 'project') {
    if (hasProjectAccess(options.roles, options.projectIds, room.id)) {
      return { ok: true, room };
    }
    if (isExternal && room.allowExternalUsers) {
      const member = await prisma.chatRoomMember.findFirst({
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

  if (isExternal && !room.allowExternalUsers) {
    return { ok: false, reason: 'forbidden_external_room' };
  }

  if (room.type === 'company') {
    if (!isExternal) {
      if (!hasInternalChatRole) {
        return { ok: false, reason: 'forbidden_room_member' };
      }
      return { ok: true, room };
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
      return { ok: true, room };
    }
  }

  const member = await prisma.chatRoomMember.findFirst({
    where: { roomId: room.id, userId: options.userId, deletedAt: null },
    select: { role: true },
  });
  if (!member) {
    return { ok: false, reason: 'forbidden_room_member' };
  }

  return { ok: true, room, memberRole: member.role };
}
