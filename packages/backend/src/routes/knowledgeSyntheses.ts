import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  createKnowledgeProvenanceCursorCodec,
  KnowledgeProvenanceCursorError,
  type KnowledgeProvenanceCursorCodec,
} from '../application/knowledge/knowledgeProvenanceCursor.js';
import {
  knowledgeProvenanceLimits,
  knowledgeSynthesisSourceKinds,
  knowledgeSynthesisSourceRelationTypes,
  type KnowledgePage,
  type KnowledgeSynthesis,
  type KnowledgeSynthesisDetail,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import {
  createKnowledgeSynthesisService,
  type KnowledgeSynthesisService,
} from '../application/knowledge/knowledgeSynthesisUseCases.js';
import {
  prismaKnowledgeProvenanceUnitOfWork,
  prismaKnowledgeSynthesisRepository,
} from '../adapters/knowledge/prismaKnowledgeProvenanceAdapter.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import {
  knowledgeProvenanceErrorResponseSchema,
  nullableStringSchema,
  rejectUnknownKnowledgeArrayObjectFields,
  rejectUnknownKnowledgeBodyFields,
  sendKnowledgeProvenanceResult,
  synthesisDetailResponse,
  synthesisResponse,
  synthesisVersionResponse,
} from './knowledgeProvenanceSchemas.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

const sourceSchema = {
  $id: 'KnowledgeSynthesisSourceResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'kind',
    'sourceId',
    'relationType',
    'ordinal',
    'accessible',
    'createdAt',
    'createdBy',
  ],
  properties: {
    id: nullableStringSchema,
    kind: { type: 'string', enum: knowledgeSynthesisSourceKinds },
    sourceId: nullableStringSchema,
    relationType: {
      type: 'string',
      enum: knowledgeSynthesisSourceRelationTypes,
    },
    ordinal: { type: 'integer', minimum: 0 },
    accessible: { type: 'boolean' },
    createdAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    createdBy: nullableStringSchema,
  },
} as const;

const versionSchema = {
  $id: 'KnowledgeSynthesisVersionResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'synthesisId',
    'version',
    'content',
    'unresolvedQuestions',
    'confidenceBasisPoints',
    'createdAt',
    'createdBy',
    'sources',
  ],
  properties: {
    id: { type: 'string' },
    synthesisId: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    content: { type: 'string' },
    unresolvedQuestions: { type: 'array', items: { type: 'string' } },
    confidenceBasisPoints: {
      anyOf: [
        {
          type: 'integer',
          minimum: 0,
          maximum: knowledgeProvenanceLimits.confidenceBasisPoints,
        },
        { type: 'null' },
      ],
    },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    sources: {
      type: 'array',
      items: { $ref: 'KnowledgeSynthesisSourceResponse#' },
    },
  },
} as const;

const synthesisSchema = {
  $id: 'KnowledgeSynthesisResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'ownerUserId',
    'scope',
    'organizationId',
    'title',
    'currentVersion',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
  ],
  properties: {
    id: { type: 'string' },
    ownerUserId: { type: 'string' },
    scope: { type: 'string', enum: ['personal', 'organization'] },
    organizationId: nullableStringSchema,
    title: { type: 'string' },
    currentVersion: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string' },
  },
} as const;

const detailSchema = {
  $id: 'KnowledgeSynthesisDetailResponse',
  type: 'object',
  additionalProperties: false,
  required: ['synthesis', 'currentVersion'],
  properties: {
    synthesis: { $ref: 'KnowledgeSynthesisResponse#' },
    currentVersion: { $ref: 'KnowledgeSynthesisVersionResponse#' },
  },
} as const;

const versionResponseRef = {
  $ref: 'KnowledgeSynthesisVersionResponse#',
} as const;
const synthesisResponseRef = {
  $ref: 'KnowledgeSynthesisResponse#',
} as const;
const detailResponseRef = {
  $ref: 'KnowledgeSynthesisDetailResponse#',
} as const;

const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['synthesisId'],
  properties: {
    synthesisId: {
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

const sourceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'sourceId', 'relationType'],
  properties: {
    kind: { type: 'string', enum: knowledgeSynthesisSourceKinds },
    sourceId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.id,
    },
    relationType: {
      type: 'string',
      enum: knowledgeSynthesisSourceRelationTypes,
    },
  },
} as const;

const versionInputProperties = {
  content: { type: 'string', minLength: 1, maxLength: 262_144 },
  unresolvedQuestions: {
    type: 'array',
    maxItems: knowledgeProvenanceLimits.unresolvedQuestions,
    items: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.unresolvedQuestion,
    },
  },
  confidenceBasisPoints: {
    anyOf: [
      {
        type: 'integer',
        minimum: 0,
        maximum: knowledgeProvenanceLimits.confidenceBasisPoints,
      },
      { type: 'null' },
    ],
  },
  sources: {
    type: 'array',
    minItems: 1,
    maxItems: knowledgeProvenanceLimits.sources,
    items: sourceInputSchema,
  },
} as const;

function sendInvalidCursor(reply: FastifyReply) {
  return reply.code(400).send(
    createApiErrorResponse('invalid_request', 'Invalid cursor', {
      category: 'validation',
    }),
  );
}

