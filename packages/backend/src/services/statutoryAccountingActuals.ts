import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { parseAttendancePeriodKey } from './attendanceClosings.js';

const STATUTORY_ACCOUNTING_AMOUNT_TYPES = [
  'revenue',
  'direct_cost',
  'labor_cost',
  'vendor_cost',
  'expense_cost',
] as const;

type StatutoryAccountingAmountType =
  (typeof STATUTORY_ACCOUNTING_AMOUNT_TYPES)[number];

type StatutoryAccountingActualImportRow = {
  rowNo?: number;
  sourceRef?: string | null;
  projectCode?: string | null;
  departmentCode?: string | null;
  accountCode?: string | null;
  accountName?: string | null;
  amountType?: string | null;
  currency?: string | null;
  amount?: string | number | null;
};

export type StatutoryAccountingActualImportPayload = {
  periodKey: string;
  importBatchKey: string;
  accountingSystem?: string | null;
  rows: StatutoryAccountingActualImportRow[];
};

type StatutoryAccountingActualClient = Prisma.TransactionClient | typeof prisma;

export class StatutoryAccountingActualImportError extends Error {
  constructor(
    public readonly code:
      | 'invalid_statutory_accounting_actual_import'
      | 'statutory_accounting_actual_import_batch_conflict',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function normalizeText(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeRequiredText(
  value: unknown,
  field: string,
  rowNo: number,
  errors: Array<Record<string, unknown>>,
) {
  const normalized = normalizeText(value);
  if (!normalized) {
    errors.push({ rowNo, field, message: `${field} is required` });
  }
  return normalized;
}

function normalizeAmountType(
  value: unknown,
  rowNo: number,
  errors: Array<Record<string, unknown>>,
): StatutoryAccountingAmountType | null {
  const normalized = normalizeText(value);
  if (
    !normalized ||
    !STATUTORY_ACCOUNTING_AMOUNT_TYPES.includes(
      normalized as StatutoryAccountingAmountType,
    )
  ) {
    errors.push({
      rowNo,
      field: 'amountType',
      message: `amountType must be one of ${STATUTORY_ACCOUNTING_AMOUNT_TYPES.join(', ')}`,
    });
    return null;
  }
  return normalized as StatutoryAccountingAmountType;
}

function normalizeCurrency(
  value: unknown,
  rowNo: number,
  errors: Array<Record<string, unknown>>,
) {
  const normalized = normalizeRequiredText(value, 'currency', rowNo, errors);
  if (normalized && !/^[A-Z]{3}$/.test(normalized)) {
    errors.push({
      rowNo,
      field: 'currency',
      message: 'currency must be an ISO 4217 uppercase code',
    });
  }
  return normalized;
}

function normalizeAmount(
  value: unknown,
  rowNo: number,
  errors: Array<Record<string, unknown>>,
) {
  if (value === null || value === undefined || value === '') {
    errors.push({ rowNo, field: 'amount', message: 'amount is required' });
    return null;
  }
  try {
    const amount = new Prisma.Decimal(String(value));
    if (!amount.isFinite() || amount.lte(0)) {
      errors.push({
        rowNo,
        field: 'amount',
        message: 'amount must be a positive number',
      });
      return null;
    }
    return amount;
  } catch {
    errors.push({
      rowNo,
      field: 'amount',
      message: 'amount must be a valid number',
    });
    return null;
  }
}

export async function importStatutoryAccountingActuals(options: {
  payload: StatutoryAccountingActualImportPayload;
  actorUserId?: string | null;
  client?: StatutoryAccountingActualClient;
}) {
  const client = options.client ?? prisma;
  const periodKey = parseAttendancePeriodKey(
    options.payload.periodKey,
  ).periodKey;
  const importBatchKey = normalizeText(options.payload.importBatchKey);
  const accountingSystem =
    normalizeText(options.payload.accountingSystem) ?? 'statutory_accounting';
  const rows = Array.isArray(options.payload.rows) ? options.payload.rows : [];
  const errors: Array<Record<string, unknown>> = [];

  if (!importBatchKey) {
    throw new StatutoryAccountingActualImportError(
      'invalid_statutory_accounting_actual_import',
      'importBatchKey is required',
      [{ field: 'importBatchKey', message: 'importBatchKey is required' }],
    );
  }
  if (rows.length === 0 || rows.length > 1000) {
    throw new StatutoryAccountingActualImportError(
      'invalid_statutory_accounting_actual_import',
      'rows must contain 1..1000 items',
      [{ field: 'rows', message: 'rows must contain 1..1000 items' }],
    );
  }

  const usedRowNos = new Set<number>();
  const importedAt = new Date();
  const data = rows.map((row, index) => {
    const rowNo = row.rowNo ?? index + 1;
    if (!Number.isInteger(rowNo) || rowNo <= 0) {
      errors.push({
        rowNo,
        field: 'rowNo',
        message: 'rowNo must be a positive integer',
      });
    } else if (usedRowNos.has(rowNo)) {
      errors.push({
        rowNo,
        field: 'rowNo',
        message: 'rowNo must be unique within an import batch',
      });
    } else {
      usedRowNos.add(rowNo);
    }

    const projectCode = normalizeText(row.projectCode);
    const departmentCode = normalizeText(row.departmentCode);
    if (!projectCode && !departmentCode) {
      errors.push({
        rowNo,
        field: 'projectCode',
        message: 'projectCode or departmentCode is required',
      });
    }
    const accountCode = normalizeRequiredText(
      row.accountCode,
      'accountCode',
      rowNo,
      errors,
    );
    const amountType = normalizeAmountType(row.amountType, rowNo, errors);
    const currency = normalizeCurrency(row.currency, rowNo, errors);
    const amount = normalizeAmount(row.amount, rowNo, errors);

    return {
      periodKey,
      importBatchKey,
      rowNo,
      accountingSystem,
      sourceRef: normalizeText(row.sourceRef),
      projectCode,
      departmentCode,
      accountCode: accountCode ?? '',
      accountName: normalizeText(row.accountName),
      amountType: amountType ?? 'direct_cost',
      currency: currency ?? '',
      amount: amount ?? new Prisma.Decimal(0),
      importedAt,
      createdBy: options.actorUserId ?? null,
      updatedBy: options.actorUserId ?? null,
    };
  });

  if (errors.length > 0) {
    throw new StatutoryAccountingActualImportError(
      'invalid_statutory_accounting_actual_import',
      'statutory accounting actual import rows are invalid',
      errors,
    );
  }

  const existingBatch = await client.statutoryAccountingActual.findFirst({
    where: { importBatchKey },
    select: { id: true },
  });
  if (existingBatch) {
    throw new StatutoryAccountingActualImportError(
      'statutory_accounting_actual_import_batch_conflict',
      'importBatchKey already exists',
      { importBatchKey },
    );
  }

  await client.statutoryAccountingActual.createMany({ data });

  return {
    periodKey,
    importBatchKey,
    accountingSystem,
    importedCount: data.length,
    importedAt: importedAt.toISOString(),
  };
}
