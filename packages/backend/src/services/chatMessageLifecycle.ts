import { Prisma } from '@prisma/client';

import { ensureChatRoomContentAccess } from './chatRoomAccess.js';
import { prisma } from './db.js';

export type ChatMessageDeleteReason = 'user_retract' | 'admin_moderation';

export type ChatMessageDeleteActor = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

const moderatorRoles = new Set(['admin', 'mgmt']);

type LockedMessage = {
  id: string;
  roomId: string;
  userId: string;
  parentMessageId: string | null;
  threadRootId: string | null;
  isKnowledgeShare: boolean;
};

async function lockActiveMessage(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<LockedMessage | null> {
  const messages = await tx.$queryRaw<LockedMessage[]>(Prisma.sql`
    SELECT
      message."id",
      message."roomId",
      message."userId",
      message."parentMessageId",
      message."threadRootId",
      EXISTS (
        SELECT 1
        FROM "KnowledgeShare" AS share
        WHERE share."chatMessageId" = message."id"
          AND share."status" IN ('posted', 'revoked')
      ) AS "isKnowledgeShare"
    FROM "ChatMessage" AS message
    WHERE message."id" = ${messageId}
      AND message."deletedAt" IS NULL
    FOR UPDATE
  `);
  return messages.length === 1 ? messages[0] : null;
}

async function lockActiveRoomAndMembership(
  tx: Prisma.TransactionClient,
  roomId: string,
  actorUserId: string,
): Promise<boolean> {
  const rooms = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT room."id"
    FROM "ChatRoom" AS room
    WHERE room."id" = ${roomId}
      AND room."deletedAt" IS NULL
    FOR SHARE
  `);
  if (rooms.length !== 1) return false;

  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT member."id"
    FROM "ChatRoomMember" AS member
    WHERE member."roomId" = ${roomId}
      AND member."userId" = ${actorUserId}
      AND member."deletedAt" IS NULL
    FOR SHARE
  `);
  return true;
}

export function createChatMessageLifecycleService(client: typeof prisma) {
  return {
    async deleteMessage(input: {
      messageId: string;
      actor: ChatMessageDeleteActor;
      reason: ChatMessageDeleteReason;
      at?: Date;
    }) {
      const messageId = input.messageId.trim();
      const userId = input.actor.userId.trim();
      if (!messageId || messageId.length > 200 || !userId) return null;
      const roles = [...new Set(input.actor.roles.map((role) => role.trim()))];
      const isModerator = roles.some((role) => moderatorRoles.has(role));
      if (input.reason === 'admin_moderation' && !isModerator) {
        return null;
      }

      return client.$transaction(
        async (tx) => {
          const message = await lockActiveMessage(tx, messageId);
          if (!message) return null;
          if (
            !(await lockActiveRoomAndMembership(tx, message.roomId, userId))
          ) {
            return null;
          }
          const access = await ensureChatRoomContentAccess({
            roomId: message.roomId,
            userId,
            roles,
            projectIds: input.actor.projectIds,
            groupIds: input.actor.groupIds,
            groupAccountIds: input.actor.groupAccountIds,
            accessLevel: 'post',
            client: tx as unknown as typeof prisma,
          });
          if (!access.ok) return null;
          if (
            message.userId !== userId &&
            (!isModerator || input.reason !== 'admin_moderation')
          ) {
            return null;
          }
          // Knowledge share roots have a dedicated revoke lifecycle. Treat
          // them as unavailable to the generic Chat delete endpoint so a
          // sender or moderator cannot bypass the mandatory share audit.
          if (message.isKnowledgeShare) return null;

          const deletedAt = input.at ?? new Date();
          const updated = await tx.chatMessage.updateMany({
            where: { id: message.id, deletedAt: null },
            data: {
              deletedAt,
              deletedReason: input.reason,
              updatedBy: userId,
            },
          });
          if (updated.count !== 1) return null;
          return {
            id: message.id,
            roomId: message.roomId,
            parentMessageId: message.parentMessageId,
            threadRootId: message.threadRootId,
            deletedAt,
            deletedReason: input.reason,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },
  };
}

export const chatMessageLifecycleService =
  createChatMessageLifecycleService(prisma);
