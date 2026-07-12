import type { ChatNotificationPort } from '../../application/chat/chatNotificationPort.js';
import {
  createChatAckRequiredNotifications,
  createChatMentionNotifications,
  createChatMessageNotifications,
  filterNotificationRecipients,
} from '../../services/appNotifications.js';

export const defaultChatNotificationPort: ChatNotificationPort = {
  createMentionNotifications(event) {
    const { messageExcerpt, ...rest } = event;
    return createChatMentionNotifications({
      ...rest,
      messageBody: messageExcerpt,
    });
  },
  createMessageNotifications(event) {
    const { messageExcerpt, ...rest } = event;
    return createChatMessageNotifications({
      ...rest,
      messageBody: messageExcerpt,
    });
  },
  createAckRequiredNotifications(event) {
    const { messageExcerpt, ...rest } = event;
    return createChatAckRequiredNotifications({
      ...rest,
      messageBody: messageExcerpt,
    });
  },
  filterRecipients(filter) {
    return filterNotificationRecipients(
      filter as Parameters<typeof filterNotificationRecipients>[0],
    );
  },
};
