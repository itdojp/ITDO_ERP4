import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error: dist JS module has no type declarations for ts-node
import { prisma } from '../packages/backend/dist/services/db.js';

type CliOptions = {
  inputDir: string;
  apply: boolean;
  only: Set<string> | null;
};

type ImportError = {
  scope: string;
  legacyId?: string;
  message: string;
};

const DNS_NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
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
  customers: Set<string>;
  vendors: Set<string>;
  projects: Set<string>;
  tasks: Set<string>;
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
    'Usage: scripts/migrate-po.ts [--input-dir=DIR] [--only=customers,vendors,...] [--apply]',
    '',
    'Options:',
    '  --input-dir=DIR   Input directory (default: tmp/migration/po)',
    '  --only=LIST       Comma-separated scopes: customers,vendors,projects,tasks,milestones,time_entries,expenses',
    '  --apply           Apply changes to DB (requires MIGRATION_CONFIRM=1)',
    '',
    'Examples:',
    '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts',
    '  MIGRATION_CONFIRM=1 npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --apply',
  ];
  console.log(lines.join('\n'));
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

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function uuidv5(name: string, namespaceUuid: string): string {
  const namespace = uuidToBytes(namespaceUuid);
  const input = Buffer.concat([namespace, Buffer.from(name, 'utf8')]);
  const hash = crypto.createHash('sha1').update(input).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function makeId(kind: string, legacyId: string) {
  return uuidv5(`erp4:po:${kind}:${legacyId}`, DNS_NAMESPACE_UUID);
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return null;
  return JSON.parse(raw) as T;
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
  customer: new Map<string, boolean>(),
  vendor: new Map<string, boolean>(),
  project: new Map<string, boolean>(),
  task: new Map<string, boolean>(),
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

type CustomerInput = {
  legacyId: string;
  code: string;
  name: string;
  status: string;
  invoiceRegistrationId?: string | null;
  taxRegion?: string | null;
  billingAddress?: string | null;
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

    const taskId = item.taskLegacyId ? makeId('task', item.taskLegacyId) : null;
    if (taskId) {
      const taskOk = await existsOrPlanned(
        taskId,
        planned.tasks,
        existsCache.task,
        async () => !!(await prisma.projectTask.findUnique({ where: { id: taskId }, select: { id: true } })),
      );
      if (!taskOk) {
        errors.push({
          scope: 'time_entries',
          legacyId: item.legacyId,
          message: `task not found: ${item.taskLegacyId}`,
        });
        continue;
      }
    }
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
  const apply = parseFlag('apply');
  const only = parseOnly(parseArgValue('only'));
  const options: CliOptions = { inputDir, apply, only };
  requireConfirm(apply);

  const errors: ImportError[] = [];

  const customers = (readJsonIfExists<CustomerInput[]>(
    path.join(inputDir, 'customers.json'),
  ) ?? []) as CustomerInput[];
  const vendors = (readJsonIfExists<VendorInput[]>(
    path.join(inputDir, 'vendors.json'),
  ) ?? []) as VendorInput[];
  const projects = (readJsonIfExists<ProjectInput[]>(
    path.join(inputDir, 'projects.json'),
  ) ?? []) as ProjectInput[];
  const tasks = (readJsonIfExists<TaskInput[]>(
    path.join(inputDir, 'tasks.json'),
  ) ?? []) as TaskInput[];
  const milestones = (readJsonIfExists<MilestoneInput[]>(
    path.join(inputDir, 'milestones.json'),
  ) ?? []) as MilestoneInput[];
  const timeEntries = (readJsonIfExists<TimeEntryInput[]>(
    path.join(inputDir, 'time_entries.json'),
  ) ?? []) as TimeEntryInput[];
  const expenses = (readJsonIfExists<ExpenseInput[]>(
    path.join(inputDir, 'expenses.json'),
  ) ?? []) as ExpenseInput[];

  const planned: PlannedIds = {
    customers: new Set<string>(),
    vendors: new Set<string>(),
    projects: new Set<string>(),
    tasks: new Set<string>(),
  };
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

  console.log('[migration-po] input dir:', inputDir);
  console.log('[migration-po] mode:', apply ? 'apply' : 'dry-run');
  if (only) console.log('[migration-po] only:', Array.from(only).join(','));

  const summary: Record<string, { created: number; updated: number; total: number }> = {};

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

    async function verifyIds(scope: string, ids: string[], countFn: (ids: string[]) => Promise<number>) {
      if (!ids.length) return;
      const count = await countFn(ids);
      if (count !== ids.length) {
        verifyErrors.push({
          scope,
          message: `integrity check mismatch: expected ${ids.length}, got ${count}`,
        });
      }
    }

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
