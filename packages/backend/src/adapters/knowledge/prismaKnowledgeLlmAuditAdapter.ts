import { Prisma } from '@prisma/client';

import type {
  KnowledgeLlmAuditEntry,
  KnowledgeLlmAuditWriter,
} from '../../application/knowledge/knowledgeLlmBudgetPorts.js';
import { isCanonicalExternalLlmModel } from '../../application/externalLlm/externalLlmPort.js';
import { normalizeAuthIdentifier } from '../../services/authIdentifiers.js';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const actionSet = new Set([
  'knowledge_llm_previewed',
  'knowledge_llm_budget_reserved',
  'knowledge_llm_budget_blocked',
  'knowledge_llm_rate_blocked',
  'knowledge_llm_duplicate_detected',
  'knowledge_llm_dispatched',
  'knowledge_llm_completed',
  'knowledge_llm_failed',
  'knowledge_llm_result_unknown',
  'knowledge_llm_usage_unknown',
  'knowledge_llm_reconciled',
]);
const scopeSet = new Set(['personal', 'organization']);
const reservationResultCodeSet = new Set([
  'previewed',
  'reserved',
  'reused',
  'conflict',
  'hard_blocked',
  'rate_blocked',
  'configuration_blocked',
  'reservation_conflict',
]);
const terminalResultCodeSet = new Set([
  'dispatched',
  'completed',
  'failed',
  'result_unknown',
  'usage_unknown',
  'reconciled',
]);
const terminalFailureCodeSet = new Set([
  'disabled',
  'rejected_before_dispatch',
  'provider_4xx',
  'provider_5xx',
  'malformed_response',
  'response_oversize',
  'empty_result',
  'timeout_outcome_unknown',
  'connection_outcome_unknown',
  'usage_missing',
  'usage_invalid',
  'finalization_failed',
]);
const actionResultCodes: Record<string, ReadonlySet<string>> = {
  knowledge_llm_previewed: new Set(['previewed']),
  knowledge_llm_budget_reserved: new Set(['reserved']),
  knowledge_llm_budget_blocked: new Set([
    'hard_blocked',
    'configuration_blocked',
    'reservation_conflict',
  ]),
  knowledge_llm_rate_blocked: new Set(['rate_blocked']),
  knowledge_llm_duplicate_detected: new Set(['reused', 'conflict']),
  knowledge_llm_dispatched: new Set(['dispatched']),
  knowledge_llm_completed: new Set(['completed']),
  knowledge_llm_failed: new Set(['failed']),
  knowledge_llm_result_unknown: new Set(['result_unknown']),
  knowledge_llm_usage_unknown: new Set(['usage_unknown']),
  knowledge_llm_reconciled: new Set(['reconciled']),
};

function identifier(value: string | undefined, maximum = 255): string {
  if (value === undefined) throw new Error('knowledge_llm_audit_invalid');
  try {
    return normalizeAuthIdentifier(value, maximum);
  } catch {
    throw new Error('knowledge_llm_audit_invalid');
  }
}

