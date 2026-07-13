import { Prisma } from '@prisma/client';

import { prisma as defaultPrisma } from '../../services/db.js';
import { parseDueDateRule } from '../../services/dueDateRule.js';

export type RecurringFrequency =
  'monthly' | 'quarterly' | 'semiannual' | 'annual';

type BillUpon = 'date' | 'acceptance' | 'time';

export type RecurringTemplateBody = {
  frequency: RecurringFrequency;
  nextRunAt?: string;
  timezone?: string;
  defaultAmount?: number;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  defaultTerms?: string;
  defaultMilestoneName?: string;
  billUpon?: BillUpon;
  dueDateRule?: unknown;
  shouldGenerateEstimate?: boolean;
  shouldGenerateInvoice?: boolean;
  isActive?: boolean;
};

type RecurringTemplateApplicationFailure = {
  ok: false;
  statusCode: number;
  body: unknown;
};

type RecurringTemplateApplicationResult<T> =
  { ok: true; value: T } | RecurringTemplateApplicationFailure;

type RecurringTemplateApplicationLogger = {
  error?: (payload: unknown, message?: string) => void;
};

type RecurringTemplateApplicationPorts = {
  db: any;
  logger?: RecurringTemplateApplicationLogger;
};

export type RecurringTemplateApplicationPortOverrides =
  Partial<RecurringTemplateApplicationPorts>;

export type RecurringProjectTemplateJobContract = {
  id: string;
  projectId: string;
  frequency: RecurringFrequency;
  nextRunAt: Date | null;
  timezone: string | null;
  defaultAmount: unknown;
  defaultCurrency: string | null;
  defaultTaxRate: unknown;
  defaultTerms: string | null;
  defaultMilestoneName: string | null;
  billUpon: BillUpon | null;
  dueDateRule: unknown;
  shouldGenerateEstimate: boolean;
  shouldGenerateInvoice: boolean;
  isActive: boolean;
};

const recurringFrequencies = new Set<RecurringFrequency>([
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]);

const defaultPorts: RecurringTemplateApplicationPorts = {
  db: defaultPrisma,
};

function ports(
  overrides?: RecurringTemplateApplicationPortOverrides,
): RecurringTemplateApplicationPorts {
  return { ...defaultPorts, ...(overrides ?? {}) };
}

function ok<T>(value: T): RecurringTemplateApplicationResult<T> {
  return { ok: true, value };
}

function fail(
  statusCode: number,
  body: unknown,
): RecurringTemplateApplicationFailure {
  return { ok: false, statusCode, body };
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function normalizeRecurringFrequency(
  value: unknown,
): RecurringFrequency | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return recurringFrequencies.has(normalized as RecurringFrequency)
    ? (normalized as RecurringFrequency)
    : null;
}

function normalizeBillUpon(value: unknown): BillUpon | null {
  if (value === 'date' || value === 'acceptance' || value === 'time') {
    return value;
  }
  return null;
}

function parseOptionalDateTime(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('invalid_next_run_at');
  }
  return parsed;
}

export function normalizeRecurringGenerationLogTake(limit?: string): number {
  const takeRaw = limit ? Number(limit) : 50;
  return Number.isFinite(takeRaw) && takeRaw > 0
    ? Math.min(Math.floor(takeRaw), 200)
    : 50;
}

export function buildRecurringTemplateMutationData(
  body: RecurringTemplateBody,
) {
  const frequency = normalizeRecurringFrequency(body.frequency);
  if (!frequency) {
    throw new Error('invalid_frequency');
  }
  let dueDateRule: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
  if (hasOwn(body as Record<string, unknown>, 'dueDateRule')) {
    const parsed = parseDueDateRule(body.dueDateRule);
    dueDateRule =
      parsed === null ? Prisma.DbNull : (parsed as Prisma.InputJsonValue);
  }
  return {
    frequency,
    nextRunAt: parseOptionalDateTime(body.nextRunAt),
    timezone: body.timezone,
    defaultAmount: body.defaultAmount,
    defaultCurrency: body.defaultCurrency,
    defaultTaxRate: body.defaultTaxRate,
    defaultTerms: body.defaultTerms,
    defaultMilestoneName: body.defaultMilestoneName,
    billUpon: body.billUpon,
    dueDateRule,
    shouldGenerateEstimate: body.shouldGenerateEstimate,
    shouldGenerateInvoice: body.shouldGenerateInvoice,
    isActive: body.isActive,
  };
}

