import crypto from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from './db.js';

export const COMPANY_ROOM_ID = 'company';
export const COMPANY_ROOM_NAME = '全社';

export type DepartmentRoomTarget = {
  roomId: string;
  groupId: string;
  displayName: string;
};

export type DepartmentGroupAccount = {
  id: string;
  displayName: string;
};

function normalizeStringList(values: unknown, max = 200) {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (normalized.length >= max) break;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeActor(userId?: string | null) {
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
}

function isUniqueConstraintError(err: unknown) {
  return (
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002') ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002')
  );
}

export function buildDepartmentRoomId(groupId: string) {
  const digest = crypto
    .createHash('sha256')
    .update(groupId.trim())
    .digest('hex')
    .slice(0, 32);
  return `dept_${digest}`;
}

export async function resolveDepartmentGroupAccounts(options: {
  groupIds: string[];
  groupAccountIds: string[];
  client?: any;
}): Promise<DepartmentGroupAccount[]> {
  const client = options.client ?? prisma;
  const groupIds = normalizeStringList(options.groupIds, 50);
  const groupAccountIds = normalizeStringList(options.groupAccountIds, 50);
  if (!groupIds.length && !groupAccountIds.length) {
    return [];
  }
  const conditions: Prisma.GroupAccountWhereInput[] = [];
  if (groupAccountIds.length > 0) {
    conditions.push({ id: { in: groupAccountIds } });
  }
  if (groupIds.length > 0) {
    conditions.push({ displayName: { in: groupIds } });
  }
  const rows = await client.groupAccount.findMany({
    where: {
      active: true,
      OR: conditions,
    },
    select: { id: true, displayName: true },
  });
  const byId = new Map<string, DepartmentGroupAccount>();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name =
      typeof row.displayName === 'string' ? row.displayName.trim() : '';
    if (!id || !name) continue;
    if (!byId.has(id)) {
      byId.set(id, { id, displayName: name });
    }
  }
  return Array.from(byId.values());
}

export async function buildDepartmentRoomTargets(options: {
  groupIds: string[];
  groupAccountIds: string[];
  client?: any;
}): Promise<DepartmentRoomTarget[]> {
  const groupIds = normalizeStringList(options.groupIds, 50);
  const groupAccountIds = normalizeStringList(options.groupAccountIds, 50);
  const resolvedDepartmentGroups = await resolveDepartmentGroupAccounts({
    groupIds,
    groupAccountIds,
    client: options.client,
  });
  const resolvedDisplayNameSet = new Set(
    resolvedDepartmentGroups.map((group) => group.displayName),
  );
  const targets: DepartmentRoomTarget[] = [];
  const seenDepartmentGroupIds = new Set<string>();
  for (const group of resolvedDepartmentGroups) {
    if (seenDepartmentGroupIds.has(group.id)) continue;
    seenDepartmentGroupIds.add(group.id);
    targets.push({
      groupId: group.id,
      displayName: group.displayName,
      roomId: buildDepartmentRoomId(group.id),
    });
  }
  for (const groupId of groupIds) {
    if (resolvedDisplayNameSet.has(groupId)) continue;
    if (seenDepartmentGroupIds.has(groupId)) continue;
    seenDepartmentGroupIds.add(groupId);
    targets.push({
      // Legacy fallback: when JWT groupIds are displayName-only, keep using displayName
      // as groupId until GroupAccount resolution catches up.
      groupId,
      displayName: groupId,
      roomId: buildDepartmentRoomId(groupId),
    });
  }
  return targets;
}

