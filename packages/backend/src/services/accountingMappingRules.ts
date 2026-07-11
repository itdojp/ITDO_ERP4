import { Prisma, type AccountingJournalStagingStatus } from '@prisma/client';
import type { AuditContext } from './audit.js';
import { logAudit as defaultLogAudit } from './audit.js';
import { prisma } from './db.js';

export type AccountingClient = Prisma.TransactionClient | typeof prisma;

export const DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT = 100;
export const MAX_ACCOUNTING_MAPPING_RULE_LIMIT = 500;
export const MAX_ACCOUNTING_MAPPING_RULE_OFFSET = 100000;
export const DEFAULT_ACCOUNTING_MAPPING_REAPPLY_LIMIT = 500;
export const MAX_ACCOUNTING_MAPPING_REAPPLY_LIMIT = 2000;

export type AccountingMappingRuleInput = {
  mappingKey: string;
  debitAccountCode: string;
  debitAccountName?: string | null;
  debitSubaccountCode?: string | null;
  requireDebitSubaccountCode?: boolean;
  creditAccountCode: string;
  creditAccountName?: string | null;
  creditSubaccountCode?: string | null;
  requireCreditSubaccountCode?: boolean;
  departmentCode?: string | null;
  requireDepartmentCode?: boolean;
  taxCode: string;
  isActive?: boolean;
};

export type AccountingMappingRuleServiceErrorCode =
  | 'invalid_accounting_mapping_rule_payload'
  | 'accounting_mapping_rule_exists'
  | 'accounting_mapping_rule_not_found'
  | 'invalid_period_key';

export class AccountingMappingRuleServiceError extends Error {
  readonly code: AccountingMappingRuleServiceErrorCode;
  readonly statusCode: number;
  readonly responseBody: Record<string, unknown>;

  constructor(
    code: AccountingMappingRuleServiceErrorCode,
    statusCode: number,
    responseBody: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AccountingMappingRuleServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

type AccountingMappingRuleRecord = {
  id: string;
  mappingKey: string;
  debitAccountCode: string;
  debitAccountName: string | null;
  debitSubaccountCode: string | null;
  requireDebitSubaccountCode: boolean;
  creditAccountCode: string;
  creditAccountName: string | null;
  creditSubaccountCode: string | null;
  requireCreditSubaccountCode: boolean;
  departmentCode: string | null;
  requireDepartmentCode: boolean;
  taxCode: string;
  isActive: boolean;
};

type AccountingMappingRuleResponseRecord = AccountingMappingRuleRecord & {
  createdAt: Date;
  updatedAt: Date;
};

type AccountingMappingRuleDependencies = {
  client?: AccountingClient;
  logAudit?: typeof defaultLogAudit;
};

function resolveAccountingMappingRuleDependencies(
  dependencies: AccountingMappingRuleDependencies,
) {
  return {
    client: dependencies.client ?? prisma,
    logAudit: dependencies.logAudit ?? defaultLogAudit,
  };
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseBoundedInteger(
  input: unknown,
  defaultValue: number,
  maxValue: number,
) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(maxValue, Math.max(1, Math.floor(input)));
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
    }
  }
  return defaultValue;
}

function parseBoundedNonNegativeInteger(
  input: unknown,
  defaultValue: number,
  maxValue: number,
) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(maxValue, Math.max(0, Math.floor(input)));
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.min(maxValue, Math.max(0, Math.floor(parsed)));
    }
  }
  return defaultValue;
}

function normalizeBooleanFilter(value: unknown) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

function invalidAccountingMappingRulePayload(invalidFields: string[]) {
  return new AccountingMappingRuleServiceError(
    'invalid_accounting_mapping_rule_payload',
    400,
    {
      error: 'invalid_accounting_mapping_rule_payload',
      invalidFields,
    },
  );
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function defaultMappingKey(mappingKey: string) {
  const normalized = normalizeText(mappingKey);
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) return normalized;
  return `${normalized.slice(0, separatorIndex)}:default`;
}

