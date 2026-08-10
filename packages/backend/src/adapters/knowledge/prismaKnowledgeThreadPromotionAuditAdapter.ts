import { Prisma } from '@prisma/client';

import type {
  KnowledgeThreadPromotionAuditEntry,
  KnowledgeThreadPromotionAuditWriter,
} from '../../application/knowledge/knowledgeThreadPromotionPorts.js';
import { normalizeAuthIdentifier } from '../../services/authIdentifiers.js';
import { normalizeAuthScopes } from '../../services/authScopes.js';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const identifierMaximum = 255;
const audienceMaximum = 100;

const targetByAction = {
  knowledge_thread_promote_previewed: 'knowledge_thread_promotions',
  knowledge_thread_promoted: 'knowledge_thread_promotions',
  knowledge_thread_promote_duplicate_detected: 'knowledge_thread_promotions',
  knowledge_thread_promote_rejected: 'knowledge_thread_promotions',
} as const;

function requiredText(value: string | undefined, maximum: number) {
  try {
    return normalizeAuthIdentifier(value, maximum);
  } catch {
    throw new Error('knowledge_thread_promotion_audit_contract_invalid');
  }
}

function optionalText(value: string | undefined, maximum: number) {
  return value === undefined ? undefined : requiredText(value, maximum);
}

function actorMetadata(
  actor: KnowledgeThreadPromotionAuditEntry['actor'],
): Prisma.InputJsonObject {
  const requestId = requiredText(actor.requestId, 128);
  if (
    !requestIdPattern.test(requestId) ||
    (actor.source !== 'api' && actor.source !== 'agent')
  ) {
    throw new Error('knowledge_thread_promotion_audit_contract_invalid');
  }
  const auth: Record<string, Prisma.InputJsonValue> = {
    principalUserId: requiredText(actor.principalUserId, identifierMaximum),
    actorUserId: requiredText(actor.actorUserId, identifierMaximum),
  };
  if (actor.authScopes !== undefined) {
    try {
      auth.scopes = normalizeAuthScopes(actor.authScopes);
    } catch {
      throw new Error('knowledge_thread_promotion_audit_contract_invalid');
    }
  }
  const tokenId = optionalText(actor.authTokenId, identifierMaximum);
  if (tokenId !== undefined) auth.tokenId = tokenId;
  if (actor.authAudience !== undefined) {
    if (
      !Array.isArray(actor.authAudience) ||
      actor.authAudience.length > audienceMaximum
    ) {
      throw new Error('knowledge_thread_promotion_audit_contract_invalid');
    }
    auth.audience = [
      ...new Set(
        actor.authAudience.map((value) =>
          requiredText(value, identifierMaximum),
        ),
      ),
    ];
  }
  if (actor.authExpiresAt !== undefined) {
    if (!Number.isSafeInteger(actor.authExpiresAt) || actor.authExpiresAt < 0) {
      throw new Error('knowledge_thread_promotion_audit_contract_invalid');
    }
    auth.expiresAt = actor.authExpiresAt;
  }
  const metadata: Record<string, Prisma.InputJsonValue> = {
    _auth: auth,
    _request: { id: requestId, source: actor.source },
  };
  const runId = optionalText(actor.agentRunId, identifierMaximum);
  const decisionRequestId = optionalText(
    actor.decisionRequestId,
    identifierMaximum,
  );
  if (runId !== undefined || decisionRequestId !== undefined) {
    metadata._agent = {
      ...(runId !== undefined ? { runId } : {}),
      ...(decisionRequestId !== undefined ? { decisionRequestId } : {}),
    };
  }
  return metadata;
}

function allowlistedMetadata(
  metadata: KnowledgeThreadPromotionAuditEntry['metadata'],
): Prisma.InputJsonObject {
  if (
    metadata.schemaVersion !== 1 ||
    !['previewed', 'created', 'reused', 'rejected', 'conflict'].includes(
      metadata.resultCode,
    ) ||
    (metadata.scope !== 'personal' && metadata.scope !== 'organization') ||
    !Number.isInteger(metadata.selectedMessageCount) ||
    metadata.selectedMessageCount < 1 ||
    metadata.selectedMessageCount > 100 ||
    !Number.isInteger(metadata.organizationGrantCount) ||
    metadata.organizationGrantCount < 0 ||
    metadata.organizationGrantCount > 20 ||
    typeof metadata.includesSharedCard !== 'boolean' ||
    typeof metadata.duplicate !== 'boolean'
  ) {
    throw new Error('knowledge_thread_promotion_audit_contract_invalid');
  }
  return {
    schemaVersion: 1,
    resultCode: metadata.resultCode,
    scope: metadata.scope,
    selectedMessageCount: metadata.selectedMessageCount,
    includesSharedCard: metadata.includesSharedCard,
    organizationGrantCount: metadata.organizationGrantCount,
    duplicate: metadata.duplicate,
  };
}

export class PrismaKnowledgeThreadPromotionAuditWriter implements KnowledgeThreadPromotionAuditWriter {
  constructor(private readonly client: AuditClient) {}

  async write(entry: KnowledgeThreadPromotionAuditEntry) {
    if (
      targetByAction[entry.action] !== entry.targetTable ||
      !entry.targetId ||
      entry.targetId.length > identifierMaximum
    ) {
      throw new Error('knowledge_thread_promotion_audit_contract_invalid');
    }
    const requestId = entry.actor.requestId?.trim();
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: requiredText(entry.actor.userId, identifierMaximum),
        requestId:
          requestId && requestIdPattern.test(requestId) ? requestId : undefined,
        source:
          entry.actor.source === 'api' || entry.actor.source === 'agent'
            ? entry.actor.source
            : undefined,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        metadata: {
          ...allowlistedMetadata(entry.metadata),
          ...actorMetadata(entry.actor),
        },
      },
    });
  }
}
