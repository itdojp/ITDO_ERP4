import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  prismaKnowledgeSavedViewRepository,
  prismaKnowledgeSavedViewUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeSavedViewAdapter.js';
import { prismaKnowledgeSearchRepository } from '../adapters/knowledge/prismaKnowledgeSearchAdapter.js';
import { createKnowledgeCursorCodec } from '../application/knowledge/knowledgeCursor.js';
import {
  knowledgeSavedViewLimits,
  type KnowledgeSavedView,
} from '../application/knowledge/knowledgeSavedViewPorts.js';
import {
  createKnowledgeSavedViewService,
  type KnowledgeSavedViewApplicationResult,
  type KnowledgeSavedViewService,
} from '../application/knowledge/knowledgeSavedViewUseCases.js';
import {
  knowledgeSearchFacetKinds,
  knowledgeSearchLimits,
} from '../application/knowledge/knowledgeSearchPorts.js';
import { createKnowledgeSearchService } from '../application/knowledge/knowledgeSearchUseCases.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import {
  knowledgeSearchFilterSchema,
  knowledgeSearchResponseSchema,
} from './knowledgeSearch.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

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

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeSavedViewLimits.id,
} as const;
const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: idSchema },
} as const;
const versionSchema = {
  type: 'integer',
  minimum: 1,
  maximum: knowledgeSavedViewLimits.expectedVersion,
} as const;

const canonicalLabelRootSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'includeDescendants'],
  properties: {
    id: { type: 'string' },
    includeDescendants: { type: 'boolean' },
  },
} as const;

const savedViewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'ownerUserId',
    'name',
    'filter',
    'schemaVersion',
    'version',
    'deletedAt',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
  ],
  properties: {
    id: { type: 'string' },
    ownerUserId: { type: 'string' },
    name: { type: 'string' },
    filter: {
      type: 'object',
      additionalProperties: false,
      required: ['labels'],
      properties: {
        labels: {
          type: 'object',
          additionalProperties: false,
          required: ['any', 'all', 'not'],
          properties: {
            any: { type: 'array', items: canonicalLabelRootSchema },
            all: { type: 'array', items: canonicalLabelRootSchema },
            not: { type: 'array', items: canonicalLabelRootSchema },
          },
        },
        sourceType: { type: 'string' },
        status: { type: 'string' },
        scope: { type: 'string' },
        publishedFrom: { type: 'string', format: 'date-time' },
        publishedTo: { type: 'string', format: 'date-time' },
        capturedFrom: { type: 'string', format: 'date-time' },
        capturedTo: { type: 'string', format: 'date-time' },
      },
    },
    schemaVersion: { type: 'integer', minimum: 1 },
    version: { type: 'integer', minimum: 1 },
    deletedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

function toResponse(view: KnowledgeSavedView) {
  return {
    ...view,
    filter: {
      ...view.filter,
      publishedFrom: view.filter.publishedFrom?.toISOString(),
      publishedTo: view.filter.publishedTo?.toISOString(),
      capturedFrom: view.filter.capturedFrom?.toISOString(),
      capturedTo: view.filter.capturedTo?.toISOString(),
    },
    deletedAt: view.deletedAt?.toISOString() ?? null,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

function sendFailure(
  reply: FastifyReply,
  result: Exclude<KnowledgeSavedViewApplicationResult<unknown>, { ok: true }>,
) {
  const category =
    result.statusCode === 404
      ? 'not_found'
      : result.statusCode === 409
        ? 'conflict'
        : 'validation';
  return reply
    .code(result.statusCode)
    .send(createApiErrorResponse(result.code, result.message, { category }));
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

export async function registerKnowledgeSavedViewRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeSavedViewService } = {},
) {
  const searchRateLimit = getRouteRateLimitOptions('RATE_LIMIT_SEARCH', {
    max: 60,
    timeWindow: '1 minute',
  });
  const search = createKnowledgeSearchService({
    repository: prismaKnowledgeSearchRepository,
    cursorCodec: createKnowledgeCursorCodec(),
  });
  const service =
    dependencies.service ??
    createKnowledgeSavedViewService({
      repository: prismaKnowledgeSavedViewRepository,
      unitOfWork: prismaKnowledgeSavedViewUnitOfWork,
      search,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.get(
    '/knowledge/saved-views',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeSavedViewLimits.list,
              default: 50,
            },
            offset: {
              type: 'integer',
              minimum: 0,
              maximum: knowledgeSavedViewLimits.offset,
              default: 0,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: savedViewResponseSchema },
            },
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query as { limit?: number; offset?: number };
      const result = await service.list({
        actor: knowledgeActorFromRequest(request),
        query: { limit: query.limit ?? 50, offset: query.offset ?? 0 },
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({ items: result.value.map(toResponse) });
    },
  );

  app.post(
    '/knowledge/saved-views',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(['name', 'filter']),
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'filter'],
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeSavedViewLimits.name,
            },
            filter: knowledgeSearchFilterSchema,
          },
        },
        response: {
          201: savedViewResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { name: string; filter: never };
      const result = await service.create({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        name: body.name,
        filter: body.filter,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(toResponse(result.value));
    },
  );

  app.get(
    '/knowledge/saved-views/recovery',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        description:
          'List owner-only metadata required to replace or delete saved views whose filters are no longer visible. Filter contents are never returned.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeSavedViewLimits.list,
              default: 50,
            },
            offset: {
              type: 'integer',
              minimum: 0,
              maximum: knowledgeSavedViewLimits.offset,
              default: 0,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'name', 'version', 'updatedAt'],
                  properties: {
                    id: idSchema,
                    name: { type: 'string' },
                    version: versionSchema,
                    updatedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query as { limit?: number; offset?: number };
      const result = await service.listRecoveryMetadata({
        actor: knowledgeActorFromRequest(request),
        query: { limit: query.limit ?? 50, offset: query.offset ?? 0 },
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        items: result.value.map((view) => ({
          ...view,
          updatedAt: view.updatedAt.toISOString(),
        })),
      });
    },
  );

  app.get(
    '/knowledge/saved-views/:id',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: paramsSchema,
        response: {
          200: savedViewResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        savedViewId: (request.params as { id: string }).id,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(toResponse(result.value));
    },
  );

  app.put(
    '/knowledge/saved-views/:id',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields([
        'expectedVersion',
        'name',
        'filter',
      ]),
      schema: {
        tags: ['knowledge'],
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion', 'name', 'filter'],
          properties: {
            expectedVersion: versionSchema,
            name: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeSavedViewLimits.name,
            },
            filter: knowledgeSearchFilterSchema,
          },
        },
        response: {
          200: savedViewResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        expectedVersion: number;
        name: string;
        filter: never;
      };
      const result = await service.update({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        savedViewId: (request.params as { id: string }).id,
        expectedVersion: body.expectedVersion,
        name: body.name,
        filter: body.filter,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(toResponse(result.value));
    },
  );

  app.delete(
    '/knowledge/saved-views/:id',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(['expectedVersion']),
      schema: {
        tags: ['knowledge'],
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion'],
          properties: { expectedVersion: versionSchema },
        },
        response: {
          204: { type: 'null' },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.remove({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        savedViewId: (request.params as { id: string }).id,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(204).send();
    },
  );

  app.post(
    '/knowledge/saved-views/:id/execute',
    {
      preHandler,
      config: { rateLimit: searchRateLimit },
      preValidation: rejectUnknownBodyFields(['facets', 'limit', 'cursor']),
      schema: {
        tags: ['knowledge'],
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
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
        },
        response: {
          200: knowledgeSearchResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        facets?: (typeof knowledgeSearchFacetKinds)[number][];
        limit?: number;
        cursor?: string;
      };
      const result = await service.execute({
        actor: knowledgeActorFromRequest(request),
        savedViewId: (request.params as { id: string }).id,
        facets: body.facets,
        limit: body.limit,
        cursor: body.cursor,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        ...result.value,
        items: result.value.items.map((item) => ({
          ...item,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          capturedAt: item.capturedAt.toISOString(),
          deletedAt: item.deletedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
      });
    },
  );
}
