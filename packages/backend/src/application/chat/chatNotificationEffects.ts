import type { Prisma } from '@prisma/client';

import type { AuditContext } from '../../services/audit.js';
import { logAudit } from '../../services/audit.js';
import {
  expandRoomMentionRecipients,
  resolveRoomAudienceUserIds,
} from '../../services/chatMentionRecipients.js';
import {
  toChatNotificationExcerpt,
  type ChatNotificationPort,
} from './chatNotificationPort.js';

type ChatNotificationLogger = {
  warn?: (payload: unknown, message: string) => void;
};

export type ChatNotificationRoom = {
  id: string;
  type: string;
  groupId: string | null;
  viewerGroupIds?: unknown;
  allowExternalUsers: boolean;
};

function resolveProjectId(
  room: ChatNotificationRoom,
  projectId?: string | null,
) {
  if (projectId !== undefined) return projectId;
  return room.type === 'project' ? room.id : null;
}

export async function tryCreateChatMentionNotificationEffects(options: {
  auditContext: AuditContext;
  logger?: ChatNotificationLogger;
  failureMessage?: string;
  notificationPort: ChatNotificationPort;
  room: ChatNotificationRoom;
  projectId?: string | null;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  mentionsAll: boolean;
  mentionUserIds: string[];
  mentionGroupIds: string[];
}) {
  const projectId = resolveProjectId(options.room, options.projectId);
  try {
    const mentionUserIds = await expandRoomMentionRecipients({
      room: options.room,
      mentionUserIds: options.mentionUserIds,
      mentionGroupIds: options.mentionGroupIds,
      mentionsAll: options.mentionsAll,
    });
    const notificationResult =
      await options.notificationPort.createMentionNotifications({
        projectId,
        roomId: options.room.id,
        messageId: options.messageId,
        messageExcerpt: toChatNotificationExcerpt(options.messageBody),
        senderUserId: options.senderUserId,
        mentionUserIds,
        mentionGroupIds: options.mentionGroupIds,
        mentionAll: options.mentionsAll,
      });
    if (notificationResult.created <= 0) {
      return notificationResult.recipients;
    }

    await logAudit({
      action: 'chat_mention_notifications_created',
      targetTable: 'chat_messages',
      targetId: options.messageId,
      metadata: {
        roomId: options.room.id,
        projectId,
        messageId: options.messageId,
        createdCount: notificationResult.created,
        recipientCount: notificationResult.recipients.length,
        recipientUserIds: notificationResult.recipients.slice(0, 20),
        recipientsTruncated: notificationResult.truncated,
        mentionAll: options.mentionsAll,
        mentionUserCount: mentionUserIds.length,
        mentionGroupCount: options.mentionGroupIds.length,
        usesProjectMemberFallback: notificationResult.usesProjectMemberFallback,
      } as Prisma.InputJsonValue,
      ...options.auditContext,
    });
    return notificationResult.recipients;
  } catch (err) {
    options.logger?.warn?.(
      { err, roomId: options.room.id, messageId: options.messageId },
      options.failureMessage ?? 'Failed to create chat mention notifications',
    );
  }
  return [];
}

export async function tryCreateChatMessageNotificationEffects(options: {
  auditContext: AuditContext;
  logger?: ChatNotificationLogger;
  failureMessage?: string;
  notificationPort: ChatNotificationPort;
  room: ChatNotificationRoom;
  projectId?: string | null;
  messageId: string;
  messageBody: string;
  senderUserId: string;
  excludeUserIds?: string[];
}) {
  const projectId = resolveProjectId(options.room, options.projectId);
  try {
    const audience = await resolveRoomAudienceUserIds({
      room: options.room,
    });
    if (audience.size === 0) return [];
    const notificationResult =
      await options.notificationPort.createMessageNotifications({
        projectId,
        roomId: options.room.id,
        messageId: options.messageId,
        messageExcerpt: toChatNotificationExcerpt(options.messageBody),
        senderUserId: options.senderUserId,
        recipientUserIds: Array.from(audience),
        excludeUserIds: options.excludeUserIds,
      });
    if (notificationResult.created <= 0) {
      return notificationResult.recipients;
    }

    await logAudit({
      action: 'chat_message_notifications_created',
      targetTable: 'chat_messages',
      targetId: options.messageId,
      metadata: {
        roomId: options.room.id,
        projectId,
        messageId: options.messageId,
        createdCount: notificationResult.created,
        recipientCount: notificationResult.recipients.length,
        recipientUserIds: notificationResult.recipients.slice(0, 20),
        recipientsTruncated: notificationResult.truncated,
        audienceCount: audience.size,
        excludedCount: options.excludeUserIds?.length ?? 0,
      } as Prisma.InputJsonValue,
      ...options.auditContext,
    });
    return notificationResult.recipients;
  } catch (err) {
    options.logger?.warn?.(
      { err, roomId: options.room.id, messageId: options.messageId },
      options.failureMessage ?? 'Failed to create chat message notifications',
    );
  }
  return [];
}
