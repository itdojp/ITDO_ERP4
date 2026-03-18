import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { formatCsvValue } from '../utils/csv.js';

const ACCOUNTING_ICS_EXPORT_SCHEMA_VERSION = 'ics_journal_v0';
const ACCOUNTING_ICS_INCOMPLETE_STATUSES = [
  'pending_mapping',
  'blocked',
] as const;
const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACCOUNTING_ICS_DESCRIPTION_MAX_BYTES = 120;

type AccountingIcsClient = Prisma.TransactionClient | typeof prisma;

export const ACCOUNTING_ICS_CSV_HEADERS = [
  '日付',
  '決修',
  '伝票番号',
  '部門ｺｰﾄﾞ',
  '借方ｺｰﾄﾞ',
  '借方名称',
  '借方枝番',
  '借方枝番摘要',
  '借方枝番ｶﾅ',
  '貸方ｺｰﾄﾞ',
  '貸方名称',
  '貸方枝番',
  '貸方枝番摘要',
  '貸方枝番ｶﾅ',
  '金額',
  '摘要',
  '税区分',
  '対価',
  '仕入区分',
  '売上業種区分',
  '仕訳区分',
  'ﾀﾞﾐｰ1',
  'ﾀﾞﾐｰ2',
  'ﾀﾞﾐｰ3',
  'ﾀﾞﾐｰ4',
  'ﾀﾞﾐｰ5',
  '手形番号',
  '手形期日',
  '付箋番号',
  '付箋コメント',
] as const;

export type AccountingIcsExportItem = {
  stagingId: string;
  eventId: string;
  sourceTable: string;
  sourceId: string;
  periodKey: string;
  lineNo: number;
  entryDate: string;
  closingMarker: string;
  voucherNo: string;
  departmentCode: string;
  debitAccountCode: string;
  debitAccountName: string;
  debitSubaccountCode: string;
  debitSubaccountSummary: string;
  debitSubaccountKana: string;
  creditAccountCode: string;
  creditAccountName: string;
  creditSubaccountCode: string;
  creditSubaccountSummary: string;
  creditSubaccountKana: string;
  amount: string;
  description: string;
  taxCode: string;
  consideration: string;
  purchaseCategory: string;
  salesIndustryCategory: string;
  journalType: string;
  dummy1: string;
  dummy2: string;
  dummy3: string;
  dummy4: string;
  dummy5: string;
  noteNumber: string;
  noteDueDate: string;
  stickyNoteNumber: string;
  stickyNoteComment: string;
};

export type AccountingIcsExportPayload = {
  schemaVersion: typeof ACCOUNTING_ICS_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  exportedUntil: string;
  periodKey: string | null;
  limit: number;
  offset: number;
  exportedCount: number;
  headers: readonly string[];
  items: AccountingIcsExportItem[];
};

export class AccountingIcsExportError extends Error {
  code: string;
  details?: Prisma.InputJsonValue;

