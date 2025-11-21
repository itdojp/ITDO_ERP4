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
    workDate: Type.String(),
    minutes: Type.Number({ minimum: 0 }),
    workType: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
  }),
};

export const expenseSchema = {
  body: Type.Object({
    projectId: Type.String(),
    userId: Type.String(),
    category: Type.String(),
    amount: Type.Number({ minimum: 0 }),
    currency: Type.Optional(Type.String()),
    incurredOn: Type.String(),
    isShared: Type.Optional(Type.Boolean()),
    receiptUrl: Type.Optional(Type.String()),
  }),
};

export const projectSchema = {
  body: Type.Object({
    code: Type.String(),
    name: Type.String(),
    status: Type.Optional(Type.String()),
    customerId: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
  }),
};

export const estimateSchema = {
  body: Type.Object({
    lines: Type.Optional(Type.Array(Type.Any())),
    totalAmount: Type.Number({ minimum: 0 }),
    currency: Type.Optional(Type.String()),
    validUntil: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
  }),
};

export const invoiceSchema = {
  body: Type.Object({
    estimateId: Type.Optional(Type.String()),
    milestoneId: Type.Optional(Type.String()),
    issueDate: Type.Optional(Type.String()),
    dueDate: Type.Optional(Type.String()),
    currency: Type.Optional(Type.String()),
    totalAmount: Type.Number({ minimum: 0 }),
    lines: Type.Optional(Type.Array(Type.Any())),
  }),
};

export const purchaseOrderSchema = {
  body: Type.Object({
    vendorId: Type.String(),
    issueDate: Type.Optional(Type.String()),
    dueDate: Type.Optional(Type.String()),
    currency: Type.Optional(Type.String()),
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
