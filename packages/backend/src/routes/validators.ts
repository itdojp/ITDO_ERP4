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

export const projectSchema = {
  body: Type.Object({
    code: Type.String(),
    name: Type.String(),
    status: Type.Optional(Type.String()),
    customerId: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
  }),
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
    receivedDate: Type.Optional(Type.String()),
    dueDate: Type.Optional(Type.String()),
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
    issueDate: Type.Optional(Type.String()),
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
  Type.Literal('delivery_due'),
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
      isEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const alertSettingPatchSchema = {
  body: Type.Partial(alertSettingSchema.body),
};
