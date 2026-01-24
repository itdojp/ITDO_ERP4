import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { prisma } from '../packages/backend/dist/services/db.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { nextNumber } from '../packages/backend/dist/services/numbering.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { makePoMigrationId as makeId } from '../packages/backend/dist/migration/legacyIds.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { normalizeCsvCell, parseCsvBoolean, parseCsvRaw } from '../packages/backend/dist/migration/csv.js';

type CliOptions = {
  inputDir: string;
  inputFormat: 'json' | 'csv';
  apply: boolean;
  only: Set<string> | null;
};

type ImportError = {
  scope: string;
  legacyId?: string;
  message: string;
};

const DOC_STATUS_VALUES = [
  'draft',
  'pending_qa',
  'pending_exec',
  'approved',
  'rejected',
  'sent',
  'paid',
  'cancelled',
  'received',
  'acknowledged',
] as const;
const PROJECT_STATUS_VALUES = ['draft', 'active', 'on_hold', 'closed'] as const;
const TIME_STATUS_VALUES = ['submitted', 'approved', 'rejected'] as const;

type DocStatus = (typeof DOC_STATUS_VALUES)[number];
type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];
type TimeStatus = (typeof TIME_STATUS_VALUES)[number];

type PlannedIds = {
  users: Set<string>;
  customers: Set<string>;
  vendors: Set<string>;
  projects: Set<string>;
  tasks: Set<string>;
  milestones: Set<string>;
  estimates: Set<string>;
  invoices: Set<string>;
  purchase_orders: Set<string>;
  vendor_quotes: Set<string>;
  vendor_invoices: Set<string>;
  time_entries: Set<string>;
  expenses: Set<string>;
};

function parseArgValue(key: string): string | undefined {
  const prefix = `--${key}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function parseFlag(key: string): boolean {
  return process.argv.includes(`--${key}`) || process.argv.includes(`--${key}=1`);
}

function shouldShowHelp(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

function printHelp() {
  const lines = [
    'Usage: scripts/migrate-po.ts [--input-dir=DIR] [--input-format=json|csv] [--only=users,customers,...] [--apply]',
    '',
    'Options:',
    '  --input-dir=DIR   Input directory (default: tmp/migration/po)',
    '  --input-format=F  Input format: json|csv (default: json)',
    '  --only=LIST       Comma-separated scopes: users,customers,vendors,projects,tasks,milestones,estimates,invoices,purchase_orders,vendor_quotes,vendor_invoices,time_entries,expenses',
    '  --apply           Apply changes to DB (requires MIGRATION_CONFIRM=1)',
    '',
    'Examples:',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts',
    '  MIGRATION_CONFIRM=1 npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --apply',
  ];
  console.log(lines.join('\n'));
}

function parseInputFormat(value?: string): 'json' | 'csv' {
  if (!value) return 'json';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json') return 'json';
  if (normalized === 'csv') return 'csv';
  throw new Error(`invalid --input-format: ${value} (expected: json|csv)`);
}

function parseOnly(value?: string): Set<string> | null {
  if (!value) return null;
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

function requireConfirm(apply: boolean) {
  if (!apply) return;
  if (process.env.MIGRATION_CONFIRM !== '1') {
    throw new Error('MIGRATION_CONFIRM=1 is required when --apply is set');
  }
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (!('code' in err)) return false;
  return (err as any).code === 'P2002';
}

async function existsOrPlanned(
  id: string,
  planned: Set<string>,
  cache: Map<string, boolean>,
  check: () => Promise<boolean>,
): Promise<boolean> {
  if (planned.has(id)) return true;
  const cached = cache.get(id);
  if (cached != null) return cached;
  const ok = await check();
  cache.set(id, ok);
  return ok;
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return null;
  return JSON.parse(raw) as T;
}

type CsvRecord = Record<string, string | null>;

function readCsvRecordsIfExists(
  filePath: string,
  scope: string,
  errors: ImportError[],
): CsvRecord[] | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];
  const rows = parseCsvRaw(raw) as string[][];
  if (!rows.length) return [];
  if (rows.length === 1) return [];

  const header = rows[0].map((cell) => (cell ?? '').trim());
  if (!header.length || header.every((v) => !v)) {
    errors.push({ scope, message: `invalid CSV header: ${path.basename(filePath)}` });
    return [];
  }
  const records: CsvRecord[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const record: CsvRecord = {};
    for (let colIndex = 0; colIndex < header.length; colIndex += 1) {
      const key = header[colIndex];
      if (!key) continue;
      record[key] = normalizeCsvCell(row[colIndex]);
    }
    records.push(record);
  }
  return records;
}

function parseCsvJsonArray(
  scope: string,
  legacyId: string | undefined,
  value: string | null,
  errors: ImportError[],
): unknown[] | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      errors.push({
        scope,
        legacyId,
        message: 'CSV lines must be a JSON array',
      });
      return null;
    }
    return parsed;
  } catch (err) {
    errors.push({
      scope,
      legacyId,
      message: `failed to parse CSV JSON field: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

function parseCsvItems<T extends { legacyId: string }>(
  scope: string,
  records: CsvRecord[],
  required: string[],
  errors: ImportError[],
  postProcess?: (item: Record<string, unknown>, record: CsvRecord) => void,
): T[] {
  const items: T[] = [];
  for (const record of records) {
    const legacyId = record.legacyId ?? undefined;
    let ok = true;
    for (const key of required) {
      if (!record[key]) {
        errors.push({
          scope,
          legacyId,
          message: `missing required field: ${key}`,
        });
        ok = false;
      }
    }
    if (!ok) continue;
    const item: Record<string, unknown> = { ...record };
    postProcess?.(item, record);
    items.push(item as T);
  }
  return items;
}

function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T) : fallback;
}

function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const existsCache = {
  user: new Map<string, boolean>(),
  customer: new Map<string, boolean>(),
  vendor: new Map<string, boolean>(),
  project: new Map<string, boolean>(),
  task: new Map<string, boolean>(),
  milestone: new Map<string, boolean>(),
  estimate: new Map<string, boolean>(),
  invoice: new Map<string, boolean>(),
  purchaseOrder: new Map<string, boolean>(),
  vendorQuote: new Map<string, boolean>(),
  vendorInvoice: new Map<string, boolean>(),
  timeEntry: new Map<string, boolean>(),
  expense: new Map<string, boolean>(),
};

function ensureNoDuplicates(
  items: Array<{ legacyId: string; code?: string | null }>,
  scope: string,
  errors: ImportError[],
) {
  const legacySeen = new Set<string>();
  const codeSeen = new Set<string>();
  for (const item of items) {
    if (legacySeen.has(item.legacyId)) {
      errors.push({
        scope,
        legacyId: item.legacyId,
        message: 'duplicate legacyId',
      });
    }
    legacySeen.add(item.legacyId);
    if (item.code) {
      if (codeSeen.has(item.code)) {
        errors.push({
          scope,
          legacyId: item.legacyId,
          message: `duplicate code: ${item.code}`,
        });
      }
      codeSeen.add(item.code);
    }
  }
}

async function importUsers(
  options: CliOptions,
  items: UserInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('users')) return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'users', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = normalizeString(item.userId);
    if (!id) {
      errors.push({ scope: 'users', legacyId: item.legacyId, message: 'userId is required' });
      continue;
    }
    const userName = normalizeString(item.userName);
    if (!userName) {
      errors.push({ scope: 'users', legacyId: item.legacyId, message: 'userName is required' });
      continue;
    }
    const email = normalizeString(item.email) ?? undefined;
    const givenName = normalizeString(item.givenName) ?? undefined;
    const familyName = normalizeString(item.familyName) ?? undefined;
    const displayName =
      normalizeString(item.displayName) ??
      [givenName, familyName].filter(Boolean).join(' ') ||
      undefined;
    const emails = email ? [{ value: email, primary: true }] : undefined;
    const active = item.active ?? true;

    const data = {
      id,
      userName,
      displayName,
      givenName,
      familyName,
      active,
      emails,
    };
    const exists = await prisma.userAccount.findUnique({ where: { id }, select: { id: true } });
    existsCache.user.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.userAccount.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.userAccount.create({ data });
        created += 1;
      }
      existsCache.user.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'users',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

