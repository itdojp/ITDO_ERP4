import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createKnowledgeItemService,
  type KnowledgeApplicationResult,
  type KnowledgeItemService,
} from '../application/knowledge/knowledgeItemUseCases.js';
import {
  knowledgeDeletionReasonCodes,
  knowledgeItemScopes,
  knowledgeItemStatuses,
  knowledgeSourceTypes,
  type KnowledgeActor,
  type KnowledgeAuditActor,
  type KnowledgeItem,
} from '../application/knowledge/knowledgeItemPorts.js';
import {
  prismaKnowledgeItemRepository,
  prismaKnowledgeUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeItemAdapter.js';
import { auditContextFromRequest } from '../services/audit.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;
const nullableDateTime = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;
const nullableDeletionReasonCode = {
  anyOf: [
    { type: 'string', enum: knowledgeDeletionReasonCodes },
    { type: 'null' },
  ],
} as const;

const knowledgeItemResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'ownerUserId',
    'scope',
    'organizationId',
    'sourceType',
    'canonicalUrl',
    'title',
    'sourceAuthor',
    'publishedAt',
    'capturedAt',
    'saveReason',
    'shortNote',
    'unresolvedQuestion',
    'status',
    'version',
    'deletedAt',
    'deletedReason',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
  ],
  properties: {
    id: { type: 'string' },
    ownerUserId: { type: 'string' },
    scope: { type: 'string', enum: knowledgeItemScopes },
    organizationId: nullableString,
    sourceType: { type: 'string', enum: knowledgeSourceTypes },
    canonicalUrl: nullableString,
    title: nullableString,
    sourceAuthor: nullableString,
    publishedAt: nullableDateTime,
    capturedAt: { type: 'string', format: 'date-time' },
    saveReason: nullableString,
    shortNote: nullableString,
    unresolvedQuestion: nullableString,
    status: { type: 'string', enum: knowledgeItemStatuses },
    version: { type: 'integer', minimum: 1 },
    deletedAt: nullableDateTime,
    deletedReason: nullableDeletionReasonCode,
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: nullableString,
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: nullableString,
  },
} as const;

const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: true,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        category: { type: 'string' },
      },
    },
  },
} as const;

const roleProtectedErrorResponses = {
  403: errorResponseSchema,
} as const;

const itemIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

const commonMutableProperties = {
  sourceType: { type: 'string', enum: knowledgeSourceTypes },
  canonicalUrl: {
    anyOf: [
      { type: 'string', maxLength: 4096, format: 'uri' },
      { type: 'null' },
    ],
  },
  title: {
    anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
  },
  sourceAuthor: {
    anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
  },
  publishedAt: nullableDateTime,
  capturedAt: { type: 'string', format: 'date-time' },
  saveReason: {
    anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'null' }],
  },
  shortNote: {
    anyOf: [{ type: 'string', maxLength: 10000 }, { type: 'null' }],
  },
  unresolvedQuestion: {
    anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'null' }],
  },
  status: { type: 'string', enum: knowledgeItemStatuses },
} as const;

const createBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'sourceType'],
  properties: {
    scope: { type: 'string', enum: knowledgeItemScopes },
    organizationGroupIds: {
      type: 'array',
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
    ...commonMutableProperties,
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    ...commonMutableProperties,
  },
} as const;

const versionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: { expectedVersion: { type: 'integer', minimum: 1 } },
} as const;

const deleteBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'reasonCode'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    reasonCode: { type: 'string', enum: knowledgeDeletionReasonCodes },
  },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
    scope: { type: 'string', enum: knowledgeItemScopes },
    status: { type: 'string', enum: knowledgeItemStatuses },
  },
} as const;

