import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prismaKnowledgeSearchRepository } from '../adapters/knowledge/prismaKnowledgeSearchAdapter.js';
import { createKnowledgeCursorCodec } from '../application/knowledge/knowledgeCursor.js';
import {
  createKnowledgeSearchService,
  type KnowledgeSearchApplicationResult,
  type KnowledgeSearchService,
} from '../application/knowledge/knowledgeSearchUseCases.js';
import {
  knowledgeSearchFacetKinds,
  knowledgeSearchLimits,
} from '../application/knowledge/knowledgeSearchPorts.js';
import {
  knowledgeItemScopes,
  knowledgeItemStatuses,
  knowledgeSourceTypes,
  type KnowledgeItem,
} from '../application/knowledge/knowledgeItemPorts.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';
import {
  knowledgeActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;
const nullableDateTime = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
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

const labelReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reference'],
  properties: {
    reference: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeSearchLimits.reference,
    },
    includeDescendants: { type: 'boolean', default: false },
  },
} as const;

export const knowledgeSearchFilterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    labels: {
      type: 'object',
      additionalProperties: false,
      properties: {
        any: {
          type: 'array',
          maxItems: knowledgeSearchLimits.labelReferences,
          items: labelReferenceSchema,
        },
        all: {
          type: 'array',
          maxItems: knowledgeSearchLimits.labelReferences,
          items: labelReferenceSchema,
        },
        not: {
          type: 'array',
          maxItems: knowledgeSearchLimits.labelReferences,
          items: labelReferenceSchema,
        },
      },
    },
    sourceType: { type: 'string', enum: knowledgeSourceTypes },
    status: { type: 'string', enum: knowledgeItemStatuses },
    scope: { type: 'string', enum: knowledgeItemScopes },
    publishedFrom: { type: 'string', format: 'date-time' },
    publishedTo: { type: 'string', format: 'date-time' },
    capturedFrom: { type: 'string', format: 'date-time' },
    capturedTo: { type: 'string', format: 'date-time' },
  },
} as const;

const searchBodySchema = {
  ...knowledgeSearchFilterSchema,
  properties: {
    ...knowledgeSearchFilterSchema.properties,
    facets: {
      type: 'array',
      uniqueItems: true,
      maxItems: knowledgeSearchFacetKinds.length,
      items: { type: 'string', enum: knowledgeSearchFacetKinds },
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeSearchLimits.page,
      default: knowledgeSearchLimits.defaultPage,
    },
    cursor: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeSearchLimits.cursor,
    },
  },
} as const;

const itemResponseSchema = {
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
    deletedReason: nullableString,
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: nullableString,
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: nullableString,
  },
} as const;

const scalarFacetBucketSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'count'],
  properties: {
    value: { type: 'string' },
    count: { type: 'integer', minimum: 0 },
  },
} as const;
const labelFacetBucketSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'displayName', 'slug', 'count'],
  properties: {
    id: { type: 'string' },
    displayName: { type: 'string' },
    slug: { type: 'string' },
    count: { type: 'integer', minimum: 0 },
  },
} as const;

export const knowledgeSearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total', 'facets', 'nextCursor'],
  properties: {
    items: { type: 'array', items: itemResponseSchema },
    total: { type: 'integer', minimum: 0 },
    facets: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sourceType: { type: 'array', items: scalarFacetBucketSchema },
        status: { type: 'array', items: scalarFacetBucketSchema },
        scope: { type: 'array', items: scalarFacetBucketSchema },
        label: { type: 'array', items: labelFacetBucketSchema },
      },
    },
    nextCursor: nullableString,
  },
} as const;

const suggestionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'displayName', 'slug', 'usageCount'],
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          slug: { type: 'string' },
          usageCount: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

function itemResponse(item: KnowledgeItem) {
  return {
    ...item,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    capturedAt: item.capturedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function sendFailure(
  reply: FastifyReply,
  result: Exclude<KnowledgeSearchApplicationResult<unknown>, { ok: true }>,
) {
  return reply.code(result.statusCode).send(
    createApiErrorResponse(result.code, result.message, {
      category: 'validation',
    }),
  );
}

function rejectUnknownBodyFields(allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body =
      request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
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

export async function registerKnowledgeSearchRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeSearchService } = {},
) {
  const searchRateLimit = getRouteRateLimitOptions('RATE_LIMIT_SEARCH', {
    max: 60,
    timeWindow: '1 minute',
  });
  const service =
    dependencies.service ??
    createKnowledgeSearchService({
      repository: prismaKnowledgeSearchRepository,
      cursorCodec: createKnowledgeCursorCodec(),
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/knowledge/search',
    {
      preHandler,
      config: { rateLimit: searchRateLimit },
      preValidation: rejectUnknownBodyFields(
        Object.keys(searchBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        body: searchBodySchema,
        response: {
          200: knowledgeSearchResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.search({
        actor: knowledgeActorFromRequest(request),
        body: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        ...result.value,
        items: result.value.items.map(itemResponse),
      });
    },
  );

  app.post(
    '/knowledge/labels/suggestions',
    {
      preHandler,
      config: { rateLimit: searchRateLimit },
      preValidation: rejectUnknownBodyFields(['query', 'limit']),
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              minLength: knowledgeSearchLimits.suggestionQueryMin,
              maxLength: knowledgeSearchLimits.suggestionQuery,
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeSearchLimits.suggestion,
              default: knowledgeSearchLimits.defaultSuggestion,
            },
          },
        },
        response: {
          200: suggestionResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { query: string; limit?: number };
      const result = await service.suggest({
        actor: knowledgeActorFromRequest(request),
        query: body.query,
        limit: body.limit,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({ items: result.value });
    },
  );
}
