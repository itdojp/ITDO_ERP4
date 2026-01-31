import { prisma } from './db.js';
import { parseGroupToRoleMap } from '../utils/authGroupToRoleMap.js';

type ChatRoomForAckValidation = {
  id: string;
  type: string;
  groupId: string | null;
  deletedAt: Date | null;
  allowExternalUsers: boolean;
};

export type ChatAckRecipientValidationResult =
  | { ok: true; validUserIds: string[]; skippedAccessCheck?: boolean }
  | { ok: false; invalidUserIds: string[]; reason: string };

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdList(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = normalizeId(raw);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

async function resolveMemberUserIdsForGroups(options: {
  groupIds: string[];
  client: any;
}) {
  const memberships = await options.client.userGroup.findMany({
    where: {
      group: { displayName: { in: options.groupIds }, active: true },
      user: { active: true, deletedAt: null },
    },
    select: {
      group: { select: { displayName: true } },
      user: { select: { userName: true } },
    },
  });

  const byGroup = new Map<string, string[]>();
  for (const membership of memberships) {
    const groupId = normalizeId(membership?.group?.displayName);
    const userId = normalizeId(membership?.user?.userName);
    if (!groupId || !userId) continue;
    const list = byGroup.get(groupId) || [];
    list.push(userId);
    byGroup.set(groupId, list);
  }
  return byGroup;
}

export async function resolveChatAckRequiredRecipientUserIds(options: {
  requiredUserIds: string[];
  requiredGroupIds?: string[];
  requiredRoles?: string[];
  client?: any;
}) {
  const client = options.client ?? prisma;
  const directUserIds = normalizeIdList(options.requiredUserIds);
  const groupIds = normalizeIdList(options.requiredGroupIds ?? []);
  const roles = normalizeIdList(options.requiredRoles ?? []);

  const out: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (userId: string) => {
    const normalized = normalizeId(userId);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  directUserIds.forEach((userId) => pushUnique(userId));

  if (groupIds.length) {
    const byGroup = await resolveMemberUserIdsForGroups({
      groupIds,
      client,
    });
    for (const groupId of groupIds) {
      const members = byGroup.get(groupId) || [];
      members.sort((a, b) => a.localeCompare(b));
      members.forEach((userId) => pushUnique(userId));
    }
  }

  if (roles.length) {
    const roleGroupIds = resolveGroupIdsForRoles(roles);
    if (roleGroupIds.length) {
      const byGroup = await resolveMemberUserIdsForGroups({
        groupIds: roleGroupIds,
        client,
      });
      for (const groupId of roleGroupIds) {
        const members = byGroup.get(groupId) || [];
        members.sort((a, b) => a.localeCompare(b));
        members.forEach((userId) => pushUnique(userId));
      }
    }
  }

  return out;
}

export async function validateChatAckRequiredRecipientsForRoom(options: {
  room: ChatRoomForAckValidation;
  requiredUserIds: string[];
  client?: any;
}): Promise<ChatAckRecipientValidationResult> {
  const client = options.client ?? prisma;
  const room = options.room;
  if (room.deletedAt) {
    return { ok: false, invalidUserIds: [], reason: 'room_deleted' };
  }

  const requested = normalizeIdList(options.requiredUserIds);
  if (!requested.length) {
    return { ok: false, invalidUserIds: [], reason: 'required_users_empty' };
  }

  const accounts = await client.userAccount.findMany({
    where: {
      userName: { in: requested },
      active: true,
      deletedAt: null,
    },
    select: { userName: true },
  });
  const activeSet = new Set(
    normalizeIdList(
      accounts.map((item: { userName?: unknown }) => item.userName),
    ),
  );
  // Preserve requested order for UI/audit readability.
  const activeUserIds = requested.filter((userId) => activeSet.has(userId));

  const missingOrInactive = requested.filter(
    (userId) => !activeSet.has(userId),
  );
  if (!activeUserIds.length) {
    return {
      ok: false,
      invalidUserIds: missingOrInactive.length ? missingOrInactive : requested,
      reason: 'required_users_inactive',
    };
  }

  // Company rooms allow internal users without explicit membership, but we cannot
  // reliably distinguish external_chat users from DB state alone (roles come from JWT).
  // Keep validation minimal here until external_chat policy is decided.
  if (room.type === 'company') {
    if (missingOrInactive.length) {
      return {
        ok: false,
        invalidUserIds: missingOrInactive,
        reason: 'required_users_inactive',
      };
    }
    return {
      ok: true,
      validUserIds: activeUserIds,
      skippedAccessCheck: true,
    };
  }

  const allowed = new Set<string>();

  // external_chat access is always membership-based.
  if (room.allowExternalUsers) {
    const members = await client.chatRoomMember.findMany({
      where: {
        roomId: room.id,
        userId: { in: activeUserIds },
        deletedAt: null,
      },
      select: { userId: true },
    });
    normalizeIdList(members.map((m: { userId?: unknown }) => m.userId)).forEach(
      (id) => allowed.add(id),
    );
  }

  if (room.type === 'project') {
    // Project rooms: admin/mgmt are always allowed (rbac.hasProjectAccess).
    const adminMgmtGroupIds = resolveGroupIdsForRoles(['admin', 'mgmt']);
    if (adminMgmtGroupIds.length) {
      const privileged = await client.userGroup.findMany({
        where: {
          user: {
            userName: { in: activeUserIds },
            active: true,
            deletedAt: null,
          },
          group: { displayName: { in: adminMgmtGroupIds }, active: true },
        },
        select: { user: { select: { userName: true } } },
      });
      normalizeIdList(
        privileged.map(
          (row: { user?: { userName?: unknown } }) => row.user?.userName,
        ),
      ).forEach((id) => allowed.add(id));
    }

    const members = await client.projectMember.findMany({
      where: { projectId: room.id, userId: { in: activeUserIds } },
      select: { userId: true },
    });
    normalizeIdList(members.map((m: { userId?: unknown }) => m.userId)).forEach(
      (id) => allowed.add(id),
    );
  } else if (room.type === 'department') {
    const groupId = normalizeId(room.groupId);
    if (!groupId) {
      return {
        ok: false,
        invalidUserIds: activeUserIds,
        reason: 'room_group_required',
      };
    }
    const members = await client.userGroup.findMany({
      where: {
        user: {
          userName: { in: activeUserIds },
          active: true,
          deletedAt: null,
        },
        group: { displayName: groupId, active: true },
      },
      select: { user: { select: { userName: true } } },
    });
    normalizeIdList(
      members.map(
        (row: { user?: { userName?: unknown } }) => row.user?.userName,
      ),
    ).forEach((id) => allowed.add(id));
  } else {
    // private_group/dm/other: membership-based access.
    const members = await client.chatRoomMember.findMany({
      where: {
        roomId: room.id,
        userId: { in: activeUserIds },
        deletedAt: null,
      },
      select: { userId: true },
    });
    normalizeIdList(members.map((m: { userId?: unknown }) => m.userId)).forEach(
      (id) => allowed.add(id),
    );
  }

  const forbidden = activeUserIds.filter((userId) => !allowed.has(userId));
  const invalid = [...missingOrInactive, ...forbidden];
  if (invalid.length) {
    const hasMissingOrInactive = missingOrInactive.length > 0;
    const hasForbidden = forbidden.length > 0;
    const reason =
      hasMissingOrInactive && hasForbidden
        ? 'required_users_invalid'
        : hasMissingOrInactive
          ? 'required_users_inactive'
          : 'required_users_forbidden';
    return {
      ok: false,
      invalidUserIds: invalid,
      reason,
    };
  }

  return { ok: true, validUserIds: activeUserIds };
}
