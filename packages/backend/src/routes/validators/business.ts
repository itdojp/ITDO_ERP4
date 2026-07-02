import { Type } from '@sinclair/typebox';
import { booleanQuerySchema } from './shared.js';

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