function toResponse(item: KnowledgeItem) {
  return {
    ...item,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    capturedAt: item.capturedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function actorFromRequest(request: FastifyRequest): KnowledgeActor {
  const userId = request.user?.userId;
  return {
    userId: typeof userId === 'string' ? userId.trim() : '',
    organizationId: request.user?.orgId?.trim() || undefined,
    groupAccountIds: [
      ...new Set(
        (request.user?.groupAccountIds ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
  };
}

function auditActorFromRequest(request: FastifyRequest): KnowledgeAuditActor {
  const context = auditContextFromRequest(request);
  return {
    userId: context.userId,
    principalUserId: context.principalUserId,
    actorUserId: context.actorUserId,
    authScopes: context.authScopes,
    actorRole: context.actorRole,
    actorGroupId: context.actorGroupId,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    source: context.source,
  };
}

function sendResult(
  reply: FastifyReply,
  result: KnowledgeApplicationResult<KnowledgeItem>,
  successStatus = 200,
) {
  if (result.ok) {
    return reply.code(successStatus).send(toResponse(result.value));
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

async function rejectScopeMutation(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body =
    request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : {};
  if ('scope' in body || 'organizationGroupIds' in body) {
    return reply
      .code(400)
      .send(
        createApiErrorResponse(
          'invalid_request',
          'scope and organization grants require a dedicated share workflow',
          { category: 'validation' },
        ),
      );
  }
}

export async function registerKnowledgeItemRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeItemService } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeItemService({
      reader: prismaKnowledgeItemRepository,
      unitOfWork: prismaKnowledgeUnitOfWork,
    });
  const preHandler = requireRole(allowedRoles);

  app.post(
    '/knowledge/items',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        body: createBodySchema,
        response: {
          ...roleProtectedErrorResponses,
          201: knowledgeItemResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.create({
        actor: actorFromRequest(request),
        auditActor: auditActorFromRequest(request),
        body: request.body as never,
      });
      return sendResult(reply, result, 201);
    },
  );

  app.get(
    '/knowledge/items',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        querystring: listQuerySchema,
        response: {
          ...roleProtectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: knowledgeItemResponseSchema },
            },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        limit?: number;
        offset?: number;
        scope?: (typeof knowledgeItemScopes)[number];
        status?: (typeof knowledgeItemStatuses)[number];
      };
      const items = await service.list({
        actor: actorFromRequest(request),
        query: {
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          scope: query.scope,
          status: query.status,
        },
      });
      return { items: items.map(toResponse) };
    },
  );

  app.get(
    '/knowledge/items/count',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', enum: knowledgeItemScopes },
            status: { type: 'string', enum: knowledgeItemStatuses },
          },
        },
        response: {
          ...roleProtectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['count'],
            properties: { count: { type: 'integer', minimum: 0 } },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        scope?: (typeof knowledgeItemScopes)[number];
        status?: (typeof knowledgeItemStatuses)[number];
      };
      return {
        count: await service.count({
          actor: actorFromRequest(request),
          scope: query.scope,
          status: query.status,
        }),
      };
    },
  );

  app.get(
    '/knowledge/items/:id',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemIdParamsSchema,
        response: {
          ...roleProtectedErrorResponses,
          200: knowledgeItemResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: actorFromRequest(request),
        itemId: (request.params as { id: string }).id,
      });
      return sendResult(reply, result);
    },
  );

  app.patch(
    '/knowledge/items/:id',
    {
      preHandler,
      preValidation: rejectScopeMutation,
      schema: {
        tags: ['knowledge'],
        params: itemIdParamsSchema,
        body: updateBodySchema,
        response: {
          ...roleProtectedErrorResponses,
          200: knowledgeItemResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.update({
        actor: actorFromRequest(request),
        auditActor: auditActorFromRequest(request),
        itemId: (request.params as { id: string }).id,
        body: request.body as never,
      });
      return sendResult(reply, result);
    },
  );

  app.delete(
    '/knowledge/items/:id',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemIdParamsSchema,
        body: deleteBodySchema,
        response: {
          ...roleProtectedErrorResponses,
          200: knowledgeItemResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        expectedVersion: number;
        reasonCode: string;
      };
      const result = await service.remove({
        actor: actorFromRequest(request),
        auditActor: auditActorFromRequest(request),
        itemId: (request.params as { id: string }).id,
        expectedVersion: body.expectedVersion,
        reasonCode: body.reasonCode,
      });
      return sendResult(reply, result);
    },
  );

  app.post(
    '/knowledge/items/:id/restore',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemIdParamsSchema,
        body: versionBodySchema,
        response: {
          ...roleProtectedErrorResponses,
          200: knowledgeItemResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.restore({
        actor: actorFromRequest(request),
        auditActor: auditActorFromRequest(request),
        itemId: (request.params as { id: string }).id,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      return sendResult(reply, result);
    },
  );
}
