import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

type ChatReadStateClient = Pick<typeof prisma, 'chatReadState' | 'chatMessage'>;
type ChatReadStateTransactionClient = Pick<
  Prisma.TransactionClient,
  'chatReadState' | 'chatMessage'
>;
type MarkChatAsReadClient =
  | ChatReadStateTransactionClient
  | Pick<typeof prisma, '$transaction' | 'chatReadState' | 'chatMessage'>;

type GetChatUnreadSummaryInput = {
  roomId: string;
  userId: string;
  client?: ChatReadStateClient;
};

type MarkChatAsReadInput = {
  roomId: string;
  userId: string;
  through?: Date;
  throughMessageId?: string;
  // Injectable server clock for deterministic service tests.
  at?: Date;
  client?: MarkChatAsReadClient;
};

export class InvalidChatReadBoundaryError extends Error {
  constructor() {
    super('Invalid chat read boundary');
    this.name = 'InvalidChatReadBoundaryError';
  }
}

async function withChatReadStateTransaction<T>(
  client: MarkChatAsReadClient,
  callback: (tx: ChatReadStateTransactionClient) => Promise<T>,
) {
  if ('$transaction' in client) {
    return client.$transaction(async (tx) => callback(tx));
  }
  return callback(client);
}

export async function getChatUnreadSummary(options: GetChatUnreadSummaryInput) {
  const client = options.client ?? prisma;
  const state = await client.chatReadState.findUnique({
    where: {
      roomId_userId: { roomId: options.roomId, userId: options.userId },
    },
    select: {
      lastReadAt: true,
      lastReadMessageId: true,
      lastReadActivitySequence: true,
    },
  });
  const unreadCount = await client.chatMessage.count({
    where: {
      roomId: options.roomId,
      deletedAt: null,
      ...(state?.lastReadActivitySequence !== null &&
      state?.lastReadActivitySequence !== undefined
        ? { activitySequence: { gt: state.lastReadActivitySequence } }
        : state?.lastReadAt
          ? { createdAt: { gt: state.lastReadAt } }
          : {}),
    },
  });
  return {
    unreadCount,
    lastReadAt: state?.lastReadAt ? state.lastReadAt.toISOString() : null,
    lastReadMessageId: state?.lastReadMessageId ?? null,
  };
}

export async function markChatAsRead(options: MarkChatAsReadInput) {
  const client = options.client ?? prisma;
  const serverNow = options.at ?? new Date();
  const requestedThrough = options.through ?? serverNow;
  const highWater =
    requestedThrough.getTime() > serverNow.getTime()
      ? serverNow
      : requestedThrough;
  const highWaterMessageId = options.throughMessageId?.trim() || null;
  const key = {
    roomId_userId: { roomId: options.roomId, userId: options.userId },
  };

  const state = await withChatReadStateTransaction(client, async (tx) => {
    const boundaryMessage = highWaterMessageId
      ? await tx.chatMessage.findFirst({
          where: {
            id: highWaterMessageId,
            roomId: options.roomId,
            deletedAt: null,
          },
          select: { id: true, createdAt: true, activitySequence: true },
        })
      : null;
    if (highWaterMessageId) {
      if (
        !boundaryMessage ||
        boundaryMessage.createdAt.getTime() !== highWater.getTime()
      ) {
        throw new InvalidChatReadBoundaryError();
      }
    }
    const highWaterActivitySequence = boundaryMessage?.activitySequence ?? null;
    // PostgreSQL serializes a conflicting insert before the conditional update.
    // The DB-assigned sequence therefore converges concurrent writers on the
    // greatest durable arrival boundary without relying on random UUID order.
    await tx.chatReadState.createMany({
      data: {
        roomId: options.roomId,
        userId: options.userId,
        lastReadAt: highWater,
        lastReadMessageId: highWaterMessageId,
        lastReadActivitySequence: highWaterActivitySequence,
      },
      skipDuplicates: true,
    });
    await tx.chatReadState.updateMany({
      where: {
        roomId: options.roomId,
        userId: options.userId,
        ...(highWaterActivitySequence !== null
          ? {
              OR: [
                {
                  lastReadActivitySequence: null,
                  lastReadAt: { lte: highWater },
                },
                {
                  lastReadActivitySequence: {
                    lt: highWaterActivitySequence,
                  },
                },
              ],
            }
          : { lastReadAt: { lt: highWater } }),
      },
      data: {
        lastReadAt: highWater,
        lastReadMessageId: highWaterMessageId,
        lastReadActivitySequence: highWaterActivitySequence,
      },
    });
    const updated = await tx.chatReadState.findUnique({
      where: key,
      select: { lastReadAt: true, lastReadMessageId: true },
    });
    if (!updated) {
      throw new Error('Chat read state update failed');
    }
    return updated;
  });
  return {
    lastReadAt: state.lastReadAt.toISOString(),
    lastReadMessageId: state.lastReadMessageId ?? null,
  };
}
