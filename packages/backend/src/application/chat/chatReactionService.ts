import { Prisma } from '@prisma/client';

import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';
import { chatThreadLimits, type ChatThreadActor } from './chatThreadPorts.js';

const reactionEmojiMaxLength = 16;
const unsafeReactionKeys = new Set(['__proto__', 'constructor', 'prototype']);

export type ChatReaction = {
  count: number;
  userIds: string[];
};

export type ChatReactions = Record<string, number | string[] | ChatReaction>;

export type ChatReactionMessage = {
  id: string;
  roomId: string;
  messageType: 'text';
  parentMessageId: string | null;
  threadRootId: string | null;
  userId: string;
  body: string;
  tags: Prisma.JsonValue | null;
  reactions: ChatReactions;
  mentions: Prisma.JsonValue | null;
  mentionsAll: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedReason: string | null;
};

export type ChatReactionMutationResult =
  | {
      ok: true;
      value: {
        message: ChatReactionMessage;
        changed: boolean;
      };
    }
  | { ok: false; reason: 'invalid_reaction' | 'not_found' };

export type ChatReactionMutationInput = {
  actor: ChatThreadActor;
  messageId: string;
  emoji: string;
};

type ChatReactionTransactionHost = {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type ChatRoomAccessCheck = typeof ensureChatRoomContentAccess;

type LockedMessage = {
  id: string;
  roomId: string;
  reactions: Prisma.JsonValue | null;
};

function normalizeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  ].sort();
}

function normalizeActor(actor: ChatThreadActor): ChatThreadActor | null {
  if (!actor || typeof actor !== 'object') return null;
  const userId = typeof actor.userId === 'string' ? actor.userId.trim() : '';
  if (!userId) return null;
  return {
    userId,
    roles: normalizeStrings(actor.roles),
    projectIds: normalizeStrings(actor.projectIds),
    groupIds: normalizeStrings(actor.groupIds),
    groupAccountIds: normalizeStrings(actor.groupAccountIds),
  };
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= chatThreadLimits.id
    ? normalized
    : null;
}

function normalizeEmoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 &&
    Array.from(normalized).length <= reactionEmojiMaxLength &&
    !unsafeReactionKeys.has(normalized)
    ? normalized
    : null;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeUserIds(value: unknown): string[] {
  return normalizeStrings(value);
}

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeReaction(value: unknown): ChatReaction | null {
  if (typeof value === 'number') {
    const count = normalizeCount(value);
    return count === null ? null : { count, userIds: [] };
  }
  // Messages written by the pre-thread application stored attributed
  // reactions directly as user-id arrays. Treat those values as the same
  // attribution set before promoting a mutated entry to the bounded shape.
  if (Array.isArray(value)) {
    const userIds = normalizeUserIds(value);
    return { count: userIds.length, userIds };
  }
  if (!isJsonRecord(value) || !Array.isArray(value.userIds)) return null;
  const userIds = normalizeUserIds(value.userIds);
  return {
    count: Math.max(normalizeCount(value.count) ?? 0, userIds.length),
    userIds,
  };
}

function sanitizeReactions(value: unknown): ChatReactions {
  if (!isJsonRecord(value)) return {};
  const sanitized: ChatReactions = {};
  for (const [emoji, rawReaction] of Object.entries(value)) {
    if (normalizeEmoji(emoji) !== emoji) continue;
    if (typeof rawReaction === 'number') {
      const count = normalizeCount(rawReaction);
      if (count && count > 0) sanitized[emoji] = count;
      continue;
    }
    const reaction = normalizeReaction(rawReaction);
    if (reaction && (reaction.count > 0 || reaction.userIds.length > 0)) {
      sanitized[emoji] = reaction;
    }
  }
  return sanitized;
}