type CustomerInput = {
  legacyId: string;
  code: string;
  name: string;
  status: string;
  invoiceRegistrationId?: string | null;
  taxRegion?: string | null;
  billingAddress?: string | null;
};

type UserInput = {
  legacyId: string;
  userId: string;
  userName: string;
  email?: string | null;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  active?: boolean | null;
};

type VendorInput = {
  legacyId: string;
  code: string;
  name: string;
  status: string;
  bankInfo?: string | null;
  taxRegion?: string | null;
};

type ProjectInput = {
  legacyId: string;
  code: string;
  name: string;
  status?: ProjectStatus;
  projectType?: string | null;
  parentLegacyId?: string | null;
  customerLegacyId?: string | null;
  ownerUserId?: string | null;
  orgUnitId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
  planHours?: number | null;
  budgetCost?: number | null;
};

type TaskInput = {
  legacyId: string;
  projectLegacyId: string;
  name: string;
  status?: string | null;
  assigneeId?: string | null;
  parentLegacyId?: string | null;
  progressPercent?: number | null;
  planStart?: string | null;
  planEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
};

type MilestoneInput = {
  legacyId: string;
  projectLegacyId: string;
  name: string;
  amount: number;
  currency?: string | null;
  billUpon?: string | null;
  dueDate?: string | null;
  taxRate?: number | null;
};

type TimeEntryInput = {
  legacyId: string;
  projectLegacyId: string;
  userId: string;
  workDate: string;
  minutes: number;
  taskLegacyId?: string | null;
  workType?: string | null;
  location?: string | null;
  notes?: string | null;
  status?: TimeStatus;
};

type ExpenseInput = {
  legacyId: string;
  projectLegacyId: string;
  userId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  isShared?: boolean;
  receiptUrl?: string | null;
  status?: DocStatus;
};

type EstimateLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
};

type EstimateInput = {
  legacyId: string;
  projectLegacyId: string;
  estimateNo?: string | null;
  numberingDate?: string | null;
  version?: number | null;
  totalAmount: number;
  currency: string;
  status?: DocStatus;
  validUntil?: string | null;
  notes?: string | null;
  lines?: EstimateLineInput[] | null;
};

type BillingLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
  timeEntryRange?: string | null;
};

type InvoiceInput = {
  legacyId: string;
  projectLegacyId: string;
  invoiceNo?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  estimateLegacyId?: string | null;
  milestoneLegacyId?: string | null;
  lines?: BillingLineInput[] | null;
};

type PurchaseOrderLineInput = {
  description: string;
  quantity?: number | null;
  unitPrice: number;
  taxRate?: number | null;
  taskLegacyId?: string | null;
  expenseLegacyId?: string | null;
};

type PurchaseOrderInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  poNo?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  lines?: PurchaseOrderLineInput[] | null;
};

type VendorQuoteInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  quoteNo?: string | null;
  issueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  documentUrl?: string | null;
};

type VendorInvoiceInput = {
  legacyId: string;
  projectLegacyId: string;
  vendorLegacyId: string;
  vendorInvoiceNo?: string | null;
  receivedDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalAmount: number;
  status?: DocStatus;
  documentUrl?: string | null;
};

async function importCustomers(
  options: CliOptions,
  items: CustomerInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('customers')) return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'customers', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('customer', item.legacyId);
    const data = {
      id,
      code: item.code,
      name: item.name,
      status: item.status,
      invoiceRegistrationId: normalizeString(item.invoiceRegistrationId) ?? undefined,
      taxRegion: normalizeString(item.taxRegion) ?? undefined,
      billingAddress: normalizeString(item.billingAddress) ?? undefined,
      externalSource: 'po',
      externalId: item.legacyId,
    };
    const exists = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    existsCache.customer.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.customer.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.customer.create({ data });
        created += 1;
      }
      existsCache.customer.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'customers',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importVendors(
  options: CliOptions,
  items: VendorInput[],
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendors')) return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'vendors', errors);
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('vendor', item.legacyId);
    const data = {
      id,
      code: item.code,
      name: item.name,
      status: item.status,
      bankInfo: normalizeString(item.bankInfo) ?? undefined,
      taxRegion: normalizeString(item.taxRegion) ?? undefined,
      externalSource: 'po',
      externalId: item.legacyId,
    };
    const exists = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    existsCache.vendor.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.vendor.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.vendor.create({ data });
        created += 1;
      }
      existsCache.vendor.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendors',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importProjects(
  options: CliOptions,
  items: ProjectInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('projects')) return { created: 0, updated: 0 };
  ensureNoDuplicates(items, 'projects', errors);
  if (errors.length) return { created: 0, updated: 0 };

  const sorted = [...items].sort((a, b) => a.legacyId.localeCompare(b.legacyId));
  let created = 0;
  let updated = 0;
  for (const item of sorted) {
    const id = makeId('project', item.legacyId);
    const startDate = parseDate(item.startDate);
    const endDate = parseDate(item.endDate);
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      errors.push({
        scope: 'projects',
        legacyId: item.legacyId,
        message: 'startDate must be before or equal to endDate',
      });
      continue;
    }

    const customerId = item.customerLegacyId
      ? makeId('customer', item.customerLegacyId)
      : null;
    if (customerId) {
      const ok = await existsOrPlanned(
        customerId,
        planned.customers,
        existsCache.customer,
        async () => !!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })),
      );
      if (!ok) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: `customer not found: ${item.customerLegacyId}`,
        });
        continue;
      }
    }
    if (item.parentLegacyId) {
      const parentId = makeId('project', item.parentLegacyId);
      const ok = await existsOrPlanned(
        parentId,
        planned.projects,
        existsCache.project,
        async () => !!(await prisma.project.findUnique({ where: { id: parentId }, select: { id: true } })),
      );
      if (!ok) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: `parent project not found: ${item.parentLegacyId}`,
        });
        continue;
      }
      if (parentId === id) {
        errors.push({
          scope: 'projects',
          legacyId: item.legacyId,
          message: 'parent project must not be self',
        });
        continue;
      }
    }

    const data = {
      id,
      code: item.code,
      name: item.name,
      status: parseEnumValue(item.status, PROJECT_STATUS_VALUES, 'active'),
      projectType: normalizeString(item.projectType) ?? undefined,
      customerId,
      ownerUserId: normalizeString(item.ownerUserId) ?? undefined,
      orgUnitId: normalizeString(item.orgUnitId) ?? undefined,
      startDate,
      endDate,
      currency: normalizeString(item.currency) ?? undefined,
      planHours: parseNumber(item.planHours) ?? undefined,
      budgetCost: parseNumber(item.budgetCost) ?? undefined,
    };

    const exists = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    existsCache.project.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.project.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.project.create({ data });
        created += 1;
      }
      existsCache.project.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'projects',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (errors.length) return { created, updated };

  // Second pass: set parentId and ensure project chat room exists.
  for (const item of sorted) {
    const id = makeId('project', item.legacyId);
    const parentId = item.parentLegacyId ? makeId('project', item.parentLegacyId) : null;
    if (!options.apply) continue;
    try {
      if (parentId) {
        const parent = await prisma.project.findUnique({
          where: { id: parentId },
          select: { id: true, deletedAt: true },
        });
        if (!parent || parent.deletedAt) {
          errors.push({
            scope: 'projects',
            legacyId: item.legacyId,
            message: `parent project not found: ${item.parentLegacyId}`,
          });
        } else if (parentId !== id) {
          await prisma.project.update({ where: { id }, data: { parentId } });
        }
      } else {
        await prisma.project.update({ where: { id }, data: { parentId: null } });
      }

      try {
        await prisma.chatRoom.create({
          data: {
            id,
            type: 'project',
            name: item.code,
            isOfficial: true,
            projectId: id,
          },
        });
      } catch (err) {
        if (!isPrismaUniqueConstraintError(err)) throw err;
        const existing = await prisma.chatRoom.findFirst({
          where: { type: 'project', projectId: id },
          select: { id: true },
        });
        if (!existing) throw err;
        await prisma.chatRoom.update({
          where: { id: existing.id },
          data: {
            name: item.code,
            isOfficial: true,
            projectId: id,
            deletedAt: null,
            deletedReason: null,
          },
        });
      }
    } catch (err) {
      errors.push({
        scope: 'projects',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated };
}

async function importTasks(
  options: CliOptions,
  items: TaskInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('tasks')) return { created: 0, updated: 0 };
  const normalized = items.map((item) => ({
    ...item,
    parentLegacyId: normalizeString(item.parentLegacyId) ?? null,
  }));
  ensureNoDuplicates(
    normalized.map((item) => ({ legacyId: item.legacyId })),
    'tasks',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  const taskProjectMap = new Map<string, string>();
  for (const item of normalized) {
    taskProjectMap.set(makeId('task', item.legacyId), makeId('project', item.projectLegacyId));
  }

  let created = 0;
  let updated = 0;
  for (const item of normalized) {
    const id = makeId('task', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const progressPercent = parseNumber(item.progressPercent);
    if (progressPercent != null && (progressPercent < 0 || progressPercent > 100)) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'progressPercent must be between 0 and 100',
      });
      continue;
    }
    const planStart = parseDate(item.planStart);
    const planEnd = parseDate(item.planEnd);
    if (planStart && planEnd && planStart.getTime() > planEnd.getTime()) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'planStart must be before or equal to planEnd',
      });
      continue;
    }
    const actualStart = parseDate(item.actualStart);
    const actualEnd = parseDate(item.actualEnd);
    if (actualStart && actualEnd && actualStart.getTime() > actualEnd.getTime()) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'actualStart must be before or equal to actualEnd',
      });
      continue;
    }

    const data = {
      id,
      projectId,
      name: item.name,
      status: normalizeString(item.status) ?? undefined,
      assigneeId: normalizeString(item.assigneeId) ?? undefined,
      parentTaskId: null,
      progressPercent: progressPercent == null ? null : Math.round(progressPercent),
      planStart,
      planEnd,
      actualStart,
      actualEnd,
    };
    const exists = await prisma.projectTask.findUnique({ where: { id }, select: { id: true } });
    existsCache.task.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.projectTask.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.projectTask.create({ data });
        created += 1;
      }
      existsCache.task.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (errors.length) return { created, updated };

  // Second pass: parent relations.
  for (const item of normalized) {
    if (!item.parentLegacyId) continue;
    const id = makeId('task', item.legacyId);
    const parentTaskId = makeId('task', item.parentLegacyId);
    if (parentTaskId === id) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task must not be self',
      });
      continue;
    }
    const expectedProjectId = taskProjectMap.get(id);
    const parentExpectedProjectId = taskProjectMap.get(parentTaskId);
    if (expectedProjectId && parentExpectedProjectId && expectedProjectId !== parentExpectedProjectId) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task belongs to another project (input validation)',
      });
      continue;
    }
    const parentOk = await existsOrPlanned(
      parentTaskId,
      planned.tasks,
      existsCache.task,
      async () => !!(await prisma.projectTask.findUnique({ where: { id: parentTaskId }, select: { id: true } })),
    );
    if (!parentOk) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `parent task not found: ${item.parentLegacyId}`,
      });
      continue;
    }
    if (!options.apply) continue;
    const parent = await prisma.projectTask.findUnique({
      where: { id: parentTaskId },
      select: { id: true, deletedAt: true, projectId: true },
    });
    if (!parent || parent.deletedAt) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: `parent task not found: ${item.parentLegacyId}`,
      });
      continue;
    }
    const current = await prisma.projectTask.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!current || current.projectId !== parent.projectId) {
      errors.push({
        scope: 'tasks',
        legacyId: item.legacyId,
        message: 'parent task belongs to another project',
      });
      continue;
    }
    await prisma.projectTask.update({ where: { id }, data: { parentTaskId } });
  }

  return { created, updated };
}

