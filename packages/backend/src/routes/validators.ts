import { Type } from '@sinclair/typebox';

const flowTypeSchema = Type.Union([
  Type.Literal('estimate'),
  Type.Literal('invoice'),
  Type.Literal('expense'),
  Type.Literal('leave'),
  Type.Literal('time'),
  Type.Literal('purchase_order'),
  Type.Literal('vendor_invoice'),
  Type.Literal('vendor_quote'),
]);

const recurringFrequencySchema = Type.Union([
  Type.Literal('monthly'),
  Type.Literal('quarterly'),
  Type.Literal('semiannual'),
  Type.Literal('annual'),
]);

const billUponSchema = Type.Union([
  Type.Literal('date'),
  Type.Literal('acceptance'),
  Type.Literal('time'),
]);

const dueDateRuleSchema = Type.Object(
  {
    type: Type.Literal('periodEndPlusOffset'),
    offsetDays: Type.Integer({ minimum: 0, maximum: 365 }),
  },
  { additionalProperties: false },
);

const currencySchema = Type.String({ pattern: '^[A-Z]{3}$' });

export const projectSchema = {
  body: Type.Object({
    code: Type.String(),
    name: Type.String(),
    status: Type.Optional(Type.String()),
    customerId: Type.Optional(
      Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    ),
    parentId: Type.Optional(Type.String()),
  }),
};

export const projectPatchSchema = {
  body: Type.Partial(projectSchema.body),
};

const projectMemberRoleSchema = Type.Union([
  Type.Literal('member'),
  Type.Literal('leader'),
]);

