import fs from 'node:fs';
import path from 'node:path';

import {
  decodePoMigrationBytes,
  parseCsvBoolean,
  parseCsvItems,
  parseCsvJsonArray,
  parsePoCsvRecords,
  parsePoJson,
  type CsvRecord,
  type ImportError,
} from './poInput.js';
import type { PoMigrationCliOptions } from './poCli.js';
import type {
  CustomerInput,
  EstimateInput,
  ExpenseInput,
  InvoiceInput,
  MilestoneInput,
  PoMigrationInputs,
  ProjectInput,
  PurchaseOrderInput,
  TaskInput,
  TimeEntryInput,
  UserInput,
  VendorInput,
  VendorInvoiceInput,
  VendorQuoteInput,
} from './poDomain.js';

export function readPoTextIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return decodePoMigrationBytes(fs.readFileSync(filePath));
}

export function readPoJsonIfExists<T>(filePath: string): T | null {
  const raw = readPoTextIfExists(filePath);
  if (raw == null || !raw.trim()) return null;
  return parsePoJson<T>(raw);
}

export function readPoCsvRecordsIfExists(
  filePath: string,
  scope: string,
  errors: ImportError[],
): CsvRecord[] | null {
  const raw = readPoTextIfExists(filePath);
  if (raw == null) return null;
  return parsePoCsvRecords(raw, scope, path.basename(filePath), errors);
}

export function readPoInputArray<T extends { legacyId: string }>(
  options: PoMigrationCliOptions,
  scope: string,
  baseName: string,
  required: string[],
  errors: ImportError[],
  postProcess?: (item: Record<string, unknown>, record: CsvRecord) => void,
): T[] {
  if (options.inputFormat === 'csv') {
    const records = readPoCsvRecordsIfExists(
      path.join(options.inputDir, `${baseName}.csv`),
      scope,
      errors,
    );
    if (!records) return [];
    return parseCsvItems<T>(scope, records, required, errors, postProcess);
  }
  const json = readPoJsonIfExists<T[]>(
    path.join(options.inputDir, `${baseName}.json`),
  );
  return (json ?? []) as T[];
}

export function readPoMigrationInputs(
  options: PoMigrationCliOptions,
  errors: ImportError[],
): PoMigrationInputs {
  const users = readPoInputArray<UserInput>(
    options,
    'users',
    'users',
    ['legacyId', 'userId', 'userName'],
    errors,
    (item, record) => {
      const parsed = parseCsvBoolean(record.active ?? null);
      if (parsed != null) item.active = parsed;
      else if (record.active != null) {
        errors.push({
          scope: 'users',
          legacyId: record.legacyId ?? undefined,
          message: 'invalid active (expected: true/false/1/0)',
        });
      }
    },
  );
  const customers = readPoInputArray<CustomerInput>(
    options,
    'customers',
    'customers',
    ['legacyId', 'code', 'name', 'status'],
    errors,
  );
  const vendors = readPoInputArray<VendorInput>(
    options,
    'vendors',
    'vendors',
    ['legacyId', 'code', 'name', 'status'],
    errors,
  );
  const projects = readPoInputArray<ProjectInput>(
    options,
    'projects',
    'projects',
    ['legacyId', 'code', 'name'],
    errors,
  );
  const tasks = readPoInputArray<TaskInput>(
    options,
    'tasks',
    'tasks',
    ['legacyId', 'projectLegacyId', 'name'],
    errors,
  );
  const milestones = readPoInputArray<MilestoneInput>(
    options,
    'milestones',
    'milestones',
    ['legacyId', 'projectLegacyId', 'name', 'amount'],
    errors,
  );
  const estimates = readPoInputArray<EstimateInput>(
    options,
    'estimates',
    'estimates',
    ['legacyId', 'projectLegacyId', 'totalAmount', 'currency'],
    errors,
    (item, record) => {
      if (record.lines != null) {
        item.lines =
          parseCsvJsonArray(
            'estimates',
            record.legacyId ?? undefined,
            record.lines,
            errors,
          ) ?? null;
      }
    },
  );
  const invoices = readPoInputArray<InvoiceInput>(
    options,
    'invoices',
    'invoices',
    ['legacyId', 'projectLegacyId', 'currency', 'totalAmount'],
    errors,
    (item, record) => {
      if (record.lines != null) {
        item.lines =
          parseCsvJsonArray(
            'invoices',
            record.legacyId ?? undefined,
            record.lines,
            errors,
          ) ?? null;
      }
    },
  );
  const purchaseOrders = readPoInputArray<PurchaseOrderInput>(
    options,
    'purchase_orders',
    'purchase_orders',
    [
      'legacyId',
      'projectLegacyId',
      'vendorLegacyId',
      'currency',
      'totalAmount',
    ],
    errors,
    (item, record) => {
      if (record.lines != null) {
        item.lines =
          parseCsvJsonArray(
            'purchase_orders',
            record.legacyId ?? undefined,
            record.lines,
            errors,
          ) ?? null;
      }
    },
  );
  const vendorQuotes = readPoInputArray<VendorQuoteInput>(
    options,
    'vendor_quotes',
    'vendor_quotes',
    [
      'legacyId',
      'projectLegacyId',
      'vendorLegacyId',
      'currency',
      'totalAmount',
    ],
    errors,
  );
  const vendorInvoices = readPoInputArray<VendorInvoiceInput>(
    options,
    'vendor_invoices',
    'vendor_invoices',
    [
      'legacyId',
      'projectLegacyId',
      'vendorLegacyId',
      'currency',
      'totalAmount',
    ],
    errors,
  );
  const timeEntries = readPoInputArray<TimeEntryInput>(
    options,
    'time_entries',
    'time_entries',
    ['legacyId', 'projectLegacyId', 'userId', 'workDate', 'minutes'],
    errors,
  );
  const expenses = readPoInputArray<ExpenseInput>(
    options,
    'expenses',
    'expenses',
    [
      'legacyId',
      'projectLegacyId',
      'userId',
      'category',
      'amount',
      'currency',
      'incurredOn',
    ],
    errors,
    (item, record) => {
      const parsed = parseCsvBoolean(record.isShared ?? null);
      if (parsed != null) item.isShared = parsed;
      else if (record.isShared != null) {
        errors.push({
          scope: 'expenses',
          legacyId: record.legacyId ?? undefined,
          message: 'invalid isShared (expected: true/false/1/0)',
        });
      }
    },
  );

  return {
    users,
    customers,
    vendors,
    projects,
    tasks,
    milestones,
    estimates,
    invoices,
    purchase_orders: purchaseOrders,
    vendor_quotes: vendorQuotes,
    vendor_invoices: vendorInvoices,
    time_entries: timeEntries,
    expenses,
  };
}
