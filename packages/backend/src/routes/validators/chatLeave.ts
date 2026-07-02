import { Type } from '@sinclair/typebox';

const projectChatMentionsSchema = Type.Object(
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
);

export const projectChatMessageSchema = {
  body: Type.Object(
    {
      body: Type.String({ minLength: 1, maxLength: 2000 }),
      tags: Type.Optional(
        Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
      ),
      mentions: Type.Optional(projectChatMentionsSchema),
    },
    { additionalProperties: false },
  ),
};

export const projectChatReactionSchema = {
  body: Type.Object({
    emoji: Type.String({ minLength: 1, maxLength: 16 }),
  }),
};

export const projectChatAckRequestSchema = {
  body: Type.Object(
    {
      body: Type.String({ minLength: 1, maxLength: 2000 }),
      requiredUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      dueAt: Type.Optional(Type.String({ format: 'date-time' })),
      tags: Type.Optional(
        Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
      ),
      mentions: Type.Optional(projectChatMentionsSchema),
    },
    { additionalProperties: false },
  ),
};

export const chatAckPreviewSchema = {
  body: Type.Object(
    {
      requiredUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const chatAckRequestCancelSchema = {
  body: Type.Object(
    {
      reason: Type.Optional(Type.String({ maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

const chatAckLinkLimitSchema = Type.Optional(
  Type.Union([
    Type.Integer({ minimum: 1, maximum: 200 }),
    Type.String({ pattern: '^[0-9]+$', maxLength: 3 }),
  ]),
);

const chatAckLinkBaseQuerySchema = {
  limit: chatAckLinkLimitSchema,
};

export const chatAckLinkQuerySchema = {
  querystring: Type.Union([
    Type.Object(
      {
        ackRequestId: Type.String({ minLength: 1, maxLength: 200 }),
        messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        targetTable: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200 }),
        ),
        targetId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        ...chatAckLinkBaseQuerySchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        messageId: Type.String({ minLength: 1, maxLength: 200 }),
        ackRequestId: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200 }),
        ),
        targetTable: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200 }),
        ),
        targetId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        ...chatAckLinkBaseQuerySchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        targetTable: Type.String({ minLength: 1, maxLength: 200 }),
        targetId: Type.String({ minLength: 1, maxLength: 200 }),
        ackRequestId: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200 }),
        ),
        messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        ...chatAckLinkBaseQuerySchema,
      },
      { additionalProperties: false },
    ),
  ]),
};

const chatAckLinkBaseBodySchema = {
  targetTable: Type.String({ minLength: 1, maxLength: 200 }),
  targetId: Type.String({ minLength: 1, maxLength: 200 }),
  flowType: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  actionKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
};

export const chatAckLinkCreateSchema = {
  body: Type.Union([
    Type.Object(
      {
        ackRequestId: Type.String({ minLength: 1, maxLength: 200 }),
        messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        ...chatAckLinkBaseBodySchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        messageId: Type.String({ minLength: 1, maxLength: 200 }),
        ackRequestId: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200 }),
        ),
        ...chatAckLinkBaseBodySchema,
      },
      { additionalProperties: false },
    ),
  ]),
};

export const chatAckTemplateSchema = {
  body: Type.Object(
    {
      flowType: Type.String({ minLength: 1, maxLength: 200 }),
      actionKey: Type.String({ minLength: 1, maxLength: 200 }),
      messageBody: Type.String({ minLength: 1, maxLength: 2000 }),
      requiredUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      dueInHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 8760 })),
      remindIntervalHours: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 8760 }),
      ),
      escalationAfterHours: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 8760 }),
      ),
      escalationUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      escalationGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      escalationRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      isEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const chatAckTemplatePatchSchema = {
  body: Type.Object(
    {
      flowType: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      actionKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      messageBody: Type.Optional(
        Type.String({ minLength: 1, maxLength: 2000 }),
      ),
      requiredUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      requiredRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      dueInHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 8760 })),
      remindIntervalHours: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 8760 }),
      ),
      escalationAfterHours: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 8760 }),
      ),
      escalationUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      escalationGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      escalationRoles: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
      isEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const projectChatSummarySchema = {
  body: Type.Object(
    {
      since: Type.Optional(Type.String({ format: 'date-time' })),
      until: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
};

export const chatRoomCreateSchema = {
  body: Type.Object(
    {
      type: Type.Union([Type.Literal('private_group'), Type.Literal('dm')]),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      memberUserIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: 200,
        }),
      ),
      partnerUserId: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
};

export const chatRoomMemberAddSchema = {
  body: Type.Object(
    {
      userIds: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 200,
      }),
    },
    { additionalProperties: false },
  ),
};