export async function ensureCompanyRoom(options: {
  userId?: string | null;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const actor = normalizeActor(options.userId);
  const existing = await client.chatRoom.findUnique({
    where: { id: COMPANY_ROOM_ID },
    select: { id: true, deletedAt: true },
  });
  if (existing) return { created: false, raced: false };

  try {
    await client.chatRoom.create({
      data: {
        id: COMPANY_ROOM_ID,
        type: 'company',
        name: COMPANY_ROOM_NAME,
        isOfficial: true,
        allowExternalUsers: false,
        allowExternalIntegrations: false,
        createdBy: actor,
        updatedBy: actor,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { created: false, raced: true };
    }
    throw err;
  }
  return { created: true, raced: false };
}

function dedupeDepartmentTargets(targets: DepartmentRoomTarget[]) {
  const normalized: DepartmentRoomTarget[] = [];
  const seenGroupIds = new Set<string>();
  const seenRoomIds = new Set<string>();
  for (const target of targets) {
    const groupId = target.groupId.trim();
    const displayName = target.displayName.trim();
    const roomId = target.roomId.trim();
    if (!groupId || !displayName || !roomId) continue;
    if (seenGroupIds.has(groupId) || seenRoomIds.has(roomId)) continue;
    seenGroupIds.add(groupId);
    seenRoomIds.add(roomId);
    normalized.push({ groupId, displayName, roomId });
  }
  return normalized;
}

export async function ensureDepartmentRooms(options: {
  userId?: string | null;
  targets: DepartmentRoomTarget[];
  client?: any;
}) {
  const client = options.client ?? prisma;
  const actor = normalizeActor(options.userId);
  const targets = dedupeDepartmentTargets(options.targets);
  if (!targets.length) return { created: 0, updated: 0 };
  const targetGroupIds = targets.map((target) => target.groupId);
  const targetDisplayNames = targets.map((target) => target.displayName);
  const existing = await client.chatRoom.findMany({
    where: {
      type: 'department',
      deletedAt: null,
      OR: [
        { groupId: { in: targetGroupIds } },
        // Migration fallback: legacy rooms stored displayName in groupId.
        { groupId: { in: targetDisplayNames } },
      ],
    },
    select: { id: true, groupId: true, name: true },
  });
  const existingByGroupId = new Map<string, (typeof existing)[number]>();
  const knownRoomIds = new Set<string>();
  for (const room of existing) {
    if (typeof room.groupId === 'string') {
      existingByGroupId.set(room.groupId, room);
    }
    knownRoomIds.add(room.id);
  }

  const updates: Promise<unknown>[] = [];
  const createData: Prisma.ChatRoomCreateManyInput[] = [];
  for (const target of targets) {
    const matched =
      existingByGroupId.get(target.groupId) ||
      existingByGroupId.get(target.displayName);
    if (matched) {
      if (
        matched.groupId !== target.groupId ||
        matched.name !== target.displayName
      ) {
        // Migration: keep the existing roomId, but normalize groupId/name to the latest target.
        updates.push(
          client.chatRoom.update({
            where: { id: matched.id },
            data: {
              groupId: target.groupId,
              name: target.displayName,
              updatedBy: actor,
            },
          }),
        );
      }
      continue;
    }
    if (knownRoomIds.has(target.roomId)) continue;
    knownRoomIds.add(target.roomId);
    createData.push({
      id: target.roomId,
      type: 'department',
      name: target.displayName,
      groupId: target.groupId,
      isOfficial: true,
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      createdBy: actor,
      updatedBy: actor,
    });
  }

  if (updates.length) {
    await Promise.all(updates);
  }
  if (createData.length) {
    await client.chatRoom.createMany({
      data: createData,
      skipDuplicates: true,
    });
  }
  return { created: createData.length, updated: updates.length };
}

export async function ensureProjectRooms(options: {
  projects: Array<{ id: string; code: string }>;
  userId?: string | null;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const actor = normalizeActor(options.userId);
  const projects = options.projects.filter(
    (project) => project.id.trim() && project.code.trim(),
  );
  const targetProjectIds = Array.from(
    new Set(projects.map((project) => project.id)),
  );
  if (targetProjectIds.length === 0) {
    return { created: 0 };
  }

  const existing = await client.chatRoom.findMany({
    where: {
      type: 'project',
      projectId: { in: targetProjectIds },
      deletedAt: null,
    },
    select: {
      id: true,
      projectId: true,
    },
  });

  const existingByProject = new Set(
    existing
      .filter(
        (room: { projectId?: unknown }) =>
          typeof room.projectId === 'string' && room.projectId,
      )
      .map((room: { projectId?: unknown }) => room.projectId as string),
  );

  const missingProjects = projects.filter(
    (project) => !existingByProject.has(project.id),
  );

  if (missingProjects.length > 0) {
    await client.chatRoom.createMany({
      data: missingProjects.map((project) => ({
        id: project.id,
        type: 'project',
        name: project.code,
        isOfficial: true,
        projectId: project.id,
        createdBy: actor,
      })),
      skipDuplicates: true,
    });
  }
  return { created: missingProjects.length };
}

export function buildDmRoomId(userA: string, userB: string) {
  const [left, right] = [userA.trim(), userB.trim()].sort((a, b) =>
    a.localeCompare(b),
  );
  const digest = crypto
    .createHash('sha256')
    .update(`${left}\n${right}`)
    .digest('hex')
    .slice(0, 32);
  return `dm_${digest}`;
}

export function buildDmRoomName(userA: string, userB: string) {
  const [left, right] = [userA.trim(), userB.trim()].sort((a, b) =>
    a.localeCompare(b),
  );
  return `dm:${left}:${right}`;
}

export async function createPrivateGroupRoomWithMembers(options: {
  userId: string;
  name: string;
  memberUserIds: string[];
  client?: any;
  now?: Date;
}) {
  const client = options.client ?? prisma;
  const actor = options.userId.trim();
  const name = options.name.trim();
  const memberUserIds = normalizeStringList(options.memberUserIds).filter(
    (entry) => entry !== actor,
  );
  const room = await client.chatRoom.create({
    data: {
      type: 'private_group',
      name,
      isOfficial: false,
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      createdBy: actor,
      updatedBy: actor,
    },
  });

  const now = options.now ?? new Date();
  const members: Prisma.ChatRoomMemberCreateManyInput[] = [
    {
      roomId: room.id,
      userId: actor,
      role: 'owner',
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    },
    ...memberUserIds.map((memberId) => ({
      roomId: room.id,
      userId: memberId,
      role: 'member',
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    })),
  ];
  await client.chatRoomMember.createMany({
    data: members,
    skipDuplicates: true,
  });

  return {
    room,
    memberUserIds,
    memberCount: 1 + memberUserIds.length,
  };
}

export async function ensureDmRoomWithMembers(options: {
  userId: string;
  partnerUserId: string;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const partnerUserId = options.partnerUserId.trim();
  const roomId = buildDmRoomId(userId, partnerUserId);
  const roomName = buildDmRoomName(userId, partnerUserId);
  const existing = await client.chatRoom.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  const room = existing
    ? await client.chatRoom.update({
        where: { id: roomId },
        data: { updatedBy: userId },
      })
    : await client.chatRoom.create({
        data: {
          id: roomId,
          type: 'dm',
          name: roomName,
          isOfficial: false,
          allowExternalUsers: false,
          allowExternalIntegrations: false,
          createdBy: userId,
          updatedBy: userId,
        },
      });

  await Promise.all([
    client.chatRoomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: {
        roomId,
        userId,
        role: 'owner',
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        role: 'owner',
        deletedAt: null,
        deletedReason: null,
        updatedBy: userId,
      },
    }),
    client.chatRoomMember.upsert({
      where: { roomId_userId: { roomId, userId: partnerUserId } },
      create: {
        roomId,
        userId: partnerUserId,
        role: 'owner',
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        role: 'owner',
        deletedAt: null,
        deletedReason: null,
        updatedBy: userId,
      },
    }),
  ]);

  return { room, created: !existing, roomId };
}
