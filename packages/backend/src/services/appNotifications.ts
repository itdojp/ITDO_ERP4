import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

type ChatMentionNotificationOptions = {
  projectId: string;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  mentionUserIds: string[];
  mentionGroupIds: string[];
  mentionAll: boolean;
};

type ChatAckRequiredNotificationOptions = {
  projectId: string;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  requiredUserIds: string[];
  dueAt?: string | null;
};

function parseMaxRecipients() {
  const raw = process.env.CHAT_MENTION_NOTIFICATION_MAX_RECIPIENTS;
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 200;
  return Math.min(Math.floor(parsed), 500);
}

export async function createChatMentionNotifications(
  options: ChatMentionNotificationOptions,
) {
  const recipients = new Set<string>();

  options.mentionUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });

  const usesProjectMemberFallback =
    options.mentionAll || options.mentionGroupIds.length > 0;
  if (usesProjectMemberFallback) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: options.projectId },
      select: { userId: true },
    });
    members.forEach((member) => {
      if (member.userId) recipients.add(member.userId);
    });
  }

  recipients.delete(options.senderUserId);

  const maxRecipients = parseMaxRecipients();
  const targetUserIds = Array.from(recipients).slice(0, maxRecipients);
  if (targetUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated: false,
      usesProjectMemberFallback,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    mentionAll: options.mentionAll || undefined,
    mentionGroupIds: options.mentionGroupIds.length
      ? options.mentionGroupIds
      : undefined,
  };

  const created = await prisma.appNotification.createMany({
    data: targetUserIds.map((userId) => ({
      userId,
      kind: 'chat_mention',
      projectId: options.projectId,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });

  return {
    created: created.count,
    recipients: targetUserIds,
    truncated: recipients.size > targetUserIds.length,
    usesProjectMemberFallback,
  };
}

export async function createChatAckRequiredNotifications(
  options: ChatAckRequiredNotificationOptions,
) {
  const recipients = new Set<string>();
  options.requiredUserIds.forEach((userId) => {
    const trimmed = userId.trim();
    if (trimmed) recipients.add(trimmed);
  });
  recipients.delete(options.senderUserId);

  const truncated = recipients.size > 50;
  const targetUserIds = Array.from(recipients).slice(0, 50);
  if (targetUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated: false,
    };
  }

  // Keep this operation idempotent at the application layer (schema has no unique constraint).
  const existing = await prisma.appNotification.findMany({
    where: {
      kind: 'chat_ack_required',
      messageId: options.messageId,
      userId: { in: targetUserIds },
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId));
  const createUserIds = targetUserIds.filter(
    (userId) => !existingUserIds.has(userId),
  );
  if (createUserIds.length === 0) {
    return {
      created: 0,
      recipients: [] as string[],
      truncated,
    };
  }

  const payload: Prisma.InputJsonValue = {
    fromUserId: options.senderUserId,
    excerpt: options.messageBody.replace(/\s+/g, ' ').trim().slice(0, 140),
    dueAt: options.dueAt || undefined,
    requiredCount: options.requiredUserIds.length,
  };

  const created = await prisma.appNotification.createMany({
    data: createUserIds.map((userId) => ({
      userId,
      kind: 'chat_ack_required',
      projectId: options.projectId,
      messageId: options.messageId,
      payload,
      createdBy: options.senderUserId,
      updatedBy: options.senderUserId,
    })),
  });

  return {
    created: created.count,
    recipients: createUserIds,
    truncated,
  };
}
