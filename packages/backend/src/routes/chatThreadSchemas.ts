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
