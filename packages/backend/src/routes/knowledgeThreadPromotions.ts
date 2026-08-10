import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  createKnowledgeThreadPromotionUseCases,
  type KnowledgeThreadPromotionUseCases,
} from '../application/knowledge/knowledgeThreadPromotionUseCases.js';
import {
  knowledgeThreadPromotionAuthorCategories,
  knowledgeThreadPromotionLimits,
} from '../application/knowledge/knowledgeThreadPromotionPorts.js';
import { prismaKnowledgeThreadPromotionAdapter } from '../adapters/knowledge/prismaKnowledgeThreadPromotionAdapter.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import { knowledgeProvenanceErrorResponseSchema } from './knowledgeProvenanceSchemas.js';
import { knowledgeSharePublicCardSchema } from './knowledgeShares.js';
import { knowledgeShareCardResponse } from './knowledgeShares.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

type RouteResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      statusCode: number;
      code: string;
      message: string;
    };

type PromotionPreviewValue = {
  sourceThread: { roomName: string; roomType: string; replyCount: number };
  selectedMessages: Array<{
    ordinal: number;
    content: string;
    createdAt: string;
    authorCategory: string;
  }>;
  selectedMessageCount: number;
  omittedMessageCount: number;
  sharedCard:
    | ({ shareVersion: number } & Parameters<
        typeof knowledgeShareCardResponse
      >[0])
    | null;
  destination: {
    scope: 'personal' | 'organization';
    organizationGroupCount: number;
  };
  synthesis: {
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: string[];
  };
  previewToken: string;
  expiresAt: string;
  requiresConfirmation: true;
  requiresOrganizationAudienceConfirmation: boolean;
};

type PromotionCommitValue = {
  promotionId: string;
  synthesisId: string;
  synthesisVersionId: string;
  synthesisVersion: 1;
  scope: 'personal' | 'organization';
  selectedMessageCount: number;
  includesSharedCard: boolean;
  createdAt: string;
  created: boolean;
  reused: boolean;
};

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeThreadPromotionLimits.id,
} as const;

const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rootMessageId'],
  properties: { rootMessageId: idSchema },
} as const;

const destinationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'organizationGroupAccountIds'],
  properties: {
    scope: { type: 'string', enum: ['personal', 'organization'] },
    organizationGroupAccountIds: {
      type: 'array',
      uniqueItems: true,
      maxItems: knowledgeThreadPromotionLimits.organizationGroupAccountIds,
      items: idSchema,
    },
  },
} as const;

const synthesisSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'content',
    'confidenceBasisPoints',
    'unresolvedQuestions',
  ],
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeThreadPromotionLimits.titleCodePoints,
    },
    content: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeThreadPromotionLimits.synthesisContentBytes,
      description: 'Maximum 262,144 UTF-8 bytes; byte-bound in application.',
    },
    confidenceBasisPoints: {
      anyOf: [
        { type: 'integer', minimum: 0, maximum: 10_000 },
        { type: 'null' },
      ],
    },
    unresolvedQuestions: {
      type: 'array',
      maxItems: knowledgeThreadPromotionLimits.unresolvedQuestions,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: knowledgeThreadPromotionLimits.unresolvedQuestionCodePoints,
      },
    },
  },
} as const;

const requestProperties = {
  selectedReplyMessageIds: {
    type: 'array',
    minItems: 1,
    maxItems: knowledgeThreadPromotionLimits.selectedReplies,
    uniqueItems: true,
    items: idSchema,
  },
  includeSharedCard: { type: 'boolean' },
  destination: destinationSchema,
  synthesis: synthesisSchema,
} as const;

const previewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(requestProperties),
  properties: requestProperties,
} as const;

const commitBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...Object.keys(requestProperties),
    'previewToken',
    'requestKey',
    'confirmed',
    'organizationAudienceConfirmed',
  ],
  properties: {
    ...requestProperties,
    previewToken: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeThreadPromotionLimits.previewTokenBytes,
    },
    requestKey: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeThreadPromotionLimits.requestKey,
    },
    confirmed: { const: true },
    organizationAudienceConfirmed: { type: 'boolean' },
  },
} as const;

const promotionShareCardSchema = {
  ...knowledgeSharePublicCardSchema,
  required: [...knowledgeSharePublicCardSchema.required, 'shareVersion'],
  properties: {
    ...knowledgeSharePublicCardSchema.properties,
    shareVersion: { type: 'integer', minimum: 1 },
  },
} as const;

const previewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceThread',
    'selectedMessages',
    'selectedMessageCount',
    'omittedMessageCount',
    'sharedCard',
    'destination',
    'synthesis',
    'previewToken',
    'expiresAt',
    'requiresConfirmation',
    'requiresOrganizationAudienceConfirmation',
  ],
  properties: {
    sourceThread: {
      type: 'object',
      additionalProperties: false,
      required: ['roomName', 'roomType', 'replyCount'],
      properties: {
        roomName: { type: 'string' },
        roomType: { type: 'string' },
        replyCount: { type: 'integer', minimum: 0 },
      },
    },
    selectedMessages: {
      type: 'array',
      minItems: 1,
      maxItems: knowledgeThreadPromotionLimits.selectedReplies,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ordinal', 'content', 'createdAt', 'authorCategory'],
        properties: {
          ordinal: { type: 'integer', minimum: 0 },
          content: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          authorCategory: {
            type: 'string',
            enum: knowledgeThreadPromotionAuthorCategories,
          },
        },
      },
    },
    selectedMessageCount: { type: 'integer', minimum: 1, maximum: 100 },
    omittedMessageCount: { type: 'integer', minimum: 0 },
    sharedCard: {
      anyOf: [promotionShareCardSchema, { type: 'null' }],
    },
    destination: {
      type: 'object',
      additionalProperties: false,
      required: ['scope', 'organizationGroupCount'],
      properties: {
        scope: { type: 'string', enum: ['personal', 'organization'] },
        organizationGroupCount: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    synthesis: synthesisSchema,
    previewToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    requiresConfirmation: { const: true },
    requiresOrganizationAudienceConfirmation: { type: 'boolean' },
  },
} as const;

const commitResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'promotionId',
    'synthesisId',
    'synthesisVersionId',
    'synthesisVersion',
    'scope',
    'selectedMessageCount',
    'includesSharedCard',
    'createdAt',
    'created',
    'reused',
  ],
  properties: {
    promotionId: { type: 'string' },
    synthesisId: { type: 'string' },
    synthesisVersionId: { type: 'string' },
    synthesisVersion: { type: 'integer', enum: [1] },
    scope: { type: 'string', enum: ['personal', 'organization'] },
    selectedMessageCount: { type: 'integer', minimum: 1, maximum: 100 },
    includesSharedCard: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    created: { type: 'boolean' },
    reused: { type: 'boolean' },
  },
} as const;

function rejectUnsupportedFields(
  allowedFields: readonly string[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  const allowed = new Set(allowedFields);
  return async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key))
    ) {
      return reply.code(400).send(
        createApiErrorResponse('invalid_request', 'Invalid request', {
          category: 'validation',
        }),
      );
    }
  };
}

function sendResult<T>(
  reply: FastifyReply,
  result: RouteResult<T>,
  mapper: (value: T) => unknown,
  createdStatus = false,
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
  const status =
    createdStatus && (result.value as { created?: boolean }).created === true
      ? 201
      : 200;
  return reply.code(status).send(mapper(result.value));
}

export function knowledgeThreadPromotionPreviewResponse(
  value: PromotionPreviewValue,
) {
  return {
    sourceThread: {
      roomName: value.sourceThread.roomName,
      roomType: value.sourceThread.roomType,
      replyCount: value.sourceThread.replyCount,
    },
    selectedMessages: value.selectedMessages.map((message) => ({
      ordinal: message.ordinal,
      content: message.content,
      createdAt: message.createdAt,
      authorCategory: message.authorCategory,
    })),
    selectedMessageCount: value.selectedMessageCount,
    omittedMessageCount: value.omittedMessageCount,
    sharedCard:
      value.sharedCard === null
        ? null
        : {
            ...knowledgeShareCardResponse(value.sharedCard),
            shareVersion: value.sharedCard.shareVersion,
          },
    destination: {
      scope: value.destination.scope,
      organizationGroupCount: value.destination.organizationGroupCount,
    },
    synthesis: {
      title: value.synthesis.title,
      content: value.synthesis.content,
      confidenceBasisPoints: value.synthesis.confidenceBasisPoints,
      unresolvedQuestions: [...value.synthesis.unresolvedQuestions],
    },
    previewToken: value.previewToken,
    expiresAt: value.expiresAt,
    requiresConfirmation: value.requiresConfirmation === true,
    requiresOrganizationAudienceConfirmation:
      value.requiresOrganizationAudienceConfirmation === true,
  };
}

export function knowledgeThreadPromotionCommitResponse(
  value: PromotionCommitValue,
) {
  return {
    promotionId: value.promotionId,
    synthesisId: value.synthesisId,
    synthesisVersionId: value.synthesisVersionId,
    synthesisVersion: 1 as const,
    scope: value.scope,
    selectedMessageCount: value.selectedMessageCount,
    includesSharedCard: value.includesSharedCard,
    createdAt: value.createdAt,
    created: value.created === true,
    reused: value.reused === true,
  };
}

export async function registerKnowledgeThreadPromotionRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeThreadPromotionUseCases } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeThreadPromotionUseCases({
      store: prismaKnowledgeThreadPromotionAdapter,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/chat-messages/:rootMessageId/promote-to-knowledge/preview',
    {
      preHandler,
      preValidation: rejectUnsupportedFields(Object.keys(requestProperties)),
      schema: {
        tags: ['chat', 'knowledge'],
        params: paramsSchema,
        body: previewBodySchema,
        response: {
          200: previewResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.preview({
        actor: knowledgeActorFromRequest(request, { includeChat: true }),
        auditActor: knowledgeAuditActorFromRequest(request),
        rootMessageId: (request.params as { rootMessageId: string })
          .rootMessageId,
        body: request.body,
      })) as RouteResult<PromotionPreviewValue>;
      return sendResult(reply, result, knowledgeThreadPromotionPreviewResponse);
    },
  );

  app.post(
    '/chat-messages/:rootMessageId/promote-to-knowledge',
    {
      preHandler,
      preValidation: rejectUnsupportedFields([
        ...Object.keys(requestProperties),
        'previewToken',
        'requestKey',
        'confirmed',
        'organizationAudienceConfirmed',
      ]),
      schema: {
        tags: ['chat', 'knowledge'],
        params: paramsSchema,
        body: commitBodySchema,
        response: {
          200: commitResponseSchema,
          201: commitResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.commit({
        actor: knowledgeActorFromRequest(request, { includeChat: true }),
        auditActor: knowledgeAuditActorFromRequest(request),
        rootMessageId: (request.params as { rootMessageId: string })
          .rootMessageId,
        body: request.body,
      })) as RouteResult<PromotionCommitValue>;
      return sendResult(
        reply,
        result,
        knowledgeThreadPromotionCommitResponse,
        true,
      );
    },
  );
}