function auditMetadata(entry: KnowledgeLlmAuditEntry): Prisma.InputJsonObject {
  const actor = entry.actor;
  const requestId = identifier(actor.requestId, 128);
  if (actor.source !== 'api' && actor.source !== 'agent') {
    throw new Error('knowledge_llm_audit_invalid');
  }
  const metadata = entry.metadata;
  const reservationResult = reservationResultCodeSet.has(metadata.resultCode);
  const terminalResult = terminalResultCodeSet.has(metadata.resultCode);
  const softLimitWarning =
    'softLimitWarning' in metadata ? metadata.softLimitWarning : undefined;
  const actualInputTokens =
    'actualInputTokens' in metadata ? metadata.actualInputTokens : undefined;
  const actualOutputTokens =
    'actualOutputTokens' in metadata ? metadata.actualOutputTokens : undefined;
  const actualCostMicros =
    'actualCostMicros' in metadata ? metadata.actualCostMicros : undefined;
  const failureCode =
    'failureCode' in metadata ? metadata.failureCode : undefined;
  const operatorIntervention =
    'operatorIntervention' in metadata
      ? metadata.operatorIntervention
      : undefined;
  const sourceCounts =
    'sourceCounts' in metadata ? metadata.sourceCounts : undefined;
  if (
    (metadata.provider !== 'stub' && metadata.provider !== 'openai') ||
    !isCanonicalExternalLlmModel(metadata.model) ||
    !scopeSet.has(metadata.scope) ||
    !Number.isSafeInteger(metadata.catalogVersion) ||
    metadata.catalogVersion < 1 ||
    !Number.isSafeInteger(metadata.estimatedInputTokens) ||
    metadata.estimatedInputTokens < 0 ||
    !Number.isSafeInteger(metadata.maxOutputTokens) ||
    metadata.maxOutputTokens < 0 ||
    !/^(0|[1-9][0-9]{0,18})$/.test(metadata.reservedCostMicros) ||
    !/^[A-Z]{3}$/.test(metadata.currency) ||
    !Number.isSafeInteger(metadata.policyCount) ||
    metadata.policyCount <
      (metadata.resultCode === 'configuration_blocked' ||
      metadata.resultCode === 'previewed'
        ? 0
        : 1) ||
    metadata.policyCount > 2 ||
    (!reservationResult && !terminalResult) ||
    !actionResultCodes[entry.action]?.has(metadata.resultCode)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    operatorIntervention !== undefined &&
    (operatorIntervention !== 'billing_evidence' ||
      entry.action !== 'knowledge_llm_reconciled' ||
      metadata.resultCode !== 'reconciled' ||
      failureCode !== undefined)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    reservationResult &&
    (typeof softLimitWarning !== 'boolean' ||
      actualInputTokens !== undefined ||
      actualOutputTokens !== undefined ||
      actualCostMicros !== undefined ||
      failureCode !== undefined)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    metadata.resultCode === 'previewed' &&
    (entry.action !== 'knowledge_llm_previewed' ||
      metadata.policyCount !== 0 ||
      sourceCounts === undefined ||
      Object.values(sourceCounts).some(
        (count) => !Number.isSafeInteger(count) || count < 0,
      ) ||
      Object.values(sourceCounts).reduce((total, count) => total + count, 0) >
        32)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  const reconciledFailure =
    metadata.resultCode === 'reconciled' && failureCode !== undefined;
  const completed =
    metadata.resultCode === 'completed' ||
    (metadata.resultCode === 'reconciled' && !reconciledFailure);
  const dispatched = metadata.resultCode === 'dispatched';
  if (
    completed &&
    (!Number.isSafeInteger(actualInputTokens) ||
      (actualInputTokens ?? -1) < 0 ||
      !Number.isSafeInteger(actualOutputTokens) ||
      (actualOutputTokens ?? -1) < 0 ||
      typeof actualCostMicros !== 'string' ||
      !/^(0|[1-9][0-9]{0,18})$/.test(actualCostMicros) ||
      failureCode !== undefined)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    terminalResult &&
    !completed &&
    !dispatched &&
    (typeof failureCode !== 'string' ||
      !terminalFailureCodeSet.has(failureCode) ||
      actualInputTokens !== undefined ||
      actualOutputTokens !== undefined ||
      actualCostMicros !== undefined)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    dispatched &&
    (failureCode !== undefined ||
      actualInputTokens !== undefined ||
      actualOutputTokens !== undefined ||
      actualCostMicros !== undefined)
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  if (
    metadata.resultCode === 'usage_unknown' &&
    failureCode !== 'usage_missing' &&
    failureCode !== 'usage_invalid'
  ) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  return {
    provider: metadata.provider,
    model: metadata.model,
    scope: metadata.scope,
    catalogVersion: metadata.catalogVersion,
    estimatedInputTokens: metadata.estimatedInputTokens,
    maxOutputTokens: metadata.maxOutputTokens,
    reservedCostMicros: metadata.reservedCostMicros,
    currency: metadata.currency,
    resultCode: metadata.resultCode,
    policyCount: metadata.policyCount,
    ...(reservationResult ? { softLimitWarning } : {}),
    ...(metadata.resultCode === 'previewed' ? { sourceCounts } : {}),
    ...(completed
      ? { actualInputTokens, actualOutputTokens, actualCostMicros }
      : terminalResult && !dispatched
        ? { failureCode }
        : {}),
    ...(operatorIntervention ? { operatorIntervention } : {}),
    // The canonical actor remains the top-level AuditLog.userId. Do not copy
    // caller-supplied principal, delegated actor, or scope identifiers into
    // LLM metadata; the request/auth boundary owns those values and future
    // route integration must not be able to forge mandatory audit identity.
    _request: { id: requestId, source: actor.source },
  } as Prisma.InputJsonObject;
}

export class PrismaKnowledgeLlmAuditWriter implements KnowledgeLlmAuditWriter {
  constructor(private readonly client: AuditClient) {}

  async write(entry: KnowledgeLlmAuditEntry): Promise<void> {
    if (
      !actionSet.has(entry.action) ||
      entry.targetTable !== 'knowledge_llm_runs'
    ) {
      throw new Error('knowledge_llm_audit_invalid');
    }
    const operatorIntervention =
      'operatorIntervention' in entry.metadata &&
      entry.metadata.operatorIntervention === 'billing_evidence';
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: identifier(entry.actor.userId, 200),
        actorRole: operatorIntervention
          ? 'knowledge_billing_operator'
          : 'knowledge_user',
        requestId: identifier(entry.actor.requestId, 128),
        source: entry.actor.source,
        reasonCode: operatorIntervention
          ? 'knowledge_llm_operator_reconciled'
          : entry.action,
        targetTable: entry.targetTable,
        targetId: identifier(entry.targetId, 255),
        metadata: auditMetadata(entry),
      },
    });
  }
}