  constructor(code: string, message: string, details?: Prisma.InputJsonValue) {
    super(message);
    this.name = 'AccountingIcsExportError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDateSlash(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatAmount(value: Prisma.Decimal | string | number) {
  return String(value ?? '').trim();
}

function validateDescription(
  value: string,
  context: {
    stagingId: string;
    eventId: string;
  },
) {
  if (/[\r\n\t]/.test(value)) {
    throw new AccountingIcsExportError(
      'accounting_journal_description_invalid',
      'description contains unsupported control characters',
      {
        stagingId: context.stagingId,
        eventId: context.eventId,
        reason: 'control_characters',
      } as Prisma.InputJsonValue,
    );
  }
  const encoded = iconv.encode(value, 'cp932');
  if (iconv.decode(encoded, 'cp932') !== value) {
    throw new AccountingIcsExportError(
      'accounting_journal_description_invalid',
      'description contains characters that cannot be encoded in CP932',
      {
        stagingId: context.stagingId,
        eventId: context.eventId,
        reason: 'cp932_unencodable',
      } as Prisma.InputJsonValue,
    );
  }
  if (encoded.byteLength > ACCOUNTING_ICS_DESCRIPTION_MAX_BYTES) {
    throw new AccountingIcsExportError(
      'accounting_journal_description_invalid',
      'description exceeds CP932 byte limit',
      {
        stagingId: context.stagingId,
        eventId: context.eventId,
        reason: 'cp932_byte_limit_exceeded',
        maxBytes: ACCOUNTING_ICS_DESCRIPTION_MAX_BYTES,
        actualBytes: encoded.byteLength,
      } as Prisma.InputJsonValue,
    );
  }
}

function buildVoucherNo(input: {
  externalRef?: string | null;
  sourceTable: string;
  sourceId: string;
}) {
  const externalRef = normalizeText(input.externalRef);
  if (externalRef) return externalRef;
  return `${input.sourceTable}-${input.sourceId}`;
}

function resolvePeriodBounds(periodKey?: string | null) {
  if (!periodKey) return null;
  if (!PERIOD_KEY_PATTERN.test(periodKey)) {
    throw new AccountingIcsExportError(
      'invalid_period_key',
      'periodKey must be in YYYY-MM format',
      { periodKey } as Prisma.InputJsonValue,
    );
  }
  const [yearText, monthText] = periodKey.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    from: new Date(Date.UTC(year, monthIndex, 1)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

function toAccountingIcsCsv(rows: AccountingIcsExportItem[]) {
  const lines = [ACCOUNTING_ICS_CSV_HEADERS.map(formatCsvValue).join(',')];
  for (const item of rows) {
    lines.push(
      [
        item.entryDate,
        item.closingMarker,
        item.voucherNo,
        item.departmentCode,
        item.debitAccountCode,
        item.debitAccountName,
        item.debitSubaccountCode,
        item.debitSubaccountSummary,
        item.debitSubaccountKana,
        item.creditAccountCode,
        item.creditAccountName,
        item.creditSubaccountCode,
        item.creditSubaccountSummary,
        item.creditSubaccountKana,
        item.amount,
        item.description,
        item.taxCode,
        item.consideration,
        item.purchaseCategory,
        item.salesIndustryCategory,
        item.journalType,
        item.dummy1,
        item.dummy2,
        item.dummy3,
        item.dummy4,
        item.dummy5,
        item.noteNumber,
        item.noteDueDate,
        item.stickyNoteNumber,
        item.stickyNoteComment,
      ]
        .map(formatCsvValue)
        .join(','),
    );
  }
  return iconv.encode(`${lines.join('\r\n')}\r\n`, 'cp932');
}

function validateReadyRow(row: {
  id: string;
  eventId: string;
  amount: Prisma.Decimal | string | number;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  taxCode: string | null;
}) {
  const missingFields: string[] = [];
  if (!normalizeText(row.debitAccountCode)) {
    missingFields.push('debitAccountCode');
  }
  if (!normalizeText(row.creditAccountCode)) {
    missingFields.push('creditAccountCode');
  }
  if (!normalizeText(row.taxCode)) {
    missingFields.push('taxCode');
  }
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    missingFields.push('amount');
  }
  if (missingFields.length > 0) {
    throw new AccountingIcsExportError(
      'accounting_journal_ready_row_incomplete',
      'ready accounting journal row is missing required export fields',
      {
        stagingId: row.id,
        eventId: row.eventId,
        missingFields,
      } as Prisma.InputJsonValue,
    );
  }
}

export function buildAccountingIcsExportRequestHash(input: {
  periodKey: string | null;
  limit: number;
  offset: number;
  format: 'csv';
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

export async function buildAccountingIcsExportPayload(input: {
  client?: AccountingIcsClient;
  periodKey?: string | null;
  exportedUntil?: Date;
  limit: number;
  offset: number;
}): Promise<AccountingIcsExportPayload> {
  const client = input.client ?? prisma;
  const now = new Date();
  const exportedUntil = input.exportedUntil ?? now;
  const bounds = resolvePeriodBounds(input.periodKey ?? null);
  const scopedWhere = bounds
    ? {
        entryDate: {
          gte: bounds.from,
          lt: bounds.to,
        },
      }
    : {};

  const incompleteCount = await client.accountingJournalStaging.count({
    where: {
      ...scopedWhere,
      status: {
        in: [...ACCOUNTING_ICS_INCOMPLETE_STATUSES],
      },
    },
  });
  if (incompleteCount > 0) {
    throw new AccountingIcsExportError(
      'accounting_journal_mapping_incomplete',
      'journal staging rows are not ready for export',
      {
        periodKey: input.periodKey ?? null,
        incompleteCount,
      } as Prisma.InputJsonValue,
    );
  }

  const rows = await client.accountingJournalStaging.findMany({
    where: {
      ...scopedWhere,
      status: 'ready',
    },
    select: {
      id: true,
      eventId: true,
      lineNo: true,
      entryDate: true,
      amount: true,
      description: true,
      debitAccountCode: true,
      debitSubaccountCode: true,
      creditAccountCode: true,
      creditSubaccountCode: true,
      departmentCode: true,
      taxCode: true,
      event: {
        select: {
          id: true,
          sourceTable: true,
          sourceId: true,
          periodKey: true,
          externalRef: true,
          description: true,
        },
      },
    },
    orderBy: [{ entryDate: 'asc' }, { eventId: 'asc' }, { lineNo: 'asc' }],
    take: input.limit,
    skip: input.offset,
  });

  const items = rows.map((row) => {
    validateReadyRow(row);
    const debitAccountCode = normalizeText(row.debitAccountCode);
    const creditAccountCode = normalizeText(row.creditAccountCode);
    const description =
      normalizeText(row.description) ||
      normalizeText(row.event.description) ||
      buildVoucherNo({
        externalRef: row.event.externalRef,
        sourceTable: row.event.sourceTable,
        sourceId: row.event.sourceId,
      });
    validateDescription(description, {
      stagingId: row.id,
      eventId: row.event.id,
    });
    return {
      stagingId: row.id,
      eventId: row.event.id,
      sourceTable: row.event.sourceTable,
      sourceId: row.event.sourceId,
      periodKey: row.event.periodKey,
      lineNo: row.lineNo,
      entryDate: formatDateSlash(row.entryDate),
      closingMarker: '',
      voucherNo: buildVoucherNo({
        externalRef: row.event.externalRef,
        sourceTable: row.event.sourceTable,
        sourceId: row.event.sourceId,
      }),
      departmentCode: normalizeText(row.departmentCode),
      debitAccountCode,
      debitAccountName: debitAccountCode,
      debitSubaccountCode: normalizeText(row.debitSubaccountCode),
      debitSubaccountSummary: '',
      debitSubaccountKana: '',
      creditAccountCode,
      creditAccountName: creditAccountCode,
      creditSubaccountCode: normalizeText(row.creditSubaccountCode),
      creditSubaccountSummary: '',
      creditSubaccountKana: '',
      amount: formatAmount(row.amount),
      description,
      taxCode: normalizeText(row.taxCode),
      consideration: '',
      purchaseCategory: '',
      salesIndustryCategory: '',
      journalType: '',
      dummy1: '',
      dummy2: '',
      dummy3: '',
      dummy4: '',
      dummy5: '',
      noteNumber: '',
      noteDueDate: '',
      stickyNoteNumber: '',
      stickyNoteComment: '',
    } satisfies AccountingIcsExportItem;
  });

  return {
    schemaVersion: ACCOUNTING_ICS_EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    exportedUntil: exportedUntil.toISOString(),
    periodKey: input.periodKey ?? null,
    limit: input.limit,
    offset: input.offset,
    exportedCount: items.length,
    headers: [...ACCOUNTING_ICS_CSV_HEADERS],
    items,
  };
}

export function buildAccountingIcsCsv(payload: AccountingIcsExportPayload) {
  return toAccountingIcsCsv(payload.items);
}

export function buildAccountingIcsCsvFilename(options: {
  exportedUntil: string | Date;
  periodKey?: string | null;
}) {
  if (options.periodKey) {
    return `ics-journals-${options.periodKey}.csv`;
  }
  const iso =
    options.exportedUntil instanceof Date
      ? options.exportedUntil.toISOString()
      : options.exportedUntil;
  const compact = iso.replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `ics-journals-${compact}.csv`;
}