export async function registerKnowledgeSynthesisRoutes(
  app: FastifyInstance,
  dependencies: {
    service?: KnowledgeSynthesisService;
    cursor?: KnowledgeProvenanceCursorCodec;
  } = {},
) {
  app.addSchema(sourceSchema);
  app.addSchema(versionSchema);
  app.addSchema(synthesisSchema);
  app.addSchema(detailSchema);
  const service =
    dependencies.service ??
    createKnowledgeSynthesisService({
      reader: prismaKnowledgeSynthesisRepository,
      unitOfWork: prismaKnowledgeProvenanceUnitOfWork,
    });
  const cursor =
    dependencies.cursor ?? createKnowledgeProvenanceCursorCodec(process.env);
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.get(
    '/knowledge/syntheses',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        querystring: listQuerySchema,
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: { type: 'array', items: synthesisResponseRef },
              nextCursor: nullableStringSchema,
            },
          },
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = knowledgeActorFromRequest(request);
      const query = request.query as { limit?: number; cursor?: string };
      let boundary;
      try {
        boundary = query.cursor
          ? cursor.decodePage({
              cursor: query.cursor,
              kind: 'syntheses',
              actor,
            })
          : undefined;
      } catch (error) {
        if (error instanceof KnowledgeProvenanceCursorError) {
          return sendInvalidCursor(reply);
        }
        throw error;
      }
      const result = await service.list({
        actor,
        limit: query.limit ?? knowledgeProvenanceLimits.defaultListLimit,
        boundary,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (page: KnowledgePage<KnowledgeSynthesis>) => ({
          items: page.items.map(synthesisResponse),
          nextCursor: page.nextBoundary
            ? cursor.encodePage({
                kind: 'syntheses',
                actor,
                boundary: page.nextBoundary,
              })
            : null,
        }),
      );
    },
  );

  app.post(
    '/knowledge/syntheses',
    {
      preHandler,
      preValidation: [
        rejectUnknownKnowledgeBodyFields([
          'scope',
          'title',
          'content',
          'unresolvedQuestions',
          'confidenceBasisPoints',
          'sources',
        ]),
        rejectUnknownKnowledgeArrayObjectFields('sources', [
          'kind',
          'sourceId',
          'relationType',
        ]),
      ],
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scope', 'title', 'content', 'sources'],
          properties: {
            scope: { type: 'string', enum: ['personal', 'organization'] },
            title: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeProvenanceLimits.title,
            },
            ...versionInputProperties,
          },
        },
        response: {
          201: detailResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.create({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (value) => synthesisDetailResponse(value as KnowledgeSynthesisDetail),
        201,
      );
    },
  );

  app.get(
    '/knowledge/syntheses/:synthesisId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        response: {
          200: detailResponseRef,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        synthesisId: (request.params as { synthesisId: string }).synthesisId,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        synthesisDetailResponse,
      );
    },
  );

  app.get(
    '/knowledge/syntheses/:synthesisId/versions',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        querystring: listQuerySchema,
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'nextCursor'],
            properties: {
              items: { type: 'array', items: versionResponseRef },
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
      const synthesisId = (request.params as { synthesisId: string })
        .synthesisId;
      const query = request.query as { limit?: number; cursor?: string };
      let boundary;
      try {
        boundary = query.cursor
          ? cursor.decodeSequence({
              cursor: query.cursor,
              kind: 'synthesis_versions',
              parentId: synthesisId,
              actor,
            })
          : undefined;
      } catch (error) {
        if (error instanceof KnowledgeProvenanceCursorError) {
          return sendInvalidCursor(reply);
        }
        throw error;
      }
      const result = await service.history({
        actor,
        synthesisId,
        limit: query.limit ?? knowledgeProvenanceLimits.defaultListLimit,
        beforeVersion: boundary?.sequence,
      });
      return sendKnowledgeProvenanceResult(reply, result, (page) => ({
        items: page.items.map(synthesisVersionResponse),
        nextCursor: page.nextBoundary
          ? cursor.encodeSequence({
              kind: 'synthesis_versions',
              parentId: synthesisId,
              actor,
              boundary: page.nextBoundary,
            })
          : null,
      }));
    },
  );

  app.post(
    '/knowledge/syntheses/:synthesisId/versions',
    {
      preHandler,
      preValidation: [
        rejectUnknownKnowledgeBodyFields([
          'expectedVersion',
          'content',
          'unresolvedQuestions',
          'confidenceBasisPoints',
          'sources',
        ]),
        rejectUnknownKnowledgeArrayObjectFields('sources', [
          'kind',
          'sourceId',
          'relationType',
        ]),
      ],
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion', 'content', 'sources'],
          properties: {
            expectedVersion: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.expectedVersion,
            },
            ...versionInputProperties,
          },
        },
        response: {
          200: detailResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.appendVersion({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        synthesisId: (request.params as { synthesisId: string }).synthesisId,
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) =>
        synthesisDetailResponse(value as KnowledgeSynthesisDetail),
      );
    },
  );
}
