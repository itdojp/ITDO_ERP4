import type { FastifyInstance, FastifyReply } from 'fastify';

import { StubExternalLlmTextAdapter } from '../adapters/externalLlm/stubTextAdapter.js';
import { PrismaKnowledgeLlmBudgetAdapter } from '../adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js';
import { prismaKnowledgeLlmRunAdapter } from '../adapters/knowledge/prismaKnowledgeLlmRunAdapter.js';
import {
  getKnowledgeLlmRuntimeConfig,
  knowledgeLlmLimits,
} from '../application/knowledge/knowledgeLlmConfig.js';
import {
  createKnowledgeLlmRunService,
  KnowledgeLlmRunError,
  type KnowledgeLlmRunRequest,
  type KnowledgeLlmRunService,
} from '../application/knowledge/knowledgeLlmRunUseCases.js';
import { prisma } from '../services/db.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import {
  knowledgeProvenanceErrorResponseSchema,
  rejectUnknownKnowledgeArrayObjectFields,
  rejectUnknownKnowledgeBodyFields,
} from './knowledgeProvenanceSchemas.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;
const sourceTypeValues = [
  'snapshot',
  'annotation_revision',
  'conversation_turn',
  'synthesis_version',
  'thread_promotion_message',
] as const;
const failureCodeValues = [
  'disabled',
  'rejected_before_dispatch',
  'provider_4xx',
  'provider_5xx',
  'malformed_response',
  'response_oversize',
  'empty_result',
  'timeout_outcome_unknown',
  'connection_outcome_unknown',
  'usage_missing',
  'usage_invalid',
  'finalization_failed',
  'budget_hard_limit',
  'rate_limit',
] as const;

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;
const nullableCostSchema = {
  anyOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'null' }],
} as const;

const scopeProperties = {
  scope: { type: 'string', enum: ['personal', 'organization'] },
  organizationId: nullableStringSchema,
} as const;

const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceType', 'sourceId'],
  properties: {
    sourceType: { type: 'string', enum: sourceTypeValues },
    sourceId: { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;

const requestProperties = {
  ...scopeProperties,
  provider: { type: 'string', enum: ['stub', 'openai'] },
  model: { type: 'string', minLength: 1, maxLength: 200 },
  catalogVersion: { type: 'integer', minimum: 1 },
  userPrompt: {
    type: 'string',
    minLength: 1,
    maxLength: knowledgeLlmLimits.userPromptBytes,
    description: 'Maximum 16,384 UTF-8 bytes; the server enforces byte length.',
  },
  maxOutputTokens: {
    type: 'integer',
    minimum: 1,
    maximum: knowledgeLlmLimits.maximumOutputTokens,
  },
  sources: {
    type: 'array',
    minItems: 1,
    maxItems: knowledgeLlmLimits.totalSources,
    items: sourceSchema,
  },
} as const;

const requestRequired = [
  'scope',
  'organizationId',
  'provider',
  'model',
  'catalogVersion',
  'userPrompt',
  'maxOutputTokens',
  'sources',
] as const;

const budgetSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'configured',
    'policyCount',
    'currency',
    'softLimitWarning',
    'hardLimitBlocked',
    'rateBlocked',
    'subjects',
  ],
  properties: {
    configured: { type: 'boolean' },
    policyCount: { type: 'integer', minimum: 0, maximum: 2 },
    currency: nullableStringSchema,
    softLimitWarning: { type: 'boolean' },
    hardLimitBlocked: { type: 'boolean' },
    rateBlocked: { type: 'boolean' },
    subjects: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'subjectType',
          'softLimitMicros',
          'hardLimitMicros',
          'activeReservedMicros',
          'settledActualMicros',
          'heldMaximumMicros',
          'requestsPerHour',
          'acceptedRequestsLastHour',
        ],
        properties: {
          subjectType: { type: 'string', enum: ['user', 'organization'] },
          softLimitMicros: { type: 'string', pattern: '^[0-9]+$' },
          hardLimitMicros: { type: 'string', pattern: '^[0-9]+$' },
          activeReservedMicros: { type: 'string', pattern: '^[0-9]+$' },
          settledActualMicros: { type: 'string', pattern: '^[0-9]+$' },
          heldMaximumMicros: { type: 'string', pattern: '^[0-9]+$' },
          requestsPerHour: { type: 'integer', minimum: 1 },
          acceptedRequestsLastHour: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

const runResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'provider',
    'model',
    'catalogVersion',
    'promptTemplateVersion',
    'scope',
    'estimatedInputTokens',
    'maxOutputTokens',
    'maximumCostMicros',
    'actualInputTokens',
    'actualOutputTokens',
    'actualCostMicros',
    'currency',
    'softLimitWarning',
    'executionStatus',
    'settlementStatus',
    'failureCode',
    'result',
    'conversationId',
    'createdAt',
    'dispatchedAt',
    'completedAt',
  ],
  properties: {
    id: { type: 'string' },
    provider: { type: 'string', enum: ['stub', 'openai'] },
    model: { type: 'string' },
    catalogVersion: { type: 'integer', minimum: 1 },
    promptTemplateVersion: { type: 'integer', minimum: 1 },
    scope: { type: 'string', enum: ['personal', 'organization'] },
    estimatedInputTokens: { type: 'integer', minimum: 1 },
    maxOutputTokens: { type: 'integer', minimum: 1 },
    maximumCostMicros: { type: 'string', pattern: '^[0-9]+$' },
    actualInputTokens: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
    actualOutputTokens: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
    actualCostMicros: nullableCostSchema,
    currency: { type: 'string' },
    softLimitWarning: { type: 'boolean' },
    executionStatus: {
      type: 'string',
      enum: [
        'reserved',
        'dispatched',
        'result_ready',
        'failed',
        'result_unknown',
      ],
    },
    settlementStatus: {
      type: 'string',
      enum: ['reserved', 'settled_actual', 'released', 'held_maximum'],
    },
    failureCode: {
      anyOf: [{ type: 'string', enum: failureCodeValues }, { type: 'null' }],
    },
    result: nullableStringSchema,
    conversationId: nullableStringSchema,
    createdAt: { type: 'string', format: 'date-time' },
    dispatchedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    completedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
  },
} as const;

