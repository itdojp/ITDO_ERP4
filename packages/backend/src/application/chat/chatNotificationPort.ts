export type ChatNotificationCreateResult = {
  created: number;
  recipients: string[];
  truncated: boolean;
  usesProjectMemberFallback?: boolean;
};

export function toChatNotificationExcerpt(messageBody: string) {
  return messageBody.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export type ChatNotificationFilterScope =
  'global' | 'chat_mentions' | 'chat_all_posts';

export type ChatNotificationFilterResult = {
  allowed: string[];
  muted: string[];
};

export type ChatMentionNotificationEvent = {
  projectId?: string | null;
  roomId?: string | null;
  messageId: string;
  messageExcerpt: string;
  senderUserId: string;
  mentionUserIds: string[];
  mentionGroupIds: string[];
  mentionAll: boolean;
};

export type ChatMessageNotificationEvent = {
  projectId?: string | null;
  roomId: string;
  messageId: string;
  messageExcerpt: string;
  senderUserId: string;
  recipientUserIds: string[];
  excludeUserIds?: string[];
};

export type ChatAckRequiredNotificationEvent = {
  projectId: string | null;
  roomId?: string | null;
  messageId: string;
  messageExcerpt: string;
  senderUserId: string;
  requiredUserIds: string[];
  dueAt?: string | null;
};

export type ChatNotificationRecipientFilter = {
  kind: string;
  userIds: string[];
  roomId?: string | null;
  scope: ChatNotificationFilterScope;
  client?: unknown;
  now?: Date;
};

export type ChatNotificationPort = {
  createMentionNotifications(
    event: ChatMentionNotificationEvent,
  ): Promise<ChatNotificationCreateResult>;
  createMessageNotifications(
    event: ChatMessageNotificationEvent,
  ): Promise<ChatNotificationCreateResult>;
  createAckRequiredNotifications(
    event: ChatAckRequiredNotificationEvent,
  ): Promise<ChatNotificationCreateResult>;
  filterRecipients(
    filter: ChatNotificationRecipientFilter,
  ): Promise<ChatNotificationFilterResult>;
};
