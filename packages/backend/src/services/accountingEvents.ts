import type {
  AccountingEventKind,
  AccountingJournalStagingStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from './db.js';
import { toDateOnly } from '../utils/date.js';

type AccountingClient = Prisma.TransactionClient | typeof prisma;

type ApprovalTargetTable = 'expenses' | 'invoices' | 'vendor_invoices';

type AccountingEventRecord = {
  sourceTable: string;
  sourceId: string;
  eventKind: AccountingEventKind;
  eventAt: Date;
  currency: string;
  amount: Prisma.Decimal | string | number;
  projectId: string;
  projectCode?: string | null;
  customerCode?: string | null;
  vendorCode?: string | null;
  employeeCode?: string | null;
  departmentCode?: string | null;
  externalRef?: string | null;
  description?: string | null;
  mappingKey: string;
  payload?: Prisma.InputJsonValue;
  actorUserId?: string | null;
};

function toPeriodKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMappingKeyPart(value: unknown) {
  const normalized = normalizeText(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  return normalized || 'default';
}

function toFiniteNumber(value: Prisma.Decimal | string | number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function buildValidationErrors(options: {
  mappingKey: string;
  blockingCodes?: string[];
}) {
  const errors: Prisma.InputJsonValue[] = [];
  for (const code of options.blockingCodes ?? []) {
    errors.push({ code });
  }
  errors.push({
    code: 'mapping_pending',
    mappingKey: options.mappingKey,
    requiredFields: ['debitAccountCode', 'creditAccountCode', 'taxCode'],
  });
  return errors;
}

function resolveStagingStatus(blockingCodes: string[]) {
  return (
    blockingCodes.length > 0 ? 'blocked' : 'pending_mapping'
  ) satisfies AccountingJournalStagingStatus;
}

async function loadProjectRefs(client: AccountingClient, projectId: string) {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: {
      code: true,
      customer: {
        select: {
          code: true,
        },
      },
    },
  });
  return {
    projectCode: project?.code ?? null,
    customerCode: project?.customer?.code ?? null,
  };
}

async function loadVendorCode(client: AccountingClient, vendorId: string) {
  const vendor = await client.vendor.findUnique({
    where: { id: vendorId },
    select: { code: true },
  });
  return vendor?.code ?? null;
}

async function upsertAccountingEventWithStaging(
  client: AccountingClient,
  record: AccountingEventRecord,
  blockingCodes: string[],
) {
  const event = await client.accountingEvent.upsert({
    where: {
      sourceTable_sourceId_eventKind: {
        sourceTable: record.sourceTable,
        sourceId: record.sourceId,
        eventKind: record.eventKind,
      },
    },
    create: {
      sourceTable: record.sourceTable,
      sourceId: record.sourceId,
      eventKind: record.eventKind,
      eventAt: record.eventAt,
      periodKey: toPeriodKey(record.eventAt),
      currency: record.currency,
      amount: record.amount,
      projectId: record.projectId,
      projectCode: record.projectCode ?? null,
      customerCode: record.customerCode ?? null,
      vendorCode: record.vendorCode ?? null,
      employeeCode: record.employeeCode ?? null,
      departmentCode: record.departmentCode ?? null,
      externalRef: record.externalRef ?? null,
      description: record.description ?? null,
      payload: record.payload,
      createdBy: record.actorUserId ?? null,
      updatedBy: record.actorUserId ?? null,
    },
    update: {
      eventAt: record.eventAt,
      periodKey: toPeriodKey(record.eventAt),
      currency: record.currency,
      amount: record.amount,
      projectId: record.projectId,
      projectCode: record.projectCode ?? null,
      customerCode: record.customerCode ?? null,
      vendorCode: record.vendorCode ?? null,
      employeeCode: record.employeeCode ?? null,
      departmentCode: record.departmentCode ?? null,
      externalRef: record.externalRef ?? null,
      description: record.description ?? null,
      payload: record.payload,
      updatedBy: record.actorUserId ?? null,
    },
    select: { id: true },
  });

  await client.accountingJournalStaging.upsert({
    where: {
      eventId_lineNo: {
        eventId: event.id,
        lineNo: 1,
      },
    },
    create: {
      eventId: event.id,
      lineNo: 1,
      entryDate: toDateOnly(record.eventAt),
      status: resolveStagingStatus(blockingCodes),
      currency: record.currency,
      amount: record.amount,
      description: record.description ?? null,
      mappingKey: record.mappingKey,
      departmentCode: record.departmentCode ?? null,
      validationErrors: buildValidationErrors({
        mappingKey: record.mappingKey,
        blockingCodes,
      }),
      createdBy: record.actorUserId ?? null,
      updatedBy: record.actorUserId ?? null,
    },
    update: {
      entryDate: toDateOnly(record.eventAt),
      status: resolveStagingStatus(blockingCodes),
      currency: record.currency,
      amount: record.amount,
      description: record.description ?? null,
      mappingKey: record.mappingKey,
      departmentCode: record.departmentCode ?? null,
      debitAccountCode: null,
      debitSubaccountCode: null,
      creditAccountCode: null,
      creditSubaccountCode: null,
      taxCode: null,
      validationErrors: buildValidationErrors({
        mappingKey: record.mappingKey,
        blockingCodes,
      }),
      updatedBy: record.actorUserId ?? null,
    },
  });
}

export async function stageAccountingEventForApproval(options: {
  client?: AccountingClient;
  targetTable: ApprovalTargetTable | string;
  targetId: string;
  eventAt?: Date;
  approvalInstanceId?: string | null;
  actorUserId?: string | null;
}) {
  const client = options.client ?? prisma;
  const eventAt = options.eventAt ?? new Date();
  const basePayload = {
    source: 'approval_act',
    approvalInstanceId: options.approvalInstanceId ?? null,
    targetTable: options.targetTable,
    targetId: options.targetId,
  } satisfies Record<string, unknown>;

  if (options.targetTable === 'expenses') {
    const expense = await client.expense.findUnique({
      where: { id: options.targetId },
      select: {
        id: true,
        projectId: true,
        userId: true,
        category: true,
        amount: true,
        currency: true,
      },
    });
    if (!expense) return null;
    const { projectCode, customerCode } = await loadProjectRefs(
      client,
      expense.projectId,
    );
    const [user, payrollProfile] = await Promise.all([
      client.userAccount.findUnique({
        where: { id: expense.userId },
        select: { employeeCode: true },
      }),
      client.employeePayrollProfile.findUnique({
        where: { userId: expense.userId },
        select: { departmentCode: true },
      }),
    ]);
    const mappingKey = `expense_approved:${normalizeMappingKeyPart(expense.category)}`;
    const blockingCodes: string[] = [];
    if (!user?.employeeCode) {
      blockingCodes.push('employee_code_missing');
    }
    if (!(toFiniteNumber(expense.amount) > 0)) {
      blockingCodes.push('amount_invalid');
    }
    await upsertAccountingEventWithStaging(
      client,
      {
        sourceTable: 'expenses',
        sourceId: expense.id,
        eventKind: 'expense_approved',
        eventAt,
        currency: expense.currency,
        amount: expense.amount,
        projectId: expense.projectId,
        projectCode,
        customerCode,
        employeeCode: user?.employeeCode ?? null,
        departmentCode: payrollProfile?.departmentCode ?? null,
        description: `経費承認 ${normalizeText(expense.category) || expense.id}`,
        mappingKey,
        payload: {
          ...basePayload,
          expenseId: expense.id,
          category: normalizeText(expense.category) || null,
          userId: expense.userId,
        },
        actorUserId: options.actorUserId ?? null,
      },
      blockingCodes,
    );
    return true;
  }

  if (options.targetTable === 'invoices') {
    const invoice = await client.invoice.findUnique({
      where: { id: options.targetId },
      select: {
        id: true,
        projectId: true,
        invoiceNo: true,
        totalAmount: true,
        currency: true,
      },
    });
    if (!invoice) return null;
    const { projectCode, customerCode } = await loadProjectRefs(
      client,
      invoice.projectId,
    );
    const mappingKey = 'invoice_approved:default';
    const blockingCodes: string[] = [];
    if (!customerCode) {
      blockingCodes.push('customer_code_missing');
    }
    if (!(toFiniteNumber(invoice.totalAmount) > 0)) {
      blockingCodes.push('amount_invalid');
    }
    await upsertAccountingEventWithStaging(
      client,
      {
        sourceTable: 'invoices',
        sourceId: invoice.id,
        eventKind: 'invoice_approved',
        eventAt,
        currency: invoice.currency,
        amount: invoice.totalAmount,
        projectId: invoice.projectId,
        projectCode,
        customerCode,
        externalRef: invoice.invoiceNo,
        description: `請求承認 ${normalizeText(invoice.invoiceNo) || invoice.id}`,
        mappingKey,
        payload: {
          ...basePayload,
          invoiceId: invoice.id,
          invoiceNo: normalizeText(invoice.invoiceNo) || null,
        },
        actorUserId: options.actorUserId ?? null,
      },
      blockingCodes,
    );
    return true;
  }

  if (options.targetTable === 'vendor_invoices') {
    const vendorInvoice = await client.vendorInvoice.findUnique({
      where: { id: options.targetId },
      select: {
        id: true,
        projectId: true,
        vendorId: true,
        vendorInvoiceNo: true,
        totalAmount: true,
        currency: true,
      },
    });
    if (!vendorInvoice) return null;
    const [{ projectCode, customerCode }, vendorCode] = await Promise.all([
      loadProjectRefs(client, vendorInvoice.projectId),
      loadVendorCode(client, vendorInvoice.vendorId),
    ]);
    const mappingKey = 'vendor_invoice_approved:default';
    const blockingCodes: string[] = [];
    if (!vendorCode) {
      blockingCodes.push('vendor_code_missing');
    }
    if (!(toFiniteNumber(vendorInvoice.totalAmount) > 0)) {
      blockingCodes.push('amount_invalid');
    }
    await upsertAccountingEventWithStaging(
      client,
      {
        sourceTable: 'vendor_invoices',
        sourceId: vendorInvoice.id,
        eventKind: 'vendor_invoice_approved',
        eventAt,
        currency: vendorInvoice.currency,
        amount: vendorInvoice.totalAmount,
        projectId: vendorInvoice.projectId,
        projectCode,
        customerCode,
        vendorCode,
        externalRef: vendorInvoice.vendorInvoiceNo,
        description: `仕入請求承認 ${normalizeText(vendorInvoice.vendorInvoiceNo) || vendorInvoice.id}`,
        mappingKey,
        payload: {
          ...basePayload,
          vendorInvoiceId: vendorInvoice.id,
          vendorInvoiceNo: normalizeText(vendorInvoice.vendorInvoiceNo) || null,
          vendorId: vendorInvoice.vendorId,
        },
        actorUserId: options.actorUserId ?? null,
      },
      blockingCodes,
    );
    return true;
  }

  return null;
}
