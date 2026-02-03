import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { parseGroupToRoleMap } from '../utils/authGroupToRoleMap.js';

export type ChatAckCandidateUser = {
  userId: string;
  displayName?: string | null;
};

export type ChatAckCandidateGroup = {
  groupId: string;
  displayName?: string | null;
};

export type ChatAckCandidates = {
  users: ChatAckCandidateUser[];
  groups: ChatAckCandidateGroup[];
};

type RoomForAckCandidates = {
  id: string;
  type: string;
  groupId: string | null;
  viewerGroupIds?: unknown;
  deletedAt: Date | null;
  allowExternalUsers: boolean;
};

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 64;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const id = normalizeId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, '\\$&');
}

function clampLimit(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT);
}

function resolveGroupIdsForRoles(roles: string[]) {
  const groupToRole = parseGroupToRoleMap(
    process.env.AUTH_GROUP_TO_ROLE_MAP || '',
  );
  return Object.entries(groupToRole)
    .filter(([, role]) => roles.includes(role))
    .map(([groupId]) => groupId.trim())
    .filter(Boolean);
}

async function resolveActiveGroupAccountIds(options: {
  selectors: string[];
  client: typeof prisma;
}) {
  const normalized = options.selectors
    .map((value) => value.trim())
    .filter(Boolean);
  if (!normalized.length) return [];
  const rows = await options.client.groupAccount.findMany({
    where: {
      active: true,
      OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
    },
    select: { id: true },
  });
  const ids = rows.map((row) => normalizeId(row.id)).filter(Boolean);
  return Array.from(new Set(ids));
}

async function fetchActiveUserIdsByGroupAccountIds(options: {
  groupAccountIds: string[];
  client: typeof prisma;
}) {
  if (!options.groupAccountIds.length) return [];
  const rows = await options.client.userGroup.findMany({
    where: {
      groupId: { in: options.groupAccountIds },
      group: { active: true },
      user: { active: true, deletedAt: null },
    },
    select: { user: { select: { userName: true } } },
  });
  return normalizeIdList(rows.map((row) => row.user?.userName));
}

async function fetchActiveProjectMemberUserIds(options: {
  projectId: string;
  client: typeof prisma;
}) {
  const rows = await options.client.$queryRaw<Array<{ userId: string | null }>>`
    SELECT DISTINCT ua."userName" AS "userId"
    FROM "ProjectMember" AS pm
    INNER JOIN "UserAccount" AS ua
      ON ua."userName" = pm."userId"
    WHERE pm."projectId" = ${options.projectId}
      AND ua."active" = true
      AND ua."deletedAt" IS NULL
  `;
  return normalizeIdList(rows.map((row) => row.userId));
}

async function fetchActiveChatRoomMemberUserIds(options: {
  roomId: string;
  client: typeof prisma;
}) {
  const rows = await options.client.$queryRaw<Array<{ userId: string | null }>>`
    SELECT DISTINCT ua."userName" AS "userId"
    FROM "ChatRoomMember" AS crm
    INNER JOIN "UserAccount" AS ua
      ON ua."userName" = crm."userId"
    WHERE crm."roomId" = ${options.roomId}
      AND crm."deletedAt" IS NULL
      AND ua."active" = true
      AND ua."deletedAt" IS NULL
  `;
  return normalizeIdList(rows.map((row) => row.userId));
}

async function collectAllowedUserIds(options: {
  room: RoomForAckCandidates;
  client: typeof prisma;
}) {
  const room = options.room;
  if (room.deletedAt) {
    return { allowedAll: false, allowedUserIds: new Set<string>() };
  }

  const allowed = new Set<string>();
  const add = (ids: string[]) => {
    ids.forEach((id) => allowed.add(id));
  };

  const viewerGroupSelectors = normalizeIdList(room.viewerGroupIds);

  if (room.type === 'company') {
    if (viewerGroupSelectors.length === 0) {
      return { allowedAll: true, allowedUserIds: allowed };
    }
    const viewerGroupIds = await resolveActiveGroupAccountIds({
      selectors: viewerGroupSelectors,
      client: options.client,
    });
    add(
      await fetchActiveUserIdsByGroupAccountIds({
        groupAccountIds: viewerGroupIds,
        client: options.client,
      }),
    );
    return { allowedAll: false, allowedUserIds: allowed };
  }

  if (room.allowExternalUsers) {
    add(
      await fetchActiveChatRoomMemberUserIds({
        roomId: room.id,
        client: options.client,
      }),
    );
  }

  if (room.type === 'project') {
    add(
      await fetchActiveProjectMemberUserIds({
        projectId: room.id,
        client: options.client,
      }),
    );
    const adminMgmtSelectors = resolveGroupIdsForRoles(['admin', 'mgmt']);
    if (adminMgmtSelectors.length) {
      const adminMgmtGroupIds = await resolveActiveGroupAccountIds({
        selectors: adminMgmtSelectors,
        client: options.client,
      });
      add(
        await fetchActiveUserIdsByGroupAccountIds({
          groupAccountIds: adminMgmtGroupIds,
          client: options.client,
        }),
      );
    }
    return { allowedAll: false, allowedUserIds: allowed };
  }

  if (room.type === 'department') {
    const groupSelector = normalizeId(room.groupId);
    if (groupSelector) {
      const groupIds = await resolveActiveGroupAccountIds({
        selectors: [groupSelector],
        client: options.client,
      });
      add(
        await fetchActiveUserIdsByGroupAccountIds({
          groupAccountIds: groupIds,
          client: options.client,
        }),
      );
    }
    return { allowedAll: false, allowedUserIds: allowed };
  }

  add(
    await fetchActiveChatRoomMemberUserIds({
      roomId: room.id,
      client: options.client,
    }),
  );

  return { allowedAll: false, allowedUserIds: allowed };
}

