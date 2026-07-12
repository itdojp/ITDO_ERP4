import { Prisma } from '@prisma/client';

import { prisma } from './db.js';
import type { ChatRoomServiceFailure } from './chatRoomLifecycle.js';

function normalizeStringArray(
  value: unknown,
  options: { dedupe?: boolean; max?: number } = {},
): string[] {
  if (!Array.isArray(value)) return [];
  const max = options.max ?? 200;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (result.length >= max) break;
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (options.dedupe) {
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
    }
    result.push(trimmed);
  }
  return result;
}

export async function addChatRoomMembers(options: {
  roomId: string;
  actorUserId: string;
  actorRoles: string[];
  userIds: unknown;
  client?: any;
}): Promise<
  | { ok: true; roomId: string; added: number; addedUserIds: string[] }
  | ChatRoomServiceFailure
> {
  const client = options.client ?? prisma;
  const actorUserId = options.actorUserId.trim();
  const roles = Array.isArray(options.actorRoles) ? options.actorRoles : [];
  const room = await client.chatRoom.findUnique({
    where: { id: options.roomId },
    select: { id: true, type: true, isOfficial: true, deletedAt: true },
  });
  if (!room || room.deletedAt) {
    return {
      ok: false,
      statusCode: 404,
      error: { code: 'NOT_FOUND', message: 'Room not found' },
    };
  }
  if (room.type === 'dm') {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_ROOM_TYPE', message: 'dm cannot add members' },
    };
  }

  if (room.type === 'private_group') {
    const membership = await client.chatRoomMember.findFirst({
      where: { roomId: room.id, userId: actorUserId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return {
        ok: false,
        statusCode: 403,
        error: {
          code: 'FORBIDDEN_ROOM_MEMBER',
          message: 'only room owner/admin can manage members',
        },
      };
    }
  } else {
    const canManageOfficialMembers =
      roles.includes('admin') || roles.includes('mgmt');
    if (!canManageOfficialMembers) {
      return {
        ok: false,
        statusCode: 403,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'only admin/mgmt can manage official room members',
        },
      };
    }
    if (!room.isOfficial) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ROOM',
          message: 'only official rooms can accept admin-managed members',
        },
      };
    }
  }

  const userIds = normalizeStringArray(options.userIds, {
    dedupe: true,
    max: 200,
  }).filter((entry) => entry !== actorUserId);
  if (userIds.length === 0) {
    return { ok: true, roomId: room.id, added: 0, addedUserIds: [] };
  }

  const now = new Date();
  const members: Prisma.ChatRoomMemberCreateManyInput[] = userIds.map(
    (memberId) => ({
      roomId: room.id,
      userId: memberId,
      role: 'member',
      createdBy: actorUserId,
      updatedBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  await client.chatRoomMember.createMany({
    data: members,
    skipDuplicates: true,
  });

  return {
    ok: true,
    roomId: room.id,
    added: userIds.length,
    addedUserIds: userIds,
  };
}
