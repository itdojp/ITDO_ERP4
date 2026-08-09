import { Prisma } from '@prisma/client';

import {
  knowledgeShareStatuses,
  type KnowledgeShareAuditEntry,
  type KnowledgeShareAuditWriter,
} from '../../application/knowledge/knowledgeSharePorts.js';
import { normalizeAuthIdentifier } from '../../services/authIdentifiers.js';
import { normalizeAuthScopes } from '../../services/authScopes.js';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const identifierMaximum = 255;
const audienceMaximum = 100;

const targetByAction = {
  knowledge_share_previewed: 'knowledge_shares',
  knowledge_share_requested: 'knowledge_shares',
  knowledge_share_posted: 'knowledge_shares',
  knowledge_share_failed: 'knowledge_shares',
  knowledge_share_reconciled: 'knowledge_shares',
  knowledge_share_duplicate_detected: 'knowledge_shares',
  knowledge_share_revoked: 'knowledge_shares',
} as const;

function requiredText(value: string | undefined, maximum: number) {
  try {
    return normalizeAuthIdentifier(value, maximum);
  } catch {
    throw new Error('knowledge_share_audit_contract_invalid');
  }
}

function optionalText(value: string | undefined, maximum: number) {
  return value === undefined ? undefined : requiredText(value, maximum);
}

function actorMetadata(
  actor: KnowledgeShareAuditEntry['actor'],
): Prisma.InputJsonObject {
  const requestId = requiredText(actor.requestId, 128);
  if (
    !requestIdPattern.test(requestId) ||
    (actor.source !== 'api' && actor.source !== 'agent')
  ) {
    throw new Error('knowledge_share_audit_contract_invalid');
  }
  const auth: Record<string, Prisma.InputJsonValue> = {
    principalUserId: requiredText(actor.principalUserId, identifierMaximum),
    actorUserId: requiredText(actor.actorUserId, identifierMaximum),
  };
  if (actor.authScopes !== undefined) {
    try {
      auth.scopes = normalizeAuthScopes(actor.authScopes);
    } catch {
      throw new Error('knowledge_share_audit_contract_invalid');
    }
  }
  const tokenId = optionalText(actor.authTokenId, identifierMaximum);
  if (tokenId !== undefined) auth.tokenId = tokenId;
  if (actor.authAudience !== undefined) {
    if (
      !Array.isArray(actor.authAudience) ||
      actor.authAudience.length > audienceMaximum
    ) {
      throw new Error('knowledge_share_audit_contract_invalid');
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
      throw new Error('knowledge_share_audit_contract_invalid');
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

function boundedCount(value: unknown, maximum: number) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function allowlistedMetadata(
  metadata: KnowledgeShareAuditEntry['metadata'],
): Prisma.InputJsonObject {
  if (metadata.schemaVersion !== 1) {
    throw new Error('knowledge_share_audit_contract_invalid');
  }
  const result: Record<string, Prisma.InputJsonValue> = { schemaVersion: 1 };
  if (
    metadata.status !== undefined &&
    knowledgeShareStatuses.some((status) => status === metadata.status)
  ) {
    result.status = metadata.status;
  }
  if (
    metadata.resultCode !== undefined &&
    ['created', 'reused', 'posted', 'pending', 'failed', 'revoked'].includes(
      metadata.resultCode,
    )
  ) {
    result.resultCode = metadata.resultCode;
  }
  if (typeof metadata.duplicate === 'boolean') {
    result.duplicate = metadata.duplicate;
  }
  if (metadata.scope === 'personal' || metadata.scope === 'organization') {
    result.scope = metadata.scope;
  }
  for (const key of [
    'selectedCategoryCount',
    'labelCount',
    'annotationCount',
    'turnCount',
    'synthesisCount',
  ] as const) {
    const value = metadata[key];
    if (value !== undefined) {
      if (!boundedCount(value, 10_000)) {
        throw new Error('knowledge_share_audit_contract_invalid');
      }
      result[key] = value;
    }
  }
  return result as Prisma.InputJsonObject;
}

export class PrismaKnowledgeShareAuditWriter implements KnowledgeShareAuditWriter {
  constructor(private readonly client: AuditClient) {}

  async write(entry: KnowledgeShareAuditEntry) {
    if (
      targetByAction[entry.action] !== entry.targetTable ||
      !entry.targetId ||
      entry.targetId.length > 255
    ) {
      throw new Error('knowledge_share_audit_contract_invalid');
    }
    const actor = actorMetadata(entry.actor);
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
          ...actor,
        },
      },
    });
  }
}
