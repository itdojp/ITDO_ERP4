import { Prisma } from '@prisma/client';

import {
  knowledgeAnnotationKinds,
  knowledgeConversationItemRelationTypes,
  knowledgeConversationRoles,
  knowledgeConversationSourceTypes,
  knowledgeProvenanceOrigins,
  knowledgeSynthesisSourceKinds,
  knowledgeSynthesisSourceRelationTypes,
  type KnowledgeProvenanceAuditEntry,
  type KnowledgeProvenanceAuditWriter,
} from '../../application/knowledge/knowledgeProvenancePorts.js';

type KnowledgeProvenanceAuditClient = Pick<
  Prisma.TransactionClient,
  'auditLog'
>;

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

const auditContextLimits = {
  identifier: 255,
  scope: 255,
  scopeCount: 100,
  audience: 255,
  audienceCount: 100,
  agentIdentifier: 255,
} as const;

const auditTargetByAction = {
  knowledge_annotation_created: 'knowledge_annotations',
  knowledge_annotation_revised: 'knowledge_annotations',
  knowledge_annotation_deleted: 'knowledge_annotations',
  knowledge_conversation_created: 'knowledge_conversations',
  knowledge_conversation_imported: 'knowledge_conversations',
  knowledge_conversation_item_linked: 'knowledge_conversations',
  knowledge_conversation_item_unlinked: 'knowledge_conversations',
  knowledge_conversation_turn_appended: 'knowledge_conversations',
  knowledge_synthesis_created: 'knowledge_syntheses',
  knowledge_synthesis_version_appended: 'knowledge_syntheses',
  knowledge_synthesis_source_linked: 'knowledge_syntheses',
  knowledge_import_previewed: 'knowledge_imports',
  knowledge_import_committed: 'knowledge_imports',
  knowledge_import_duplicate_detected: 'knowledge_imports',
  knowledge_import_rejected: 'knowledge_imports',
} as const;

function bounded(value: string | undefined, maximum: number) {
  if (!value) return undefined;
  return value.slice(0, maximum);
}

function hasAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function requiredAuditText(value: string | undefined, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error('knowledge_provenance_audit_contract_invalid');
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    hasAsciiControlCharacter(normalized)
  ) {
    throw new Error('knowledge_provenance_audit_contract_invalid');
  }
  return normalized;
}

function optionalAuditText(
  value: string | undefined,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredAuditText(value, maximum);
}

function optionalAuditArray(
  values: string[] | undefined,
  maximumCount: number,
  maximumLength: number,
): string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values) || values.length > maximumCount) {
    throw new Error('knowledge_provenance_audit_contract_invalid');
  }
  const normalized = [
    ...new Set(values.map((value) => requiredAuditText(value, maximumLength))),
  ];
  return normalized;
}

function actorAuditMetadata(
  actor: KnowledgeProvenanceAuditEntry['actor'],
): Prisma.InputJsonObject {
  const principalUserId = requiredAuditText(
    actor.principalUserId,
    auditContextLimits.identifier,
  );
  const actorUserId = requiredAuditText(
    actor.actorUserId,
    auditContextLimits.identifier,
  );
  const requestId = actor.requestId?.trim();
  const source = actor.source;
  if (
    !requestId ||
    !requestIdPattern.test(requestId) ||
    (source !== 'api' && source !== 'agent')
  ) {
    throw new Error('knowledge_provenance_audit_contract_invalid');
  }

  const auth: Record<string, Prisma.InputJsonValue> = {
    principalUserId,
    actorUserId,
  };
  const scopes = optionalAuditArray(
    actor.authScopes,
    auditContextLimits.scopeCount,
    auditContextLimits.scope,
  );
  if (scopes !== undefined) auth.scopes = scopes;
  const tokenId = optionalAuditText(
    actor.authTokenId,
    auditContextLimits.identifier,
  );
  if (tokenId !== undefined) auth.tokenId = tokenId;
  const audience = optionalAuditArray(
    actor.authAudience,
    auditContextLimits.audienceCount,
    auditContextLimits.audience,
  );
  if (audience !== undefined) auth.audience = audience;
  if (actor.authExpiresAt !== undefined) {
    if (!Number.isSafeInteger(actor.authExpiresAt) || actor.authExpiresAt < 0) {
      throw new Error('knowledge_provenance_audit_contract_invalid');
    }
    auth.expiresAt = actor.authExpiresAt;
  }

  const metadata: Record<string, Prisma.InputJsonValue> = {
    _auth: auth,
    _request: { id: requestId, source },
  };
  const runId = optionalAuditText(
    actor.agentRunId,
    auditContextLimits.agentIdentifier,
  );
  const decisionRequestId = optionalAuditText(
    actor.decisionRequestId,
    auditContextLimits.agentIdentifier,
  );
  if (runId !== undefined || decisionRequestId !== undefined) {
    metadata._agent = {
      ...(runId !== undefined ? { runId } : {}),
      ...(decisionRequestId !== undefined ? { decisionRequestId } : {}),
    };
  }
  return metadata;
}

