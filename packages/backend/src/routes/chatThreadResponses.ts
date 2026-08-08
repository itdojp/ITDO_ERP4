import type {
  ChatRootTimelineMessage,
  ChatThreadMessage,
} from '../application/chat/chatThreadPorts.js';

function mapAckRequest(value: ChatThreadMessage['ackRequest']) {
  if (!value) return null;
  return {
    id: value.id,
    messageId: value.messageId,
    roomId: value.roomId,
    requiredUserIds: value.requiredUserIds,
    requestedUserIds: value.requestedUserIds,
    requestedGroupIds: value.requestedGroupIds,
    requestedRoles: value.requestedRoles,
    dueAt: value.dueAt?.toISOString() ?? null,
    remindIntervalHours: value.remindIntervalHours,
    escalationAfterHours: value.escalationAfterHours,
    escalationUserIds: value.escalationUserIds,
    escalationGroupIds: value.escalationGroupIds,
    escalationRoles: value.escalationRoles,
    templateId: value.templateId,
    canceledAt: value.canceledAt?.toISOString() ?? null,
    canceledBy: value.canceledBy,
    createdAt: value.createdAt.toISOString(),
    createdBy: value.createdBy,
    acks: value.acks.map((ack) => ({
      id: ack.id,
      requestId: ack.requestId,
      userId: ack.userId,
      ackedAt: ack.ackedAt.toISOString(),
    })),
  };
}

export function chatThreadMessageResponse(message: ChatThreadMessage) {
  return {
    id: message.id,
    roomId: message.roomId,
    messageType: message.messageType,
    parentMessageId: message.parentMessageId,
    threadRootId: message.threadRootId,
    userId: message.userId,
    body: message.body,
    tags: message.tags,
    reactions: message.reactions,
    mentions: message.mentions,
    mentionsAll: message.mentionsAll,
    ackRequest: mapAckRequest(message.ackRequest),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt.toISOString(),
      createdBy: attachment.createdBy,
    })),
    createdAt: message.createdAt.toISOString(),
    createdBy: message.createdBy,
    updatedAt: message.updatedAt.toISOString(),
    updatedBy: message.updatedBy,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    deletedReason: message.deletedReason,
    deleted: message.deletedAt !== null,
  };
}

export function chatRootTimelineMessageResponse(
  message: ChatRootTimelineMessage,
) {
  const { deleted: _deleted, ...response } = chatThreadMessageResponse(message);
  return {
    ...response,
    replyCount: message.replyCount,
    lastReplyAt: message.lastReplyAt?.toISOString() ?? null,
  };
}