function rawReactionRecord(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function addReaction(
  current: Record<string, unknown>,
  emoji: string,
  userId: string,
): boolean {
  const reaction = normalizeReaction(current[emoji]) ?? {
    count: 0,
    userIds: [],
  };
  if (reaction.userIds.includes(userId)) return false;
  current[emoji] = {
    count: Math.min(Number.MAX_SAFE_INTEGER, reaction.count + 1),
    userIds: [...reaction.userIds, userId],
  };
  return true;
}

function removeReaction(
  current: Record<string, unknown>,
  emoji: string,
  userId: string,
): boolean {
  const reaction = normalizeReaction(current[emoji]);
  if (!reaction || !reaction.userIds.includes(userId)) return false;
  const userIds = reaction.userIds.filter((candidate) => candidate !== userId);
  const count = Math.max(userIds.length, reaction.count - 1);
  if (count === 0) {
    delete current[emoji];
  } else {
    current[emoji] = { count, userIds };
  }
  return true;
}

async function lockActiveMessage(
  transaction: Prisma.TransactionClient,
  messageId: string,
): Promise<LockedMessage | null> {
  const rows = await transaction.$queryRaw<LockedMessage[]>(Prisma.sql`
    SELECT
      message."id",
      message."roomId",
      message."reactions"
    FROM "ChatMessage" AS message
    WHERE message."id" = ${messageId}
      AND message."deletedAt" IS NULL
    FOR UPDATE
  `);
  return rows.length === 1 ? rows[0] : null;
}

async function lockActiveRoomAndMembership(
  transaction: Prisma.TransactionClient,
  roomId: string,
  actorUserId: string,
): Promise<boolean> {
  const rooms = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT room."id"
    FROM "ChatRoom" AS room
    WHERE room."id" = ${roomId}
      AND room."deletedAt" IS NULL
    FOR SHARE
  `);
  if (rooms.length !== 1) return false;

  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT member."id"
    FROM "ChatRoomMember" AS member
    WHERE member."roomId" = ${roomId}
      AND member."userId" = ${actorUserId}
      AND member."deletedAt" IS NULL
    FOR SHARE
  `);
  return true;
}

export function createChatReactionService(dependencies: {
  client: ChatReactionTransactionHost;
  ensureRoomAccess?: ChatRoomAccessCheck;
}) {
  const ensureRoomAccess =
    dependencies.ensureRoomAccess ?? ensureChatRoomContentAccess;

  async function mutate(
    operation: 'add' | 'remove',
    input: ChatReactionMutationInput,
  ): Promise<ChatReactionMutationResult> {
    const emoji = normalizeEmoji(input.emoji);
    if (!emoji) return { ok: false, reason: 'invalid_reaction' };
    const actor = normalizeActor(input.actor);
    const messageId = normalizeMessageId(input.messageId);
    if (!actor || !messageId) return { ok: false, reason: 'not_found' };

    return dependencies.client.$transaction(
      async (transaction) => {
        const message = await lockActiveMessage(transaction, messageId);
        if (!message) return { ok: false, reason: 'not_found' } as const;
        if (
          !(await lockActiveRoomAndMembership(
            transaction,
            message.roomId,
            actor.userId,
          ))
        ) {
          return { ok: false, reason: 'not_found' } as const;
        }

        const access = await ensureRoomAccess({
          roomId: message.roomId,
          userId: actor.userId,
          roles: actor.roles,
          projectIds: actor.projectIds,
          groupIds: actor.groupIds,
          groupAccountIds: actor.groupAccountIds,
          accessLevel: 'read',
          client: transaction as unknown as typeof prisma,
        });
        if (!access.ok) return { ok: false, reason: 'not_found' } as const;

        const reactions = rawReactionRecord(message.reactions);
        const changed =
          operation === 'add'
            ? addReaction(reactions, emoji, actor.userId)
            : removeReaction(reactions, emoji, actor.userId);
        if (changed) {
          await transaction.chatMessage.update({
            where: { id: message.id },
            data: {
              reactions: reactions as Prisma.InputJsonValue,
              updatedBy: actor.userId,
            },
            select: { id: true },
          });
        }

        const response = await transaction.chatMessage.findUnique({
          where: { id: message.id },
          select: {
            id: true,
            roomId: true,
            messageType: true,
            parentMessageId: true,
            threadRootId: true,
            userId: true,
            body: true,
            tags: true,
            mentions: true,
            mentionsAll: true,
            createdAt: true,
            createdBy: true,
            updatedAt: true,
            updatedBy: true,
            deletedAt: true,
            deletedReason: true,
          },
        });
        if (!response || response.deletedAt) {
          throw new Error('Locked chat reaction message became unavailable');
        }

        return {
          ok: true,
          value: {
            message: {
              id: response.id,
              roomId: response.roomId,
              messageType: response.messageType,
              parentMessageId: response.parentMessageId,
              threadRootId: response.threadRootId,
              userId: response.userId,
              body: response.body,
              tags: response.tags,
              reactions: sanitizeReactions(reactions),
              mentions: response.mentions,
              mentionsAll: response.mentionsAll,
              createdAt: response.createdAt,
              createdBy: response.createdBy,
              updatedAt: response.updatedAt,
              updatedBy: response.updatedBy,
              deletedAt: response.deletedAt,
              deletedReason: response.deletedReason,
            },
            changed,
          },
        } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  return {
    add(input: ChatReactionMutationInput) {
      return mutate('add', input);
    },
    remove(input: ChatReactionMutationInput) {
      return mutate('remove', input);
    },
  };
}

export const chatReactionService = createChatReactionService({
  client: prisma,
});