export const chatRoomPatchSchema = {
  body: Type.Object(
    {
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      allowExternalUsers: Type.Optional(Type.Boolean()),
      allowExternalIntegrations: Type.Optional(Type.Boolean()),
      viewerGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          maxItems: 200,
        }),
      ),
      posterGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          maxItems: 200,
        }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const chatBreakGlassRequestSchema = {
  body: Type.Object(
    {
      projectId: Type.Optional(Type.String({ minLength: 1 })),
      roomId: Type.Optional(Type.String({ minLength: 1 })),
      viewerUserId: Type.Optional(Type.String({ minLength: 1 })),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.String({ minLength: 1, maxLength: 2000 }),
      targetFrom: Type.Optional(Type.String({ format: 'date-time' })),
      targetUntil: Type.Optional(Type.String({ format: 'date-time' })),
      ttlHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
    },
    { additionalProperties: false },
  ),
};

export const chatBreakGlassRejectSchema = {
  body: Type.Object(
    {
      reason: Type.String({ minLength: 1, maxLength: 2000 }),
    },
    { additionalProperties: false },
  ),
};

export const notificationPreferencePatchSchema = {
  body: Type.Object(
    {
      emailMode: Type.Optional(
        Type.Union([Type.Literal('realtime'), Type.Literal('digest')]),
      ),
      emailDigestIntervalMinutes: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 1440 }),
      ),
      muteAllUntil: Type.Optional(
        Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      ),
    },
    { additionalProperties: false },
  ),
};

export const chatRoomNotificationSettingPatchSchema = {
  body: Type.Object(
    {
      notifyAllPosts: Type.Optional(Type.Boolean()),
      notifyMentions: Type.Optional(Type.Boolean()),
      muteUntil: Type.Optional(
        Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      ),
    },
    { additionalProperties: false },
  ),
};

export const leaveRequestSchema = {
  body: Type.Object({
    userId: Type.String(),
    leaveType: Type.String(),
    startDate: Type.String({ format: 'date' }),
    endDate: Type.String({ format: 'date' }),
    // NOTE: `openapi-diff` flags it as a breaking change to introduce a new field with a
    // stricter schema when the previous schema allowed unknown properties. We keep these
    // fields schema-loose and validate in the handler.
    leaveUnit: Type.Optional(
      Type.Any({
        description:
          "Leave request unit. Allowed values are 'daily' and 'hourly' (validated in handler for backward compatibility).",
      }),
    ),
    startTime: Type.Optional(Type.Any()),
    endTime: Type.Optional(Type.Any()),
    hours: Type.Optional(Type.Number({ minimum: 0 })),
    notes: Type.Optional(Type.String()),
  }),
};

export const leaveLeaderListQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      status: Type.Optional(
        Type.Union([
          Type.Literal('pending_manager'),
          Type.Literal('approved'),
          Type.Literal('rejected'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveTypeListQuerySchema = {
  querystring: Type.Object(
    {
      includeInactive: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const leaveTypeCreateSchema = {
  body: Type.Object(
    {
      code: Type.String({ minLength: 1, maxLength: 50 }),
      name: Type.String({ minLength: 1, maxLength: 100 }),
      description: Type.Optional(
        Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
      ),
      isPaid: Type.Boolean(),
      unit: Type.Union([
        Type.Literal('daily'),
        Type.Literal('hourly'),
        Type.Literal('mixed'),
      ]),
      requiresApproval: Type.Boolean(),
      attachmentPolicy: Type.Union([
        Type.Literal('required'),
        Type.Literal('optional'),
        Type.Literal('none'),
      ]),
      submitLeadDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 365 })),
      allowRetroactiveSubmit: Type.Optional(Type.Boolean()),
      retroactiveLimitDays: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0, maximum: 365 }), Type.Null()]),
      ),
      applicableGroupIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
          maxItems: 200,
        }),
      ),
      displayOrder: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 100000 }),
      ),
      active: Type.Optional(Type.Boolean()),
      effectiveFrom: Type.Optional(Type.String({ format: 'date-time' })),
    },
    { additionalProperties: false },
  ),
};

