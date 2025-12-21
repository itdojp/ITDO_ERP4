import { Type } from '@sinclair/typebox';

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

export const approvalActionSchema = {
  body: Type.Object({
    action: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
    reason: Type.Optional(Type.String()),
  }),
};
