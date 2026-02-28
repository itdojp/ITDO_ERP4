import { prisma } from './db.js';
import { hasProjectAccess } from './rbac.js';

type ChatRoomBase = {
  id: string;
  type: string;
  isOfficial: boolean;
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
      isOfficial: true,
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

  const groupAllowsRead =
    viewerGroupIds.length > 0 &&
    viewerGroupIds.some((groupId) => groupAccessSet.has(groupId));
  const groupAllowsPost =
    posterGroupIds.length === 0
      ? groupAllowsRead
      : posterGroupIds.some((groupId) => groupAccessSet.has(groupId));

  // Default behavior: viewerGroupIds/posterGroupIds restrict access.
  const hasViewerAccess =
    viewerGroupIds.length === 0 ||
    viewerGroupIds.some((groupId) => groupAccessSet.has(groupId));
  const hasPosterAccess =
    posterGroupIds.length === 0 ? hasViewerAccess : groupAllowsPost;

  if (room.type === 'project') {
    if (accessLevel === 'read' && !hasViewerAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (accessLevel === 'post' && !hasPosterAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (hasProjectAccess(options.roles, options.projectIds, room.id)) {
      return {
        ok: true,
        room,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
    if (room.allowExternalUsers) {
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

  if (room.type === 'company') {
    if (accessLevel === 'read' && !hasViewerAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (accessLevel === 'post' && !hasPosterAccess) {
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

  if (room.type === 'department') {
    if (accessLevel === 'read' && !hasViewerAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (accessLevel === 'post' && !hasPosterAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    const groupId = typeof room.groupId === 'string' ? room.groupId.trim() : '';
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

  // private_group/dm: membership-based rooms.
  // Official private_group can additionally grant read/post to viewerGroupIds/posterGroupIds
  // without requiring explicit members (e.g., personal GA rooms).
  if (room.type === 'private_group' && room.isOfficial) {
    const member = await client.chatRoomMember.findFirst({
      where: { roomId: room.id, userId: options.userId, deletedAt: null },
      select: { role: true },
    });
    const isMember = Boolean(member);
    const canRead = isMember || groupAllowsRead;
    const canPost = isMember || groupAllowsPost;
    if (accessLevel === 'read' && !canRead) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (accessLevel === 'post' && !canPost) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    return {
      ok: true,
      room,
      ...(member ? { memberRole: member.role } : {}),
      ...(accessLevel === 'post' && canPost && !canRead
        ? { postWithoutView: true }
        : {}),
    };
  }

  if (accessLevel === 'read' && !hasViewerAccess) {
    return { ok: false, reason: 'forbidden_room_member' };
  }
  if (accessLevel === 'post' && !hasPosterAccess) {
    return { ok: false, reason: 'forbidden_room_member' };
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
