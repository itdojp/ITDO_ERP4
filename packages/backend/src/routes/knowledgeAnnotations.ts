import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  createKnowledgeAnnotationService,
  type KnowledgeAnnotationService,
} from '../application/knowledge/knowledgeAnnotationUseCases.js';
import {
  createKnowledgeProvenanceCursorCodec,
  KnowledgeProvenanceCursorError,
  type KnowledgeProvenanceCursorCodec,
} from '../application/knowledge/knowledgeProvenanceCursor.js';
import {
  knowledgeAnnotationKinds,
  knowledgeProvenanceLimits,
  knowledgeProvenanceOrigins,
  type KnowledgeAnnotation,
  type KnowledgeAnnotationRevision,
  type KnowledgePage,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import {
  prismaKnowledgeAnnotationRepository,
  prismaKnowledgeProvenanceUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeProvenanceAdapter.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import {
  annotationResponse,
  annotationRevisionResponse,
  knowledgeProvenanceErrorResponseSchema,
  nullableDateTimeSchema,
  nullableStringSchema,
  rejectUnknownKnowledgeBodyFields,
  sendKnowledgeProvenanceResult,
} from './knowledgeProvenanceSchemas.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

const revisionSchema = {
  $id: 'KnowledgeAnnotationRevisionResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'annotationId',
    'revision',
    'kind',
    'origin',
    'content',
    'createdAt',
    'createdBy',
  ],
  properties: {
    id: { type: 'string' },
    annotationId: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    kind: { type: 'string', enum: knowledgeAnnotationKinds },
    origin: { type: 'string', enum: knowledgeProvenanceOrigins },
    content: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
  },
} as const;

const annotationSchema = {
  $id: 'KnowledgeAnnotationResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'knowledgeItemId',
    'ownerUserId',
    'authorUserId',
    'scope',
    'organizationId',
    'kind',
    'origin',
    'currentRevision',
    'deletedAt',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'revision',
  ],
  properties: {
    id: { type: 'string' },
    knowledgeItemId: { type: 'string' },
    ownerUserId: { type: 'string' },
    authorUserId: { type: 'string' },
    scope: { type: 'string', enum: ['personal', 'organization'] },
    organizationId: nullableStringSchema,
    kind: { type: 'string', enum: knowledgeAnnotationKinds },
    origin: { type: 'string', enum: knowledgeProvenanceOrigins },
    currentRevision: { type: 'integer', minimum: 1 },
    deletedAt: nullableDateTimeSchema,
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string' },
    revision: { $ref: 'KnowledgeAnnotationRevisionResponse#' },
  },
} as const;

const revisionResponseRef = {
  $ref: 'KnowledgeAnnotationRevisionResponse#',
} as const;
const annotationResponseRef = {
  $ref: 'KnowledgeAnnotationResponse#',
} as const;

const itemParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: {
    itemId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.id,
    },
  },
} as const;

const annotationParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId', 'annotationId'],
  properties: {
    ...itemParamsSchema.properties,
    annotationId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.id,
    },
  },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeProvenanceLimits.listLimit,
      default: knowledgeProvenanceLimits.defaultListLimit,
    },
    cursor: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.cursor,
    },
  },
} as const;

const annotationListQuerySchema = {
  ...listQuerySchema,
  properties: {
    ...listQuerySchema.properties,
    includeDeleted: {
      type: 'boolean',
      default: false,
      description:
        'Include logically deleted annotations only when the current actor owns both the annotation and its Knowledge item.',
    },
  },
} as const;

const writeBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'origin', 'content'],
  properties: {
    kind: { type: 'string', enum: knowledgeAnnotationKinds },
    origin: { type: 'string', enum: knowledgeProvenanceOrigins },
    content: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.annotationContentBytes,
      description:
        'Maximum 65,536 UTF-8 bytes; the server enforces the byte length.',
    },
  },
} as const;

function invalidCursor(reply: FastifyReply) {
  return reply.code(400).send(
    createApiErrorResponse('invalid_request', 'Invalid cursor', {
      category: 'validation',
    }),
  );
}

