import { Type } from '@sinclair/typebox';
import { flowTypeSchema } from './shared.js';

export const approvalActionSchema = {
  body: Type.Object({
    action: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
    reason: Type.Optional(Type.String()),
  }),
};

export const approvalCancelSchema = {
  body: Type.Object(
    {
      reason: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const evidenceSnapshotCreateSchema = {
  body: Type.Object(
    {
      forceRegenerate: Type.Optional(Type.Boolean()),
      reasonText: Type.Optional(Type.String({ maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const evidenceSnapshotHistoryQuerySchema = {
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    },
    { additionalProperties: false },
  ),
};

export const evidenceSnapshotDiffQuerySchema = {
  querystring: Type.Object(
    {
      fromVersion: Type.Optional(Type.Integer({ minimum: 1 })),
      toVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
};

export const evidencePackExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(
        Type.Union([Type.Literal('json'), Type.Literal('pdf')]),
      ),
      version: Type.Optional(Type.Integer({ minimum: 1 })),
      mask: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 1,
          description: '0 is available only for admin/mgmt',
        }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const evidencePackArchiveBodySchema = {
  body: Type.Object(
    {
      format: Type.Optional(
        Type.Union([Type.Literal('json'), Type.Literal('pdf')]),
      ),
      version: Type.Optional(Type.Integer({ minimum: 1 })),
      mask: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 1,
          description: '0 is available only for admin/mgmt',
        }),
      ),
    },
    { additionalProperties: false },
  ),
};

const approvalStepSchema = Type.Object(
  {
    stepOrder: Type.Optional(Type.Number({ minimum: 1 })),
    approverGroupId: Type.Optional(Type.String()),
    approverUserId: Type.Optional(Type.String()),
    parallelKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const approvalStageApproverSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('group'), Type.Literal('user')]),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const approvalStageCompletionSchema = Type.Union([
  Type.Object({ mode: Type.Literal('all') }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal('any') }, { additionalProperties: false }),
  Type.Object(
    { mode: Type.Literal('quorum'), quorum: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  ),
]);

const approvalStageSchema = Type.Object(
  {
    order: Type.Integer({ minimum: 1 }),
    label: Type.Optional(Type.String()),
    completion: Type.Optional(approvalStageCompletionSchema),
    approvers: Type.Array(approvalStageApproverSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const approvalStagesSchema = Type.Object(
  {
    stages: Type.Array(approvalStageSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const flowFlagsSchema = Type.Union([
  Type.Array(Type.String()),
  Type.Record(Type.String(), Type.Boolean()),
]);

const approvalConditionSchema = Type.Object(
  {
    amountMin: Type.Optional(Type.Number({ minimum: 0 })),
    amountMax: Type.Optional(Type.Number({ minimum: 0 })),
    skipUnder: Type.Optional(Type.Number({ minimum: 0 })),
    execThreshold: Type.Optional(Type.Number({ minimum: 0 })),
    isRecurring: Type.Optional(Type.Boolean()),
    projectType: Type.Optional(Type.String()),
    customerId: Type.Optional(Type.String()),
    orgUnitId: Type.Optional(Type.String()),
    flowFlags: Type.Optional(flowFlagsSchema),
    minAmount: Type.Optional(Type.Number({ minimum: 0 })),
    maxAmount: Type.Optional(Type.Number({ minimum: 0 })),
    skipSmallUnder: Type.Optional(Type.Number({ minimum: 0 })),
    appliesTo: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

export const approvalRuleSchema = {
  body: Type.Object(
    {
      flowType: flowTypeSchema,
      version: Type.Optional(Type.Integer({ minimum: 1 })),
      isActive: Type.Optional(Type.Boolean()),
      effectiveFrom: Type.Optional(Type.String({ format: 'date-time' })),
      effectiveTo: Type.Optional(
        Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      ),
      supersedesRuleId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      conditions: Type.Optional(approvalConditionSchema),
      steps: Type.Union([
        Type.Array(approvalStepSchema, { minItems: 1 }),
        approvalStagesSchema,
      ]),
    },
    { additionalProperties: false },
  ),
};

export const approvalRulePatchSchema = {
  body: Type.Partial(approvalRuleSchema.body),
};

const actionPolicySubjectsSchema = Type.Union([
  Type.Null(),
  Type.Object(
    {
      roles: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      groupIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      userIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    },
    { additionalProperties: true },
  ),
]);

const actionPolicyStateConstraintsSchema = Type.Union([
  Type.Null(),
  Type.Object(
    {
      statusIn: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      statusNotIn: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    },
    { additionalProperties: true },
  ),
]);

// NOTE: Keep this schema intentionally wide for backward compatibility.
// Guard payloads are validated fail-safe by the evaluator itself.
const actionPolicyGuardsSchema = Type.Any();

export const actionPolicySchema = {
  body: Type.Object(
    {
      flowType: flowTypeSchema,
      actionKey: Type.String({ minLength: 1, maxLength: 100 }),
      priority: Type.Optional(Type.Integer()),
      isEnabled: Type.Optional(Type.Boolean()),
      subjects: Type.Optional(actionPolicySubjectsSchema),
      stateConstraints: Type.Optional(actionPolicyStateConstraintsSchema),
      requireReason: Type.Optional(Type.Boolean()),
      guards: Type.Optional(actionPolicyGuardsSchema),
    },
    { additionalProperties: false },
  ),
};

export const actionPolicyPatchSchema = {
  body: Type.Partial(actionPolicySchema.body),
};

export const actionPolicyEvaluateSchema = {
  body: Type.Object(
    {
      flowType: flowTypeSchema,
      actionKey: Type.String({ minLength: 1, maxLength: 100 }),
      state: Type.Optional(Type.Any()),
      targetTable: Type.Optional(Type.String({ minLength: 1 })),
      targetId: Type.Optional(Type.String({ minLength: 1 })),
      actor: Type.Optional(
        Type.Object(
          {
            userId: Type.Optional(Type.String({ minLength: 1 })),
            roles: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
            groupIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
            groupAccountIds: Type.Optional(
              Type.Array(Type.String({ minLength: 1 })),
            ),
          },
          { additionalProperties: false },
        ),
      ),
      reasonText: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
};

export const groupCreateSchema = {
  body: Type.Object(
    {
      displayName: Type.String({ minLength: 1, maxLength: 200 }),
      active: Type.Optional(Type.Boolean()),
      userIds: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const groupPatchSchema = {
  body: Type.Partial(
    Type.Object(
      {
        displayName: Type.String({ minLength: 1, maxLength: 200 }),
        active: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  ),
};

export const groupMemberChangeSchema = {
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

const alertTypeSchema = Type.Union([
  Type.Literal('budget_overrun'),
  Type.Literal('overtime'),
  Type.Literal('approval_delay'),
  Type.Literal('approval_escalation'),
  Type.Literal('delivery_due'),
  Type.Literal('integration_failure'),
  Type.Literal('daily_report_missing'),
]);

const alertChannelSchema = Type.Union([
  Type.Literal('email'),
  Type.Literal('dashboard'),
  Type.Literal('slack'),
  Type.Literal('webhook'),
]);

const alertRecipientsSchema = Type.Object(
  {
    emails: Type.Optional(Type.Array(Type.String())),
    roles: Type.Optional(Type.Array(Type.String())),
    users: Type.Optional(Type.Array(Type.String())),
    slackWebhooks: Type.Optional(Type.Array(Type.String({ format: 'uri' }))),
    webhooks: Type.Optional(Type.Array(Type.String({ format: 'uri' }))),
  },
  { additionalProperties: true },
);

export const alertSettingSchema = {
  body: Type.Object(
    {
      type: alertTypeSchema,
      threshold: Type.Number({ minimum: 0 }),
      period: Type.String(),
      scopeProjectId: Type.Optional(Type.String()),
      recipients: alertRecipientsSchema,
      channels: Type.Array(alertChannelSchema, { minItems: 1 }),
      remindAfterHours: Type.Optional(Type.Integer({ minimum: 1 })),
      remindMaxCount: Type.Optional(Type.Integer({ minimum: 0 })),
      isEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const alertSettingPatchSchema = {
  body: Type.Partial(alertSettingSchema.body),
};

const periodLockScopeSchema = Type.Union([
  Type.Literal('global'),
  Type.Literal('project'),
]);

export const periodLockSchema = {
  body: Type.Object(
    {
      period: Type.String({ pattern: '^\\d{4}-\\d{2}$' }),
      scope: periodLockScopeSchema,
      projectId: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
};

const templateKindSchema = Type.Union([
  Type.Literal('estimate'),
  Type.Literal('invoice'),
  Type.Literal('purchase_order'),
]);

const reportFormatSchema = Type.Union([
  Type.Literal('csv'),
  Type.Literal('pdf'),
]);

const reportChannelSchema = Type.Union([
  Type.Literal('email'),
  Type.Literal('dashboard'),
]);

const reportRecipientsSchema = Type.Object(
  {
    emails: Type.Optional(Type.Array(Type.String())),
    roles: Type.Optional(Type.Array(Type.String())),
    users: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const integrationTypeSchema = Type.Union([
  Type.Literal('hr'),
  Type.Literal('crm'),
]);

const integrationStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('disabled'),
]);
export const templateSettingSchema = {
  body: Type.Object(
    {
      kind: templateKindSchema,
      templateId: Type.String({ minLength: 1 }),
      numberRule: Type.String({
        pattern: '^(?=.*YYYY)(?=.*MM)(?=.*NNNN)[A-Za-z0-9_\\-\\/]+$',
      }),
      layoutConfig: Type.Optional(Type.Any()),
      logoUrl: Type.Optional(Type.String()),
      signatureText: Type.Optional(Type.String()),
      isDefault: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const templateSettingPatchSchema = {
  body: Type.Partial(templateSettingSchema.body),
};

export const reportSubscriptionSchema = {
  body: Type.Object(
    {
      name: Type.Optional(Type.String()),
      reportKey: Type.String({ minLength: 1 }),
      format: Type.Optional(reportFormatSchema),
      schedule: Type.Optional(
        Type.String({
          pattern: '^([\\d*/,\\-]+\\s+){4}[\\d*/,\\-]+$',
        }),
      ),
      params: Type.Optional(Type.Any()),
      recipients: Type.Optional(reportRecipientsSchema),
      channels: Type.Optional(Type.Array(reportChannelSchema, { minItems: 1 })),
      isEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const reportSubscriptionPatchSchema = {
  body: Type.Partial(reportSubscriptionSchema.body),
};

export const reportSubscriptionRunSchema = {
  body: Type.Object(
    {
      dryRun: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const chatAckReminderRunSchema = {
  body: Type.Object(
    {
      dryRun: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      now: Type.Optional(Type.String({ format: 'date-time' })),
    },
    { additionalProperties: false },
  ),
};

export const chatRoomAclAlertRunSchema = {
  body: Type.Object(
    {
      dryRun: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false },
  ),
};

export const notificationDeliveryRunSchema = {
  body: Type.Object(
    {
      dryRun: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
};

export const dailyReportMissingRunSchema = {
  body: Type.Object(
    {
      targetDate: Type.Optional(Type.String()),
      dryRun: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const leaveUpcomingRunSchema = {
  body: Type.Object(
    {
      targetDate: Type.Optional(Type.String()),
      dryRun: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const leaveEntitlementReminderRunSchema = {
  body: Type.Object(
    {
      targetDate: Type.Optional(Type.String()),
      dryRun: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const pushSubscriptionSchema = {
  body: Type.Object(
    {
      endpoint: Type.String({ minLength: 1 }),
      expirationTime: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      keys: Type.Object(
        {
          p256dh: Type.String({ minLength: 1 }),
          auth: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      userAgent: Type.Optional(Type.String()),
      topics: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
};

export const pushSubscriptionDisableSchema = {
  body: Type.Object(
    {
      endpoint: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const pushTestSchema = {
  body: Type.Object(
    {
      userId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
};

const draftKindSchema = Type.Union([
  Type.Literal('invoice_send'),
  Type.Literal('approval_request'),
  Type.Literal('notification_report'),
]);

const draftTextSchema = Type.Object(
  {
    subject: Type.String({ minLength: 1, maxLength: 500 }),
    body: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
);

const draftContextSchema = Type.Union([
  Type.Object({}, { additionalProperties: true }),
  Type.Null(),
]);

export const draftGenerateSchema = {
  body: Type.Object(
    {
      kind: draftKindSchema,
      targetId: Type.Optional(Type.String({ minLength: 1 })),
      context: Type.Optional(draftContextSchema),
      instruction: Type.Optional(Type.String({ maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const draftRegenerateSchema = {
  body: Type.Object(
    {
      kind: draftKindSchema,
      targetId: Type.Optional(Type.String({ minLength: 1 })),
      context: Type.Optional(draftContextSchema),
      instruction: Type.Optional(Type.String({ maxLength: 2000 })),
      previous: draftTextSchema,
    },
    { additionalProperties: false },
  ),
};

export const draftDiffSchema = {
  body: Type.Object(
    {
      before: draftTextSchema,
      after: draftTextSchema,
    },
    { additionalProperties: false },
  ),
};

export const integrationSettingSchema = {
  body: Type.Object(
    {
      type: integrationTypeSchema,
      name: Type.Optional(Type.String()),
      provider: Type.Optional(Type.String()),
      status: Type.Optional(integrationStatusSchema),
      schedule: Type.Optional(Type.String()),
      config: Type.Optional(Type.Any()),
    },
    { additionalProperties: false },
  ),
};

export const integrationSettingPatchSchema = {
  body: Type.Partial(integrationSettingSchema.body),
};
