import type { PrismaClient } from '@prisma/client';
import { prisma } from './db.js';

type ChatReadStateClient = Pick<PrismaClient, 'chatReadState' | 'chatMessage'>;

type GetChatUnreadSummaryInput = {
  roomId: string;
  userId: string;
  client?: ChatReadStateClient;
};

type MarkChatAsReadInput = {
  roomId: string;
  userId: string;
  at?: Date;
  client?: ChatReadStateClient;
};

export async function getChatUnreadSummary(options: GetChatUnreadSummaryInput) {
  const client = options.client ?? prisma;
  const state = await client.chatReadState.findUnique({
    where: { roomId_userId: { roomId: options.roomId, userId: options.userId } },
    select: { lastReadAt: true },
  });
  const unreadCount = await client.chatMessage.count({
    where: {
      roomId: options.roomId,
      deletedAt: null,
      createdAt: state?.lastReadAt ? { gt: state.lastReadAt } : undefined,
    },
  });
  return {
    unreadCount,
    lastReadAt: state?.lastReadAt ? state.lastReadAt.toISOString() : null,
  };
}

export async function markChatAsRead(options: MarkChatAsReadInput) {
  const client = options.client ?? prisma;
  const now = options.at ?? new Date();
  const updated = await client.chatReadState.upsert({
    where: { roomId_userId: { roomId: options.roomId, userId: options.userId } },
    update: { lastReadAt: now },
    create: {
      roomId: options.roomId,
      userId: options.userId,
      lastReadAt: now,
    },
    select: { lastReadAt: true },
  });
  return { lastReadAt: updated.lastReadAt.toISOString() };
}
