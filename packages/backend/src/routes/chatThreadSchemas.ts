import { Type } from '@sinclair/typebox';

const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableDate = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null(),
]);

const ackSchema = Type.Object(
  {
    id: Type.String(),
    requestId: Type.String(),
    userId: Type.String(),
    ackedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

const ackRequestSchema = Type.Object(
  {
    id: Type.String(),
    messageId: Type.String(),
    roomId: Type.String(),
    requiredUserIds: Type.Any(),
    requestedUserIds: Type.Any(),
    requestedGroupIds: Type.Any(),
    requestedRoles: Type.Any(),
    dueAt: nullableDate,
    remindIntervalHours: Type.Union([Type.Integer(), Type.Null()]),
    escalationAfterHours: Type.Union([Type.Integer(), Type.Null()]),
    escalationUserIds: Type.Any(),
    escalationGroupIds: Type.Any(),
    escalationRoles: Type.Any(),
    templateId: nullableString,
    canceledAt: nullableDate,
    canceledBy: nullableString,
    createdAt: Type.String({ format: 'date-time' }),
    createdBy: nullableString,
    acks: Type.Array(ackSchema),
  },
  { additionalProperties: false },
);

const attachmentSchema = Type.Object(
  {
    id: Type.String(),
    originalName: Type.String(),
    mimeType: nullableString,
    sizeBytes: Type.Union([Type.Integer(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    createdBy: nullableString,
  },
  { additionalProperties: false },
);

const knowledgeShareSummarySchema = Type.Object(
  {
    shareId: Type.String(),
    status: Type.Union([Type.Literal('posted'), Type.Literal('revoked')]),
    version: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Literal(1),
  },
  { additionalProperties: false },
);

const messageProperties = {
  id: Type.String(),
  roomId: Type.String(),
  messageType: Type.Literal('text'),
  parentMessageId: nullableString,
  threadRootId: nullableString,
  userId: Type.String(),
  body: nullableString,
  tags: Type.Any(),
  reactions: Type.Any(),
  mentions: Type.Any(),
  mentionsAll: Type.Boolean(),
  ackRequest: Type.Union([ackRequestSchema, Type.Null()]),
  attachments: Type.Array(attachmentSchema),
  createdAt: Type.String({ format: 'date-time' }),
  createdBy: nullableString,
  updatedAt: Type.String({ format: 'date-time' }),
  updatedBy: nullableString,
  deletedAt: nullableDate,
  deletedReason: nullableString,
  deleted: Type.Boolean(),
} as const;

const messageSchema = Type.Object(messageProperties, {
  additionalProperties: false,
});

const replyCreateResponseSchema = Type.Object(
  {
    ...messageProperties,
    warning: Type.Optional(
      Type.Object(
        {
          code: Type.Literal('POST_WITHOUT_VIEW'),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const rootSchema = Type.Object(
  {
    ...messageProperties,
    replyCount: Type.Integer({ minimum: 0 }),
    lastReplyAt: nullableDate,
  },
  { additionalProperties: false },
);

const { deleted: _deletedTimelineProperty, ...rootTimelineProperties } =
  messageProperties;

const rootTimelineMessageSchema = Type.Object(
  {
    ...rootTimelineProperties,
    replyCount: Type.Integer({ minimum: 0 }),
    lastReplyAt: nullableDate,
  },
  { additionalProperties: false },
);

export const chatRootTimelineListResponseSchema = Type.Object(
  { items: Type.Array(rootTimelineMessageSchema) },
  { additionalProperties: false },
);

export const chatKnowledgeShareSummaryListResponseSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          messageId: Type.String(),
          ...knowledgeShareSummarySchema.properties,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const projectChatTimelineParamsSchema = Type.Object(
  { projectId: Type.String() },
  { additionalProperties: false },
);

export const projectChatTimelineQuerySchema = Type.Object({
  limit: Type.Optional(Type.String()),
  before: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
});

export const chatRoomTimelineParamsSchema = Type.Object(
  { roomId: Type.String() },
  { additionalProperties: false },
);

export const chatRoomTimelineQuerySchema = Type.Object({
  limit: Type.Optional(Type.String()),
  before: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
  q: Type.Optional(Type.String()),
});

export const chatApiErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const chatTimelineNotFoundResponseSchema = Type.Object(
  { error: Type.Literal('not_found') },
  { additionalProperties: false },
);

const chatSearchRoomSchema = Type.Object(
  {
    id: Type.String(),
    type: Type.String(),
    name: Type.String(),
    isOfficial: Type.Boolean(),
    projectId: nullableString,
    projectCode: nullableString,
    projectName: nullableString,
    groupId: nullableString,
    allowExternalUsers: Type.Boolean(),
    allowExternalIntegrations: Type.Boolean(),
  },
  { additionalProperties: false },
);

const chatSearchItemSchema = Type.Object(
  {
    id: Type.String(),
    roomId: Type.String(),
    messageType: Type.Literal('text'),
    parentMessageId: nullableString,
    threadRootId: nullableString,
    userId: Type.String(),
    body: Type.String(),
    tags: Type.Any(),
    createdAt: Type.String({ format: 'date-time' }),
    room: chatSearchRoomSchema,
  },
  { additionalProperties: false },
);

export const chatMessageSearchSchema = {
  querystring: Type.Object(
    {
      q: Type.Optional(Type.String()),
      limit: Type.Optional(Type.String()),
      before: Type.Optional(Type.String()),
      beforeId: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  response: {
    200: Type.Object(
      {
        items: Type.Array(chatSearchItemSchema),
        nextBefore: nullableDate,
        nextBeforeId: nullableString,
      },
      { additionalProperties: false },
    ),
    400: chatApiErrorResponseSchema,
  },
};

const chatReadStateResponseSchema = Type.Object(
  {
    lastReadAt: Type.String({ format: 'date-time' }),
    lastReadMessageId: nullableString,
  },
  { additionalProperties: false },
);

export const projectChatReadStateSchema = {
  description:
    'Optional body accepts through (date-time) and optional throughMessageId (1..200 characters). The request body remains absent from OpenAPI to preserve the legacy bodyless/untyped client contract; application validation is fail-closed.',
  params: Type.Object(
    { projectId: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false },
  ),
  response: {
    200: chatReadStateResponseSchema,
    400: chatApiErrorResponseSchema,
    403: chatApiErrorResponseSchema,
    404: chatApiErrorResponseSchema,
  },
};

export const chatRoomReadStateSchema = {
  description:
    'Optional body accepts through (date-time) and optional throughMessageId (1..200 characters). The request body remains absent from OpenAPI to preserve the legacy bodyless/untyped client contract; application validation is fail-closed.',
  params: Type.Object(
    { roomId: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false },
  ),
  response: {
    200: chatReadStateResponseSchema,
    400: chatApiErrorResponseSchema,
    403: chatApiErrorResponseSchema,
    404: chatApiErrorResponseSchema,
  },
};

export const chatReactionMessageResponseSchema = Type.Object(
  {
    id: Type.String(),
    roomId: Type.String(),
    messageType: Type.Literal('text'),
    parentMessageId: nullableString,
    threadRootId: nullableString,
    userId: Type.String(),
    body: Type.String(),
    tags: Type.Any(),
    reactions: Type.Any(),
    mentions: Type.Any(),
    mentionsAll: Type.Boolean(),
    createdAt: Type.String({ format: 'date-time' }),
    createdBy: nullableString,
    updatedAt: Type.String({ format: 'date-time' }),
    updatedBy: nullableString,
    deletedAt: nullableDate,
    deletedReason: nullableString,
  },
  { additionalProperties: false },
);

export const chatThreadGetSchema = {
  params: Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false },
  ),
  querystring: Type.Object(
    {
      limit: Type.Optional(
        Type.String({
          pattern: '^(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|200)$',
          maxLength: 3,
        }),
      ),
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    },
    { additionalProperties: false },
  ),
  response: {
    200: Type.Object(
      {
        root: rootSchema,
        replies: Type.Array(messageSchema),
        replyCount: Type.Integer({ minimum: 0 }),
        lastReplyAt: nullableDate,
        nextCursor: nullableString,
      },
      { additionalProperties: false },
    ),
    400: chatApiErrorResponseSchema,
    404: chatApiErrorResponseSchema,
  },
};

export const chatThreadReplyCreateSchema = {
  params: Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false },
  ),
  body: Type.Object(
    {
      body: Type.String({ minLength: 1, maxLength: 2000 }),
      tags: Type.Optional(
        Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
      ),
      mentions: Type.Optional(
        Type.Object(
          {
            userIds: Type.Optional(
              Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 }),
            ),
            groupIds: Type.Optional(
              Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
            ),
            all: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  response: {
    201: replyCreateResponseSchema,
    404: chatApiErrorResponseSchema,
    429: chatApiErrorResponseSchema,
  },
};

export const chatMessageDeleteSchema = {
  params: Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false },
  ),
  body: Type.Object(
    {
      reason: Type.Union([
        Type.Literal('user_retract'),
        Type.Literal('admin_moderation'),
      ]),
    },
    { additionalProperties: false },
  ),
  response: {
    200: Type.Object(
      {
        id: Type.String(),
        roomId: Type.String(),
        parentMessageId: nullableString,
        threadRootId: nullableString,
        deletedAt: Type.String({ format: 'date-time' }),
        deletedReason: Type.Union([
          Type.Literal('user_retract'),
          Type.Literal('admin_moderation'),
        ]),
      },
      { additionalProperties: false },
    ),
    404: chatApiErrorResponseSchema,
  },
};