export function toRecurringProjectTemplateJobContract(
  template: Record<string, unknown>,
): RecurringProjectTemplateJobContract {
  return {
    id: String(template.id),
    projectId: String(template.projectId),
    frequency: normalizeRecurringFrequency(template.frequency) ?? 'monthly',
    nextRunAt: template.nextRunAt instanceof Date ? template.nextRunAt : null,
    timezone:
      typeof template.timezone === 'string' && template.timezone.trim()
        ? template.timezone
        : null,
    defaultAmount: template.defaultAmount ?? null,
    defaultCurrency:
      typeof template.defaultCurrency === 'string'
        ? template.defaultCurrency
        : null,
    defaultTaxRate: template.defaultTaxRate ?? null,
    defaultTerms:
      typeof template.defaultTerms === 'string' ? template.defaultTerms : null,
    defaultMilestoneName:
      typeof template.defaultMilestoneName === 'string'
        ? template.defaultMilestoneName
        : null,
    billUpon: normalizeBillUpon(template.billUpon),
    dueDateRule: template.dueDateRule ?? null,
    shouldGenerateEstimate: template.shouldGenerateEstimate === true,
    shouldGenerateInvoice: template.shouldGenerateInvoice !== false,
    isActive: template.isActive !== false,
  };
}

export async function getProjectRecurringTemplate(input: {
  projectId: string;
  ports?: RecurringTemplateApplicationPortOverrides;
}): Promise<RecurringTemplateApplicationResult<unknown | null>> {
  const p = ports(input.ports);
  const template = await p.db.recurringProjectTemplate.findUnique({
    where: { projectId: input.projectId },
  });
  return ok(template);
}

export async function upsertProjectRecurringTemplate(input: {
  projectId: string;
  body: RecurringTemplateBody;
  ports?: RecurringTemplateApplicationPortOverrides;
}): Promise<RecurringTemplateApplicationResult<unknown>> {
  const p = ports(input.ports);
  const project = await p.db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) return fail(404, { error: 'not_found' });

  let data: ReturnType<typeof buildRecurringTemplateMutationData>;
  try {
    data = buildRecurringTemplateMutationData(input.body);
  } catch (err) {
    if ((err as Error).message === 'invalid_next_run_at') {
      return fail(400, {
        error: {
          code: 'INVALID_NEXT_RUN_AT',
          message: 'nextRunAt is invalid',
        },
      });
    }
    if ((err as Error).message === 'invalid_frequency') {
      return fail(400, {
        error: {
          code: 'INVALID_FREQUENCY',
          message: 'frequency is invalid',
        },
      });
    }
    p.logger?.error?.({ err }, 'Failed to parse dueDateRule');
    return fail(400, {
      error: {
        code: 'INVALID_DUE_DATE_RULE',
        message: 'dueDateRule is invalid',
        details: err instanceof Error ? err.message : String(err),
      },
    });
  }

  const template = await p.db.recurringProjectTemplate.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      ...data,
    },
    update: data,
  });
  return ok(template);
}

export async function listProjectRecurringGenerationLogs(input: {
  projectId: string;
  query: {
    limit?: string;
    templateId?: string;
    periodKey?: string;
  };
  ports?: RecurringTemplateApplicationPortOverrides;
}): Promise<RecurringTemplateApplicationResult<{ items: unknown[] }>> {
  const p = ports(input.ports);
  const project = await p.db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, deletedAt: true },
  });
  if (!project || project.deletedAt) return fail(404, { error: 'not_found' });

  const where: Record<string, unknown> = { projectId: input.projectId };
  if (input.query.templateId) where.templateId = input.query.templateId;
  if (input.query.periodKey) where.periodKey = input.query.periodKey;
  const items = await p.db.recurringGenerationLog.findMany({
    where,
    orderBy: [{ runAt: 'desc' }, { createdAt: 'desc' }],
    take: normalizeRecurringGenerationLogTake(input.query.limit),
  });
  return ok({ items });
}
