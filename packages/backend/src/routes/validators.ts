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
    startDate: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
    endDate: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
    parentId: Type.Optional(Type.String()),
    planHours: Type.Optional(Type.Number({ minimum: 0 })),
    budgetCost: Type.Optional(Type.Number({ minimum: 0 })),
  }),
};

export const projectPatchSchema = {
  body: Type.Intersect([
    Type.Partial(projectSchema.body),
    Type.Object({
      reasonText: Type.Optional(Type.String({ minLength: 1 })),
    }),
  ]),
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

export const projectMemberBulkSchema = {
  body: Type.Object(
    {
      items: Type.Array(
        Type.Object(
          {
            userId: Type.String({ minLength: 1 }),
            role: Type.Optional(projectMemberRoleSchema),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 500 },
      ),
    },
    { additionalProperties: false },
  ),
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
    dueDateRule: Type.Optional(Type.Union([dueDateRuleSchema, Type.Null()])),
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
    progressPercent: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 100, nullable: true }),
    ),
    planStart: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
    planEnd: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
    actualStart: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
    actualEnd: Type.Optional(
      Type.Union([Type.String({ format: 'date' }), Type.Null()]),
    ),
  }),
};

export const projectTaskPatchSchema = {
  body: Type.Intersect([
    Type.Partial(projectTaskSchema.body),
    Type.Object({
      reasonText: Type.Optional(Type.String({ minLength: 1 })),
    }),
  ]),
};

export const projectTaskDependencySchema = {
  body: Type.Object(
    {
      predecessorIds: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 0,
        maxItems: 200,
      }),
    },
    { additionalProperties: false },
  ),
};

export const projectBaselineSchema = {
  body: Type.Object(
    {
      name: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
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
    moveTimeEntries: Type.Optional(Type.Boolean()),
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
    // Keep OpenAPI backward-compatible; detailed validation runs in route logic.
    lines: Type.Optional(Type.Any()),
    attachments: Type.Optional(Type.Any()),
  }),
};

const expenseStatusFilterSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('pending_qa'),
  Type.Literal('pending_exec'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
]);

const booleanQuerySchema = Type.Union([
  Type.Boolean(),
  Type.Literal('true'),
  Type.Literal('false'),
  Type.Literal('1'),
  Type.Literal('0'),
]);

export const expenseListQuerySchema = {
  querystring: Type.Object(
    {
      projectId: Type.Optional(Type.String({ minLength: 1 })),
      userId: Type.Optional(Type.String({ minLength: 1 })),
      from: Type.Optional(Type.String({ minLength: 1 })),
      to: Type.Optional(Type.String({ minLength: 1 })),
      status: Type.Optional(expenseStatusFilterSchema),
      settlementStatus: Type.Optional(
        Type.Union([Type.Literal('unpaid'), Type.Literal('paid')]),
      ),
      paidFrom: Type.Optional(Type.String({ minLength: 1 })),
      paidTo: Type.Optional(Type.String({ minLength: 1 })),
      hasReceipt: Type.Optional(booleanQuerySchema),
    },
    { additionalProperties: false },
  ),
};

