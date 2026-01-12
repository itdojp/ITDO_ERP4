import { prisma } from './db.js';
import { hasProjectAccess } from './rbac.js';

type ChatRoomBase = {
  id: string;
  type: string;
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
}): Promise<ChatRoomContentAccessResult> {
  const room = await prisma.chatRoom.findUnique({
    where: { id: options.roomId },
    select: {
      id: true,
      type: true,
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
    return { ok: false, reason: 'forbidden_project' };
  }

  if (options.roles.includes('external_chat') && !room.allowExternalUsers) {
    return { ok: false, reason: 'forbidden_external_room' };
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