export const projectMemberSchema = {
  body: Type.Object({
    userId: Type.String({ minLength: 1 }),
    role: Type.Optional(projectMemberRoleSchema),
  }),
};
export const customerSchema = {
  body: Type.Object(
    {
      code: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      status: Type.String({ minLength: 1 }),
      invoiceRegistrationId: Type.Optional(Type.String()),
      taxRegion: Type.Optional(Type.String()),
      billingAddress: Type.Optional(Type.String()),
      externalSource: Type.Optional(Type.String()),
      externalId: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
};

export const customerPatchSchema = {
  body: Type.Partial(customerSchema.body),
};

export const vendorSchema = {
  body: Type.Object(
    {
      code: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      status: Type.String({ minLength: 1 }),
      bankInfo: Type.Optional(Type.String()),
      taxRegion: Type.Optional(Type.String()),
      externalSource: Type.Optional(Type.String()),
      externalId: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
};

export const vendorPatchSchema = {
  body: Type.Partial(vendorSchema.body),
};

export const contactSchema = {
  body: Type.Object(
    {
      customerId: Type.Optional(Type.String({ minLength: 1 })),
      vendorId: Type.Optional(Type.String({ minLength: 1 })),
      name: Type.String({ minLength: 1 }),
      email: Type.Optional(Type.String({ format: 'email' })),
      phone: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      isPrimary: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const contactPatchSchema = {
  body: Type.Partial(contactSchema.body),
};

export const recurringTemplateSchema = {
  body: Type.Object({
    frequency: recurringFrequencySchema,
    nextRunAt: Type.Optional(Type.String({ format: 'date-time' })),
    timezone: Type.Optional(Type.String()),
    defaultAmount: Type.Optional(Type.Number({ minimum: 0 })),
    defaultCurrency: Type.Optional(currencySchema),
    defaultTaxRate: Type.Optional(Type.Number({ minimum: 0 })),
    defaultTerms: Type.Optional(Type.String()),
    defaultMilestoneName: Type.Optional(Type.String()),
    billUpon: Type.Optional(billUponSchema),
    dueDateRule: Type.Optional(dueDateRuleSchema),
    shouldGenerateEstimate: Type.Optional(Type.Boolean()),
    shouldGenerateInvoice: Type.Optional(Type.Boolean()),
    isActive: Type.Optional(Type.Boolean()),
  }),
};

export const projectTaskSchema = {
  body: Type.Object({
    name: Type.String(),
    parentTaskId: Type.Optional(Type.String()),
    assigneeId: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    planStart: Type.Optional(Type.String({ format: 'date' })),
    planEnd: Type.Optional(Type.String({ format: 'date' })),
    actualStart: Type.Optional(Type.String({ format: 'date' })),
    actualEnd: Type.Optional(Type.String({ format: 'date' })),
  }),
};

export const projectTaskPatchSchema = {
  body: Type.Partial(projectTaskSchema.body),
};

export const projectMilestoneSchema = {
  body: Type.Object({
    name: Type.String(),
    amount: Type.Number({ minimum: 0 }),
    billUpon: Type.Optional(Type.String()),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    taxRate: Type.Optional(Type.Number({ minimum: 0 })),
  }),
};

export const projectMilestonePatchSchema = {
  body: Type.Partial(projectMilestoneSchema.body),
};

export const deleteReasonSchema = {
  body: Type.Object({
    reason: Type.String(),
  }),
};

const reassignReasonCodeSchema = Type.Union([
  Type.Literal('input_error'),
  Type.Literal('project_misassignment'),
  Type.Literal('task_restructure'),
  Type.Literal('contract_split_merge'),
  Type.Literal('internal_transfer'),
]);

export const reassignSchema = {
  body: Type.Object({
    toProjectId: Type.String(),
    reasonCode: reassignReasonCodeSchema,
    reasonText: Type.String({ minLength: 1 }),
  }),
};

const optionalStringOrNullSchema = Type.Union([Type.String(), Type.Null()]);

export const timeEntryReassignSchema = {
  body: Type.Object(
    {
      toProjectId: Type.String(),
      toTaskId: Type.Optional(optionalStringOrNullSchema),
      reasonCode: reassignReasonCodeSchema,
      reasonText: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const expenseReassignSchema = {
  body: Type.Object(
    {
      toProjectId: Type.String(),
      reasonCode: reassignReasonCodeSchema,
      reasonText: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const timeEntrySchema = {
  body: Type.Object({
    projectId: Type.String(),
    taskId: Type.Optional(Type.String()),
    userId: Type.String(),
    workDate: Type.String({ format: 'date' }),
    minutes: Type.Number({ minimum: 0, maximum: 1440 }),
    workType: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
  }),
};

export const timeEntryPatchSchema = {
  body: Type.Partial(timeEntrySchema.body),
};

export const expenseSchema = {
  body: Type.Object({
    projectId: Type.String(),
    userId: Type.String(),
    category: Type.String(),
    amount: Type.Number({ minimum: 0 }),
    currency: Type.String({ default: 'JPY' }),
    incurredOn: Type.String({ format: 'date' }),
    isShared: Type.Optional(Type.Boolean()),
    receiptUrl: Type.Optional(Type.String()),
  }),
};

export const estimateSchema = {
  body: Type.Object({
    lines: Type.Optional(Type.Array(Type.Any())),
    totalAmount: Type.Number({ minimum: 0 }),
    currency: Type.Optional(Type.String({ default: 'JPY' })),
    validUntil: Type.Optional(Type.String({ format: 'date' })),
    notes: Type.Optional(Type.String()),
  }),
};

export const invoiceSchema = {
  body: Type.Object({
    estimateId: Type.Optional(Type.String()),
    milestoneId: Type.Optional(Type.String()),
    issueDate: Type.Optional(Type.String({ format: 'date' })),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    currency: Type.Optional(Type.String({ default: 'JPY' })),
    totalAmount: Type.Number({ minimum: 0 }),
    lines: Type.Optional(Type.Array(Type.Any())),
  }),
};

export const purchaseOrderSchema = {
  body: Type.Object({
    vendorId: Type.String(),
    issueDate: Type.Optional(Type.String({ format: 'date' })),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    currency: Type.Optional(Type.String({ default: 'JPY' })),
    totalAmount: Type.Number({ minimum: 0 }),
    lines: Type.Optional(Type.Array(Type.Any())),
  }),
};

export const vendorInvoiceSchema = {
  body: Type.Object({
    projectId: Type.String(),
    vendorId: Type.String(),
    vendorInvoiceNo: Type.Optional(Type.String()),
    receivedDate: Type.Optional(Type.String({ format: 'date' })),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    currency: Type.Optional(Type.String()),
    totalAmount: Type.Number({ minimum: 0 }),
    documentUrl: Type.Optional(Type.String()),
  }),
};

export const vendorQuoteSchema = {
  body: Type.Object({
    projectId: Type.String(),
    vendorId: Type.String(),
    quoteNo: Type.Optional(Type.String()),
    issueDate: Type.Optional(Type.String({ format: 'date' })),
    currency: Type.Optional(Type.String()),
    totalAmount: Type.Number({ minimum: 0 }),
    documentUrl: Type.Optional(Type.String()),
  }),
};

export const dailyReportSchema = {
  body: Type.Object({
    content: Type.String(),
    reportDate: Type.String(),
    userId: Type.String(),
    linkedProjectIds: Type.Optional(Type.Array(Type.String())),
    status: Type.Optional(Type.String()),
  }),
};

export const wellbeingSchema = {
  body: Type.Object({
    entryDate: Type.String(),
    status: Type.String(),
    userId: Type.String(),
    notes: Type.Optional(Type.String()),
    helpRequested: Type.Optional(Type.Boolean()),
    visibilityGroupId: Type.String(),
  }),
};

export const projectChatMessageSchema = {
  body: Type.Object({
    body: Type.String({ minLength: 1, maxLength: 2000 }),
    tags: Type.Optional(
      Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
    ),
  }),
};

export const projectChatReactionSchema = {
  body: Type.Object({
    emoji: Type.String({ minLength: 1, maxLength: 16 }),
  }),
};

export const leaveRequestSchema = {
  body: Type.Object({
    userId: Type.String(),
    leaveType: Type.String(),
    startDate: Type.String({ format: 'date' }),
    endDate: Type.String({ format: 'date' }),
    hours: Type.Optional(Type.Number({ minimum: 0 })),
    notes: Type.Optional(Type.String()),
  }),
};

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

const approvalStepSchema = Type.Object(
  {
    stepOrder: Type.Optional(Type.Number({ minimum: 1 })),
    approverGroupId: Type.Optional(Type.String()),
    approverUserId: Type.Optional(Type.String()),
    parallelKey: Type.Optional(Type.String()),
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
      conditions: Type.Optional(approvalConditionSchema),
      steps: Type.Array(approvalStepSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const approvalRulePatchSchema = {
  body: Type.Partial(approvalRuleSchema.body),
};

const alertTypeSchema = Type.Union([
  Type.Literal('budget_overrun'),
  Type.Literal('overtime'),
  Type.Literal('approval_delay'),
  Type.Literal('approval_escalation'),
  Type.Literal('delivery_due'),
  Type.Literal('integration_failure'),
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