async function searchUserCandidates(options: {
  keyword: string;
  allowedAll: boolean;
  allowedUserIds: Set<string>;
  limit?: number;
  client: typeof prisma;
}) {
  if (!options.allowedAll && options.allowedUserIds.size === 0) return [];
  const limit = clampLimit(options.limit);
  const likePattern = `%${escapeLike(options.keyword)}%`;
  const allowedIds = Array.from(options.allowedUserIds);
  const allowedClause = options.allowedAll
    ? Prisma.sql``
    : Prisma.sql`AND ua."userName" IN (${Prisma.join(allowedIds)})`;
  const rows = await options.client.$queryRaw<
    Array<{ userId: string | null; displayName: string | null }>
  >`
    SELECT ua."userName" AS "userId", ua."displayName"
    FROM "UserAccount" AS ua
    WHERE ua."active" = true
      AND ua."deletedAt" IS NULL
      AND (
        ua."userName" ILIKE ${likePattern} ESCAPE '\\'
        OR ua."displayName" ILIKE ${likePattern} ESCAPE '\\'
        OR ua."givenName" ILIKE ${likePattern} ESCAPE '\\'
        OR ua."familyName" ILIKE ${likePattern} ESCAPE '\\'
        OR ua."department" ILIKE ${likePattern} ESCAPE '\\'
      )
      ${allowedClause}
    ORDER BY ua."userName" ASC
    LIMIT ${limit}
  `;
  return rows
    .map((row) => ({
      userId: normalizeId(row.userId),
      displayName: typeof row.displayName === 'string' ? row.displayName : null,
    }))
    .filter((row) => row.userId);
}

async function searchGroupCandidates(options: {
  keyword: string;
  allowedAll: boolean;
  allowedUserIds: Set<string>;
  limit?: number;
  client: typeof prisma;
}) {
  const limit = clampLimit(options.limit);
  const groups = await options.client.groupAccount.findMany({
    where: {
      active: true,
      OR: [
        { id: { contains: options.keyword, mode: 'insensitive' } },
        { displayName: { contains: options.keyword, mode: 'insensitive' } },
      ],
    },
    orderBy: { displayName: 'asc' },
    take: Math.max(limit * 3, limit),
    select: { id: true, displayName: true },
  });
  if (!groups.length) return [];
  const groupIds = groups.map((group) => group.id);
  const memberships = await options.client.userGroup.findMany({
    where: {
      groupId: { in: groupIds },
      group: { active: true },
      user: { active: true, deletedAt: null },
    },
    select: { groupId: true, user: { select: { userName: true } } },
  });
  const membersByGroup = new Map<string, string[]>();
  for (const membership of memberships) {
    const groupId = normalizeId(membership.groupId);
    const userId = normalizeId(membership.user?.userName);
    if (!groupId || !userId) continue;
    const list = membersByGroup.get(groupId) || [];
    list.push(userId);
    membersByGroup.set(groupId, list);
  }
  const results: ChatAckCandidateGroup[] = [];
  for (const group of groups) {
    if (results.length >= limit) break;
    const groupId = normalizeId(group.id);
    if (!groupId) continue;
    const members = membersByGroup.get(groupId) || [];
    if (members.length === 0) continue;
    if (!options.allowedAll) {
      const allowed = options.allowedUserIds;
      if (members.some((memberId) => !allowed.has(memberId))) {
        continue;
      }
    }
    results.push({
      groupId,
      displayName:
        typeof group.displayName === 'string' ? group.displayName : null,
    });
  }
  return results;
}

export async function searchChatAckCandidates(options: {
  room: RoomForAckCandidates;
  q: string;
  limit?: number;
  client?: typeof prisma;
}): Promise<ChatAckCandidates> {
  const client = options.client ?? prisma;
  const keyword = options.q.trim().slice(0, MAX_QUERY_LENGTH);
  if (keyword.length < MIN_QUERY_LENGTH) {
    return { users: [], groups: [] };
  }
  const { allowedAll, allowedUserIds } = await collectAllowedUserIds({
    room: options.room,
    client,
  });
  if (!allowedAll && allowedUserIds.size === 0) {
    return { users: [], groups: [] };
  }
  const [users, groups] = await Promise.all([
    searchUserCandidates({
      keyword,
      allowedAll,
      allowedUserIds,
      limit: options.limit,
      client,
    }),
    searchGroupCandidates({
      keyword,
      allowedAll,
      allowedUserIds,
      limit: options.limit,
      client,
    }),
  ]);
  return { users, groups };
}
