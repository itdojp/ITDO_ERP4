import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createKnowledgeItemService,
  type KnowledgeApplicationResult,
  type KnowledgeItemService,
} from '../application/knowledge/knowledgeItemUseCases.js';
import {
  knowledgeDeletionReasonCodes,
  knowledgeItemInputLimits,
  knowledgeItemScopes,
  knowledgeItemStatuses,
  knowledgeSourceTypes,
  type KnowledgeActor,
  type KnowledgeAuditActorContext,
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
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeItemInputLimits.itemId,
    },
  },
} as const;

const commonMutableProperties = {
  sourceType: { type: 'string', enum: knowledgeSourceTypes },
  canonicalUrl: {
    anyOf: [
      {
        type: 'string',
        maxLength: knowledgeItemInputLimits.canonicalUrl,
        format: 'uri',
      },
      { type: 'null' },
    ],
  },
  title: {
    anyOf: [
      { type: 'string', maxLength: knowledgeItemInputLimits.title },
      { type: 'null' },
    ],
  },
  sourceAuthor: {
    anyOf: [
      { type: 'string', maxLength: knowledgeItemInputLimits.sourceAuthor },
      { type: 'null' },
    ],
  },
  publishedAt: nullableDateTime,
  capturedAt: { type: 'string', format: 'date-time' },
  saveReason: {
    anyOf: [
      { type: 'string', maxLength: knowledgeItemInputLimits.saveReason },
      { type: 'null' },
    ],
  },
  shortNote: {
    anyOf: [
      { type: 'string', maxLength: knowledgeItemInputLimits.shortNote },
      { type: 'null' },
    ],
  },
  unresolvedQuestion: {
    anyOf: [
      {
        type: 'string',
        maxLength: knowledgeItemInputLimits.unresolvedQuestion,
      },
      { type: 'null' },
    ],
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
      maxItems: knowledgeItemInputLimits.organizationGroupIds,
      uniqueItems: true,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: knowledgeItemInputLimits.organizationGroupId,
      },
    },
    ...commonMutableProperties,
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: {
    expectedVersion: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeItemInputLimits.expectedVersion,
    },
    ...commonMutableProperties,
  },
} as const;

const versionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: {
    expectedVersion: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeItemInputLimits.expectedVersion,
    },
  },
} as const;

const deleteBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'reasonCode'],
  properties: {
    expectedVersion: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeItemInputLimits.expectedVersion,
    },
    reasonCode: { type: 'string', enum: knowledgeDeletionReasonCodes },
  },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeItemInputLimits.listLimit,
      default: 50,
    },
    offset: {
      type: 'integer',
      minimum: 0,
      maximum: knowledgeItemInputLimits.listOffset,
      default: 0,
    },
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
  const userId = knowledgeActorUserId(request);
  const orgId = request.user?.orgId;
  const groupAccountIds = request.user?.groupAccountIds;
  return {
    userId: typeof userId === 'string' ? userId.trim() : '',
    organizationId:
      typeof orgId === 'string' ? orgId.trim() || undefined : undefined,
    groupAccountIds: [
      ...new Set(
        (Array.isArray(groupAccountIds) ? groupAccountIds : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
  };
}

function knowledgeActorUserId(request: FastifyRequest) {
  const auth = request.user?.auth;
  const hasCanonicalIdentity =
    typeof auth?.identityId === 'string' && auth.identityId.trim().length > 0;
  const candidate =
    auth?.providerType === 'header'
      ? request.user?.userId
      : hasCanonicalIdentity
        ? auth?.userAccountId
        : undefined;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

async function requireCanonicalKnowledgeActor(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (knowledgeActorUserId(request)) return;
  return reply.code(403).send(
    createApiErrorResponse('forbidden', 'Forbidden', {
      category: 'permission',
      details: { reason: 'canonical_account_required' },
    }),
  );
}

function auditActorFromRequest(
  request: FastifyRequest,
): KnowledgeAuditActorContext {
  const context = auditContextFromRequest(request);
  return {
    requestId: context.requestId,
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

function rejectUnknownBodyFields(
  allowedFields: readonly string[],
  options: { rejectScopeMutation?: boolean } = {},
) {
  const allowed = new Set(allowedFields);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body =
      request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
    if (
      options.rejectScopeMutation &&
      ('scope' in body || 'organizationGroupIds' in body)
    ) {
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
    if (Object.keys(body).some((field) => !allowed.has(field))) {
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

const rejectUnknownCreateBodyFields = rejectUnknownBodyFields(
  Object.keys(createBodySchema.properties),
);
const rejectUnknownUpdateBodyFields = rejectUnknownBodyFields(
  Object.keys(updateBodySchema.properties),
  { rejectScopeMutation: true },
);
const rejectUnknownDeleteBodyFields = rejectUnknownBodyFields(
  Object.keys(deleteBodySchema.properties),
);
const rejectUnknownRestoreBodyFields = rejectUnknownBodyFields(
  Object.keys(versionBodySchema.properties),
);

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
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/knowledge/items',
    {
      preHandler,
      preValidation: rejectUnknownCreateBodyFields,
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
      preValidation: rejectUnknownUpdateBodyFields,
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
      preValidation: rejectUnknownDeleteBodyFields,
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
      preValidation: rejectUnknownRestoreBodyFields,
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