export function normalizeAccountingMappingRuleInput(
  input: Partial<AccountingMappingRuleInput>,
  options: { partial: boolean },
) {
  const data: Partial<AccountingMappingRuleInput> = {};
  const invalidFields: string[] = [];

  const requiredFields = [
    'mappingKey',
    'debitAccountCode',
    'creditAccountCode',
    'taxCode',
  ] as const;

  for (const field of requiredFields) {
    if (input[field] === undefined) {
      if (!options.partial) invalidFields.push(field);
      continue;
    }
    const normalized = normalizeText(input[field]);
    if (!normalized) {
      invalidFields.push(field);
      continue;
    }
    data[field] = normalized;
  }

  if (input.debitSubaccountCode !== undefined) {
    data.debitSubaccountCode = normalizeNullableText(input.debitSubaccountCode);
  }
  if (input.debitAccountName !== undefined) {
    data.debitAccountName = normalizeNullableText(input.debitAccountName);
  }
  if (typeof input.requireDebitSubaccountCode === 'boolean') {
    data.requireDebitSubaccountCode = input.requireDebitSubaccountCode;
  }
  if (input.creditAccountName !== undefined) {
    data.creditAccountName = normalizeNullableText(input.creditAccountName);
  }
  if (input.creditSubaccountCode !== undefined) {
    data.creditSubaccountCode = normalizeNullableText(
      input.creditSubaccountCode,
    );
  }
  if (typeof input.requireCreditSubaccountCode === 'boolean') {
    data.requireCreditSubaccountCode = input.requireCreditSubaccountCode;
  }
  if (input.departmentCode !== undefined) {
    data.departmentCode = normalizeNullableText(input.departmentCode);
  }
  if (typeof input.requireDepartmentCode === 'boolean') {
    data.requireDepartmentCode = input.requireDepartmentCode;
  }
  if (typeof input.isActive === 'boolean') {
    data.isActive = input.isActive;
  }

  return { data, invalidFields };
}

export function buildAccountingMappingRuleResponse(
  item: AccountingMappingRuleResponseRecord,
) {
  return {
    id: item.id,
    mappingKey: item.mappingKey,
    debitAccountCode: item.debitAccountCode,
    debitAccountName: item.debitAccountName,
    debitSubaccountCode: item.debitSubaccountCode,
    requireDebitSubaccountCode: item.requireDebitSubaccountCode,
    creditAccountCode: item.creditAccountCode,
    creditAccountName: item.creditAccountName,
    creditSubaccountCode: item.creditSubaccountCode,
    requireCreditSubaccountCode: item.requireCreditSubaccountCode,
    departmentCode: item.departmentCode,
    requireDepartmentCode: item.requireDepartmentCode,
    taxCode: item.taxCode,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeBlockingCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const code =
        'code' in entry && typeof entry.code === 'string'
          ? entry.code.trim()
          : '';
      return code && code !== 'mapping_pending' ? [code] : [];
    })
    .filter((code, index, values) => values.indexOf(code) === index);
}

export async function resolveAccountingMappingRule(
  client: AccountingClient,
  mappingKey: string,
) {
  const normalizedKey = normalizeText(mappingKey);
  if (!normalizedKey) return null;
  const fallbackKey = defaultMappingKey(normalizedKey);
  const keys =
    fallbackKey && fallbackKey !== normalizedKey
      ? [normalizedKey, fallbackKey]
      : [normalizedKey];
  const rules = await client.accountingMappingRule.findMany({
    where: {
      mappingKey: { in: keys },
      isActive: true,
    },
    select: {
      id: true,
      mappingKey: true,
      debitAccountCode: true,
      debitAccountName: true,
      debitSubaccountCode: true,
      requireDebitSubaccountCode: true,
      creditAccountCode: true,
      creditAccountName: true,
      creditSubaccountCode: true,
      requireCreditSubaccountCode: true,
      departmentCode: true,
      requireDepartmentCode: true,
      taxCode: true,
      isActive: true,
    },
  });
  return (rules.find((rule) => rule.mappingKey === normalizedKey) ??
    rules.find((rule) => rule.mappingKey === fallbackKey) ??
    null) as AccountingMappingRuleRecord | null;
}

