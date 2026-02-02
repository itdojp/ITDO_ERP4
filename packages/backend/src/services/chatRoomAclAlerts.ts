import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function diff(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

export async function runChatRoomAclMismatchAlerts(options?: {
  dryRun?: boolean;
  limit?: number;
  actorId?: string | null;
}) {
  const dryRun = options?.dryRun === true;
  const limitRaw = options?.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(Math.floor(limitRaw), 500))
      : undefined;

  const rooms = await prisma.chatRoom.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      type: true,
      name: true,
      projectId: true,
      viewerGroupIds: true,
      posterGroupIds: true,
    },
  });

  const candidates = [];
  for (const room of rooms) {
    const viewerGroupIds = normalizeStringArray(room.viewerGroupIds);
    const posterGroupIds = normalizeStringArray(room.posterGroupIds);
    if (!viewerGroupIds.length || !posterGroupIds.length) continue;
    const mismatch = diff(posterGroupIds, viewerGroupIds);
    if (!mismatch.length) continue;
    candidates.push({
      room,
      mismatchGroupIds: mismatch,
      viewerGroupIds,
      posterGroupIds,
    });
  }

  const selected =
    typeof limit === 'number' ? candidates.slice(0, limit) : candidates;

  let created = 0;
  let recipients = 0;
  let roomsAlerted = 0;

  for (const candidate of selected) {
    const members = await prisma.chatRoomMember.findMany({
      where: {
        roomId: candidate.room.id,
        deletedAt: null,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
    });
    const userIds = Array.from(
      new Set(
        members.map((member) => member.userId).filter((userId) => userId),
      ),
    );
    if (!userIds.length) continue;
    if (dryRun) {
      roomsAlerted += 1;
      recipients += userIds.length;
      continue;
    }
    const existing = await prisma.appNotification.findMany({
      where: {
        kind: 'chat_room_acl_mismatch',
        messageId: candidate.room.id,
        userId: { in: userIds },
      },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((item) => item.userId));
    const targets = userIds.filter((userId) => !existingSet.has(userId));
    if (!targets.length) continue;
    roomsAlerted += 1;
    recipients += targets.length;
    const result = await prisma.appNotification.createMany({
      data: targets.map((userId) => ({
        userId,
        kind: 'chat_room_acl_mismatch',
        projectId: candidate.room.projectId ?? undefined,
        messageId: candidate.room.id,
        payload: {
          roomId: candidate.room.id,
          roomType: candidate.room.type,
          roomName: candidate.room.name,
          viewerGroupIds: candidate.viewerGroupIds,
          posterGroupIds: candidate.posterGroupIds,
          mismatchGroupIds: candidate.mismatchGroupIds,
        } as Prisma.InputJsonValue,
        createdBy: options?.actorId ?? undefined,
      })),
    });
    created += result.count ?? 0;
  }

  return {
    dryRun,
    scannedRooms: rooms.length,
    mismatchedRooms: candidates.length,
    alertedRooms: roomsAlerted,
    recipients,
    created,
  };
}
