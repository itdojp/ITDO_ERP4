import { Prisma } from '@prisma/client';

import { prisma } from './db.js';
import {
  buildDepartmentRoomTargets,
  COMPANY_ROOM_ID,
  ensureCompanyRoom,
  ensureDepartmentRooms,
  ensureProjectRooms,
} from './chatRoomProvisioning.js';

export type ChatRoomServiceError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ChatRoomServiceFailure = {
  ok: false;
  statusCode: number;
  error: ChatRoomServiceError;
};

type ChatRoomListProject = {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
};

type ChatRoomListRoom = {
  id: string;
  type: string;
  name: string;
  isOfficial: boolean;
  projectId: string | null;
  groupId: string | null;
  viewerGroupIds?: unknown;
  posterGroupIds?: unknown;
  allowExternalUsers: boolean;
  allowExternalIntegrations: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

type ChatRoomMemberRoomRow = {
  room: ChatRoomListRoom;
};

function normalizeStringArray(
  value: unknown,
  options: { dedupe?: boolean; max?: number } = {},
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof options.max === 'number' && result.length >= options.max) {
      break;
    }
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

function normalizeGroupIdList(value: unknown, max = 200) {
  return normalizeStringArray(value, { dedupe: true, max });
}

function normalizeSortedUnique(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function areSameStringSet(a: string[], b: string[]) {
  const left = normalizeSortedUnique(a);
  const right = normalizeSortedUnique(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export async function resolveGroupAccountIdsBySelector(options: {
  selectors: string[];
  client?: any;
}) {
  const client = options.client ?? prisma;
  const normalized = normalizeGroupIdList(options.selectors);
  if (!normalized.length) {
    return { ids: [] as string[], unresolved: [] as string[] };
  }
  const rows = await client.groupAccount.findMany({
    where: {
      active: true,
      OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
    },
    select: { id: true, displayName: true },
  });
  const selectorMap = new Map<string, string>();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name =
      typeof row.displayName === 'string' ? row.displayName.trim() : '';
    if (id) selectorMap.set(id, id);
    // Prefer earlier mappings (typically exact id) over displayName matches.
    if (name && !selectorMap.has(name)) selectorMap.set(name, id);
  }
  const ids = new Set<string>();
  const unresolved: string[] = [];
  for (const selector of normalized) {
    const id = selectorMap.get(selector);
    if (id) {
      ids.add(id);
    } else {
      unresolved.push(selector);
    }
  }
  return { ids: Array.from(ids), unresolved };
}

export async function listChatRoomsForUser(options: {
  roles: string[];
  userId?: string | null;
  projectIds?: string[];
  groupIds?: unknown;
  groupAccountIds?: unknown;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const roles = Array.isArray(options.roles) ? options.roles : [];
  const userId =
    typeof options.userId === 'string' && options.userId.trim()
      ? options.userId.trim()
      : null;
  const projectIds = Array.isArray(options.projectIds)
    ? options.projectIds
    : [];
  const groupIds = normalizeStringArray(options.groupIds, {
    dedupe: true,
    max: 50,
  });
  const groupAccountIds = normalizeStringArray(options.groupAccountIds, {
    dedupe: true,
    max: 50,
  });
  const groupIdSet = new Set([...groupIds, ...groupAccountIds]);
  const hasViewerAccess = (room: { viewerGroupIds?: unknown }) => {
    const viewerGroupIds = normalizeStringArray(room.viewerGroupIds);
    return (
      viewerGroupIds.length === 0 ||
      viewerGroupIds.some((groupId) => groupIdSet.has(groupId))
    );
  };
  const canSeeAllMeta =
    roles.includes('admin') || roles.includes('mgmt') || roles.includes('exec');
  const canBootstrapOfficialRooms = true;
  const departmentTargets = await buildDepartmentRoomTargets({
    groupIds,
    groupAccountIds,
    client,
  });
  const departmentGroupIds = departmentTargets.map((target) => target.groupId);

  const canSeeAllProjects = canSeeAllMeta;
  const invitedProjectIds =
    !canSeeAllProjects && userId
      ? Array.from(
          new Set(
            (
              (await client.chatRoomMember.findMany({
                where: {
                  userId,
                  deletedAt: null,
                  room: {
                    deletedAt: null,
                    type: 'project',
                    allowExternalUsers: true,
                  },
                },
                take: 200,
                select: { roomId: true },
              })) as Array<{ roomId?: string | null }>
            )
              .map((row) => row.roomId)
              .filter(Boolean),
          ),
        )
      : [];

  const effectiveProjectIds = canSeeAllProjects
    ? []
    : Array.from(new Set([...projectIds, ...invitedProjectIds]));

  const projects: ChatRoomListProject[] =
    canSeeAllProjects || effectiveProjectIds.length > 0
      ? await client.project.findMany({
          where: canSeeAllProjects
            ? { deletedAt: null }
            : { id: { in: effectiveProjectIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            code: true,
            name: true,
            createdAt: true,
          },
        })
      : [];

  const targetProjectIds = projects.map((project) => project.id);
  await ensureProjectRooms({ projects, userId, client });

  if (canBootstrapOfficialRooms) {
    await ensureCompanyRoom({ userId, client });
    await ensureDepartmentRooms({ userId, targets: departmentTargets, client });
  }

  const roomSelect = {
    id: true,
    type: true,
    name: true,
    isOfficial: true,
    projectId: true,
    groupId: true,
    viewerGroupIds: true,
    posterGroupIds: true,
    allowExternalUsers: true,
    allowExternalIntegrations: true,
    createdAt: true,
    createdBy: true,
    updatedAt: true,
    updatedBy: true,
  } as const;

  const projectRoomsPromise =
    targetProjectIds.length > 0
      ? client.chatRoom.findMany({
          where: {
            type: 'project',
            projectId: { in: targetProjectIds },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: roomSelect,
        })
      : Promise.resolve([]);

  const metaRoomsPromise = canSeeAllMeta
    ? client.chatRoom.findMany({
        where: { type: { not: 'project' }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: roomSelect,
      })
    : Promise.resolve([]);

  const memberRoomsPromise =
    !canSeeAllMeta && userId
      ? client.chatRoomMember
          .findMany({
            where: {
              userId,
              deletedAt: null,
              room: {
                deletedAt: null,
                type: { not: 'project' },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: { room: { select: roomSelect } },
          })
          .then((rows: ChatRoomMemberRoomRow[]) => rows.map((row) => row.room))
      : Promise.resolve([]);

  const officialRoomsPromise =
    !canSeeAllMeta && canBootstrapOfficialRooms
      ? client.chatRoom.findMany({
          where: {
            deletedAt: null,
            OR: (() => {
              const conditions: Prisma.ChatRoomWhereInput[] = [
                { id: COMPANY_ROOM_ID },
              ];
              if (departmentGroupIds.length > 0) {
                conditions.push({
                  type: 'department',
                  groupId: { in: departmentGroupIds },
                });
              }
              return conditions;
            })(),
          },
          orderBy: { createdAt: 'desc' },
          select: roomSelect,
        })
      : Promise.resolve([]);

  const groupSelectors = Array.from(
    new Set(
      [...groupIds, ...groupAccountIds]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const groupAclRoomsPromise =
    !canSeeAllMeta && groupSelectors.length > 0
      ? client.chatRoom.findMany({
          where: {
            type: 'private_group',
            isOfficial: true,
            deletedAt: null,
            OR: groupSelectors.map((groupId) => ({
              viewerGroupIds: { array_contains: [groupId] },
            })),
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: roomSelect,
        })
      : Promise.resolve([]);

  const [
    projectRooms,
    metaRooms,
    memberRooms,
    officialRooms,
    groupAclRooms,
  ]: ChatRoomListRoom[][] = await Promise.all([
    projectRoomsPromise,
    metaRoomsPromise,
    memberRoomsPromise,
    officialRoomsPromise,
    groupAclRoomsPromise,
  ]);

  const filteredProjectRooms = projectRooms.filter(hasViewerAccess);
  const filteredMetaRooms = metaRooms.filter(hasViewerAccess);
  const filteredMemberRooms = memberRooms.filter((room) => {
    if (room.type === 'private_group' && room.isOfficial) return true;
    return hasViewerAccess(room);
  });
  const filteredOfficialRooms = officialRooms.filter(hasViewerAccess);
  const filteredGroupAclRooms = groupAclRooms.filter(hasViewerAccess);

  const otherRoomsRaw = canSeeAllMeta
    ? filteredMetaRooms
    : [
        ...filteredMemberRooms,
        ...filteredOfficialRooms,
        ...filteredGroupAclRooms,
      ];

  const otherRooms = (() => {
    if (otherRoomsRaw.length <= 1) return otherRoomsRaw;
    const seen = new Set<string>();
    const merged: typeof otherRoomsRaw = [];
    for (const room of otherRoomsRaw) {
      if (seen.has(room.id)) continue;
      seen.add(room.id);
      merged.push(room);
    }
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged;
  })();

  const projectMap = new Map(
    projects.map((project) => [
      project.id,
      { code: project.code, name: project.name },
    ]),
  );

  const memberRoleByRoom =
    canSeeAllMeta && userId && otherRooms.length
      ? new Map(
          (
            (await client.chatRoomMember.findMany({
              where: {
                userId,
                roomId: { in: otherRooms.map((room) => room.id) },
                deletedAt: null,
              },
              select: { roomId: true, role: true },
            })) as Array<{ roomId: string; role: string }>
          ).map((row) => [row.roomId, row.role]),
        )
      : new Map<string, string>();

  const items = [
    ...filteredProjectRooms.map((room) => {
      const projectId = room.projectId || null;
      const project = projectId ? projectMap.get(projectId) : undefined;
      return {
        id: room.id,
        type: room.type,
        name: room.name,
        isOfficial: room.isOfficial,
        projectId,
        projectCode: project?.code || null,
        projectName: project?.name || null,
        groupId: room.groupId || null,
        allowExternalUsers: room.allowExternalUsers,
        allowExternalIntegrations: room.allowExternalIntegrations,
        createdAt: room.createdAt,
        createdBy: room.createdBy || null,
        updatedAt: room.updatedAt,
        updatedBy: room.updatedBy || null,
      };
    }),
    ...otherRooms.map((room) => {
      const deptGroupId =
        typeof room.groupId === 'string' ? room.groupId.trim() : '';
      const implicitAccess =
        room.type === 'company'
          ? canBootstrapOfficialRooms
          : room.type === 'department'
            ? deptGroupId !== '' && groupIdSet.has(deptGroupId)
            : false;
      const isMember = canSeeAllMeta
        ? implicitAccess || memberRoleByRoom.has(room.id)
        : true;
      return {
        id: room.id,
        type: room.type,
        name: room.name,
        isOfficial: room.isOfficial,
        isMember,
        memberRole: canSeeAllMeta
          ? memberRoleByRoom.get(room.id) || null
          : null,
        projectId: null,
        projectCode: null,
        projectName: null,
        groupId: room.groupId || null,
        allowExternalUsers: room.allowExternalUsers,
        allowExternalIntegrations: room.allowExternalIntegrations,
        createdAt: room.createdAt,
        createdBy: room.createdBy || null,
        updatedAt: room.updatedAt,
        updatedBy: room.updatedBy || null,
      };
    }),
  ];

  return { items };
}

export async function updateManagedChatRoom(options: {
  roomId: string;
  userId: string;
  patch: {
    name?: string;
    allowExternalUsers?: boolean;
    allowExternalIntegrations?: boolean;
    viewerGroupIds?: unknown;
    posterGroupIds?: unknown;
  };
  client?: any;
}): Promise<
  | {
      ok: true;
      room: any;
      changes: Record<string, { from: unknown; to: unknown }>;
    }
  | ChatRoomServiceFailure
> {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const body = options.patch;
  const room = await client.chatRoom.findUnique({
    where: { id: options.roomId },
    select: {
      id: true,
      type: true,
      name: true,
      isOfficial: true,
      allowExternalUsers: true,
      allowExternalIntegrations: true,
      viewerGroupIds: true,
      posterGroupIds: true,
      deletedAt: true,
    },
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
      error: { code: 'INVALID_ROOM_TYPE', message: 'dm cannot be updated' },
    };
  }

  const update: Prisma.ChatRoomUpdateInput = { updatedBy: userId };
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (body.name !== undefined) {
    const nextName = typeof body.name === 'string' ? body.name.trim() : '';
    if (!nextName) {
      return {
        ok: false,
        statusCode: 400,
        error: { code: 'INVALID_NAME', message: 'name is required' },
      };
    }
    if (!room.isOfficial) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ROOM',
          message: 'non-official room name cannot be updated by this API',
        },
      };
    }
    if (room.type === 'project') {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ROOM_TYPE',
          message: 'project room name cannot be updated',
        },
      };
    }
    if (nextName !== room.name) {
      update.name = nextName;
      changes.name = { from: room.name, to: nextName };
    }
  }

  if (body.allowExternalUsers !== undefined) {
    if (body.allowExternalUsers && !room.isOfficial) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ROOM',
          message: 'allowExternalUsers can be enabled only for official rooms',
        },
      };
    }
    if (body.allowExternalUsers !== room.allowExternalUsers) {
      update.allowExternalUsers = body.allowExternalUsers;
      changes.allowExternalUsers = {
        from: room.allowExternalUsers,
        to: body.allowExternalUsers,
      };
    }
  }

  if (body.allowExternalIntegrations !== undefined) {
    if (body.allowExternalIntegrations && !room.isOfficial) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ROOM',
          message:
            'allowExternalIntegrations can be enabled only for official rooms',
        },
      };
    }
    if (body.allowExternalIntegrations !== room.allowExternalIntegrations) {
      update.allowExternalIntegrations = body.allowExternalIntegrations;
      changes.allowExternalIntegrations = {
        from: room.allowExternalIntegrations,
        to: body.allowExternalIntegrations,
      };
    }
  }

  if (body.viewerGroupIds !== undefined) {
    const requested = normalizeGroupIdList(body.viewerGroupIds);
    const { ids, unresolved } = await resolveGroupAccountIdsBySelector({
      selectors: requested,
      client,
    });
    if (unresolved.length > 0) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_GROUP_IDS',
          message: 'viewerGroupIds contains unknown group ids',
          details: { groupIds: unresolved },
        },
      };
    }
    const current = normalizeGroupIdList(room.viewerGroupIds);
    if (!areSameStringSet(current, ids)) {
      update.viewerGroupIds = ids.length ? ids : Prisma.DbNull;
      changes.viewerGroupIds = { from: current, to: ids };
    }
  }

  if (body.posterGroupIds !== undefined) {
    const requested = normalizeGroupIdList(body.posterGroupIds);
    const { ids, unresolved } = await resolveGroupAccountIdsBySelector({
      selectors: requested,
      client,
    });
    if (unresolved.length > 0) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_GROUP_IDS',
          message: 'posterGroupIds contains unknown group ids',
          details: { groupIds: unresolved },
        },
      };
    }
    const current = normalizeGroupIdList(room.posterGroupIds);
    if (!areSameStringSet(current, ids)) {
      update.posterGroupIds = ids.length ? ids : Prisma.DbNull;
      changes.posterGroupIds = { from: current, to: ids };
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true, room, changes };
  }

  const updated = await client.chatRoom.update({
    where: { id: room.id },
    data: update,
  });

  return { ok: true, room: updated, changes };
}
