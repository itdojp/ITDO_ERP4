import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createKnowledgeLabelService,
  type KnowledgeLabelApplicationResult,
  type KnowledgeLabelService,
} from '../application/knowledge/knowledgeLabelUseCases.js';
import {
  knowledgeLabelAssignmentSources,
  knowledgeLabelCapabilities,
  knowledgeLabelInputLimits,
  type KnowledgeItemLabelAssignment,
  type KnowledgeLabel,
  type KnowledgeLabelAlias,
  type KnowledgeLabelGroupGrant,
} from '../application/knowledge/knowledgeLabelPorts.js';
import { knowledgeItemScopes } from '../application/knowledge/knowledgeItemPorts.js';
import {
  prismaKnowledgeLabelRepository,
  prismaKnowledgeLabelUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeLabelAdapter.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
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

const protectedErrorResponses = { 403: errorResponseSchema } as const;

const labelResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'ownerUserId',
    'scope',
    'organizationId',
    'displayName',
    'slug',
    'parentId',
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
    scope: { type: 'string', enum: knowledgeItemScopes },
    organizationId: nullableString,
    displayName: { type: 'string' },
    slug: { type: 'string' },
    parentId: nullableString,
    version: { type: 'integer', minimum: 1 },
    deletedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: nullableString,
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: nullableString,
  },
} as const;

const aliasResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'labelId',
    'alias',
    'normalizedAlias',
    'createdAt',
    'createdBy',
  ],
  properties: {
    id: { type: 'string' },
    labelId: { type: 'string' },
    alias: { type: 'string' },
    normalizedAlias: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: nullableString,
  },
} as const;

const grantResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'labelId',
    'groupAccountId',
    'capability',
    'active',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
  ],
  properties: {
    id: { type: 'string' },
    labelId: { type: 'string' },
    groupAccountId: { type: 'string' },
    capability: { type: 'string', enum: knowledgeLabelCapabilities },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: nullableString,
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: nullableString,
  },
} as const;

const assignmentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId',
    'labelId',
    'assignmentSource',
    'assignedBy',
    'confidenceBasisPoints',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    itemId: { type: 'string' },
    labelId: { type: 'string' },
    assignmentSource: {
      type: 'string',
      enum: knowledgeLabelAssignmentSources,
    },
    assignedBy: { type: 'string' },
    confidenceBasisPoints: {
      anyOf: [
        {
          type: 'integer',
          minimum: 0,
          maximum: knowledgeLabelInputLimits.confidenceBasisPoints,
        },
        { type: 'null' },
      ],
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const idProperty = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeLabelInputLimits.labelId,
} as const;

const labelIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: idProperty },
} as const;

const labelAliasParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'aliasId'],
  properties: {
    id: idProperty,
    aliasId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.aliasId,
    },
  },
} as const;

const itemLabelParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'labelId'],
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.itemId,
    },
    labelId: idProperty,
  },
} as const;

const versionProperty = {
  type: 'integer',
  minimum: 1,
  maximum: knowledgeLabelInputLimits.expectedVersion,
} as const;

const grantInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['groupAccountId', 'capability'],
  properties: {
    groupAccountId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.groupAccountId,
    },
    capability: { type: 'string', enum: knowledgeLabelCapabilities },
  },
} as const;

const createBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'displayName', 'slug'],
  properties: {
    scope: { type: 'string', enum: knowledgeItemScopes },
    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.displayName,
    },
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.slug,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    parentId: {
      anyOf: [idProperty, { type: 'null' }],
    },
    groupGrants: {
      type: 'array',
      maxItems: knowledgeLabelInputLimits.groupGrants,
      items: grantInputSchema,
    },
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: {
    expectedVersion: versionProperty,
    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.displayName,
    },
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.slug,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    parentId: { anyOf: [idProperty, { type: 'null' }] },
  },
} as const;

const versionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: { expectedVersion: versionProperty },
} as const;

const aliasBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'alias'],
  properties: {
    expectedVersion: versionProperty,
    alias: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeLabelInputLimits.alias,
    },
  },
} as const;

const replaceGrantsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'groupGrants'],
  properties: {
    expectedVersion: versionProperty,
    groupGrants: {
      type: 'array',
      maxItems: knowledgeLabelInputLimits.groupGrants,
      items: grantInputSchema,
    },
  },
} as const;

const attachBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'labelId'],
  properties: {
    expectedVersion: versionProperty,
    labelId: idProperty,
  },
} as const;

function toLabelResponse(label: KnowledgeLabel) {
  return {
    ...label,
    deletedAt: label.deletedAt?.toISOString() ?? null,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  };
}

function toAliasResponse(alias: KnowledgeLabelAlias) {
  return { ...alias, createdAt: alias.createdAt.toISOString() };
}

