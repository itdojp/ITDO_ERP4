import { Prisma } from '@prisma/client';

import type {
  KnowledgeLlmAuditEntry,
  KnowledgeLlmAuditWriter,
} from '../../application/knowledge/knowledgeLlmBudgetPorts.js';
import { normalizeAuthIdentifier } from '../../services/authIdentifiers.js';
import { normalizeAuthScopes } from '../../services/authScopes.js';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const actionSet = new Set([
  'knowledge_llm_budget_reserved',
  'knowledge_llm_budget_blocked',
  'knowledge_llm_rate_blocked',
  'knowledge_llm_duplicate_detected',
]);
const scopeSet = new Set(['personal', 'organization']);
const resultCodeSet = new Set([
  'reserved',
  'reused',
  'conflict',
  'hard_blocked',
  'rate_blocked',
]);

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
  const principalUserId = identifier(actor.principalUserId);
  const actorUserId = identifier(actor.actorUserId);
  const requestId = identifier(actor.requestId, 128);
  if (actor.source !== 'api' && actor.source !== 'agent') {
    throw new Error('knowledge_llm_audit_invalid');
  }
  let scopes: string[] | undefined;
  if (actor.authScopes !== undefined) {
    try {
      scopes = normalizeAuthScopes(actor.authScopes);
    } catch {
      throw new Error('knowledge_llm_audit_invalid');
    }
  }
  const metadata = entry.metadata;
  const modelHasControl = [...metadata.model].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (
    (metadata.provider !== 'stub' && metadata.provider !== 'openai') ||
    !metadata.model ||
    metadata.model.length > 200 ||
    modelHasControl ||
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
    metadata.policyCount < 1 ||
    metadata.policyCount > 2 ||
    !resultCodeSet.has(metadata.resultCode) ||
    typeof metadata.softLimitWarning !== 'boolean'
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
    softLimitWarning: metadata.softLimitWarning,
    _auth: {
      principalUserId,
      actorUserId,
      ...(scopes === undefined ? {} : { scopes }),
    },
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
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.actor.userId,
        actorRole: 'knowledge_user',
        requestId: identifier(entry.actor.requestId, 128),
        source: entry.actor.source,
        reasonCode: entry.action,
        targetTable: entry.targetTable,
        targetId: identifier(entry.targetId, 255),
        metadata: auditMetadata(entry),
      },
    });
  }
}