async function importMilestones(
  options: CliOptions,
  items: MilestoneInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('milestones')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'milestones',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('milestone', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'milestones',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const dueDate = parseDate(item.dueDate);
    const taxRate = parseNumber(item.taxRate);
    const data = {
      id,
      projectId,
      name: item.name,
      amount: item.amount,
      billUpon: normalizeString(item.billUpon) ?? 'acceptance',
      dueDate,
      taxRate: taxRate == null ? null : taxRate,
      invoiceTemplateId: null,
    };
    const exists = await prisma.projectMilestone.findUnique({ where: { id }, select: { id: true } });
    existsCache.milestone.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.projectMilestone.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.projectMilestone.create({ data });
        created += 1;
      }
      existsCache.milestone.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'milestones',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function resolveTaskId(
  options: CliOptions,
  planned: PlannedIds,
  projectId: string,
  taskLegacyId: string,
  scope: string,
  legacyId: string,
  errors: ImportError[],
): Promise<string | null> {
  const taskId = makeId('task', taskLegacyId);
  const taskOk = await existsOrPlanned(
    taskId,
    planned.tasks,
    existsCache.task,
    async () =>
      !!(await prisma.projectTask.findUnique({ where: { id: taskId }, select: { id: true } })),
  );
  if (!taskOk) {
    errors.push({ scope, legacyId, message: `task not found: ${taskLegacyId}` });
    return null;
  }
  if (!options.apply) return taskId;
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    errors.push({ scope, legacyId, message: `task not found: ${taskLegacyId}` });
    return null;
  }
  if (task.projectId !== projectId) {
    errors.push({ scope, legacyId, message: `task belongs to another project: ${taskLegacyId}` });
    return null;
  }
  return taskId;
}

function normalizeLines<T>(lines: T[] | null | undefined): T[] {
  if (!lines) return [];
  return lines.filter((line) => line != null);
}

type NumberingKind = 'estimate' | 'invoice' | 'purchase_order' | 'vendor_quote' | 'vendor_invoice';

async function resolveDocumentNumber(
  kind: NumberingKind,
  numberingDate: Date,
  preferredNo: string | null,
  existingNo: string | null | undefined,
  existingSerial?: number | null | undefined,
): Promise<{ number: string; serial: number | null }> {
  if (existingNo) {
    return { number: existingNo, serial: existingSerial ?? null };
  }
  if (preferredNo) {
    return { number: preferredNo, serial: existingSerial ?? null };
  }
  const allocation = await nextNumber(kind, numberingDate);
  return { number: allocation.number, serial: allocation.serial };
}