function requestBody(body: unknown): KnowledgeLlmRunRequest {
  return body as KnowledgeLlmRunRequest;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof KnowledgeLlmRunError)) throw error;
  return reply.code(error.status).send(
    createApiErrorResponse(error.code, error.message, {
      category:
        error.status === 404
          ? 'not_found'
          : error.status === 429
            ? 'rate_limit'
            : error.status === 503
              ? 'external'
              : 'validation',
    }),
  );
}

export async function registerKnowledgeLlmRunRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeLlmRunService } = {},
) {
  const runtime = dependencies.service ? null : getKnowledgeLlmRuntimeConfig();
  const service =
    dependencies.service ??
    createKnowledgeLlmRunService({
      runtime: runtime!,
      providerPort:
        runtime?.provider === 'stub' ? new StubExternalLlmTextAdapter() : null,
      budgetPort: new PrismaKnowledgeLlmBudgetAdapter(prisma),
      runPort: prismaKnowledgeLlmRunAdapter,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];
  const errorResponses = {
    400: knowledgeProvenanceErrorResponseSchema,
    401: knowledgeProvenanceErrorResponseSchema,
    403: knowledgeProvenanceErrorResponseSchema,
    404: knowledgeProvenanceErrorResponseSchema,
    409: knowledgeProvenanceErrorResponseSchema,
    429: knowledgeProvenanceErrorResponseSchema,
    503: knowledgeProvenanceErrorResponseSchema,
  } as const;

  app.get(
    '/knowledge/llm/catalog',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        response: {
          ...errorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['enabled', 'provider', 'version', 'models'],
            properties: {
              enabled: { type: 'boolean' },
              provider: nullableStringSchema,
              version: {
                anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
              },
              models: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'provider',
                    'model',
                    'maxInputTokens',
                    'maxOutputTokens',
                    'inputCostMicrosPerMillion',
                    'outputCostMicrosPerMillion',
                    'currency',
                  ],
                  properties: {
                    provider: { type: 'string', enum: ['stub', 'openai'] },
                    model: { type: 'string' },
                    maxInputTokens: { type: 'integer', minimum: 1 },
                    maxOutputTokens: { type: 'integer', minimum: 1 },
                    inputCostMicrosPerMillion: {
                      type: 'string',
                      pattern: '^[0-9]+$',
                    },
                    outputCostMicrosPerMillion: {
                      type: 'string',
                      pattern: '^[0-9]+$',
                    },
                    currency: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => service.catalog(),
  );

  app.get(
    '/knowledge/llm/budget',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['scope'],
          properties: scopeProperties,
        },
        response: { ...errorResponses, 200: budgetSchema },
      },
    },
    async (request, reply) => {
      const actor = knowledgeActorFromRequest(request);
      const query = request.query as {
        scope: 'personal' | 'organization';
        organizationId?: string | null;
      };
      try {
        return await service.budget({
          actor,
          scope: query.scope,
          organizationId: query.organizationId ?? null,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post(
    '/knowledge/llm/runs/preview',
    {
      preHandler,
      preValidation: [
        rejectUnknownKnowledgeBodyFields(requestRequired),
        rejectUnknownKnowledgeArrayObjectFields('sources', [
          'sourceType',
          'sourceId',
        ]),
      ],
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: requestRequired,
          properties: requestProperties,
        },
        response: {
          ...errorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'runId',
              'provider',
              'model',
              'catalogVersion',
              'promptTemplateVersion',
              'scope',
              'selectedSources',
              'sourceCounts',
              'selectedItemCount',
              'selectedSourceCount',
              'totalContextBytes',
              'estimatedInputTokens',
              'maxOutputTokens',
              'maximumCostMicros',
              'currency',
              'budget',
              'expiresAt',
              'previewToken',
            ],
            properties: {
              runId: { type: 'string' },
              provider: { type: 'string', enum: ['stub', 'openai'] },
              model: { type: 'string' },
              catalogVersion: { type: 'integer', minimum: 1 },
              promptTemplateVersion: { type: 'integer', minimum: 1 },
              scope: { type: 'string', enum: ['personal', 'organization'] },
              selectedSources: {
                type: 'array',
                minItems: 1,
                maxItems: knowledgeLlmLimits.totalSources,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'ordinal',
                    'sourceType',
                    'exactSourceVersion',
                    'exactSourceHash',
                    'byteLength',
                    'content',
                  ],
                  properties: {
                    ordinal: { type: 'integer', minimum: 0 },
                    sourceType: { type: 'string', enum: sourceTypeValues },
                    exactSourceVersion: { type: 'integer', minimum: 1 },
                    exactSourceHash: {
                      type: 'string',
                      pattern: '^[0-9a-f]{64}$',
                    },
                    byteLength: {
                      type: 'integer',
                      minimum: 1,
                      maximum: knowledgeLlmLimits.sourceBytes,
                    },
                    content: {
                      type: 'string',
                      minLength: 1,
                      maxLength: knowledgeLlmLimits.sourceBytes,
                      description:
                        'Exact authorized preview; the server enforces the UTF-8 byte limit.',
                    },
                  },
                },
              },
              sourceCounts: {
                type: 'object',
                additionalProperties: false,
                required: sourceTypeValues,
                properties: Object.fromEntries(
                  sourceTypeValues.map((type) => [
                    type,
                    { type: 'integer', minimum: 0 },
                  ]),
                ),
              },
              selectedItemCount: { type: 'integer', minimum: 0 },
              selectedSourceCount: { type: 'integer', minimum: 1 },
              totalContextBytes: { type: 'integer', minimum: 1 },
              estimatedInputTokens: { type: 'integer', minimum: 1 },
              maxOutputTokens: { type: 'integer', minimum: 1 },
              maximumCostMicros: { type: 'string', pattern: '^[0-9]+$' },
              currency: { type: 'string' },
              budget: budgetSchema,
              expiresAt: { type: 'string', format: 'date-time' },
              previewToken: {
                type: 'string',
                maxLength: knowledgeLlmLimits.previewTokenBytes,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.preview({
          actor: knowledgeActorFromRequest(request),
          auditActor: knowledgeAuditActorFromRequest(request),
          request: requestBody(request.body),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post(
    '/knowledge/llm/runs',
    {
      preHandler,
      preValidation: [
        rejectUnknownKnowledgeBodyFields([
          ...requestRequired,
          'previewToken',
          'requestKey',
          'confirmed',
        ]),
        rejectUnknownKnowledgeArrayObjectFields('sources', [
          'sourceType',
          'sourceId',
        ]),
      ],
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            ...requestRequired,
            'previewToken',
            'requestKey',
            'confirmed',
          ],
          properties: {
            ...requestProperties,
            previewToken: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeLlmLimits.previewTokenBytes,
            },
            requestKey: { type: 'string', minLength: 1, maxLength: 200 },
            confirmed: { type: 'boolean' },
          },
        },
        response: {
          ...errorResponses,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['created', 'reused', 'run'],
            properties: {
              created: { type: 'boolean' },
              reused: { type: 'boolean' },
              run: runResponseSchema,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as KnowledgeLlmRunRequest & {
        previewToken: unknown;
        requestKey: unknown;
        confirmed: unknown;
      };
      try {
        return await service.execute({
          actor: knowledgeActorFromRequest(request),
          auditActor: knowledgeAuditActorFromRequest(request),
          request: body,
          previewToken: body.previewToken,
          requestKey: body.requestKey,
          confirmed: body.confirmed,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  const runParams = {
    type: 'object',
    additionalProperties: false,
    required: ['runId'],
    properties: { runId: { type: 'string', minLength: 1, maxLength: 255 } },
  } as const;

  app.get(
    '/knowledge/llm/runs/:runId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: runParams,
        response: { ...errorResponses, 200: runResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await service.detail({
          actor: knowledgeActorFromRequest(request),
          runId: (request.params as { runId: string }).runId,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post(
    '/knowledge/llm/runs/:runId/reconcile',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: runParams,
        response: { ...errorResponses, 200: runResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await service.reconcile({
          actor: knowledgeActorFromRequest(request),
          auditActor: knowledgeAuditActorFromRequest(request),
          runId: (request.params as { runId: string }).runId,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
