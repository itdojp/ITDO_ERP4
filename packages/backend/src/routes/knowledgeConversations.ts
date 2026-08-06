import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  createKnowledgeConversationService,
  type KnowledgeConversationService,
} from '../application/knowledge/knowledgeConversationUseCases.js';
import {
  createKnowledgeProvenanceCursorCodec,
  KnowledgeProvenanceCursorError,
  type KnowledgeProvenanceCursorCodec,
} from '../application/knowledge/knowledgeProvenanceCursor.js';
import {
  knowledgeConversationItemRelationTypes,
  knowledgeConversationRoles,
  knowledgeProvenanceLimits,
  knowledgeProvenanceOrigins,
  type KnowledgeConversation,
  type KnowledgeConversationTurn,
  type KnowledgePage,
  type KnowledgeSequencePage,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import {
  prismaKnowledgeConversationRepository,
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
  conversationResponse,
  conversationTurnResponse,
  knowledgeProvenanceErrorResponseSchema,
  nullableDateTimeSchema,
  nullableStringSchema,
  rejectUnknownKnowledgeBodyFields,
  sendKnowledgeProvenanceResult,
} from './knowledgeProvenanceSchemas.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

const conversationItemSchema = {
  $id: 'KnowledgeConversationItemResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'knowledgeItemId',
    'relationType',
    'ordinal',
    'createdAt',
    'createdBy',
  ],
  properties: {
    id: { type: 'string' },
    knowledgeItemId: { type: 'string' },
    relationType: {
      type: 'string',
      enum: knowledgeConversationItemRelationTypes,
    },
    ordinal: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
  },
} as const;

const conversationSchema = {
  $id: 'KnowledgeConversationResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'ownerUserId',
    'title',
    'sourceType',
    'provider',
    'model',
    'capturedAt',
    'importedAt',
    'contentHash',
    'version',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'items',
  ],
  properties: {
    id: { type: 'string' },
    ownerUserId: { type: 'string' },
    title: { type: 'string' },
    sourceType: { type: 'string', enum: ['manual', 'json', 'markdown'] },
    provider: { type: 'string', nullable: true, enum: [null] },
    model: { type: 'string', nullable: true, enum: [null] },
    capturedAt: { type: 'string', format: 'date-time' },
    importedAt: nullableDateTimeSchema,
    contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string' },
    items: {
      type: 'array',
      items: { $ref: 'KnowledgeConversationItemResponse#' },
    },
  },
} as const;

const turnSchema = {
  $id: 'KnowledgeConversationTurnResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'conversationId',
    'sequence',
    'role',
    'origin',
    'content',
    'name',
    'occurredAt',
    'contentHash',
    'createdAt',
    'createdBy',
  ],
  properties: {
    id: { type: 'string' },
    conversationId: { type: 'string' },
    sequence: { type: 'integer', minimum: 1 },
    role: { type: 'string', enum: knowledgeConversationRoles },
    origin: { type: 'string', enum: knowledgeProvenanceOrigins },
    content: { type: 'string' },
    name: { type: 'string', nullable: true, enum: [null] },
    occurredAt: nullableDateTimeSchema,
    contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
  },
} as const;

const conversationResponseRef = {
  $ref: 'KnowledgeConversationResponse#',
} as const;
const turnResponseRef = {
  $ref: 'KnowledgeConversationTurnResponse#',
} as const;

const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conversationId'],
  properties: {
    conversationId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeProvenanceLimits.id,
    },
  },
} as const;

const itemParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conversationId', 'itemId'],
  properties: {
    ...idParamsSchema.properties,
    itemId: {
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

function sendInvalidCursor(reply: FastifyReply) {
  return reply.code(400).send(
    createApiErrorResponse('invalid_request', 'Invalid cursor', {
      category: 'validation',
    }),
  );
}

export async function registerKnowledgeConversationRoutes(
  app: FastifyInstance,
  dependencies: {
    service?: KnowledgeConversationService;
    cursor?: KnowledgeProvenanceCursorCodec;
  } = {},
) {
  app.addSchema(conversationItemSchema);
  app.addSchema(conversationSchema);
  app.addSchema(turnSchema);
  const service =
    dependencies.service ??
    createKnowledgeConversationService({
      reader: prismaKnowledgeConversationRepository,
      unitOfWork: prismaKnowledgeProvenanceUnitOfWork,
    });
  const cursor =
    dependencies.cursor ?? createKnowledgeProvenanceCursorCodec(process.env);
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.get(
    '/knowledge/conversations',
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
              items: { type: 'array', items: conversationResponseRef },
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
              kind: 'conversations',
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
        (page: KnowledgePage<KnowledgeConversation>) => ({
          items: page.items.map(conversationResponse),
          nextCursor: page.nextBoundary
            ? cursor.encodePage({
                kind: 'conversations',
                actor,
                boundary: page.nextBoundary,
              })
            : null,
        }),
      );
    },
  );

  app.post(
    '/knowledge/conversations',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields([
        'title',
        'sourceType',
        'capturedAt',
      ]),
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeProvenanceLimits.title,
            },
            sourceType: { type: 'string', enum: ['manual'], default: 'manual' },
            capturedAt: nullableDateTimeSchema,
          },
        },
        response: {
          201: conversationResponseRef,
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
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (value) => conversationResponse(value as KnowledgeConversation),
        201,
      );
    },
  );

  app.get(
    '/knowledge/conversations/:conversationId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        response: {
          200: conversationResponseRef,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        conversationId: (request.params as { conversationId: string })
          .conversationId,
      });
      return sendKnowledgeProvenanceResult(reply, result, conversationResponse);
    },
  );

  app.post(
    '/knowledge/conversations/:conversationId/items',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields([
        'itemId',
        'relationType',
        'ordinal',
        'expectedVersion',
      ]),
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId', 'relationType', 'ordinal', 'expectedVersion'],
          properties: {
            itemId: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeProvenanceLimits.id,
            },
            relationType: {
              type: 'string',
              enum: knowledgeConversationItemRelationTypes,
            },
            ordinal: {
              type: 'integer',
              minimum: 0,
              maximum: knowledgeProvenanceLimits.conversationItems - 1,
            },
            expectedVersion: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.expectedVersion,
            },
          },
        },
        response: {
          200: conversationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.addItem({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        conversationId: (request.params as { conversationId: string })
          .conversationId,
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) =>
        conversationResponse(value as KnowledgeConversation),
      );
    },
  );

  app.delete(
    '/knowledge/conversations/:conversationId/items/:itemId',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields(['expectedVersion']),
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion'],
          properties: {
            expectedVersion: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.expectedVersion,
            },
          },
        },
        response: {
          200: conversationResponseRef,
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as {
        conversationId: string;
        itemId: string;
      };
      const result = await service.removeItem({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        ...params,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      return sendKnowledgeProvenanceResult(reply, result, (value) =>
        conversationResponse(value as KnowledgeConversation),
      );
    },
  );

  app.get(
    '/knowledge/conversations/:conversationId/turns',
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
              items: { type: 'array', items: turnResponseRef },
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
      const conversationId = (request.params as { conversationId: string })
        .conversationId;
      const query = request.query as { limit?: number; cursor?: string };
      let boundary;
      try {
        boundary = query.cursor
          ? cursor.decodeSequence({
              cursor: query.cursor,
              kind: 'conversation_turns',
              parentId: conversationId,
              actor,
            })
          : undefined;
      } catch (error) {
        if (error instanceof KnowledgeProvenanceCursorError) {
          return sendInvalidCursor(reply);
        }
        throw error;
      }
      const result = await service.listTurns({
        actor,
        conversationId,
        limit: query.limit ?? knowledgeProvenanceLimits.defaultListLimit,
        boundary,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (page: KnowledgeSequencePage<KnowledgeConversationTurn>) => ({
          items: page.items.map(conversationTurnResponse),
          nextCursor: page.nextBoundary
            ? cursor.encodeSequence({
                kind: 'conversation_turns',
                parentId: conversationId,
                actor,
                boundary: page.nextBoundary,
              })
            : null,
        }),
      );
    },
  );

  app.post(
    '/knowledge/conversations/:conversationId/turns',
    {
      preHandler,
      preValidation: rejectUnknownKnowledgeBodyFields([
        'expectedVersion',
        'role',
        'origin',
        'content',
        'occurredAt',
      ]),
      schema: {
        tags: ['knowledge'],
        params: idParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion', 'role', 'origin', 'content'],
          properties: {
            expectedVersion: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeProvenanceLimits.expectedVersion,
            },
            role: { type: 'string', enum: knowledgeConversationRoles },
            origin: { type: 'string', enum: knowledgeProvenanceOrigins },
            content: { type: 'string', minLength: 1, maxLength: 65_536 },
            occurredAt: nullableDateTimeSchema,
          },
        },
        response: {
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['conversation', 'turn'],
            properties: {
              conversation: conversationResponseRef,
              turn: turnResponseRef,
            },
          },
          400: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.appendTurn({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        conversationId: (request.params as { conversationId: string })
          .conversationId,
        body: request.body as never,
      });
      return sendKnowledgeProvenanceResult(
        reply,
        result,
        (value) => {
          const typed = value as {
            conversation: KnowledgeConversation;
            turn: KnowledgeConversationTurn;
          };
          return {
            conversation: conversationResponse(typed.conversation),
            turn: conversationTurnResponse(typed.turn),
          };
        },
        201,
      );
    },
  );
}
