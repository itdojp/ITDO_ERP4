import { Prisma } from '@prisma/client';

import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';
import type { ChatThreadActor } from './chatThreadPorts.js';

const ackRequestResponseSelect = {
  id: true,
  messageId: true,
  roomId: true,
  requiredUserIds: true,
  requestedUserIds: true,
  requestedGroupIds: true,
  requestedRoles: true,
  dueAt: true,
  remindIntervalHours: true,
  escalationAfterHours: true,
  escalationUserIds: true,
  escalationGroupIds: true,
  escalationRoles: true,
  templateId: true,
  canceledAt: true,
  canceledBy: true,
  createdAt: true,
  createdBy: true,
  acks: {
    select: {
      id: true,
      requestId: true,
      userId: true,
      ackedAt: true,
    },
    orderBy: [{ ackedAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.ChatAckRequestSelect;

export type ChatAckRequestResponse = Prisma.ChatAckRequestGetPayload<{
  select: typeof ackRequestResponseSelect;
}>;

export type ChatAckMutationResult =
  | {
      ok: true;
      value: {
        request: ChatAckRequestResponse;
        changed: boolean;
        requiredUserCount: number;
        ackedCount: number;
        isPrivileged?: boolean;
      };
    }
  | {
      ok: false;
      reason: 'not_found' | 'canceled' | 'not_required' | 'forbidden';
    };

type AckMutationClient = {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type RoomAccessCheck = typeof ensureChatRoomContentAccess;

type LockedAckRequest = {
  id: string;
  messageId: string;
  roomId: string;
};

type LockedAckMessage = {
  id: string;
  roomId: string;
  userId: string;
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
  const userId = typeof actor?.userId === 'string' ? actor.userId.trim() : '';
  if (!userId) return null;
  return {
    userId,
    roles: normalizeStrings(actor.roles),
    projectIds: normalizeStrings(actor.projectIds),
    groupIds: normalizeStrings(actor.groupIds),
    groupAccountIds: normalizeStrings(actor.groupAccountIds),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function requiredUserIds(value: unknown): string[] {
  return normalizeStrings(value);
}

async function lockRequestAndActiveMessage(
  transaction: Prisma.TransactionClient,
  requestId: string,
  actorUserId: string,
) {
  const requests = await transaction.$queryRaw<LockedAckRequest[]>(Prisma.sql`
    SELECT request."id", request."messageId", request."roomId"
    FROM "ChatAckRequest" AS request
    WHERE request."id" = ${requestId}
    FOR UPDATE
  `);
  const lockedRequest = requests.length === 1 ? requests[0] : null;
  if (!lockedRequest) return null;

  const messages = await transaction.$queryRaw<LockedAckMessage[]>(Prisma.sql`
    SELECT message."id", message."roomId", message."userId"
    FROM "ChatMessage" AS message
    WHERE message."id" = ${lockedRequest.messageId}
      AND message."deletedAt" IS NULL
    FOR UPDATE
  `);
  const message = messages.length === 1 ? messages[0] : null;
  if (!message || lockedRequest.roomId !== message.roomId) return null;

  const rooms = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT room."id"
    FROM "ChatRoom" AS room
    WHERE room."id" = ${message.roomId}
      AND room."deletedAt" IS NULL
    FOR SHARE
  `);
  if (rooms.length !== 1) return null;

  // A current direct membership, when one exists, is protected from concurrent
  // revocation until the ACK mutation commits. Room grant fields are protected
  // by the preceding room lock.
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT member."id"
    FROM "ChatRoomMember" AS member
    WHERE member."roomId" = ${message.roomId}
      AND member."userId" = ${actorUserId}
      AND member."deletedAt" IS NULL
    FOR SHARE
  `);

  return { request: lockedRequest, message };
}

export function createChatAckMutationService(dependencies: {
  client: AckMutationClient;
  ensureRoomAccess?: RoomAccessCheck;
}) {
  const ensureRoomAccess =
    dependencies.ensureRoomAccess ?? ensureChatRoomContentAccess;

  async function withLockedRequest(
    input: { requestId: string; actor: ChatThreadActor },
    operation: (
      transaction: Prisma.TransactionClient,
      state: {
        actor: ChatThreadActor;
        message: LockedAckMessage;
        request: ChatAckRequestResponse;
        requiredUserIds: string[];
      },
    ) => Promise<ChatAckMutationResult>,
  ): Promise<ChatAckMutationResult> {
    const actor = normalizeActor(input.actor);
    const requestId = normalizeId(input.requestId);
    if (!actor || !requestId) return { ok: false, reason: 'not_found' };

    return dependencies.client.$transaction(
      async (transaction) => {
        const locked = await lockRequestAndActiveMessage(
          transaction,
          requestId,
          actor.userId,
        );
        if (!locked) return { ok: false, reason: 'not_found' } as const;

        const access = await ensureRoomAccess({
          roomId: locked.message.roomId,
          userId: actor.userId,
          roles: actor.roles,
          projectIds: actor.projectIds,
          groupIds: actor.groupIds,
          groupAccountIds: actor.groupAccountIds,
          accessLevel: 'read',
          client: transaction as unknown as typeof prisma,
        });
        if (!access.ok) return { ok: false, reason: 'not_found' } as const;

        const request = await transaction.chatAckRequest.findUnique({
          where: { id: locked.request.id },
          select: ackRequestResponseSelect,
        });
        if (
          !request ||
          request.messageId !== locked.message.id ||
          request.roomId !== locked.message.roomId
        ) {
          return { ok: false, reason: 'not_found' } as const;
        }

        return operation(transaction, {
          actor,
          message: locked.message,
          request,
          requiredUserIds: requiredUserIds(request.requiredUserIds),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  return {
    acknowledge(input: { requestId: string; actor: ChatThreadActor }) {
      return withLockedRequest(input, async (transaction, state) => {
        if (state.request.canceledAt) {
          return { ok: false, reason: 'canceled' };
        }
        if (!state.requiredUserIds.includes(state.actor.userId)) {
          return { ok: false, reason: 'not_required' };
        }
        const alreadyAcked = state.request.acks.some(
          (ack) => ack.userId === state.actor.userId,
        );
        if (!alreadyAcked) {
          await transaction.chatAck.create({
            data: {
              requestId: state.request.id,
              userId: state.actor.userId,
            },
            select: { id: true },
          });
        }
        const request = await transaction.chatAckRequest.findUnique({
          where: { id: state.request.id },
          select: ackRequestResponseSelect,
        });
        if (!request) throw new Error('Locked chat ACK request disappeared');
        return {
          ok: true,
          value: {
            request,
            changed: !alreadyAcked,
            requiredUserCount: state.requiredUserIds.length,
            ackedCount: request.acks.length,
          },
        };
      });
    },

    revoke(input: { requestId: string; actor: ChatThreadActor }) {
      return withLockedRequest(input, async (transaction, state) => {
        if (state.request.canceledAt) {
          return { ok: false, reason: 'canceled' };
        }
        if (!state.requiredUserIds.includes(state.actor.userId)) {
          return { ok: false, reason: 'not_required' };
        }
        const deleted = await transaction.chatAck.deleteMany({
          where: {
            requestId: state.request.id,
            userId: state.actor.userId,
          },
        });
        const request = await transaction.chatAckRequest.findUnique({
          where: { id: state.request.id },
          select: ackRequestResponseSelect,
        });
        if (!request) throw new Error('Locked chat ACK request disappeared');
        return {
          ok: true,
          value: {
            request,
            changed: deleted.count > 0,
            requiredUserCount: state.requiredUserIds.length,
            ackedCount: request.acks.length,
          },
        };
      });
    },

    cancel(input: { requestId: string; actor: ChatThreadActor }) {
      return withLockedRequest(input, async (transaction, state) => {
        const isPrivileged =
          state.actor.roles.includes('admin') ||
          state.actor.roles.includes('mgmt');
        const isOwner =
          state.message.userId === state.actor.userId ||
          state.request.createdBy === state.actor.userId;
        if (!isOwner && !isPrivileged) {
          return { ok: false, reason: 'forbidden' };
        }

        let changed = false;
        if (!state.request.canceledAt) {
          await transaction.chatAckRequest.update({
            where: { id: state.request.id },
            data: {
              canceledAt: new Date(),
              canceledBy: state.actor.userId,
            },
            select: { id: true },
          });
          changed = true;
        }
        const request = await transaction.chatAckRequest.findUnique({
          where: { id: state.request.id },
          select: ackRequestResponseSelect,
        });
        if (!request) throw new Error('Locked chat ACK request disappeared');
        return {
          ok: true,
          value: {
            request,
            changed,
            requiredUserCount: state.requiredUserIds.length,
            ackedCount: request.acks.length,
            isPrivileged,
          },
        };
      });
    },
  };
}

export const chatAckMutationService = createChatAckMutationService({
  client: prisma,
});
