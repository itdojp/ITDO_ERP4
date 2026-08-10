import { prisma } from './db.js';
import { hasProjectAccess } from './rbac.js';

export type ChatRoomAccessRoom = {
  id: string;
  type: string;
  projectId?: string | null;
  isOfficial: boolean;
  groupId: string | null;
  viewerGroupIds?: unknown;
  posterGroupIds?: unknown;
  deletedAt: Date | null;
  allowExternalUsers: boolean;
};

export type ChatRoomContentAccessResult =
  | {
      ok: true;
      room: ChatRoomAccessRoom;
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

export function chatRoomProjectId(
  room: Pick<ChatRoomAccessRoom, 'id' | 'type' | 'projectId' | 'isOfficial'>,
): string | null {
  return room.type === 'project'
    ? (room.projectId ?? (room.isOfficial ? room.id : null))
    : null;
}

/**
 * Revalidates that the project backing a project Chat room is still active.
 *
 * The ordinary room policy remains the canonical authorization contract for
 * project claims. Call this after that policy, with the same transaction
 * client as the message/share projection, so a logically deleted project
 * cannot retain an accessible room through a stale alias.
 */
export async function hasActiveChatProject(options: {
  room: Pick<ChatRoomAccessRoom, 'id' | 'type' | 'projectId' | 'isOfficial'>;
  client?: typeof prisma;
}): Promise<boolean> {
  const projectId = chatRoomProjectId(options.room);
  if (!projectId) return true;
  const client = options.client ?? prisma;
  const project = await client.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  return project !== null;
}

type ChatRoomContentAccessEvaluation =
  ChatRoomContentAccessResult | { ok: false; reason: 'membership_required' };

function normalizeRoomGroupIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export function evaluateChatRoomContentAccess(options: {
  room: ChatRoomAccessRoom;
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds?: string[];
  groupAccountIds?: string[];
  accessLevel?: 'read' | 'post';
  memberRole?: string;
}): ChatRoomContentAccessEvaluation {
  const room = options.room;
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
  const hasViewerAccess = viewerGroupIds.length === 0 || groupAllowsRead;
  const hasPosterAccess =
    posterGroupIds.length === 0 ? hasViewerAccess : groupAllowsPost;
  const memberRole = options.memberRole?.trim();

  if (room.type === 'project') {
    if (accessLevel === 'read' && !hasViewerAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    if (accessLevel === 'post' && !hasPosterAccess) {
      return { ok: false, reason: 'forbidden_room_member' };
    }
    const projectAccessProjectId =
      room.projectId || (room.isOfficial ? room.id : null);
    if (
      projectAccessProjectId &&
      hasProjectAccess(
        options.roles,
        options.projectIds,
        projectAccessProjectId,
      )
    ) {
      return {
        ok: true,
        room,
        ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
          ? { postWithoutView: true }
          : {}),
      };
    }
    if (room.allowExternalUsers) {
      if (!memberRole) return { ok: false, reason: 'membership_required' };
      return {
        ok: true,
        room,
        memberRole,
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

  if (room.type === 'private_group' && room.isOfficial) {
    const isMember = Boolean(memberRole);
    const canRead = isMember || groupAllowsRead;
    const canPost = isMember || groupAllowsPost;
    if (accessLevel === 'read' && !canRead) {
      return isMember
        ? { ok: false, reason: 'forbidden_room_member' }
        : { ok: false, reason: 'membership_required' };
    }
    if (accessLevel === 'post' && !canPost) {
      return isMember
        ? { ok: false, reason: 'forbidden_room_member' }
        : { ok: false, reason: 'membership_required' };
    }
    return {
      ok: true,
      room,
      ...(memberRole ? { memberRole } : {}),
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
  if (!memberRole) return { ok: false, reason: 'membership_required' };
  return {
    ok: true,
    room,
    memberRole,
    ...(accessLevel === 'post' && hasPosterAccess && !hasViewerAccess
      ? { postWithoutView: true }
      : {}),
  };
}

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

  const room = await client.chatRoom.findUnique({
    where: { id: options.roomId },
    select: {
      id: true,
      type: true,
      projectId: true,
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
  const evaluate = (memberRole?: string) =>
    evaluateChatRoomContentAccess({
      ...options,
      room,
      memberRole,
    });
  const initial = evaluate();
  if (initial.ok || initial.reason !== 'membership_required') return initial;

  const member = await client.chatRoomMember.findFirst({
    where: { roomId: room.id, userId: options.userId, deletedAt: null },
    select: { role: true },
  });
  if (!member) return { ok: false, reason: 'forbidden_room_member' };
  const withMember = evaluate(member.role);
  return withMember.ok
    ? withMember
    : {
        ok: false,
        reason:
          withMember.reason === 'membership_required'
            ? 'forbidden_room_member'
            : withMember.reason,
      };
}
