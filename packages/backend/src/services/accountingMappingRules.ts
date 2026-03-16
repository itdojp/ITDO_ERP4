import type { AccountingJournalStagingStatus, Prisma } from '@prisma/client';
import { prisma } from './db.js';

type AccountingClient = Prisma.TransactionClient | typeof prisma;

type AccountingMappingRuleRecord = {
  id: string;
  mappingKey: string;
  debitAccountCode: string;
  debitSubaccountCode: string | null;
  creditAccountCode: string;
  creditSubaccountCode: string | null;
  departmentCode: string | null;
  taxCode: string;
  isActive: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultMappingKey(mappingKey: string) {
  const normalized = normalizeText(mappingKey);
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) return normalized;
  return `${normalized.slice(0, separatorIndex)}:default`;
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
      debitSubaccountCode: true,
      creditAccountCode: true,
      creditSubaccountCode: true,
      departmentCode: true,
      taxCode: true,
      isActive: true,
    },
  });
  return (rules.find((rule) => rule.mappingKey === normalizedKey) ??
    rules.find((rule) => rule.mappingKey === fallbackKey) ??
    null) as AccountingMappingRuleRecord | null;
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
  debitSubaccountCode: string | null;
  creditAccountCode: string | null;
  creditSubaccountCode: string | null;
  departmentCode: string | null;
  taxCode: string | null;
  validationErrors: Prisma.InputJsonValue[];
} {
  const blockingCodes = (options.blockingCodes ?? [])
    .map((code) => normalizeText(code))
    .filter((code, index, values) => code && values.indexOf(code) === index);
  const debitAccountCode = normalizeText(options.rule?.debitAccountCode);
  const debitSubaccountCode = normalizeText(options.rule?.debitSubaccountCode);
  const creditAccountCode = normalizeText(options.rule?.creditAccountCode);
  const creditSubaccountCode = normalizeText(
    options.rule?.creditSubaccountCode,
  );
  const sourceDepartmentCode = normalizeText(options.departmentCode);
  const ruleDepartmentCode = normalizeText(options.rule?.departmentCode);
  const departmentCode = options.preferRuleDepartmentCode
    ? ruleDepartmentCode || sourceDepartmentCode
    : sourceDepartmentCode || ruleDepartmentCode;
  const taxCode = normalizeText(options.rule?.taxCode);
  const requiredFields: string[] = [];
  if (!debitAccountCode) requiredFields.push('debitAccountCode');
  if (!creditAccountCode) requiredFields.push('creditAccountCode');
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
    debitSubaccountCode: debitSubaccountCode || null,
    creditAccountCode: creditAccountCode || null,
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
        in: ['pending_mapping', 'blocked'],
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
          debitSubaccountCode: true,
          creditAccountCode: true,
          creditSubaccountCode: true,
          departmentCode: true,
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
        debitSubaccountCode: next.debitSubaccountCode,
        creditAccountCode: next.creditAccountCode,
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