async function importEstimates(
  options: CliOptions,
  items: EstimateInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('estimates')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId, code: normalizeString(item.estimateNo) })),
    'estimates',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('estimate', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'estimates',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const totalAmount = parseNumber(item.totalAmount);
    if (totalAmount == null || totalAmount < 0) {
      errors.push({
        scope: 'estimates',
        legacyId: item.legacyId,
        message: 'totalAmount must be >= 0',
      });
      continue;
    }

    const versionRaw = parseNumber(item.version);
    const version = versionRaw == null ? 1 : Math.max(1, Math.trunc(versionRaw));
    const validUntil = parseDate(item.validUntil);
    const numberingDate = parseDate(item.numberingDate) || new Date();
    const preferredNo = normalizeString(item.estimateNo);
    const currency = normalizeString(item.currency) || 'JPY';

    const exists = await prisma.estimate.findUnique({
      where: { id },
      select: { id: true, estimateNo: true, numberingSerial: true },
    });
    existsCache.estimate.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = normalizeLines(item.lines).length
      ? normalizeLines(item.lines)
      : [
          {
            description: `Imported (${item.legacyId})`,
            quantity: 1,
            unitPrice: totalAmount,
            taxRate: null,
            taskLegacyId: null,
          } satisfies EstimateLineInput,
        ];

    const lineData: Array<{
      estimateId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = parseNumber(line.unitPrice);
      if (unitPrice == null || unitPrice < 0) {
        errors.push({
          scope: 'estimates',
          legacyId: item.legacyId,
          message: 'line.unitPrice must be >= 0',
        });
        continue;
      }
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(options, planned, projectId, taskLegacyId, 'estimates', item.legacyId, errors)
        : null;
      if (taskLegacyId && !taskId) continue;
      lineData.push({
        estimateId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'estimate',
      numberingDate,
      preferredNo,
      exists?.estimateNo,
      exists?.numberingSerial,
    );
    const estimateNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      estimateNo,
      version,
      totalAmount,
      currency,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
      validUntil,
      notes: normalizeString(item.notes) ?? undefined,
      numberingSerial: numberingSerial ?? undefined,
      pdfUrl: undefined,
      emailMessageId: undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.estimate.update({
            where: { id },
            data: {
              projectId,
              version,
              totalAmount,
              currency,
              status: data.status,
              validUntil,
              notes: data.notes,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.estimate.create({ data });
        }
        await tx.estimateLine.deleteMany({ where: { estimateId: id } });
        if (lineData.length) {
          await tx.estimateLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.estimate.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'estimates',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importInvoices(
  options: CliOptions,
  items: InvoiceInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('invoices')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId, code: normalizeString(item.invoiceNo) })),
    'invoices',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('invoice', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'invoices',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const totalAmount = parseNumber(item.totalAmount);
    if (totalAmount == null || totalAmount < 0) {
      errors.push({ scope: 'invoices', legacyId: item.legacyId, message: 'totalAmount must be >= 0' });
      continue;
    }
    const issueDate = parseDate(item.issueDate);
    const dueDate = parseDate(item.dueDate);
    const numberingDate = issueDate || dueDate || new Date();
    const preferredNo = normalizeString(item.invoiceNo);
    const currency = normalizeString(item.currency) || 'JPY';

    const estimateId = normalizeString(item.estimateLegacyId)
      ? makeId('estimate', item.estimateLegacyId as string)
      : null;
    if (estimateId) {
      const ok = await existsOrPlanned(
        estimateId,
        planned.estimates,
        existsCache.estimate,
        async () => !!(await prisma.estimate.findUnique({ where: { id: estimateId }, select: { id: true } })),
      );
      if (!ok) {
        errors.push({ scope: 'invoices', legacyId: item.legacyId, message: `estimate not found: ${item.estimateLegacyId}` });
        continue;
      }
    }

    const milestoneId = normalizeString(item.milestoneLegacyId)
      ? makeId('milestone', item.milestoneLegacyId as string)
      : null;
    if (milestoneId) {
      const ok = await existsOrPlanned(
        milestoneId,
        planned.milestones,
        existsCache.milestone,
        async () => !!(await prisma.projectMilestone.findUnique({ where: { id: milestoneId }, select: { id: true } })),
      );
      if (!ok) {
        errors.push({ scope: 'invoices', legacyId: item.legacyId, message: `milestone not found: ${item.milestoneLegacyId}` });
        continue;
      }
    }

    const exists = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNo: true, numberingSerial: true },
    });
    existsCache.invoice.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = normalizeLines(item.lines).length
      ? normalizeLines(item.lines)
      : [
          {
            description: `Imported (${item.legacyId})`,
            quantity: 1,
            unitPrice: totalAmount,
            taxRate: null,
            taskLegacyId: null,
            timeEntryRange: null,
          } satisfies BillingLineInput,
        ];

    const lineData: Array<{
      invoiceId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
      timeEntryRange: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = parseNumber(line.unitPrice);
      if (unitPrice == null || unitPrice < 0) {
        errors.push({ scope: 'invoices', legacyId: item.legacyId, message: 'line.unitPrice must be >= 0' });
        continue;
      }
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(options, planned, projectId, taskLegacyId, 'invoices', item.legacyId, errors)
        : null;
      if (taskLegacyId && !taskId) continue;
      lineData.push({
        invoiceId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
        timeEntryRange: normalizeString(line.timeEntryRange),
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'invoice',
      numberingDate,
      preferredNo,
      exists?.invoiceNo,
      exists?.numberingSerial,
    );
    const invoiceNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      estimateId,
      milestoneId,
      invoiceNo,
      issueDate,
      dueDate,
      currency,
      totalAmount,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
      pdfUrl: undefined,
      emailMessageId: undefined,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.invoice.update({
            where: { id },
            data: {
              projectId,
              estimateId,
              milestoneId,
              issueDate,
              dueDate,
              currency,
              totalAmount,
              status: data.status,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.invoice.create({ data });
        }
        await tx.billingLine.deleteMany({ where: { invoiceId: id } });
        if (lineData.length) {
          await tx.billingLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.invoice.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'invoices',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importPurchaseOrders(
  options: CliOptions,
  items: PurchaseOrderInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('purchase_orders')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId, code: normalizeString(item.poNo) })),
    'purchase_orders',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('purchase_order', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({ scope: 'purchase_orders', legacyId: item.legacyId, message: `project not found: ${item.projectLegacyId}` });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () => !!(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })),
    );
    if (!vendorOk) {
      errors.push({ scope: 'purchase_orders', legacyId: item.legacyId, message: `vendor not found: ${item.vendorLegacyId}` });
      continue;
    }

    const totalAmount = parseNumber(item.totalAmount);
    if (totalAmount == null || totalAmount < 0) {
      errors.push({ scope: 'purchase_orders', legacyId: item.legacyId, message: 'totalAmount must be >= 0' });
      continue;
    }
    const issueDate = parseDate(item.issueDate);
    const dueDate = parseDate(item.dueDate);
    const numberingDate = issueDate || dueDate || new Date();
    const preferredNo = normalizeString(item.poNo);
    const currency = normalizeString(item.currency) || 'JPY';

    const exists = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, poNo: true, numberingSerial: true },
    });
    existsCache.purchaseOrder.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const lines = normalizeLines(item.lines).length
      ? normalizeLines(item.lines)
      : [
          {
            description: `Imported (${item.legacyId})`,
            quantity: 1,
            unitPrice: totalAmount,
            taxRate: null,
            taskLegacyId: null,
            expenseLegacyId: null,
          } satisfies PurchaseOrderLineInput,
        ];

    const lineData: Array<{
      purchaseOrderId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number | null;
      taskId: string | null;
      expenseId: string | null;
    }> = [];
    for (const line of lines) {
      const quantity = parseNumber(line.quantity) ?? 1;
      const unitPrice = parseNumber(line.unitPrice);
      if (unitPrice == null || unitPrice < 0) {
        errors.push({ scope: 'purchase_orders', legacyId: item.legacyId, message: 'line.unitPrice must be >= 0' });
        continue;
      }
      const taskLegacyId = normalizeString(line.taskLegacyId);
      const taskId = taskLegacyId
        ? await resolveTaskId(options, planned, projectId, taskLegacyId, 'purchase_orders', item.legacyId, errors)
        : null;
      if (taskLegacyId && !taskId) continue;

      const expenseLegacyId = normalizeString(line.expenseLegacyId);
      const expenseId = expenseLegacyId ? makeId('expense', expenseLegacyId) : null;
      if (expenseId) {
        const ok = await existsOrPlanned(
          expenseId,
          planned.expenses,
          existsCache.expense,
          async () => !!(await prisma.expense.findUnique({ where: { id: expenseId }, select: { id: true } })),
        );
        if (!ok) {
          errors.push({ scope: 'purchase_orders', legacyId: item.legacyId, message: `expense not found: ${expenseLegacyId}` });
          continue;
        }
      }

      lineData.push({
        purchaseOrderId: id,
        description: line.description,
        quantity,
        unitPrice,
        taxRate: parseNumber(line.taxRate),
        taskId,
        expenseId,
      });
    }
    if (errors.length) break;

    const resolved = await resolveDocumentNumber(
      'purchase_order',
      numberingDate,
      preferredNo,
      exists?.poNo,
      exists?.numberingSerial,
    );
    const poNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      vendorId,
      poNo,
      issueDate,
      dueDate,
      currency,
      totalAmount,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
      pdfUrl: undefined,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      await prisma.$transaction(async (tx: any) => {
        if (exists) {
          await tx.purchaseOrder.update({
            where: { id },
            data: {
              projectId,
              vendorId,
              issueDate,
              dueDate,
              currency,
              totalAmount,
              status: data.status,
              deletedAt: null,
              deletedReason: null,
            },
          });
        } else {
          await tx.purchaseOrder.create({ data });
        }
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        if (lineData.length) {
          await tx.purchaseOrderLine.createMany({ data: lineData });
        }
      });
      if (exists) updated += 1;
      else created += 1;
      existsCache.purchaseOrder.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'purchase_orders',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importVendorQuotes(
  options: CliOptions,
  items: VendorQuoteInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendor_quotes')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId, code: normalizeString(item.quoteNo) })),
    'vendor_quotes',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('vendor_quote', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({ scope: 'vendor_quotes', legacyId: item.legacyId, message: `project not found: ${item.projectLegacyId}` });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () => !!(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })),
    );
    if (!vendorOk) {
      errors.push({ scope: 'vendor_quotes', legacyId: item.legacyId, message: `vendor not found: ${item.vendorLegacyId}` });
      continue;
    }

    const totalAmount = parseNumber(item.totalAmount);
    if (totalAmount == null || totalAmount < 0) {
      errors.push({ scope: 'vendor_quotes', legacyId: item.legacyId, message: 'totalAmount must be >= 0' });
      continue;
    }
    const issueDate = parseDate(item.issueDate);
    const numberingDate = issueDate || new Date();
    const preferredNo = normalizeString(item.quoteNo);
    const currency = normalizeString(item.currency) || 'JPY';

    const exists = await prisma.vendorQuote.findUnique({
      where: { id },
      select: { id: true, quoteNo: true },
    });
    existsCache.vendorQuote.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const quoteNo = (
      await resolveDocumentNumber('vendor_quote', numberingDate, preferredNo, exists?.quoteNo)
    ).number;

    const data = {
      id,
      projectId,
      vendorId,
      quoteNo,
      issueDate,
      currency,
      totalAmount,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'received'),
      documentUrl: normalizeString(item.documentUrl) ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      if (exists) {
        await prisma.vendorQuote.update({
          where: { id },
          data: {
            projectId,
            vendorId,
            quoteNo,
            issueDate,
            currency,
            totalAmount,
            status: data.status,
            documentUrl: data.documentUrl,
            deletedAt: null,
            deletedReason: null,
          },
        });
        updated += 1;
      } else {
        await prisma.vendorQuote.create({ data });
        created += 1;
      }
      existsCache.vendorQuote.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendor_quotes',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importVendorInvoices(
  options: CliOptions,
  items: VendorInvoiceInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('vendor_invoices')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId, code: normalizeString(item.vendorInvoiceNo) })),
    'vendor_invoices',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('vendor_invoice', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const vendorId = makeId('vendor', item.vendorLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({ scope: 'vendor_invoices', legacyId: item.legacyId, message: `project not found: ${item.projectLegacyId}` });
      continue;
    }
    const vendorOk = await existsOrPlanned(
      vendorId,
      planned.vendors,
      existsCache.vendor,
      async () => !!(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })),
    );
    if (!vendorOk) {
      errors.push({ scope: 'vendor_invoices', legacyId: item.legacyId, message: `vendor not found: ${item.vendorLegacyId}` });
      continue;
    }

    const totalAmount = parseNumber(item.totalAmount);
    if (totalAmount == null || totalAmount < 0) {
      errors.push({ scope: 'vendor_invoices', legacyId: item.legacyId, message: 'totalAmount must be >= 0' });
      continue;
    }
    const receivedDate = parseDate(item.receivedDate);
    const dueDate = parseDate(item.dueDate);
    const numberingDate = receivedDate || dueDate || new Date();
    const preferredNo = normalizeString(item.vendorInvoiceNo);
    const currency = normalizeString(item.currency) || 'JPY';

    const exists = await prisma.vendorInvoice.findUnique({
      where: { id },
      select: { id: true, vendorInvoiceNo: true, numberingSerial: true },
    });
    existsCache.vendorInvoice.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }

    const resolved = await resolveDocumentNumber(
      'vendor_invoice',
      numberingDate,
      preferredNo,
      exists?.vendorInvoiceNo,
      exists?.numberingSerial,
    );
    const vendorInvoiceNo = resolved.number;
    const numberingSerial = resolved.serial;

    const data = {
      id,
      projectId,
      vendorId,
      vendorInvoiceNo,
      receivedDate,
      dueDate,
      currency,
      totalAmount,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'received'),
      documentUrl: normalizeString(item.documentUrl) ?? undefined,
      numberingSerial: numberingSerial ?? undefined,
      deletedAt: null,
      deletedReason: null,
    };

    try {
      if (exists) {
        await prisma.vendorInvoice.update({
          where: { id },
          data: {
            projectId,
            vendorId,
            vendorInvoiceNo,
            receivedDate,
            dueDate,
            currency,
            totalAmount,
            status: data.status,
            documentUrl: data.documentUrl,
            numberingSerial: numberingSerial ?? undefined,
            deletedAt: null,
            deletedReason: null,
          },
        });
        updated += 1;
      } else {
        await prisma.vendorInvoice.create({ data });
        created += 1;
      }
      existsCache.vendorInvoice.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'vendor_invoices',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importTimeEntries(
  options: CliOptions,
  items: TimeEntryInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('time_entries')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'time_entries',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('time_entry', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }

    const taskLegacyId = normalizeString(item.taskLegacyId);
    const taskId = taskLegacyId
      ? await resolveTaskId(
          options,
          planned,
          projectId,
          taskLegacyId,
          'time_entries',
          item.legacyId,
          errors,
        )
      : null;
    if (taskLegacyId && !taskId) continue;
    const workDate = parseDate(item.workDate);
    if (!workDate) {
      errors.push({
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: 'invalid workDate',
      });
      continue;
    }
    const minutes = parseNumber(item.minutes);
    if (minutes == null || minutes <= 0) {
      errors.push({
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: 'minutes must be > 0',
      });
      continue;
    }
    const data = {
      id,
      projectId,
      taskId,
      billedInvoiceId: null,
      billedAt: null,
      userId: item.userId,
      workDate,
      minutes: Math.round(minutes),
      workType: normalizeString(item.workType) ?? undefined,
      location: normalizeString(item.location) ?? undefined,
      notes: normalizeString(item.notes) ?? undefined,
      status: parseEnumValue(item.status, TIME_STATUS_VALUES, 'submitted'),
      approvedBy: null,
      approvedAt: null,
    };
    const exists = await prisma.timeEntry.findUnique({ where: { id }, select: { id: true } });
    existsCache.timeEntry.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.timeEntry.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.timeEntry.create({ data });
        created += 1;
      }
      existsCache.timeEntry.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'time_entries',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

async function importExpenses(
  options: CliOptions,
  items: ExpenseInput[],
  planned: PlannedIds,
  errors: ImportError[],
) {
  if (options.only && !options.only.has('expenses')) return { created: 0, updated: 0 };
  ensureNoDuplicates(
    items.map((item) => ({ legacyId: item.legacyId })),
    'expenses',
    errors,
  );
  if (errors.length) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const id = makeId('expense', item.legacyId);
    const projectId = makeId('project', item.projectLegacyId);
    const projectOk = await existsOrPlanned(
      projectId,
      planned.projects,
      existsCache.project,
      async () => !!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })),
    );
    if (!projectOk) {
      errors.push({
        scope: 'expenses',
        legacyId: item.legacyId,
        message: `project not found: ${item.projectLegacyId}`,
      });
      continue;
    }
    const incurredOn = parseDate(item.incurredOn);
    if (!incurredOn) {
      errors.push({ scope: 'expenses', legacyId: item.legacyId, message: 'invalid incurredOn' });
      continue;
    }
    const amount = parseNumber(item.amount);
    if (amount == null || amount < 0) {
      errors.push({ scope: 'expenses', legacyId: item.legacyId, message: 'amount must be >= 0' });
      continue;
    }
    const data = {
      id,
      projectId,
      userId: item.userId,
      category: item.category,
      amount,
      currency: item.currency,
      incurredOn,
      isShared: item.isShared === true,
      status: parseEnumValue(item.status, DOC_STATUS_VALUES, 'draft'),
      receiptUrl: normalizeString(item.receiptUrl) ?? undefined,
    };
    const exists = await prisma.expense.findUnique({ where: { id }, select: { id: true } });
    existsCache.expense.set(id, !!exists);
    if (!options.apply) {
      if (exists) updated += 1;
      else created += 1;
      continue;
    }
    try {
      if (exists) {
        await prisma.expense.update({ where: { id }, data });
        updated += 1;
      } else {
        await prisma.expense.create({ data });
        created += 1;
      }
      existsCache.expense.set(id, true);
    } catch (err) {
      errors.push({
        scope: 'expenses',
        legacyId: item.legacyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, updated };
}

function shouldRun(options: CliOptions, key: string) {
  return !options.only || options.only.has(key);
}

async function main() {
  if (shouldShowHelp()) {
    printHelp();
    return;
  }

  const inputDir =
    parseArgValue('input-dir') || parseArgValue('inputDir') || 'tmp/migration/po';
  const inputFormat = parseInputFormat(parseArgValue('input-format') || parseArgValue('inputFormat'));
  const apply = parseFlag('apply');
  const only = parseOnly(parseArgValue('only'));
  const options: CliOptions = { inputDir, inputFormat, apply, only };
  requireConfirm(apply);

  const errors: ImportError[] = [];

  function readInputArray<T extends { legacyId: string }>(
    scope: string,
    baseName: string,
    required: string[],
    postProcess?: (item: Record<string, unknown>, record: CsvRecord) => void,
  ): T[] {
    if (options.inputFormat === 'csv') {
      const records = readCsvRecordsIfExists(
        path.join(inputDir, `${baseName}.csv`),
        scope,
        errors,
      );
      if (!records) return [];
      return parseCsvItems<T>(scope, records, required, errors, postProcess);
    }
    const json = readJsonIfExists<T[]>(path.join(inputDir, `${baseName}.json`));
    return (json ?? []) as T[];
  }

  const users = readInputArray<UserInput>('users', 'users', ['legacyId', 'userId', 'userName'], (item, record) => {
    const parsed = parseCsvBoolean(record.active ?? null);
    if (parsed != null) item.active = parsed;
    else if (record.active != null) {
      errors.push({
        scope: 'users',
        legacyId: record.legacyId ?? undefined,
        message: 'invalid active (expected: true/false/1/0)',
      });
    }
  });
  const customers = readInputArray<CustomerInput>('customers', 'customers', [
    'legacyId',
    'code',
    'name',
    'status',
  ]);
  const vendors = readInputArray<VendorInput>('vendors', 'vendors', [
    'legacyId',
    'code',
    'name',
    'status',
  ]);
  const projects = readInputArray<ProjectInput>('projects', 'projects', ['legacyId', 'code', 'name']);
  const tasks = readInputArray<TaskInput>('tasks', 'tasks', ['legacyId', 'projectLegacyId', 'name']);
  const milestones = readInputArray<MilestoneInput>('milestones', 'milestones', [
    'legacyId',
    'projectLegacyId',
    'name',
    'amount',
  ]);
  const estimates = readInputArray<EstimateInput>(
    'estimates',
    'estimates',
    ['legacyId', 'projectLegacyId', 'totalAmount', 'currency'],
    (item, record) => {
      if (record.lines != null) {
        item.lines = parseCsvJsonArray('estimates', record.legacyId ?? undefined, record.lines, errors) ?? null;
      }
    },
  );
  const invoices = readInputArray<InvoiceInput>(
    'invoices',
    'invoices',
    ['legacyId', 'projectLegacyId', 'currency', 'totalAmount'],
    (item, record) => {
      if (record.lines != null) {
        item.lines = parseCsvJsonArray('invoices', record.legacyId ?? undefined, record.lines, errors) ?? null;
      }
    },
  );
  const purchaseOrders = readInputArray<PurchaseOrderInput>(
    'purchase_orders',
    'purchase_orders',
    ['legacyId', 'projectLegacyId', 'vendorLegacyId', 'currency', 'totalAmount'],
    (item, record) => {
      if (record.lines != null) {
        item.lines = parseCsvJsonArray('purchase_orders', record.legacyId ?? undefined, record.lines, errors) ?? null;
      }
    },
  );
  const vendorQuotes = readInputArray<VendorQuoteInput>(
    'vendor_quotes',
    'vendor_quotes',
    ['legacyId', 'projectLegacyId', 'vendorLegacyId', 'currency', 'totalAmount'],
  );
  const vendorInvoices = readInputArray<VendorInvoiceInput>(
    'vendor_invoices',
    'vendor_invoices',
    ['legacyId', 'projectLegacyId', 'vendorLegacyId', 'currency', 'totalAmount'],
  );
  const timeEntries = readInputArray<TimeEntryInput>(
    'time_entries',
    'time_entries',
    ['legacyId', 'projectLegacyId', 'userId', 'workDate', 'minutes'],
  );
  const expenses = readInputArray<ExpenseInput>(
    'expenses',
    'expenses',
    ['legacyId', 'projectLegacyId', 'userId', 'category', 'amount', 'currency', 'incurredOn'],
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

  const planned: PlannedIds = {
    users: new Set<string>(),
    customers: new Set<string>(),
    vendors: new Set<string>(),
    projects: new Set<string>(),
    tasks: new Set<string>(),
    milestones: new Set<string>(),
    estimates: new Set<string>(),
    invoices: new Set<string>(),
    purchase_orders: new Set<string>(),
    vendor_quotes: new Set<string>(),
    vendor_invoices: new Set<string>(),
    time_entries: new Set<string>(),
    expenses: new Set<string>(),
  };
  if (shouldRun(options, 'users')) {
    users.forEach((item) => planned.users.add(item.userId));
  }
  if (shouldRun(options, 'customers')) {
    customers.forEach((item) => planned.customers.add(makeId('customer', item.legacyId)));
  }
  if (shouldRun(options, 'vendors')) {
    vendors.forEach((item) => planned.vendors.add(makeId('vendor', item.legacyId)));
  }
  if (shouldRun(options, 'projects')) {
    projects.forEach((item) => planned.projects.add(makeId('project', item.legacyId)));
  }
  if (shouldRun(options, 'tasks')) {
    tasks.forEach((item) => planned.tasks.add(makeId('task', item.legacyId)));
  }
  if (shouldRun(options, 'milestones')) {
    milestones.forEach((item) => planned.milestones.add(makeId('milestone', item.legacyId)));
  }
  if (shouldRun(options, 'estimates')) {
    estimates.forEach((item) => planned.estimates.add(makeId('estimate', item.legacyId)));
  }
  if (shouldRun(options, 'invoices')) {
    invoices.forEach((item) => planned.invoices.add(makeId('invoice', item.legacyId)));
  }
  if (shouldRun(options, 'purchase_orders')) {
    purchaseOrders.forEach((item) =>
      planned.purchase_orders.add(makeId('purchase_order', item.legacyId)),
    );
  }
  if (shouldRun(options, 'vendor_quotes')) {
    vendorQuotes.forEach((item) => planned.vendor_quotes.add(makeId('vendor_quote', item.legacyId)));
  }
  if (shouldRun(options, 'vendor_invoices')) {
    vendorInvoices.forEach((item) =>
      planned.vendor_invoices.add(makeId('vendor_invoice', item.legacyId)),
    );
  }
  if (shouldRun(options, 'time_entries')) {
    timeEntries.forEach((item) => planned.time_entries.add(makeId('time_entry', item.legacyId)));
  }
  if (shouldRun(options, 'expenses')) {
    expenses.forEach((item) => planned.expenses.add(makeId('expense', item.legacyId)));
  }

  console.log('[migration-po] input dir:', inputDir);
  console.log('[migration-po] input format:', inputFormat);
  console.log('[migration-po] mode:', apply ? 'apply' : 'dry-run');
  if (only) console.log('[migration-po] only:', Array.from(only).join(','));

  const summary: Record<string, { created: number; updated: number; total: number }> = {};

  if (shouldRun(options, 'users')) {
    const res = await importUsers(options, users, errors);
    summary.users = { ...res, total: users.length };
  }
  if (shouldRun(options, 'customers')) {
    const res = await importCustomers(options, customers, errors);
    summary.customers = { ...res, total: customers.length };
  }
  if (shouldRun(options, 'vendors')) {
    const res = await importVendors(options, vendors, errors);
    summary.vendors = { ...res, total: vendors.length };
  }
  if (shouldRun(options, 'projects')) {
    const res = await importProjects(options, projects, planned, errors);
    summary.projects = { ...res, total: projects.length };
  }
  if (shouldRun(options, 'tasks')) {
    const res = await importTasks(options, tasks, planned, errors);
    summary.tasks = { ...res, total: tasks.length };
  }
  if (shouldRun(options, 'milestones')) {
    const res = await importMilestones(options, milestones, planned, errors);
    summary.milestones = { ...res, total: milestones.length };
  }
  if (shouldRun(options, 'estimates')) {
    const res = await importEstimates(options, estimates, planned, errors);
    summary.estimates = { ...res, total: estimates.length };
  }
  if (shouldRun(options, 'invoices')) {
    const res = await importInvoices(options, invoices, planned, errors);
    summary.invoices = { ...res, total: invoices.length };
  }
  if (shouldRun(options, 'purchase_orders')) {
    const res = await importPurchaseOrders(options, purchaseOrders, planned, errors);
    summary.purchase_orders = { ...res, total: purchaseOrders.length };
  }
  if (shouldRun(options, 'vendor_quotes')) {
    const res = await importVendorQuotes(options, vendorQuotes, planned, errors);
    summary.vendor_quotes = { ...res, total: vendorQuotes.length };
  }
  if (shouldRun(options, 'vendor_invoices')) {
    const res = await importVendorInvoices(options, vendorInvoices, planned, errors);
    summary.vendor_invoices = { ...res, total: vendorInvoices.length };
  }
  if (shouldRun(options, 'time_entries')) {
    const res = await importTimeEntries(options, timeEntries, planned, errors);
    summary.time_entries = { ...res, total: timeEntries.length };
  }
  if (shouldRun(options, 'expenses')) {
    const res = await importExpenses(options, expenses, planned, errors);
    summary.expenses = { ...res, total: expenses.length };
  }

  console.log('[migration-po] summary:', JSON.stringify(summary, null, 2));

  if (errors.length) {
    console.error('[migration-po] errors:', JSON.stringify(errors.slice(0, 50), null, 2));
    process.exitCode = 1;
    return;
  }

  if (apply) {
    const verifyErrors: ImportError[] = [];
    const defaultVerifyChunkSize = 1000;
    const parsedVerifyChunkSize = Number.parseInt(process.env.MIGRATION_VERIFY_CHUNK_SIZE ?? '', 10);
    const verifyChunkSize =
      Number.isFinite(parsedVerifyChunkSize) && parsedVerifyChunkSize > 0
        ? parsedVerifyChunkSize
        : defaultVerifyChunkSize;

    async function verifyIds(scope: string, ids: string[], countFn: (ids: string[]) => Promise<number>) {
      if (!ids.length) return;
      let total = 0;
      for (let offset = 0; offset < ids.length; offset += verifyChunkSize) {
        const chunk = ids.slice(offset, offset + verifyChunkSize);
        total += await countFn(chunk);
      }
      if (total !== ids.length) {
        verifyErrors.push({
          scope,
          message: `integrity check mismatch: expected ${ids.length}, got ${total}`,
        });
      }
    }

    function toNumber(value: unknown): number {
      if (value == null) return 0;
      if (typeof value === 'number') return value;
      return Number(String(value));
    }

    function isClose(a: number, b: number, tolerance: number): boolean {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return Math.abs(a - b) <= tolerance;
    }

    async function groupSumByProject(
      ids: string[],
      sumKey: string,
      groupByFn: (ids: string[]) => Promise<{ projectId: string; _sum?: Record<string, unknown> }[]>,
    ): Promise<Map<string, number>> {
      const totals = new Map<string, number>();
      for (let offset = 0; offset < ids.length; offset += verifyChunkSize) {
        const chunk = ids.slice(offset, offset + verifyChunkSize);
        const rows = await groupByFn(chunk);
        for (const row of rows) {
          const value = toNumber(row._sum?.[sumKey]);
          totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + value);
        }
      }
      return totals;
    }

    type ProjectInfo = { legacyId?: string; code?: string; name?: string };
    const projectInfo = new Map<string, ProjectInfo>();
    for (const item of projects) {
      projectInfo.set(makeId('project', item.legacyId), {
        legacyId: item.legacyId,
        code: item.code,
        name: item.name,
      });
    }

    function rememberProject(projectId: string, legacyId: string) {
      const info = projectInfo.get(projectId);
      if (info) {
        if (!info.legacyId) info.legacyId = legacyId;
        return;
      }
      projectInfo.set(projectId, { legacyId });
    }

    function describeProject(projectId: string): string {
      const info = projectInfo.get(projectId);
      if (!info) return projectId;
      const parts: string[] = [];
      if (info.code) parts.push(info.code);
      if (info.name) parts.push(info.name);
      if (info.legacyId && info.legacyId !== info.code) parts.push(`legacy:${info.legacyId}`);
      const label = parts.join(' / ');
      return label ? `${label} (${projectId})` : projectId;
    }

    function addSum(map: Map<string, number>, key: string, value: number) {
      map.set(key, (map.get(key) ?? 0) + value);
    }

    function verifyProjectSums(
      scope: string,
      expected: Map<string, number>,
      actual: Map<string, number>,
      tolerance: number,
    ) {
      const keys = new Set<string>([...expected.keys(), ...actual.keys()]);
      for (const projectId of keys) {
        const exp = expected.get(projectId) ?? 0;
        const act = actual.get(projectId) ?? 0;
        if (!isClose(exp, act, tolerance)) {
          const diff = act - exp;
          verifyErrors.push({
            scope,
            legacyId: projectInfo.get(projectId)?.legacyId,
            message: `project sum mismatch: project=${describeProject(projectId)} expected=${exp} actual=${act} diff=${diff}`,
          });
        }
      }
    }

    type PurchaseOrderDoc = { id: string; poNo: string; projectId: string };
    type PurchaseOrderLineDoc = { id: string; purchaseOrderId: string; expenseId: string | null };
    type ExpenseDoc = { id: string; projectId: string };

    if (shouldRun(options, 'customers')) {
      await verifyIds(
        'customers',
        customers.map((item) => makeId('customer', item.legacyId)),
        async (ids) => prisma.customer.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendors')) {
      await verifyIds(
        'vendors',
        vendors.map((item) => makeId('vendor', item.legacyId)),
        async (ids) => prisma.vendor.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'projects')) {
      await verifyIds(
        'projects',
        projects.map((item) => makeId('project', item.legacyId)),
        async (ids) => prisma.project.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'tasks')) {
      await verifyIds(
        'tasks',
        tasks.map((item) => makeId('task', item.legacyId)),
        async (ids) => prisma.projectTask.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'milestones')) {
      await verifyIds(
        'milestones',
        milestones.map((item) => makeId('milestone', item.legacyId)),
        async (ids) => prisma.projectMilestone.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'estimates')) {
      await verifyIds(
        'estimates',
        estimates.map((item) => makeId('estimate', item.legacyId)),
        async (ids) => prisma.estimate.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'invoices')) {
      await verifyIds(
        'invoices',
        invoices.map((item) => makeId('invoice', item.legacyId)),
        async (ids) => prisma.invoice.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'purchase_orders')) {
      await verifyIds(
        'purchase_orders',
        purchaseOrders.map((item) => makeId('purchase_order', item.legacyId)),
        async (ids) => prisma.purchaseOrder.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendor_quotes')) {
      await verifyIds(
        'vendor_quotes',
        vendorQuotes.map((item) => makeId('vendor_quote', item.legacyId)),
        async (ids) => prisma.vendorQuote.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'vendor_invoices')) {
      await verifyIds(
        'vendor_invoices',
        vendorInvoices.map((item) => makeId('vendor_invoice', item.legacyId)),
        async (ids) => prisma.vendorInvoice.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'time_entries')) {
      await verifyIds(
        'time_entries',
        timeEntries.map((item) => makeId('time_entry', item.legacyId)),
        async (ids) => prisma.timeEntry.count({ where: { id: { in: ids } } }),
      );
    }
    if (shouldRun(options, 'expenses')) {
      await verifyIds(
        'expenses',
        expenses.map((item) => makeId('expense', item.legacyId)),
        async (ids) => prisma.expense.count({ where: { id: { in: ids } } }),
      );
    }

    if (shouldRun(options, 'invoices') && invoices.length) {
      const invoiceIds = invoices.map((item) => makeId('invoice', item.legacyId));
      const docs = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
          invoiceNo: true,
          projectId: true,
          estimateId: true,
          milestoneId: true,
          estimate: { select: { projectId: true } },
          milestone: { select: { projectId: true } },
        },
      });
      for (const doc of docs) {
        if (doc.estimateId && !doc.estimate?.projectId) {
          verifyErrors.push({
            scope: 'invoices.estimateProject',
            message: `estimate missing (${doc.invoiceNo}): estimateId=${doc.estimateId}`,
          });
        }
        if (doc.estimate?.projectId && doc.estimate.projectId !== doc.projectId) {
          verifyErrors.push({
            scope: 'invoices.estimateProject',
            message: `estimate project mismatch (${doc.invoiceNo}): invoice.project=${describeProject(doc.projectId)} estimate.project=${describeProject(doc.estimate.projectId)}`,
          });
        }

        if (doc.milestoneId && !doc.milestone?.projectId) {
          verifyErrors.push({
            scope: 'invoices.milestoneProject',
            message: `milestone missing (${doc.invoiceNo}): milestoneId=${doc.milestoneId}`,
          });
        }
        if (doc.milestone?.projectId && doc.milestone.projectId !== doc.projectId) {
          verifyErrors.push({
            scope: 'invoices.milestoneProject',
            message: `milestone project mismatch (${doc.invoiceNo}): invoice.project=${describeProject(doc.projectId)} milestone.project=${describeProject(doc.milestone.projectId)}`,
          });
        }
      }
    }

    if (shouldRun(options, 'purchase_orders') && purchaseOrders.length) {
      const poIds = purchaseOrders.map((item) => makeId('purchase_order', item.legacyId));
      const purchaseOrderDocs: PurchaseOrderDoc[] = await prisma.purchaseOrder.findMany({
        where: { id: { in: poIds } },
        select: { id: true, poNo: true, projectId: true },
      });
      const purchaseOrderById = new Map<string, { poNo: string; projectId: string }>(
        purchaseOrderDocs.map((doc) => [doc.id, { poNo: doc.poNo, projectId: doc.projectId }]),
      );
      const lines: PurchaseOrderLineDoc[] = await prisma.purchaseOrderLine.findMany({
        where: { purchaseOrderId: { in: poIds }, expenseId: { not: null } },
        select: { id: true, purchaseOrderId: true, expenseId: true },
      });
      const expenseIds = Array.from(
        new Set(lines.map((line) => line.expenseId).filter(Boolean)),
      );
      if (expenseIds.length) {
        const expenseDocs: ExpenseDoc[] = await prisma.expense.findMany({
          where: { id: { in: expenseIds } },
          select: { id: true, projectId: true },
        });
        const expenseProjectById = new Map<string, string>(
          expenseDocs.map((doc) => [doc.id, doc.projectId]),
        );
        for (const line of lines) {
          if (!line.expenseId) continue;
          const po = purchaseOrderById.get(line.purchaseOrderId);
          if (!po) continue;
          const expenseProjectId = expenseProjectById.get(line.expenseId);
          if (!expenseProjectId) {
            verifyErrors.push({
              scope: 'purchase_orders.expenseProject',
              message: `expense missing (${po.poNo}): lineId=${line.id} expenseId=${line.expenseId}`,
            });
            continue;
          }
          if (expenseProjectId !== po.projectId) {
            verifyErrors.push({
              scope: 'purchase_orders.expenseProject',
              message: `expense project mismatch (${po.poNo}): PO.project=${describeProject(po.projectId)} expense.project=${describeProject(expenseProjectId)} lineId=${line.id} expenseId=${line.expenseId}`,
            });
          }
        }
      }
    }

    if (shouldRun(options, 'invoices') && invoices.length) {
      const expected = new Map<string, number>();
      for (const item of invoices) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = invoices.map((item) => makeId('invoice', item.legacyId));
      const actual = await groupSumByProject(ids, 'totalAmount', (chunk) =>
        prisma.invoice.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { totalAmount: true },
        }),
      );
      verifyProjectSums('invoices.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'purchase_orders') && purchaseOrders.length) {
      const expected = new Map<string, number>();
      for (const item of purchaseOrders) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = purchaseOrders.map((item) => makeId('purchase_order', item.legacyId));
      const actual = await groupSumByProject(ids, 'totalAmount', (chunk) =>
        prisma.purchaseOrder.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { totalAmount: true },
        }),
      );
      verifyProjectSums('purchase_orders.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'vendor_quotes') && vendorQuotes.length) {
      const expected = new Map<string, number>();
      for (const item of vendorQuotes) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = vendorQuotes.map((item) => makeId('vendor_quote', item.legacyId));
      const actual = await groupSumByProject(ids, 'totalAmount', (chunk) =>
        prisma.vendorQuote.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { totalAmount: true },
        }),
      );
      verifyProjectSums('vendor_quotes.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'vendor_invoices') && vendorInvoices.length) {
      const expected = new Map<string, number>();
      for (const item of vendorInvoices) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.totalAmount));
      }
      const ids = vendorInvoices.map((item) => makeId('vendor_invoice', item.legacyId));
      const actual = await groupSumByProject(ids, 'totalAmount', (chunk) =>
        prisma.vendorInvoice.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { totalAmount: true },
        }),
      );
      verifyProjectSums('vendor_invoices.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'expenses') && expenses.length) {
      const expected = new Map<string, number>();
      for (const item of expenses) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.amount));
      }
      const ids = expenses.map((item) => makeId('expense', item.legacyId));
      const actual = await groupSumByProject(ids, 'amount', (chunk) =>
        prisma.expense.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { amount: true },
        }),
      );
      verifyProjectSums('expenses.projectSum', expected, actual, 0.01);
    }

    if (shouldRun(options, 'time_entries') && timeEntries.length) {
      const expected = new Map<string, number>();
      for (const item of timeEntries) {
        const projectId = makeId('project', item.projectLegacyId);
        rememberProject(projectId, item.projectLegacyId);
        addSum(expected, projectId, toNumber(item.minutes));
      }
      const ids = timeEntries.map((item) => makeId('time_entry', item.legacyId));
      const actual = await groupSumByProject(ids, 'minutes', (chunk) =>
        prisma.timeEntry.groupBy({
          by: ['projectId'],
          where: { id: { in: chunk } },
          _sum: { minutes: true },
        }),
      );
      verifyProjectSums('time_entries.projectSum', expected, actual, 0);
    }

    if (shouldRun(options, 'estimates')) {
      const docs = await prisma.estimate.findMany({
        where: { id: { in: estimates.map((item) => makeId('estimate', item.legacyId)) } },
        select: { id: true, estimateNo: true, totalAmount: true, lines: { select: { quantity: true, unitPrice: true } } },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) => acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'estimates',
            message: `line total mismatch (${doc.estimateNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (shouldRun(options, 'invoices')) {
      const docs = await prisma.invoice.findMany({
        where: { id: { in: invoices.map((item) => makeId('invoice', item.legacyId)) } },
        select: { id: true, invoiceNo: true, totalAmount: true, lines: { select: { quantity: true, unitPrice: true } } },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) => acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'invoices',
            message: `line total mismatch (${doc.invoiceNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (shouldRun(options, 'purchase_orders')) {
      const docs = await prisma.purchaseOrder.findMany({
        where: { id: { in: purchaseOrders.map((item) => makeId('purchase_order', item.legacyId)) } },
        select: { id: true, poNo: true, totalAmount: true, lines: { select: { quantity: true, unitPrice: true } } },
      });
      for (const doc of docs) {
        const total = toNumber(doc.totalAmount);
        const sum = (doc.lines || []).reduce(
          (acc: number, line: any) => acc + toNumber(line.quantity) * toNumber(line.unitPrice),
          0,
        );
        if (!isClose(sum, total, 0.01)) {
          verifyErrors.push({
            scope: 'purchase_orders',
            message: `line total mismatch (${doc.poNo}): totalAmount=${total} lines=${sum}`,
          });
        }
      }
    }

    if (verifyErrors.length) {
      console.error('[migration-po] verify errors:', JSON.stringify(verifyErrors, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log('[migration-po] integrity ok');
  }

  console.log('[migration-po] done');
}

main()
  .catch((err) => {
    console.error('[migration-po] fatal:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