function finiteMetadataInteger(value: unknown, maximum: number) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function allowlistedAuditMetadata(
  metadata: KnowledgeProvenanceAuditEntry['metadata'],
): Prisma.InputJsonObject {
  const result: Record<string, string | number | boolean> = {};
  const version = metadata.version;
  if (
    finiteMetadataInteger(version, 2_147_483_647) &&
    typeof version === 'number' &&
    version !== 0
  ) {
    result.version = version;
  }
  const revision = metadata.revision;
  if (
    finiteMetadataInteger(revision, 2_147_483_647) &&
    typeof revision === 'number' &&
    revision !== 0
  ) {
    result.revision = revision;
  }
  if (metadata.scope === 'personal' || metadata.scope === 'organization') {
    result.scope = metadata.scope;
  }
  const annotationKind = metadata.annotationKind;
  if (
    typeof annotationKind === 'string' &&
    knowledgeAnnotationKinds.some((value) => value === annotationKind)
  ) {
    result.annotationKind = annotationKind;
  }
  const origin = metadata.origin;
  if (
    typeof origin === 'string' &&
    knowledgeProvenanceOrigins.some((value) => value === origin)
  ) {
    result.origin = origin;
  }
  const role = metadata.role;
  if (
    typeof role === 'string' &&
    knowledgeConversationRoles.some((value) => value === role)
  ) {
    result.role = role;
  }
  const relationType = metadata.relationType;
  if (
    typeof relationType === 'string' &&
    (knowledgeConversationItemRelationTypes.some(
      (value) => value === relationType,
    ) ||
      knowledgeSynthesisSourceRelationTypes.some(
        (value) => value === relationType,
      ))
  ) {
    result.relationType = relationType;
  }
  const sourceKind = metadata.sourceKind;
  if (
    typeof sourceKind === 'string' &&
    knowledgeSynthesisSourceKinds.some((value) => value === sourceKind)
  ) {
    result.sourceKind = sourceKind;
  }
  for (const key of ['sourceCount', 'turnCount', 'itemCount'] as const) {
    const value = metadata[key];
    if (finiteMetadataInteger(value, 10_000) && typeof value === 'number') {
      result[key] = value;
    }
  }
  const format = metadata.format;
  if (
    typeof format === 'string' &&
    knowledgeConversationSourceTypes.some((value) => value === format)
  ) {
    result.format = format;
  }
  if (typeof metadata.duplicate === 'boolean') {
    result.duplicate = metadata.duplicate;
  }
  return result as Prisma.InputJsonObject;
}

export class PrismaKnowledgeProvenanceAuditWriter implements KnowledgeProvenanceAuditWriter {
  constructor(private readonly client: KnowledgeProvenanceAuditClient) {}

  async write(entry: KnowledgeProvenanceAuditEntry) {
    const expectedTarget = auditTargetByAction[entry.action];
    if (!expectedTarget || entry.targetTable !== expectedTarget) {
      throw new Error('knowledge_provenance_audit_contract_invalid');
    }
    const metadata = {
      ...allowlistedAuditMetadata(entry.metadata),
      ...actorAuditMetadata(entry.actor),
    } as Prisma.InputJsonObject;
    const requestId = entry.actor.requestId?.trim();
    const source = entry.actor.source;
    await this.client.auditLog.create({
      data: {
        action: entry.action,
        userId: bounded(entry.actor.userId, 255),
        requestId:
          requestId && requestIdPattern.test(requestId) ? requestId : undefined,
        source: source === 'api' || source === 'agent' ? source : undefined,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        metadata,
      },
    });
  }
}