export async function registerKnowledgeAnnotationRoutes(
  app: FastifyInstance,
  dependencies: {
    service?: KnowledgeAnnotationService;
    cursor?: KnowledgeProvenanceCursorCodec;
  } = {},
) {
  app.addSchema(revisionSchema);
  app.addSchema(annotationSchema);
  const service =
    dependencies.service ??
    createKnowledgeAnnotationService({
      reader: prismaKnowledgeAnnotationRepository,
      unitOfWork: prismaKnowledgeProvenanceUnitOfWork,
    });
  const cursor =
    dependencies.cursor ?? createKnowledgeProvenanceCursorCodec(process.env);
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.get(
    '/knowledge/items/:itemId/annotations/capabilities',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['canManageAnnotations'],
            properties: {
              canManageAnnotations: { type: 'boolean' },
            },
          },
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.capabilities({
        actor: knowledgeActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) => ({
        canManageAnnotations: value.canManageAnnotations,
      }));
    },
  );

  app.get(
    '/knowledge/items/:itemId/annotations',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        querystring: annotationListQuerySchema,
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: { type: 'array', items: annotationResponseRef },
              nextCursor: nullableStringSchema,
            },
          },
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = knowledgeActorFromRequest(request);
      const { itemId } = request.params as { itemId: string };
      const query = request.query as {
        limit?: number;
        cursor?: string;
        includeDeleted?: boolean;
      };
      const includeDeleted = query.includeDeleted === true;
      const cursorKind = includeDeleted
        ? ('annotations_with_deleted' as const)
        : ('annotations' as const);
      let boundary;
      try {
        boundary = query.cursor
          ? cursor.decodePage({
              cursor: query.cursor,
              kind: cursorKind,
              parentId: itemId,
              actor,
            })
          : undefined;
      } catch (error) {
        if (error instanceof KnowledgeProvenanceCursorError) {
          return invalidCursor(reply);
        }
        throw error;
      }
      const result = await service.list({
        actor,
        itemId,
        limit: query.limit ?? knowledgeProvenanceLimits.defaultListLimit,
        boundary,
        includeDeleted,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (page: KnowledgePage<KnowledgeAnnotation>) => ({
          items: page.items.map(annotationResponse),
          nextCursor: page.nextBoundary
            ? cursor.encodePage({
                kind: cursorKind,
                parentId: itemId,
                actor,
                boundary: page.nextBoundary,
              })
            : null,
        }),
      );
    },
  );

  app.post(
    '/knowledge/items/:itemId/annotations',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields([
        'kind',
        'origin',
        'content',
      ]),
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        body: writeBodySchema,
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          201: annotationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.create({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (value) => annotationResponse(value as KnowledgeAnnotation),
        201,
      );
    },
  );

  app.get(
    '/knowledge/items/:itemId/annotations/:annotationId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: annotationParamsSchema,
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: annotationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as {
        itemId: string;
        annotationId: string;
      };
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        ...params,
      });
      return sendKnowledgeProvenanceResult(reply, result, annotationResponse);
    },
  );

  app.get(
    '/knowledge/items/:itemId/annotations/:annotationId/revisions',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: annotationParamsSchema,
        querystring: listQuerySchema,
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: { type: 'array', items: revisionResponseRef },
              nextCursor: nullableStringSchema,
            },
          },
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = knowledgeActorFromRequest(request);
      const params = request.params as {
        itemId: string;
        annotationId: string;
      };
      const query = request.query as { limit?: number; cursor?: string };
      let boundary;
      try {
        boundary = query.cursor
          ? cursor.decodeSequence({
              cursor: query.cursor,
              kind: 'annotation_revisions',
              parentId: params.annotationId,
              actor,
            })
          : undefined;
      } catch (error) {
        if (error instanceof KnowledgeProvenanceCursorError) {
          return invalidCursor(reply);
        }
        throw error;
      }
      const result = await service.history({
        actor,
        ...params,
        limit: query.limit ?? knowledgeProvenanceLimits.defaultListLimit,
        beforeRevision: boundary?.sequence,
      });
      return sendKnowledgeProvenanceResult(reply, result, (page) => ({
        items: page.items.map(annotationRevisionResponse),
        nextCursor: page.nextBoundary
          ? cursor.encodeSequence({
              kind: 'annotation_revisions',
              parentId: params.annotationId,
              actor,
              boundary: page.nextBoundary,
            })
          : null,
      }));
    },
  );

  app.post(
    '/knowledge/items/:itemId/annotations/:annotationId/revisions',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields([
        'expectedRevision',
        'kind',
        'origin',
        'content',
      ]),
      schema: {
        tags: ['knowledge'],
        params: annotationParamsSchema,
        body: {
          ...writeBodySchema,
          required: ['expectedRevision', ...writeBodySchema.required],
          properties: {
            expectedRevision: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.expectedVersion,
            },
            ...writeBodySchema.properties,
          },
        },
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: annotationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as {
        itemId: string;
        annotationId: string;
      };
      const result = await service.revise({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        ...params,
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) =>
        annotationResponse(value as KnowledgeAnnotation),
      );
    },
  );

  app.delete(
    '/knowledge/items/:itemId/annotations/:annotationId',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields(['expectedRevision']),
      schema: {
        tags: ['knowledge'],
        params: annotationParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision'],
          properties: {
            expectedRevision: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.sequence,
            },
          },
        },
        response: {
          401: knowledgeProvenanceErrorResponseSchema,
          200: annotationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as {
        itemId: string;
        annotationId: string;
      };
      const result = await service.remove({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        ...params,
        expectedRevision: (request.body as { expectedRevision: number })
          .expectedRevision,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) =>
        annotationResponse(value as KnowledgeAnnotation),
      );
    },
  );
}
