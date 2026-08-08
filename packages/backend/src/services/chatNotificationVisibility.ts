import { Prisma } from '@prisma/client';

import { parseGroupToRoleMap } from '../utils/authGroupToRoleMap.js';
import {
  evaluateChatRoomContentAccess,
  type ChatRoomAccessRoom,
} from './chatRoomAccess.js';
import { prisma } from './db.js';

export const CHAT_MESSAGE_NOTIFICATION_KINDS = new Set([
  'chat_mention',
  'chat_message',
  'chat_ack_required',
  'chat_ack_escalation',
]);
export const CHAT_ROOM_NOTIFICATION_KINDS = new Set(['chat_room_acl_mismatch']);

const chatRoomSelect = {
  id: true,
  type: true,
  projectId: true,
  isOfficial: true,
  groupId: true,
  viewerGroupIds: true,
  posterGroupIds: true,
  deletedAt: true,
  allowExternalUsers: true,
} satisfies Prisma.ChatRoomSelect;

type VisibilityTransactionHost = Pick<typeof prisma, '$transaction'>;

export type ChatNotificationVisibilityInput = {
  kind: string;
  userId: string;
  projectId?: string | null;
  messageId?: string | null;
  payload?: Prisma.InputJsonValue | Prisma.JsonValue | null;
};

function normalizeId(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

export function isChatNotificationKind(kind: string) {
  return kind.startsWith('chat_');
}

export function isSupportedChatNotificationKind(kind: string) {
  return (
    CHAT_MESSAGE_NOTIFICATION_KINDS.has(kind) ||
    CHAT_ROOM_NOTIFICATION_KINDS.has(kind)
  );
}

export function resolveChatNotificationPayloadRoomId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return normalizeId((value as Record<string, unknown>).roomId);
}

export function resolveChatRoomProjectId(room: ChatRoomAccessRoom) {
  if (room.type !== 'project') return null;
  return normalizeId(room.projectId) ?? room.id;
}

export function hasConsistentChatNotificationProjectReference(
  projectId: string | null | undefined,
  room: ChatRoomAccessRoom,
  project?: { id: string; deletedAt: Date | null } | null,
) {
  const expectedProjectId = resolveChatRoomProjectId(room);
  const actualProjectId = normalizeId(projectId);
  if (actualProjectId !== expectedProjectId) return false;
  if (!expectedProjectId) return project === undefined || project === null;
  return project?.id === expectedProjectId && project.deletedAt === null;
}

function canonicalUserAliases(account: {
  userName: string;
  externalId: string | null;
}) {
  return [account.externalId, account.userName]
    .map((value) => normalizeId(value))
    .filter((value): value is string => Boolean(value));
}

export async function isChatNotificationVisibleForUser(
  input: ChatNotificationVisibilityInput,
  options: { client?: VisibilityTransactionHost } = {},
) {
  const userId = normalizeId(input.userId);
  if (!userId) return false;
  const allowed = await filterVisibleChatNotificationRecipients(
    { ...input, userIds: [userId] },
    options,
  );
  return allowed.includes(userId);
}

export async function filterVisibleChatNotificationRecipients(
  input: Omit<ChatNotificationVisibilityInput, 'userId'> & {
    userIds: string[];
  },
  options: { client?: VisibilityTransactionHost } = {},
) {
  const kind = normalizeId(input.kind);
  const referenceId = normalizeId(input.messageId);
  const userIds = [
    ...new Set(
      input.userIds
        .map((userId) => normalizeId(userId))
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  if (
    !kind ||
    !referenceId ||
    !userIds.length ||
    !isSupportedChatNotificationKind(kind)
  ) {
    return [];
  }

  const client = options.client ?? prisma;
  return client.$transaction(
    async (transaction) => {
      const message = CHAT_MESSAGE_NOTIFICATION_KINDS.has(kind)
        ? await transaction.chatMessage.findUnique({
            where: { id: referenceId },
            select: { id: true, roomId: true, deletedAt: true },
          })
        : null;
      if (CHAT_MESSAGE_NOTIFICATION_KINDS.has(kind) && !message) return [];
      if (message?.deletedAt) return [];

      const roomId = message?.roomId ?? referenceId;
      const room = await transaction.chatRoom.findUnique({
        where: { id: roomId },
        select: chatRoomSelect,
      });
      if (!room || room.deletedAt) return [];
      const payloadRoomId = resolveChatNotificationPayloadRoomId(input.payload);
      if (payloadRoomId && payloadRoomId !== room.id) return [];

      const expectedProjectId = resolveChatRoomProjectId(room);
      const project = expectedProjectId
        ? await transaction.project.findUnique({
            where: { id: expectedProjectId },
            select: { id: true, deletedAt: true },
          })
        : null;
      if (
        !hasConsistentChatNotificationProjectReference(
          input.projectId,
          room,
          project,
        )
      ) {
        return [];
      }

      const accounts = await transaction.userAccount.findMany({
        where: {
          OR: [{ userName: { in: userIds } }, { externalId: { in: userIds } }],
        },
        select: {
          active: true,
          deletedAt: true,
          userName: true,
          externalId: true,
          memberships: {
            where: { group: { active: true } },
            select: {
              group: { select: { id: true, displayName: true } },
            },
          },
        },
      });
      const accountByAlias = new Map<string, (typeof accounts)[number]>();
      const allAliases = new Set(userIds);
      for (const account of accounts) {
        for (const alias of canonicalUserAliases(account)) {
          accountByAlias.set(alias, account);
          allAliases.add(alias);
        }
      }

      const members = await transaction.chatRoomMember.findMany({
        where: {
          roomId: room.id,
          userId: { in: [...allAliases] },
          deletedAt: null,
        },
        select: { role: true, userId: true },
      });
      const memberByUserId = new Map(
        members.map((member) => [member.userId, member]),
      );
      const projectMemberships = expectedProjectId
        ? await transaction.projectMember.findMany({
            where: {
              projectId: expectedProjectId,
              userId: { in: [...allAliases] },
              project: { deletedAt: null },
            },
            select: { projectId: true, userId: true },
          })
        : [];
      const projectMemberIds = new Set(
        projectMemberships.map((membership) => membership.userId),
      );
      const groupToRoleMap = parseGroupToRoleMap(
        process.env.AUTH_GROUP_TO_ROLE_MAP ?? '',
      );

      return userIds.filter((userId) => {
        const account = accountByAlias.get(userId);
        if (account && (!account.active || account.deletedAt)) return false;
        const aliases = account ? canonicalUserAliases(account) : [userId];
        const member = aliases
          .map((alias) => memberByUserId.get(alias))
          .find(Boolean);
        if (CHAT_ROOM_NOTIFICATION_KINDS.has(kind)) {
          return member?.role === 'owner' || member?.role === 'admin';
        }
        const groupIds =
          account?.memberships.map((membership) =>
            membership.group.displayName.trim(),
          ) ?? [];
        const groupAccountIds =
          account?.memberships.map((membership) =>
            membership.group.id.trim(),
          ) ?? [];
        const roles = [
          'user',
          ...groupIds
            .map((groupId) => groupToRoleMap[groupId])
            .filter((role): role is string => Boolean(role)),
        ];
        const projectIds = expectedProjectId
          ? aliases.some((alias) => projectMemberIds.has(alias))
            ? [expectedProjectId]
            : []
          : [];
        return evaluateChatRoomContentAccess({
          room,
          userId,
          roles,
          projectIds,
          groupIds,
          groupAccountIds,
          accessLevel: 'read',
          memberRole: member?.role,
        }).ok;
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
