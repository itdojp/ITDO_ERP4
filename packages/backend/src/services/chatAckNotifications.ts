import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { auditContextFromRequest, logAudit } from './audit.js';
import { createChatAckRequiredNotifications } from './appNotifications.js';

type LogChatAckRequestCreatedOptions = {
  req: FastifyRequest;
  actorUserId: string;
  projectId: string | null;
  roomId: string;
  messageId: string;
  ackRequestId: string;
  requiredUserIds: string[];
  dueAt: Date | null;
};

export async function logChatAckRequestCreated(
  options: LogChatAckRequestCreatedOptions,
) {
  await logAudit({
    action: 'chat_ack_request_created',
    targetTable: 'chat_ack_requests',
    targetId: options.ackRequestId,
    metadata: {
      projectId: options.projectId,
      roomId: options.roomId,
      messageId: options.messageId,
      requiredUserCount: options.requiredUserIds.length,
      dueAt: options.dueAt ? options.dueAt.toISOString() : null,
    } as Prisma.InputJsonValue,
    ...auditContextFromRequest(options.req, { userId: options.actorUserId }),
  });
}

type TryCreateChatAckRequiredNotificationsWithAuditOptions = {
  req: FastifyRequest;
  actorUserId: string;
  projectId: string | null;
  roomId: string;
  messageId: string;
  messageBody: string;
  requiredUserIds: string[];
  dueAt: Date | null;
};

export async function tryCreateChatAckRequiredNotificationsWithAudit(
  options: TryCreateChatAckRequiredNotificationsWithAuditOptions,
) {
  try {
    const notificationResult = await createChatAckRequiredNotifications({
      projectId: options.projectId,
      messageId: options.messageId,
      messageBody: options.messageBody,
      senderUserId: options.actorUserId,
      requiredUserIds: options.requiredUserIds,
      dueAt: options.dueAt ? options.dueAt.toISOString() : null,
    });
    if (notificationResult.created <= 0) return;

    await logAudit({
      action: 'chat_ack_required_notifications_created',
      targetTable: 'chat_messages',
      targetId: options.messageId,
      metadata: {
        projectId: options.projectId,
        roomId: options.roomId,
        messageId: options.messageId,
        createdCount: notificationResult.created,
        recipientCount: notificationResult.recipients.length,
        recipientUserIds: notificationResult.recipients.slice(0, 20),
        recipientsTruncated: notificationResult.truncated,
        requiredUserCount: options.requiredUserIds.length,
        senderExcluded:
          notificationResult.recipients.includes(options.actorUserId) ===
            false && options.requiredUserIds.includes(options.actorUserId),
      } as Prisma.InputJsonValue,
      ...auditContextFromRequest(options.req, { userId: options.actorUserId }),
    });
  } catch (err) {
    options.req.log?.warn(
      {
        err,
        projectId: options.projectId,
        roomId: options.roomId,
        messageId: options.messageId,
        requiredUserCount: options.requiredUserIds.length,
      },
      'Failed to create chat ack required notifications',
    );
  }
}