export async function listAccountingMappingRules(
  options: {
    query?: {
      mappingKey?: unknown;
      isActive?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
  },
  dependencies: AccountingMappingRuleDependencies = {},
) {
  const { client } = resolveAccountingMappingRuleDependencies(dependencies);
  const query = options.query ?? {};
  const limit = parseBoundedInteger(
    query.limit,
    DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
    MAX_ACCOUNTING_MAPPING_RULE_LIMIT,
  );
  const offset = parseBoundedNonNegativeInteger(
    query.offset,
    0,
    MAX_ACCOUNTING_MAPPING_RULE_OFFSET,
  );
  const mappingKey = normalizeText(query.mappingKey);
  const isActive = normalizeBooleanFilter(query.isActive);
  const items = await client.accountingMappingRule.findMany({
    where: {
      ...(mappingKey ? { mappingKey: { contains: mappingKey } } : {}),
      ...(isActive === undefined ? {} : { isActive }),
    },
    orderBy: [{ mappingKey: 'asc' }, { id: 'asc' }],
    take: limit,
    skip: offset,
  });
  return {
    items: items.map(buildAccountingMappingRuleResponse),
    limit,
    offset,
  };
}

export async function createAccountingMappingRule(
  options: {
    body: Partial<AccountingMappingRuleInput>;
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: AccountingMappingRuleDependencies = {},
) {
  const { client, logAudit } =
    resolveAccountingMappingRuleDependencies(dependencies);
  const normalized = normalizeAccountingMappingRuleInput(options.body, {
    partial: false,
  });
  if (normalized.invalidFields.length > 0) {
    throw invalidAccountingMappingRulePayload(normalized.invalidFields);
  }

  let created;
  try {
    created = await client.accountingMappingRule.create({
      data: {
        mappingKey: normalized.data.mappingKey!,
        debitAccountCode: normalized.data.debitAccountCode!,
        debitAccountName: normalized.data.debitAccountName ?? null,
        debitSubaccountCode: normalized.data.debitSubaccountCode ?? null,
        requireDebitSubaccountCode:
          normalized.data.requireDebitSubaccountCode ?? false,
        creditAccountCode: normalized.data.creditAccountCode!,
        creditAccountName: normalized.data.creditAccountName ?? null,
        creditSubaccountCode: normalized.data.creditSubaccountCode ?? null,
        requireCreditSubaccountCode:
          normalized.data.requireCreditSubaccountCode ?? false,
        departmentCode: normalized.data.departmentCode ?? null,
        requireDepartmentCode: normalized.data.requireDepartmentCode ?? false,
        taxCode: normalized.data.taxCode!,
        isActive: normalized.data.isActive ?? true,
        createdBy: options.actorUserId ?? null,
        updatedBy: options.actorUserId ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountingMappingRuleServiceError(
        'accounting_mapping_rule_exists',
        409,
        { error: 'accounting_mapping_rule_exists' },
      );
    }
    throw error;
  }

  await logAudit({
    ...(options.auditContext ?? {}),
    action: 'integration_accounting_mapping_rule_created',
    targetTable: 'AccountingMappingRule',
    targetId: created.id,
    metadata: {
      mappingKey: created.mappingKey,
      isActive: created.isActive,
    } as Prisma.InputJsonValue,
  });
  return buildAccountingMappingRuleResponse(created);
}

export async function updateAccountingMappingRule(
  options: {
    id: string;
    body: Partial<AccountingMappingRuleInput>;
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: AccountingMappingRuleDependencies = {},
) {
  const { client, logAudit } =
    resolveAccountingMappingRuleDependencies(dependencies);
  const id = normalizeText(options.id);
  const current = await client.accountingMappingRule.findUnique({
    where: { id },
  });
  if (!current) {
    throw new AccountingMappingRuleServiceError(
      'accounting_mapping_rule_not_found',
      404,
      { error: 'accounting_mapping_rule_not_found' },
    );
  }

  const normalized = normalizeAccountingMappingRuleInput(options.body, {
    partial: true,
  });
  if (normalized.invalidFields.length > 0) {
    throw invalidAccountingMappingRulePayload(normalized.invalidFields);
  }

  let updated;
  try {
    updated = await client.accountingMappingRule.update({
      where: { id },
      data: {
        ...normalized.data,
        updatedBy: options.actorUserId ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountingMappingRuleServiceError(
        'accounting_mapping_rule_exists',
        409,
        { error: 'accounting_mapping_rule_exists' },
      );
    }
    throw error;
  }

  await logAudit({
    ...(options.auditContext ?? {}),
    action: 'integration_accounting_mapping_rule_updated',
    targetTable: 'AccountingMappingRule',
    targetId: updated.id,
    metadata: {
      before: {
        mappingKey: current.mappingKey,
        isActive: current.isActive,
      },
      after: {
        mappingKey: updated.mappingKey,
        isActive: updated.isActive,
      },
    } as Prisma.InputJsonValue,
  });
  return buildAccountingMappingRuleResponse(updated);
}

export function buildAccountingStagingMappingResult(options: {
  mappingKey: string;
  blockingCodes?: string[];
  departmentCode?: string | null;
  rule?: AccountingMappingRuleRecord | null;
  preferRuleDepartmentCode?: boolean;
}): {
  status: AccountingJournalStagingStatus;
  debitAccountCode: string | null;
  debitAccountName: string | null;
  debitSubaccountCode: string | null;
  creditAccountCode: string | null;
  creditAccountName: string | null;
  creditSubaccountCode: string | null;
  departmentCode: string | null;
  taxCode: string | null;
  validationErrors: Prisma.InputJsonValue[];
} {
  const blockingCodes = (options.blockingCodes ?? [])
    .map((code) => normalizeText(code))
    .filter((code, index, values) => code && values.indexOf(code) === index);
  const debitAccountCode = normalizeText(options.rule?.debitAccountCode);
  const debitAccountName = normalizeText(options.rule?.debitAccountName);
  const debitSubaccountCode = normalizeText(options.rule?.debitSubaccountCode);
  const requireDebitSubaccountCode = Boolean(
    options.rule?.requireDebitSubaccountCode,
  );
  const creditAccountCode = normalizeText(options.rule?.creditAccountCode);
  const creditAccountName = normalizeText(options.rule?.creditAccountName);
  const creditSubaccountCode = normalizeText(
    options.rule?.creditSubaccountCode,
  );
  const requireCreditSubaccountCode = Boolean(
    options.rule?.requireCreditSubaccountCode,
  );
  const sourceDepartmentCode = normalizeText(options.departmentCode);
  const ruleDepartmentCode = normalizeText(options.rule?.departmentCode);
  const requireDepartmentCode = Boolean(options.rule?.requireDepartmentCode);
  const departmentCode = options.preferRuleDepartmentCode
    ? ruleDepartmentCode || sourceDepartmentCode
    : sourceDepartmentCode || ruleDepartmentCode;
  const taxCode = normalizeText(options.rule?.taxCode);
  const requiredFields: string[] = [];
  if (!debitAccountCode) requiredFields.push('debitAccountCode');
  if (!creditAccountCode) requiredFields.push('creditAccountCode');
  if (requireDebitSubaccountCode && !debitSubaccountCode) {
    requiredFields.push('debitSubaccountCode');
  }
  if (requireCreditSubaccountCode && !creditSubaccountCode) {
    requiredFields.push('creditSubaccountCode');
  }
  if (requireDepartmentCode && !departmentCode) {
    requiredFields.push('departmentCode');
  }
  if (!taxCode) requiredFields.push('taxCode');

  const validationErrors: Prisma.InputJsonValue[] = blockingCodes.map(
    (code) => ({
      code,
    }),
  );
  if (requiredFields.length > 0) {
    validationErrors.push({
      code: 'mapping_pending',
      mappingKey: normalizeText(options.mappingKey),
      requiredFields,
    });
  }

  const status: AccountingJournalStagingStatus =
    blockingCodes.length > 0
      ? 'blocked'
      : requiredFields.length > 0
        ? 'pending_mapping'
        : 'ready';

  return {
    status,
    debitAccountCode: debitAccountCode || null,
    debitAccountName: debitAccountName || null,
    debitSubaccountCode: debitSubaccountCode || null,
    creditAccountCode: creditAccountCode || null,
    creditAccountName: creditAccountName || null,
    creditSubaccountCode: creditSubaccountCode || null,
    departmentCode: departmentCode || null,
    taxCode: taxCode || null,
    validationErrors,
  };
}

export async function reapplyAccountingMappingRules(options: {
  client?: AccountingClient;
  periodKey?: string | null;
  mappingKey?: string | null;
  limit: number;
  offset: number;
  actorUserId?: string | null;
}) {
  const client = options.client ?? prisma;
  const periodKey = normalizeText(options.periodKey);
  const mappingKeyFilter = normalizeText(options.mappingKey);
  const rows = await client.accountingJournalStaging.findMany({
    where: {
      status: {
        in: ['pending_mapping', 'blocked', 'ready'],
      },
      ...(mappingKeyFilter ? { mappingKey: mappingKeyFilter } : {}),
      ...(periodKey ? { event: { periodKey } } : {}),
    },
    select: {
      id: true,
      mappingKey: true,
      departmentCode: true,
      validationErrors: true,
    },
    orderBy: [{ id: 'asc' }],
    take: options.limit,
    skip: options.offset,
  });

  const ruleKeys = [
    ...new Set(
      rows.flatMap((row) => {
        const key = normalizeText(row.mappingKey);
        if (!key) return [];
        const fallback = defaultMappingKey(key);
        return fallback && fallback !== key ? [key, fallback] : [key];
      }),
    ),
  ];
  const rules = ruleKeys.length
    ? await client.accountingMappingRule.findMany({
        where: {
          mappingKey: { in: ruleKeys },
          isActive: true,
        },
        select: {
          id: true,
          mappingKey: true,
          debitAccountCode: true,
          debitAccountName: true,
          debitSubaccountCode: true,
          requireDebitSubaccountCode: true,
          creditAccountCode: true,
          creditAccountName: true,
          creditSubaccountCode: true,
          requireCreditSubaccountCode: true,
          departmentCode: true,
          requireDepartmentCode: true,
          taxCode: true,
          isActive: true,
        },
      })
    : [];
  const ruleMap = new Map(rules.map((rule) => [rule.mappingKey, rule]));

  let updatedCount = 0;
  let readyCount = 0;
  let pendingMappingCount = 0;
  let blockedCount = 0;

  for (const row of rows) {
    const normalizedKey = normalizeText(row.mappingKey);
    const rule =
      ruleMap.get(normalizedKey) ??
      ruleMap.get(defaultMappingKey(normalizedKey)) ??
      null;
    const next = buildAccountingStagingMappingResult({
      mappingKey: normalizedKey,
      departmentCode: row.departmentCode,
      blockingCodes: normalizeBlockingCodes(row.validationErrors),
      rule,
      preferRuleDepartmentCode: true,
    });
    await client.accountingJournalStaging.update({
      where: { id: row.id },
      data: {
        status: next.status,
        debitAccountCode: next.debitAccountCode,
        debitAccountName: next.debitAccountName,
        debitSubaccountCode: next.debitSubaccountCode,
        creditAccountCode: next.creditAccountCode,
        creditAccountName: next.creditAccountName,
        creditSubaccountCode: next.creditSubaccountCode,
        departmentCode: next.departmentCode,
        taxCode: next.taxCode,
        validationErrors: next.validationErrors,
        updatedBy: options.actorUserId ?? null,
      },
    });
    updatedCount += 1;
    if (next.status === 'ready') readyCount += 1;
    if (next.status === 'pending_mapping') pendingMappingCount += 1;
    if (next.status === 'blocked') blockedCount += 1;
  }

  return {
    processedCount: rows.length,
    updatedCount,
    readyCount,
    pendingMappingCount,
    blockedCount,
  };
}

export async function reapplyAccountingMappingRulesWithAudit(
  options: {
    body?: {
      periodKey?: unknown;
      mappingKey?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: AccountingMappingRuleDependencies = {},
) {
  const { client, logAudit } =
    resolveAccountingMappingRuleDependencies(dependencies);
  const body = options.body ?? {};
  const periodKey = normalizeText(body.periodKey);
  if (periodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
    throw new AccountingMappingRuleServiceError('invalid_period_key', 400, {
      error: 'invalid_period_key',
    });
  }
  const mappingKey = normalizeText(body.mappingKey);
  const limit = parseBoundedInteger(
    body.limit,
    DEFAULT_ACCOUNTING_MAPPING_REAPPLY_LIMIT,
    MAX_ACCOUNTING_MAPPING_REAPPLY_LIMIT,
  );
  const offset = parseBoundedNonNegativeInteger(
    body.offset,
    0,
    MAX_ACCOUNTING_MAPPING_RULE_OFFSET,
  );

  const result = await reapplyAccountingMappingRules({
    client,
    periodKey: periodKey || null,
    mappingKey: mappingKey || null,
    limit,
    offset,
    actorUserId: options.actorUserId ?? null,
  });
  await logAudit({
    ...(options.auditContext ?? {}),
    action: 'integration_accounting_mapping_rule_reapplied',
    targetTable: 'AccountingJournalStaging',
    targetId: periodKey || 'all',
    metadata: {
      periodKey: periodKey || null,
      mappingKey: mappingKey || null,
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      readyCount: result.readyCount,
      pendingMappingCount: result.pendingMappingCount,
      blockedCount: result.blockedCount,
    } as Prisma.InputJsonValue,
  });
  return result;
}
