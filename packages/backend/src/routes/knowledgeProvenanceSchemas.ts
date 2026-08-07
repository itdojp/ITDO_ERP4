import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  KnowledgeAnnotation,
  KnowledgeAnnotationRevision,
  KnowledgeConversation,
  KnowledgeConversationTurn,
  KnowledgeSynthesis,
  KnowledgeSynthesisDetail,
  KnowledgeSynthesisSource,
  KnowledgeSynthesisVersion,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import {
  knowledgeConversationImportModels,
  knowledgeConversationImportProviders,
  knowledgeConversationImportToolNames,
} from '../application/knowledge/knowledgeConversationImportPorts.js';
import type { KnowledgeProvenanceResult } from '../application/knowledge/knowledgeProvenanceValidation.js';
import { createApiErrorResponse } from '../services/errors.js';

export const knowledgeProvenanceErrorResponseSchema = {
  // Deliberately omit `details`: Fastify validation internals and canonical
  // account diagnostics are not part of the public provenance API contract.
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        category: { type: 'string' },
      },
    },
  },
} as const;

export const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

export const nullableDateTimeSchema = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;

export function rejectUnknownKnowledgeBodyFields(
  allowedFields: readonly string[],
) {
  const allowed = new Set(allowedFields);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    if (
      Object.keys(body as Record<string, unknown>).some(
        (field) => !allowed.has(field),
      )
    ) {
      return reply
        .code(400)
        .send(
          createApiErrorResponse(
            'invalid_request',
            'body contains an unsupported field',
            { category: 'validation' },
          ),
        );
    }
  };
}

export function rejectUnknownKnowledgeArrayObjectFields(
  field: string,
  allowedFields: readonly string[],
) {
  const allowed = new Set(allowedFields);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const values = (body as Record<string, unknown>)[field];
    if (!Array.isArray(values)) return;
    if (
      values.some(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value as Record<string, unknown>).some(
            (nestedField) => !allowed.has(nestedField),
          ),
      )
    ) {
      return reply
        .code(400)
        .send(
          createApiErrorResponse(
            'invalid_request',
            `${field} contains an unsupported field`,
            { category: 'validation' },
          ),
        );
    }
  };
}

export function annotationRevisionResponse(
  revision: KnowledgeAnnotationRevision,
) {
  return {
    id: revision.id,
    annotationId: revision.annotationId,
    revision: revision.revision,
    kind: revision.kind,
    origin: revision.origin,
    content: revision.content,
    createdAt: revision.createdAt.toISOString(),
    createdBy: revision.createdBy,
  };
}

export function annotationResponse(annotation: KnowledgeAnnotation) {
  return {
    id: annotation.id,
    knowledgeItemId: annotation.knowledgeItemId,
    ownerUserId: annotation.ownerUserId,
    authorUserId: annotation.authorUserId,
    scope: annotation.scope,
    organizationId: annotation.organizationId,
    kind: annotation.kind,
    origin: annotation.origin,
    currentRevision: annotation.currentRevision,
    deletedAt: annotation.deletedAt?.toISOString() ?? null,
    createdAt: annotation.createdAt.toISOString(),
    createdBy: annotation.createdBy,
    updatedAt: annotation.updatedAt.toISOString(),
    updatedBy: annotation.updatedBy,
    revision: annotationRevisionResponse(annotation.revision),
  };
}

export function conversationResponse(conversation: KnowledgeConversation) {
  return {
    id: conversation.id,
    ownerUserId: conversation.ownerUserId,
    title: conversation.title,
    sourceType: conversation.sourceType,
    provider: knowledgeConversationImportProviders.some(
      (value) => value === conversation.provider,
    )
      ? conversation.provider
      : null,
    model: knowledgeConversationImportModels.some(
      (value) => value === conversation.model,
    )
      ? conversation.model
      : null,
    capturedAt: conversation.capturedAt.toISOString(),
    importedAt: conversation.importedAt?.toISOString() ?? null,
    contentHash: conversation.contentHash,
    version: conversation.version,
    createdAt: conversation.createdAt.toISOString(),
    createdBy: conversation.createdBy,
    updatedAt: conversation.updatedAt.toISOString(),
    updatedBy: conversation.updatedBy,
    items: conversation.items.map((item) => ({
      id: item.id,
      knowledgeItemId: item.knowledgeItemId,
      relationType: item.relationType,
      ordinal: item.ordinal,
      createdAt: item.createdAt.toISOString(),
      createdBy: item.createdBy,
    })),
  };
}

export function conversationTurnResponse(turn: KnowledgeConversationTurn) {
  return {
    id: turn.id,
    conversationId: turn.conversationId,
    sequence: turn.sequence,
    role: turn.role,
    origin: turn.origin,
    content: turn.content,
    name:
      turn.role === 'tool' &&
      knowledgeConversationImportToolNames.some((value) => value === turn.name)
        ? turn.name
        : null,
    occurredAt: turn.occurredAt?.toISOString() ?? null,
    contentHash: turn.contentHash,
    createdAt: turn.createdAt.toISOString(),
    createdBy: turn.createdBy,
  };
}

export function synthesisResponse(synthesis: KnowledgeSynthesis) {
  return {
    id: synthesis.id,
    ownerUserId: synthesis.ownerUserId,
    scope: synthesis.scope,
    organizationId: synthesis.organizationId,
    title: synthesis.title,
    currentVersion: synthesis.currentVersion,
    createdAt: synthesis.createdAt.toISOString(),
    createdBy: synthesis.createdBy,
    updatedAt: synthesis.updatedAt.toISOString(),
    updatedBy: synthesis.updatedBy,
  };
}

export function synthesisSourceResponse(source: KnowledgeSynthesisSource) {
  return {
    id: source.id,
    kind: source.kind,
    sourceId: source.sourceId,
    relationType: source.relationType,
    ordinal: source.ordinal,
    accessible: source.accessible,
    createdAt: source.createdAt?.toISOString() ?? null,
    createdBy: source.createdBy,
  };
}

export function synthesisVersionResponse(version: KnowledgeSynthesisVersion) {
  return {
    id: version.id,
    synthesisId: version.synthesisId,
    version: version.version,
    content: version.content,
    unresolvedQuestions: version.unresolvedQuestions,
    confidenceBasisPoints: version.confidenceBasisPoints,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    sources: version.sources.map(synthesisSourceResponse),
  };
}

export function synthesisDetailResponse(detail: KnowledgeSynthesisDetail) {
  return {
    synthesis: synthesisResponse(detail.synthesis),
    currentVersion: synthesisVersionResponse(detail.currentVersion),
  };
}

export function sendKnowledgeProvenanceResult<T>(
  reply: FastifyReply,
  result: KnowledgeProvenanceResult<T>,
  transform: (value: T) => unknown,
  successStatus = 200,
) {
  if (result.ok) {
    return reply.code(successStatus).send(transform(result.value));
  }
  const category =
    result.statusCode === 404
      ? 'not_found'
      : result.statusCode === 409
        ? 'conflict'
        : 'validation';
  return reply.code(result.statusCode).send(
    createApiErrorResponse(result.code, result.message, {
      category,
    }),
  );
}
