export const chatThreadLimits = {
  id: 200,
  cursor: 1024,
  pageDefault: 50,
  pageMax: 200,
} as const;

export type ChatThreadActor = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export type ChatThreadRoom = {
  id: string;
  type: string;
  projectId?: string | null;
  isOfficial: boolean;
  groupId: string | null;
  viewerGroupIds?: unknown;
  posterGroupIds?: unknown;
  allowExternalUsers: boolean;
};

export type ChatReplyTarget = {
  rootMessageId: string;
  room: ChatThreadRoom;
  postWithoutView: boolean;
};

export type ChatReplyAckDraft = {
  requiredUserIds: string[];
  requestedUserIds: string[];
  requestedGroupIds: string[];
  requestedRoles: string[];
  dueAt?: Date;
};

export type ChatReplyDraft = {
  body: string;
  tags?: string[];
  mentions: unknown;
  mentionsAll: boolean;
  ackRequest?: ChatReplyAckDraft;
};

export type ChatThreadBoundary = {
  createdAt: Date;
  id: string;
};

export type ChatThreadAck = {
  id: string;
  requestId: string;
  userId: string;
  ackedAt: Date;
};

export type ChatThreadAckRequest = {
  id: string;
  messageId: string;
  roomId: string;
  requiredUserIds: unknown;
  requestedUserIds: unknown;
  requestedGroupIds: unknown;
  requestedRoles: unknown;
  dueAt: Date | null;
  remindIntervalHours: number | null;
  escalationAfterHours: number | null;
  escalationUserIds: unknown;
  escalationGroupIds: unknown;
  escalationRoles: unknown;
  templateId: string | null;
  canceledAt: Date | null;
  canceledBy: string | null;
  createdAt: Date;
  createdBy: string | null;
  acks: ChatThreadAck[];
};

export type ChatThreadAttachment = {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  createdBy: string | null;
};

export type ChatKnowledgeShareSummary = {
  shareId: string;
  status: 'posted' | 'revoked';
  version: number;
  schemaVersion: 1;
};

export type ChatKnowledgeShareMessageSummary = ChatKnowledgeShareSummary & {
  messageId: string;
};

export type ChatThreadMessage = {
  id: string;
  roomId: string;
  messageType: 'text';
  parentMessageId: string | null;
  threadRootId: string | null;
  userId: string;
  body: string | null;
  tags: unknown;
  reactions: unknown;
  mentions: unknown;
  mentionsAll: boolean;
  ackRequest: ChatThreadAckRequest | null;
  attachments: ChatThreadAttachment[];
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedReason: string | null;
};

export type ChatRootTimelineMessage = ChatThreadMessage & {
  body: string;
  replyCount: number;
  lastReplyAt: Date | null;
};

export type ChatRootTimelineInput = {
  roomId: string;
  actor: ChatThreadActor;
  limit: number;
  before?: Date;
  tag?: string;
  query?: string;
};

export type ChatThreadSnapshot = {
  root: ChatThreadMessage;
  replies: ChatThreadMessage[];
  replyCount: number;
  lastReplyAt: Date | null;
  hasMore: boolean;
};

export type ChatThreadSnapshotRepository = {
  resolveMessage(messageId: string): Promise<{
    id: string;
    roomId: string;
    parentMessageId: string | null;
    threadRootId: string | null;
  } | null>;
  canReadRoom(roomId: string, actor: ChatThreadActor): Promise<boolean>;
  readThread(input: {
    roomId: string;
    rootMessageId: string;
    boundary?: ChatThreadBoundary;
    limit: number;
  }): Promise<ChatThreadSnapshot | null>;
};

export type ChatThreadRepository = {
  listRootTimeline(
    input: ChatRootTimelineInput,
  ): Promise<ChatRootTimelineMessage[] | null>;
  listKnowledgeShareSummaries(input: {
    roomId: string;
    actor: ChatThreadActor;
    messageIds: string[];
  }): Promise<ChatKnowledgeShareMessageSummary[] | null>;
  withReadSnapshot<T>(
    operation: (repository: ChatThreadSnapshotRepository) => Promise<T>,
  ): Promise<T>;
  prepareReply(input: {
    rootMessageId: string;
    expectedRoomId?: string;
    actor: ChatThreadActor;
  }): Promise<ChatReplyTarget | null>;
  createReply(input: {
    rootMessageId: string;
    expectedRoomId?: string;
    actor: ChatThreadActor;
    draft: ChatReplyDraft;
  }): Promise<{
    target: ChatReplyTarget;
    message: ChatThreadMessage;
  } | null>;
};

export type ChatThreadCursorCodec = {
  encode(input: {
    actor: ChatThreadActor;
    rootMessageId: string;
    boundary: ChatThreadBoundary;
  }): string;
  decode(input: {
    actor: ChatThreadActor;
    rootMessageId: string;
    cursor: string;
  }): ChatThreadBoundary;
};