function toGrantResponse(grant: KnowledgeLabelGroupGrant) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function toAssignmentResponse(assignment: KnowledgeItemLabelAssignment) {
  return {
    ...assignment,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

function sendFailure(
  reply: FastifyReply,
  failure: Exclude<KnowledgeLabelApplicationResult<unknown>, { ok: true }>,
) {
  const category =
    failure.statusCode === 404
      ? 'not_found'
      : failure.statusCode === 409
        ? 'conflict'
        : 'validation';
  return reply.code(failure.statusCode).send(
    createApiErrorResponse(failure.code, failure.message, {
      category,
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

export async function registerKnowledgeLabelRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeLabelService } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeLabelService({
      reader: prismaKnowledgeLabelRepository,
      unitOfWork: prismaKnowledgeLabelUnitOfWork,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/knowledge/labels',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(createBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        body: createBodySchema,
        response: {
          ...protectedErrorResponses,
          201: labelResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.create({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        body: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send(toLabelResponse(result.value));
    },
  );

  app.get(
    '/knowledge/labels',
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
              maximum: knowledgeLabelInputLimits.listLimit,
              default: 50,
            },
            offset: {
              type: 'integer',
              minimum: 0,
              maximum: knowledgeLabelInputLimits.listOffset,
              default: 0,
            },
            scope: { type: 'string', enum: knowledgeItemScopes },
            parentId: { anyOf: [idProperty, { type: 'null' }] },
          },
        },
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: labelResponseSchema },
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
        parentId?: string | null;
      };
      const items = await service.list({
        actor: knowledgeActorFromRequest(request),
        query: {
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          scope: query.scope,
          parentId: query.parentId,
        },
      });
      return { items: items.map(toLabelResponse) };
    },
  );

  app.get(
    '/knowledge/labels/:id',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        response: {
          ...protectedErrorResponses,
          200: labelResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(toLabelResponse(result.value));
    },
  );

  app.patch(
    '/knowledge/labels/:id',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(updateBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        body: updateBodySchema,
        response: {
          ...protectedErrorResponses,
          200: labelResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.update({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
        body: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(toLabelResponse(result.value));
    },
  );

  app.delete(
    '/knowledge/labels/:id',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(versionBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        body: versionBodySchema,
        response: {
          ...protectedErrorResponses,
          200: labelResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.remove({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(toLabelResponse(result.value));
    },
  );

  app.get(
    '/knowledge/labels/:id/aliases',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: aliasResponseSchema },
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.aliases({
        actor: knowledgeActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
      });
      if (!result.ok) return sendFailure(reply, result);
      return { items: result.value.map(toAliasResponse) };
    },
  );

  app.post(
    '/knowledge/labels/:id/aliases',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(aliasBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        body: aliasBodySchema,
        response: {
          ...protectedErrorResponses,
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['alias', 'labelVersion'],
            properties: {
              alias: aliasResponseSchema,
              labelVersion: { type: 'integer', minimum: 2 },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { expectedVersion: number; alias: string };
      const result = await service.addAlias({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
        expectedVersion: body.expectedVersion,
        alias: body.alias,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send({
        alias: toAliasResponse(result.value.alias),
        labelVersion: result.value.labelVersion,
      });
    },
  );

  app.delete(
    '/knowledge/labels/:id/aliases/:aliasId',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(versionBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: labelAliasParamsSchema,
        body: versionBodySchema,
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['alias', 'labelVersion'],
            properties: {
              alias: aliasResponseSchema,
              labelVersion: { type: 'integer', minimum: 2 },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string; aliasId: string };
      const result = await service.removeAlias({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        labelId: params.id,
        aliasId: params.aliasId,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        alias: toAliasResponse(result.value.alias),
        labelVersion: result.value.labelVersion,
      });
    },
  );

  app.get(
    '/knowledge/labels/:id/group-grants',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: grantResponseSchema },
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.grants({
        actor: knowledgeActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
      });
      if (!result.ok) return sendFailure(reply, result);
      return { items: result.value.map(toGrantResponse) };
    },
  );

  app.put(
    '/knowledge/labels/:id/group-grants',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(replaceGrantsBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: labelIdParamsSchema,
        body: replaceGrantsBodySchema,
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'labelVersion'],
            properties: {
              items: { type: 'array', items: grantResponseSchema },
              labelVersion: { type: 'integer', minimum: 2 },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        expectedVersion: number;
        groupGrants: Array<{
          groupAccountId: string;
          capability: (typeof knowledgeLabelCapabilities)[number];
        }>;
      };
      const result = await service.replaceGrants({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        labelId: (request.params as { id: string }).id,
        expectedVersion: body.expectedVersion,
        groupGrants: body.groupGrants,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        items: result.value.grants.map(toGrantResponse),
        labelVersion: result.value.labelVersion,
      });
    },
  );

  app.post(
    '/knowledge/items/:id/labels',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(attachBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: itemLabelParamsSchema.properties.id },
        },
        body: attachBodySchema,
        response: {
          ...protectedErrorResponses,
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['assignment', 'itemVersion'],
            properties: {
              assignment: assignmentResponseSchema,
              itemVersion: { type: 'integer', minimum: 2 },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.attach({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { id: string }).id,
        body: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.code(201).send({
        assignment: toAssignmentResponse(result.value.assignment),
        itemVersion: result.value.itemVersion,
      });
    },
  );

  app.delete(
    '/knowledge/items/:id/labels/:labelId',
    {
      preHandler,
      preValidation: rejectUnknownBodyFields(
        Object.keys(versionBodySchema.properties),
      ),
      schema: {
        tags: ['knowledge'],
        params: itemLabelParamsSchema,
        body: versionBodySchema,
        response: {
          ...protectedErrorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['assignment', 'itemVersion'],
            properties: {
              assignment: assignmentResponseSchema,
              itemVersion: { type: 'integer', minimum: 2 },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { id: string; labelId: string };
      const result = await service.detach({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: params.id,
        labelId: params.labelId,
        expectedVersion: (request.body as { expectedVersion: number })
          .expectedVersion,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        assignment: toAssignmentResponse(result.value.assignment),
        itemVersion: result.value.itemVersion,
      });
    },
  );
}