export const expenseCommentCreateSchema = {
  body: Type.Object(
    {
      kind: Type.Optional(Type.String({ minLength: 1 })),
      body: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const expenseQaChecklistPatchSchema = {
  body: Type.Object(
    {
      amountVerified: Type.Optional(Type.Boolean()),
      receiptVerified: Type.Optional(Type.Boolean()),
      journalPrepared: Type.Optional(Type.Boolean()),
      projectLinked: Type.Optional(Type.Boolean()),
      budgetChecked: Type.Optional(Type.Boolean()),
      notes: Type.Optional(
        Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
      ),
    },
    { additionalProperties: false, minProperties: 1 },
  ),
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

export const invoiceFromTimeEntriesSchema = {
  body: Type.Object(
    {
      from: Type.String({ format: 'date' }),
      to: Type.String({ format: 'date' }),
      unitPrice: Type.Number({ exclusiveMinimum: 0 }),
      currency: Type.Optional(Type.String({ default: 'JPY' })),
      issueDate: Type.Optional(Type.String({ format: 'date' })),
      dueDate: Type.Optional(Type.String({ format: 'date' })),
    },
    { additionalProperties: false },
  ),
};

export const invoiceMarkPaidSchema = {
  body: Type.Object(
    {
      // NOTE: Validate in handler (INVALID_DATE) to keep error codes consistent.
      paidAt: Type.Optional(
        Type.Union([
          Type.String({ format: 'date-time' }),
          Type.String({ format: 'date' }),
          Type.String({ minLength: 1, maxLength: 50 }),
        ]),
      ),
      reasonText: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
};

export const expenseMarkPaidSchema = {
  body: Type.Object(
    {
      // NOTE: Validate in handler (INVALID_DATE) to keep error codes consistent.
      paidAt: Type.Optional(
        Type.Union([
          Type.String({ format: 'date-time' }),
          Type.String({ format: 'date' }),
          Type.String({ minLength: 1, maxLength: 50 }),
        ]),
      ),
      reasonText: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
};

export const expenseUnmarkPaidSchema = {
  body: Type.Object(
    {
      reasonText: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
};

export const expenseSubmitSchema = {
  body: Type.Object(
    {
      reasonText: Type.Optional(Type.String({ minLength: 1 })),
      budgetEscalationReason: Type.Optional(
        Type.String({ minLength: 1, maxLength: 2000 }),
      ),
      budgetEscalationImpact: Type.Optional(
        Type.String({ minLength: 1, maxLength: 2000 }),
      ),
      budgetEscalationAlternative: Type.Optional(
        Type.String({ minLength: 1, maxLength: 2000 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const expenseBudgetEscalationSchema = {
  body: Type.Object(
    {
      budgetEscalationReason: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
      budgetEscalationImpact: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
      budgetEscalationAlternative: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
    },
    { additionalProperties: false, minProperties: 1 },
  ),
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
    purchaseOrderId: Type.Optional(
      Type.Any({ description: 'Purchase order id (string)' }),
    ),
    vendorInvoiceNo: Type.Optional(Type.String()),
    receivedDate: Type.Optional(Type.String({ format: 'date' })),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    currency: Type.Optional(Type.String()),
    totalAmount: Type.Number({ minimum: 0 }),
    documentUrl: Type.Optional(Type.String()),
  }),
};

export const vendorInvoiceLinkPoSchema = {
  body: Type.Object(
    {
      purchaseOrderId: Type.String({ minLength: 1, pattern: '\\S' }),
      reasonText: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
    },
    { additionalProperties: false },
  ),
};

export const vendorInvoiceUnlinkPoSchema = {
  body: Type.Object(
    {
      reasonText: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
    },
    { additionalProperties: false },
  ),
};

export const vendorInvoiceAllocationsSchema = {
  body: Type.Object(
    {
      allocations: Type.Array(
        Type.Object(
          {
            projectId: Type.String({ minLength: 1 }),
            amount: Type.Number({ minimum: 0 }),
            taxRate: Type.Optional(Type.Number({ minimum: 0 })),
            taxAmount: Type.Optional(Type.Number({ minimum: 0 })),
            purchaseOrderLineId: Type.Optional(Type.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      ),
      reasonText: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
      autoAdjust: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const vendorInvoiceLinesSchema = {
  body: Type.Object(
    {
      lines: Type.Array(
        Type.Object(
          {
            lineNo: Type.Optional(Type.Integer({ minimum: 1 })),
            description: Type.String({ minLength: 1 }),
            quantity: Type.Number({ exclusiveMinimum: 0 }),
            unitPrice: Type.Number({ minimum: 0 }),
            amount: Type.Optional(
              Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
            ),
            taxRate: Type.Optional(
              Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
            ),
            taxAmount: Type.Optional(
              Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
            ),
            purchaseOrderLineId: Type.Optional(
              Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
            ),
          },
          { additionalProperties: false },
        ),
      ),
      reasonText: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
      autoAdjust: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
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

export const integrationRunMetricsQuerySchema = {
  querystring: Type.Object(
    {
      settingId: Type.Optional(Type.String({ minLength: 1 })),
      days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    },
    { additionalProperties: false },
  ),
};

const leaveExportTargetSchema = Type.Union([
  Type.Literal('attendance'),
  Type.Literal('payroll'),
]);

const hrEmployeeMasterExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
]);

const hrAttendanceExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
]);

const accountingIcsExportFormatSchema = Type.Union([
  Type.Literal('json'),
  Type.Literal('csv'),
  Type.Literal('ics_template'),
]);

const accountingPeriodKeyLooseSchema = Type.String({
  minLength: 1,
  maxLength: 7,
});

const integrationExportJobKindSchema = Type.Union([
  Type.Literal('hr_leave_export_attendance'),
  Type.Literal('hr_leave_export_payroll'),
  Type.Literal('hr_employee_master_export'),
  Type.Literal('accounting_ics_export'),
]);

const accountingMappingRuleBodySchema = Type.Object(
  {
    mappingKey: Type.String({ minLength: 1, maxLength: 200 }),
    debitAccountCode: Type.String({ minLength: 1, maxLength: 100 }),
    debitAccountName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    debitSubaccountCode: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    requireDebitSubaccountCode: Type.Optional(Type.Boolean()),
    creditAccountCode: Type.String({ minLength: 1, maxLength: 100 }),
    creditAccountName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    creditSubaccountCode: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    requireCreditSubaccountCode: Type.Optional(Type.Boolean()),
    departmentCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    requireDepartmentCode: Type.Optional(Type.Boolean()),
    taxCode: Type.String({ minLength: 1, maxLength: 100 }),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const integrationHrLeaveExportQuerySchema = {
  querystring: Type.Object(
    {
      target: Type.Optional(leaveExportTargetSchema),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrLeaveExportDispatchSchema = {
  body: Type.Object(
    {
      target: leaveExportTargetSchema,
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrLeaveExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      target: Type.Optional(leaveExportTargetSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(hrEmployeeMasterExportFormatSchema),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(Type.Literal('csv')),
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      updatedSince: Type.Optional(Type.String({ format: 'date-time' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrEmployeeMasterExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

const attendanceClosingPeriodKeySchema = Type.String({
  pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
});

export const integrationHrAttendanceExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(hrAttendanceExportFormatSchema),
      periodKey: attendanceClosingPeriodKeySchema,
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(Type.Literal('csv')),
      periodKey: attendanceClosingPeriodKeySchema,
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(attendanceClosingPeriodKeySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportQuerySchema = {
  querystring: Type.Object(
    {
      format: Type.Optional(accountingIcsExportFormatSchema),
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      companyCode: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
      companyName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      fiscalYearStartMonth: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 12 }),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportDispatchSchema = {
  body: Type.Object(
    {
      format: Type.Optional(
        Type.Union([Type.Literal('csv'), Type.Literal('ics_template')]),
      ),
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      companyCode: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
      companyName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      fiscalYearStartMonth: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 12 }),
      ),
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingIcsExportLogListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      status: Type.Optional(
        Type.Union([
          Type.Literal('running'),
          Type.Literal('success'),
          Type.Literal('failed'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
      idempotencyKey: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingMappingRuleListQuerySchema = {
  querystring: Type.Object(
    {
      mappingKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      isActive: Type.Optional(booleanQuerySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationAccountingMappingRuleCreateSchema = {
  body: accountingMappingRuleBodySchema,
};

export const integrationAccountingMappingRulePatchSchema = {
  params: Type.Object(
    {
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  body: Type.Partial(accountingMappingRuleBodySchema, {
    additionalProperties: false,
  }),
};

export const integrationAccountingMappingRuleReapplySchema = {
  body: Type.Object(
    {
      periodKey: Type.Optional(accountingPeriodKeyLooseSchema),
      mappingKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationExportJobListQuerySchema = {
  querystring: Type.Object(
    {
      kind: Type.Optional(integrationExportJobKindSchema),
      status: Type.Optional(
        Type.Union([
          Type.Literal('running'),
          Type.Literal('success'),
          Type.Literal('failed'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationExportJobRedispatchSchema = {
  params: Type.Object(
    {
      kind: integrationExportJobKindSchema,
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  body: Type.Object(
    {
      idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingCreateSchema = {
  body: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
      reclose: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingListQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: Type.Optional(attendanceClosingPeriodKeySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationHrAttendanceClosingSummaryListSchema = {
  params: Type.Object(
    {
      id: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false },
  ),
};

export const integrationReconciliationSummaryQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
    },
    { additionalProperties: false },
  ),
};

export const integrationReconciliationDetailsQuerySchema = {
  querystring: Type.Object(
    {
      periodKey: attendanceClosingPeriodKeySchema,
    },
    { additionalProperties: false },
  ),
};

export const chatSettingPatchSchema = {
  body: Type.Object(
    {
      allowUserPrivateGroupCreation: Type.Optional(Type.Boolean()),
      allowDmCreation: Type.Optional(Type.Boolean()),
      ackMaxRequiredUsers: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
      ackMaxRequiredGroups: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
      ackMaxRequiredRoles: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const worklogSettingPatchSchema = {
  body: Type.Object(
    {
      editableDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveSettingPatchSchema = {
  body: Type.Object(
    {
      timeUnitMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
      defaultWorkdayMinutes: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 1440 }),
      ),
      paidLeaveAdvanceMaxMinutes: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 10080 }),
      ),
      paidLeaveAdvanceRequireNextGrantWithinDays: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 366 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const annotationSettingPatchSchema = {
  body: Type.Object(
    {
      maxExternalUrlCount: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 500 }),
      ),
      maxExternalUrlLength: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200000 }),
      ),
      maxExternalUrlTotalLength: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 2000000 }),
      ),
      maxNotesLength: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 200000 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const annotationPatchSchema = {
  body: Type.Object(
    {
      notes: Type.Optional(
        Type.Union([Type.String({ maxLength: 200000 }), Type.Null()]),
      ),
      externalUrls: Type.Optional(
        Type.Union([
          Type.Array(Type.String({ maxLength: 200000 }), { maxItems: 500 }),
          Type.Null(),
        ]),
      ),
      internalRefs: Type.Optional(
        Type.Union([
          Type.Array(
            Type.Object(
              {
                kind: Type.String({ minLength: 1, maxLength: 50 }),
                id: Type.String({ minLength: 1, maxLength: 200 }),
                label: Type.Optional(Type.String({ maxLength: 200 })),
              },
              { additionalProperties: false },
            ),
            { maxItems: 500 },
          ),
          Type.Null(),
        ]),
      ),
      reasonText: Type.Optional(Type.String({ maxLength: 20000 })),
    },
    { additionalProperties: false },
  ),
};