export const leaveTypeUpdateSchema = {
  body: Type.Object(
    {
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      description: Type.Optional(
        Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
      ),
      isPaid: Type.Optional(Type.Boolean()),
      unit: Type.Optional(
        Type.Union([
          Type.Literal('daily'),
          Type.Literal('hourly'),
          Type.Literal('mixed'),
        ]),
      ),
      requiresApproval: Type.Optional(Type.Boolean()),
      attachmentPolicy: Type.Optional(
        Type.Union([
          Type.Literal('required'),
          Type.Literal('optional'),
          Type.Literal('none'),
        ]),
      ),
      submitLeadDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 365 })),
      allowRetroactiveSubmit: Type.Optional(Type.Boolean()),
      retroactiveLimitDays: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0, maximum: 365 }), Type.Null()]),
      ),
      applicableGroupIds: Type.Optional(
        Type.Union([
          Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
            maxItems: 200,
          }),
          Type.Null(),
        ]),
      ),
      displayOrder: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 100000 }),
      ),
      active: Type.Optional(Type.Boolean()),
      effectiveFrom: Type.Optional(Type.String({ format: 'date-time' })),
    },
    { additionalProperties: false },
  ),
};

export const leaveCompanyHolidayListQuerySchema = {
  querystring: Type.Object(
    {
      from: Type.Optional(Type.String({ format: 'date' })),
      to: Type.Optional(Type.String({ format: 'date' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 366 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveCompanyHolidayUpsertSchema = {
  body: Type.Object(
    {
      holidayDate: Type.String({ format: 'date' }),
      name: Type.Optional(Type.String({ maxLength: 200 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveWorkdayOverrideListQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      from: Type.Optional(Type.String({ format: 'date' })),
      to: Type.Optional(Type.String({ format: 'date' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 366 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveWorkdayOverrideUpsertSchema = {
  body: Type.Object(
    {
      userId: Type.String({ minLength: 1 }),
      workDate: Type.String({ format: 'date' }),
      workMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
      reasonText: Type.Optional(Type.String({ maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveEntitlementBalanceQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      leaveRequestId: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveEntitlementProfileUpsertSchema = {
  body: Type.Object(
    {
      userId: Type.String({ minLength: 1 }),
      paidLeaveBaseDate: Type.String({ format: 'date' }),
      nextGrantDueDate: Type.Optional(
        Type.Union([Type.String({ format: 'date' }), Type.Null()]),
      ),
    },
    { additionalProperties: false },
  ),
};

export const leaveGrantCreateSchema = {
  body: Type.Object(
    {
      userId: Type.String({ minLength: 1 }),
      grantedMinutes: Type.Integer({ minimum: 1, maximum: 527040 }),
      grantDate: Type.Optional(Type.String({ format: 'date' })),
      expiresAt: Type.Optional(
        Type.Union([Type.String({ format: 'date' }), Type.Null()]),
      ),
      reasonText: Type.String({ minLength: 1, maxLength: 2000 }),
    },
    { additionalProperties: false },
  ),
};

export const leaveGrantListQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveCompGrantCreateSchema = {
  body: Type.Object(
    {
      userId: Type.String({ minLength: 1 }),
      leaveType: Type.Union([
        Type.Literal('compensatory'),
        Type.Literal('substitute'),
      ]),
      sourceDate: Type.String({ format: 'date' }),
      grantDate: Type.Optional(Type.String({ format: 'date' })),
      expiresAt: Type.String({ format: 'date' }),
      grantedMinutes: Type.Integer({ minimum: 1, maximum: 527040 }),
      reasonText: Type.String({ minLength: 1, maxLength: 2000 }),
      sourceTimeEntryIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          maxItems: 200,
        }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const leaveCompGrantListQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      leaveType: Type.Optional(
        Type.Union([Type.Literal('compensatory'), Type.Literal('substitute')]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveCompBalanceQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      leaveType: Type.Optional(
        Type.Union([Type.Literal('compensatory'), Type.Literal('substitute')]),
      ),
      asOfDate: Type.Optional(Type.String({ format: 'date' })),
    },
    { additionalProperties: false },
  ),
};

export const leaveHrSummaryQuerySchema = {
  querystring: Type.Object(
    {
      asOfDate: Type.Optional(Type.String({ format: 'date' })),
      staleDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
      expiringWithinDays: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 365 }),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveHrLedgerQuerySchema = {
  querystring: Type.Object(
    {
      userId: Type.Optional(Type.String({ minLength: 1 })),
      from: Type.Optional(Type.String({ format: 'date' })),
      to: Type.Optional(Type.String({ format: 'date' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      format: Type.Optional(
        Type.Union([Type.Literal('json'), Type.Literal('csv')]),
      ),
    },
    { additionalProperties: false },
  ),
};
