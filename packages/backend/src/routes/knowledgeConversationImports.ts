import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  createKnowledgeConversationImportUseCases,
  type KnowledgeConversationImportUseCaseResult,
} from '../application/knowledge/knowledgeConversationImportUseCases.js';
import { knowledgeConversationImportLimits } from '../application/knowledge/knowledgeConversationImportPorts.js';
import {
  knowledgeConversationRoles,
  knowledgeProvenanceOrigins,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import { prismaKnowledgeConversationImportUnitOfWork } from '../adapters/knowledge/prismaKnowledgeConversationImportAdapter.js';
import { createApiErrorResponse } from '../services/errors.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import { knowledgeProvenanceErrorResponseSchema } from './knowledgeProvenanceSchemas.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;
const encodedInputMaximum = Math.ceil(
  (knowledgeConversationImportLimits.rawBytes * 4) / 3,
);
const nullableProviderSchema = {
  type: ['string', 'null'],
  enum: ['openai', 'anthropic', 'google', 'microsoft', 'other', null],
} as const;
const nullableModelSchema = {
  type: ['string', 'null'],
  enum: ['gpt', 'claude', 'gemini', 'copilot', 'other', null],
} as const;

const linkedItemsSchema = {
  type: 'array',
  maxItems: knowledgeConversationImportLimits.linkedItems,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId', 'relationType'],
    properties: {
      itemId: { type: 'string', minLength: 1, maxLength: 100 },
      relationType: {
        type: 'string',
        enum: ['primary', 'supporting', 'contradicting', 'context'],
      },
    },
  },
} as const;

function importBodySchema(commit: boolean) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'format',
      'inputBase64',
      'linkedItems',
      ...(commit ? ['previewToken', 'requestKey'] : []),
    ],
    properties: {
      format: {
        type: 'string',
        enum: ['manual', 'json', 'markdown'],
      },
      inputBase64: {
        type: 'string',
        minLength: 1,
        maxLength: encodedInputMaximum,
        pattern: '^[A-Za-z0-9_-]+$',
        description:
          'Canonical unpadded base64url. Manual and JSON decode to the strict structured conversation model; Markdown uses the versioned role-block grammar.',
      },
      linkedItems: linkedItemsSchema,
      ...(commit
        ? {
            previewToken: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeConversationImportLimits.previewTokenBytes,
            },
            requestKey: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeConversationImportLimits.requestKeyCodePoints,
              description:
                'Opaque high-entropy client operation key. The raw value is not persisted.',
            },
          }
        : {}),
    },
  } as const;
}

const previewBodySchema = {
  ...importBodySchema(false),
  description:
    'Strict bounded import envelope. Validation is application-owned so rejected input is included in the mandatory audit transaction without storing its content.',
} as const;

const commitBodySchema = {
  ...importBodySchema(true),
  description:
    'Strict bounded import envelope plus actor-bound preview token and opaque request key.',
} as const;

// Fastify's default Ajv configuration removes additional properties before a
// handler runs. Import rejection is a mandatory audited application decision,
// so this route deliberately preserves the parsed JSON value and delegates the
// exact schema, byte, vocabulary, and prototype-key checks to the bounded
// parser/use case. The schemas above remain the generated OpenAPI contract.
const preserveImportBodyForApplicationValidation = () => (value: unknown) => ({
  value,
});

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'format',
    'title',
    'provider',
    'model',
    'roles',
    'origins',
    'turnCount',
    'linkedItemCount',
  ],
  properties: {
    format: { type: 'string', enum: ['manual', 'json', 'markdown'] },
    title: { type: 'string' },
    provider: nullableProviderSchema,
    model: nullableModelSchema,
    roles: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', enum: knowledgeConversationRoles },
    },
    origins: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', enum: knowledgeProvenanceOrigins },
    },
    turnCount: { type: 'integer', minimum: 1 },
    linkedItemCount: { type: 'integer', minimum: 0 },
  },
} as const;

const previewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'warnings',
    'rejectedFields',
    'previewToken',
    'expiresAt',
  ],
  properties: {
    summary: summarySchema,
    warnings: { type: 'array', maxItems: 0, items: { type: 'string' } },
    rejectedFields: { type: 'array', maxItems: 0, items: { type: 'string' } },
    previewToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

const commitResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'conversationId',
    'created',
    'reused',
    'turnCount',
    'linkedItemCount',
    'result',
  ],
  properties: {
    conversationId: { type: 'string' },
    created: { type: 'boolean' },
    reused: { type: 'boolean' },
    turnCount: { type: 'integer', minimum: 1 },
    linkedItemCount: { type: 'integer', minimum: 0 },
    result: { type: 'string', enum: ['created', 'reused'] },
  },
} as const;

type ImportService = ReturnType<
  typeof createKnowledgeConversationImportUseCases
>;

function sendResult(
  reply: FastifyReply,
  result: KnowledgeConversationImportUseCaseResult<unknown>,
  mapSuccess: (value: unknown) => unknown,
) {
  if (!result.ok) {
    return reply.code(result.statusCode).send(
      createApiErrorResponse(result.code, result.message, {
        category:
          result.statusCode === 404
            ? 'not_found'
            : result.statusCode === 409
              ? 'conflict'
              : 'validation',
      }),
    );
  }
  return reply.code(200).send(mapSuccess(result.value));
}

export async function registerKnowledgeConversationImportRoutes(
  app: FastifyInstance,
  dependencies: { service?: ImportService } = {},
) {
  const importRateLimit = getRouteRateLimitOptions(
    'RATE_LIMIT_KNOWLEDGE_IMPORT',
    { max: 20, timeWindow: '1 minute' },
  );
  const service =
    dependencies.service ??
    createKnowledgeConversationImportUseCases({
      unitOfWork: prismaKnowledgeConversationImportUnitOfWork,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/knowledge/conversations/import/preview',
    {
      preHandler,
      validatorCompiler: preserveImportBodyForApplicationValidation,
      config: { rateLimit: importRateLimit },
      bodyLimit: 1024 * 1024,
      schema: {
        tags: ['knowledge'],
        body: previewBodySchema,
        response: {
          200: previewResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.preview({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        body: request.body,
      });
      return sendResult(reply, result, (value) => value);
    },
  );

  app.post(
    '/knowledge/conversations/import/commit',
    {
      preHandler,
      validatorCompiler: preserveImportBodyForApplicationValidation,
      config: { rateLimit: importRateLimit },
      bodyLimit: 1024 * 1024,
      schema: {
        tags: ['knowledge'],
        body: commitBodySchema,
        response: {
          200: commitResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.commit({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        body: request.body,
      });
      return sendResult(reply, result, (value) => {
        const typed = value as {
          conversationId: string;
          created: boolean;
          reused: boolean;
          turnCount: number;
          linkedItemCount: number;
        };
        return {
          ...typed,
          result: typed.created ? 'created' : 'reused',
        };
      });
    },
  );
}
