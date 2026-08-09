export type ChatRoomTestValue = {
  id: string;
  type: string;
  name: string;
  allowExternalIntegrations?: boolean | null;
  isMember?: boolean | null;
  isOfficial?: boolean | null;
  projectCode?: string | null;
  projectName?: string | null;
};

export type ChatMessageTestValue = {
  id: string;
  roomId: string;
  messageType?: 'text';
  parentMessageId?: string | null;
  threadRootId?: string | null;
  userId: string;
  body: string;
  createdAt: string;
  reactions?: Record<string, number>;
  ackRequest?: {
    id: string;
    messageId: string;
    roomId: string;
    requiredUserIds: string[];
    dueAt: string | null;
    canceledAt: string | null;
    canceledBy: string | null;
    acks: Array<{
      id: string;
      requestId: string;
      userId: string;
      ackedAt: string;
    }>;
  } | null;
};

export type ChatSearchItemTestValue = {
  id: string;
  roomId: string;
  messageType?: 'text';
  parentMessageId?: string | null;
  threadRootId?: string | null;
  userId: string;
  body: string;
  createdAt: string;
  room: ChatRoomTestValue;
};

export type RoomChatApiMockOptions = {
  rooms: ChatRoomTestValue[];
  messagesByRoom: Record<string, ChatMessageTestValue[]>;
  messageReadResultsByRoom?: Record<
    string,
    Array<ChatMessageTestValue[] | Error>
  >;
  unreadByRoom?: Record<
    string,
    { unreadCount?: number; lastReadAt?: string | null }
  >;
  notificationSettingsByRoom?: Record<
    string,
    {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    }
  >;
  mentionCandidatesByRoom?: Record<string, unknown>;
  failOnSearch?: string[];
  searchResultsByQuery?: Record<string, ChatMessageTestValue[]>;
  failOnGlobalSearch?: string[];
  globalSearchResultsByQuery?: Record<string, ChatSearchItemTestValue[]>;
  failOnExternalSummary?: string[];
  notificationSettingPatchBodies?: Array<{
    roomId: string;
    body: {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    };
  }>;
  notificationSettingsSaveResponseByRoom?: Record<
    string,
    {
      notifyAllPosts?: boolean;
      notifyMentions?: boolean;
      muteUntil?: string | null;
    }
  >;
  failOnNotificationSave?: string[];
  postedMessages?: Array<{ roomId: string; body: unknown }>;
  postMessageResponse?: ChatMessageTestValue & {
    warning?: { code?: string; message?: string };
  };
  postMessageResults?: Array<
    | (ChatMessageTestValue & {
        warning?: { code?: string; message?: string };
      })
    | Error
  >;
  postAckResponse?: ChatMessageTestValue & {
    warning?: { code?: string; message?: string };
  };
  postAckResults?: Array<
    | (ChatMessageTestValue & {
        warning?: { code?: string; message?: string };
      })
    | Error
  >;
  failMessageRefreshAfterPost?: boolean;
  failAttachmentUpload?: boolean;
  postMessagePromise?: Promise<
    ChatMessageTestValue & { warning?: { code?: string; message?: string } }
  >;
  threadsByMessageId?: Record<
    string,
    {
      root: ChatMessageTestValue;
      replies: ChatMessageTestValue[];
      replyCount: number;
      lastReplyAt: string | null;
      nextCursor: string | null;
    }
  >;
  threadResultsByMessageId?: Record<
    string,
    Array<
      | {
          root: ChatMessageTestValue;
          replies: ChatMessageTestValue[];
          replyCount: number;
          lastReplyAt: string | null;
          nextCursor: string | null;
        }
      | Error
    >
  >;
  threadReplyResponse?: ChatMessageTestValue & {
    warning?: { code?: string; message?: string };
  };
  rootMutationErrors?: Record<string, Error>;
};

export type DeferredTestValue<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};
