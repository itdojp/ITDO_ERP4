import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  createKnowledgeShareUseCases,
  type KnowledgeShareUseCases,
} from '../application/knowledge/knowledgeShareUseCases.js';
import { knowledgeSourceTypes } from '../application/knowledge/knowledgeItemPorts.js';
import {
  knowledgeAnnotationKinds,
  knowledgeConversationRoles,
  knowledgeProvenanceOrigins,
} from '../application/knowledge/knowledgeProvenancePorts.js';
import {
  knowledgeShareFailureCodes,
  knowledgeShareLimits,
  knowledgeShareSelectionCategories,
  knowledgeShareStatuses,
  type KnowledgeShareChatActor,
} from '../application/knowledge/knowledgeSharePorts.js';
import { prismaKnowledgeShareAdapter } from '../adapters/knowledge/prismaKnowledgeShareAdapter.js';
import { safeCanonicalUrl } from '../adapters/knowledge/knowledgeShareSanitizers.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';
import { knowledgeProvenanceErrorResponseSchema } from './knowledgeProvenanceSchemas.js';
import { CHAT_ROLES } from './chat/shared/constants.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;

type RouteFailure =
  | {
      ok: false;
      statusCode: number;
      code: string;
      message: string;
    }
  | {
      ok: false;
      error: { status: number; code: string; message: string };
    };

type RouteResult<T> =
  { ok: true; value: T; statusCode?: number } | RouteFailure;

type KnowledgeSharePreviewValue = {
  destinationRoom: { name: string; type: string };
  card: KnowledgeSharePublicCard;
  previewToken: string;
  expiresAt: Date | string;
  requiresConfirmation: boolean;
};

type KnowledgeShareRouteService = KnowledgeShareUseCases;

type KnowledgeSharePublicCard = {
  schemaVersion: 1;
  title?: string;
  sourceType?: (typeof knowledgeSourceTypes)[number];
  canonicalUrl?: string;
  snapshot?: { version?: number; excerpt?: string; sha256?: string };
  sharerNote?: string;
  labels: Array<{ displayName: string; ordinal?: number }>;
  annotations: Array<{
    revision: number;
    kind: (typeof knowledgeAnnotationKinds)[number];
    origin: (typeof knowledgeProvenanceOrigins)[number];
    content: string;
    ordinal?: number;
  }>;
  turns: Array<{
    role: (typeof knowledgeConversationRoles)[number];
    origin: (typeof knowledgeProvenanceOrigins)[number];
    content: string;
    name: string | null;
    occurredAt: Date | string | null;
    ordinal?: number;
  }>;
  syntheses: Array<{
    version: number;
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: string[];
    ordinal?: number;
  }>;
  selectedCategories: Array<(typeof knowledgeShareSelectionCategories)[number]>;
  omittedCategories: Array<(typeof knowledgeShareSelectionCategories)[number]>;
};

type KnowledgeSharePublicStatus = {
  shareId: string;
  status: (typeof knowledgeShareStatuses)[number];
  version: number;
  chatMessageId: string | null;
  failureCode: (typeof knowledgeShareFailureCodes)[number] | null;
  createdAt: Date | string;
  postedAt: Date | string | null;
  failedAt: Date | string | null;
  revokedAt: Date | string | null;
};

type KnowledgeSharePublicCommit = KnowledgeSharePublicStatus & {
  created: boolean;
  reused: boolean;
  resultUnknown: boolean;
};

type KnowledgeShareRoomCardValue = {
  shareId: string;
  status: 'posted' | 'revoked';
  version: number;
  schemaVersion: 1;
  card: KnowledgeSharePublicCard | null;
  canOpenSource: boolean;
};

type PreviewBody = {
  destinationRoomId: string;
  selection: {
    includeTitle: boolean;
    includeSourceType: boolean;
    includeCanonicalUrl: boolean;
    snapshot: {
      snapshotId: string;
      includeProvenance: boolean;
      includeExcerpt: boolean;
    } | null;
    labelAssignmentIds: string[];
    annotations: Array<{ annotationId: string; revision: number }>;
    conversationTurnIds: string[];
    syntheses: Array<{ synthesisId: string; version: number }>;
    sharerNote: string | null;
  };
};

type CommitBody = PreviewBody & {
  confirmed: true;
  previewToken: string;
  requestKey: string;
};

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeShareLimits.id,
} as const;

const itemParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: { itemId: idSchema },
} as const;

const shareParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['shareId'],
  properties: { shareId: idSchema },
} as const;

const messageParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['messageId'],
  properties: { messageId: idSchema },
} as const;

const selectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'includeTitle',
    'includeSourceType',
    'includeCanonicalUrl',
    'snapshot',
    'labelAssignmentIds',
    'annotations',
    'conversationTurnIds',
    'syntheses',
    'sharerNote',
  ],
  properties: {
    includeTitle: { type: 'boolean' },
    includeSourceType: { type: 'boolean' },
    includeCanonicalUrl: { type: 'boolean' },
    snapshot: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['snapshotId', 'includeProvenance', 'includeExcerpt'],
          properties: {
            snapshotId: idSchema,
            includeProvenance: { type: 'boolean' },
            includeExcerpt: { type: 'boolean' },
          },
        },
      ],
    },
    labelAssignmentIds: {
      type: 'array',
      maxItems: knowledgeShareLimits.labels,
      uniqueItems: true,
      items: idSchema,
    },
    annotations: {
      type: 'array',
      maxItems: knowledgeShareLimits.annotations,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['annotationId', 'revision'],
        properties: {
          annotationId: idSchema,
          revision: { type: 'integer', minimum: 1 },
        },
      },
    },
    conversationTurnIds: {
      type: 'array',
      maxItems: knowledgeShareLimits.turns,
      uniqueItems: true,
      items: idSchema,
    },
    syntheses: {
      type: 'array',
      maxItems: knowledgeShareLimits.syntheses,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['synthesisId', 'version'],
        properties: {
          synthesisId: idSchema,
          version: { type: 'integer', minimum: 1 },
        },
      },
    },
    sharerNote: {
      anyOf: [
        { type: 'null' },
        {
          type: 'string',
          maxLength: knowledgeShareLimits.sharerNoteBytes,
          description:
            'Maximum 4,096 UTF-8 bytes; the application layer enforces the byte limit.',
        },
      ],
    },
  },
} as const;

const previewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['destinationRoomId', 'selection'],
  properties: {
    destinationRoomId: idSchema,
    selection: selectionSchema,
  },
} as const;

const commitBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'destinationRoomId',
    'selection',
    'confirmed',
    'previewToken',
    'requestKey',
  ],
  properties: {
    destinationRoomId: idSchema,
    selection: selectionSchema,
    confirmed: { const: true },
    previewToken: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeShareLimits.previewTokenBytes,
    },
    requestKey: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeShareLimits.requestKey,
      description:
        'Opaque client operation key. The raw value is not persisted or returned.',
    },
  },
} as const;

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const nullableDateTimeSchema = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;

const publicCardSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'title',
    'sourceType',
    'canonicalUrl',
    'snapshot',
    'sharerNote',
    'labels',
    'annotations',
    'turns',
    'syntheses',
    'selectedCategories',
    'omittedCategories',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    title: nullableStringSchema,
    sourceType: {
      anyOf: [{ type: 'string', enum: knowledgeSourceTypes }, { type: 'null' }],
    },
    canonicalUrl: nullableStringSchema,
    snapshot: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          anyOf: [
            { type: 'object', required: ['version', 'sha256'] },
            { type: 'object', required: ['excerpt'] },
          ],
          properties: {
            version: { type: 'integer', minimum: 1 },
            sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            excerpt: { type: 'string' },
          },
        },
      ],
    },
    sharerNote: nullableStringSchema,
    labels: {
      type: 'array',
      maxItems: knowledgeShareLimits.labels,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['displayName'],
        properties: { displayName: { type: 'string' } },
      },
    },
    annotations: {
      type: 'array',
      maxItems: knowledgeShareLimits.annotations,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['revision', 'kind', 'origin', 'content'],
        properties: {
          revision: { type: 'integer', minimum: 1 },
          kind: {
            type: 'string',
            enum: knowledgeAnnotationKinds,
          },
          origin: {
            type: 'string',
            enum: knowledgeProvenanceOrigins,
          },
          content: { type: 'string' },
        },
      },
    },
    turns: {
      type: 'array',
      maxItems: knowledgeShareLimits.turns,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'origin', 'content', 'name', 'occurredAt'],
        properties: {
          role: {
            type: 'string',
            enum: knowledgeConversationRoles,
          },
          origin: {
            type: 'string',
            enum: knowledgeProvenanceOrigins,
          },
          content: { type: 'string' },
          name: nullableStringSchema,
          occurredAt: nullableDateTimeSchema,
        },
      },
    },
    syntheses: {
      type: 'array',
      maxItems: knowledgeShareLimits.syntheses,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'version',
          'title',
          'content',
          'confidenceBasisPoints',
          'unresolvedQuestions',
        ],
        properties: {
          version: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          content: { type: 'string' },
          confidenceBasisPoints: {
            anyOf: [
              { type: 'integer', minimum: 0, maximum: 10_000 },
              { type: 'null' },
            ],
          },
          unresolvedQuestions: {
            type: 'array',
            maxItems: knowledgeShareLimits.unresolvedQuestions,
            items: { type: 'string' },
          },
        },
      },
    },
    selectedCategories: {
      type: 'array',
      uniqueItems: true,
      items: {
        type: 'string',
        enum: knowledgeShareSelectionCategories,
      },
    },
    omittedCategories: {
      type: 'array',
      uniqueItems: true,
      items: {
        type: 'string',
        enum: knowledgeShareSelectionCategories,
      },
    },
  },
} as const;

// Reused by the thread-promotion preview. The promotion route adds only its
// immutable share version discriminator and does not expose source identities.
export const knowledgeSharePublicCardSchema = publicCardSchema;

const previewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'card',
    'destinationRoom',
    'previewToken',
    'expiresAt',
    'requiresConfirmation',
  ],
  properties: {
    card: publicCardSchema,
    destinationRoom: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'type'],
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
      },
    },
    previewToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    requiresConfirmation: { const: true },
  },
} as const;

const statusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'shareId',
    'status',
    'version',
    'chatMessageId',
    'failureCode',
    'createdAt',
    'postedAt',
    'failedAt',
    'revokedAt',
  ],
  properties: {
    shareId: { type: 'string' },
    status: { type: 'string', enum: knowledgeShareStatuses },
    version: { type: 'integer', minimum: 1 },
    chatMessageId: nullableStringSchema,
    failureCode: {
      anyOf: [
        { type: 'string', enum: knowledgeShareFailureCodes },
        { type: 'null' },
      ],
    },
    createdAt: { type: 'string', format: 'date-time' },
    postedAt: nullableDateTimeSchema,
    failedAt: nullableDateTimeSchema,
    revokedAt: nullableDateTimeSchema,
  },
} as const;

const commitResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...statusResponseSchema.required,
    'created',
    'reused',
    'resultUnknown',
  ],
  properties: {
    ...statusResponseSchema.properties,
    created: { type: 'boolean' },
    reused: { type: 'boolean' },
    resultUnknown: { type: 'boolean' },
  },
} as const;

const sourceResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['knowledgeItemId'],
  properties: { knowledgeItemId: { type: 'string' } },
} as const;

const roomCardResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'shareId',
    'status',
    'version',
    'schemaVersion',
    'card',
    'canOpenSource',
  ],
  properties: {
    shareId: { type: 'string' },
    status: { type: 'string', enum: ['posted', 'revoked'] },
    version: { type: 'integer', minimum: 1 },
    schemaVersion: { type: 'integer', enum: [1] },
    card: { anyOf: [publicCardSchema, { type: 'null' }] },
    canOpenSource: { type: 'boolean' },
  },
} as const;

function dateTime(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableDateTime(value: Date | string | null) {
  return value === null ? null : dateTime(value);
}

export function knowledgeShareCardResponse(snapshot: KnowledgeSharePublicCard) {
  const canonicalUrl =
    snapshot.canonicalUrl === undefined
      ? undefined
      : safeCanonicalUrl(snapshot.canonicalUrl);
  return {
    schemaVersion: 1 as const,
    title: snapshot.title ?? null,
    sourceType: snapshot.sourceType ?? null,
    canonicalUrl: canonicalUrl ?? null,
    snapshot: snapshot.snapshot
      ? {
          ...(snapshot.snapshot.version === undefined
            ? {}
            : { version: snapshot.snapshot.version }),
          ...(snapshot.snapshot.sha256 === undefined
            ? {}
            : { sha256: snapshot.snapshot.sha256 }),
          ...(snapshot.snapshot.excerpt === undefined
            ? {}
            : { excerpt: snapshot.snapshot.excerpt }),
        }
      : null,
    sharerNote: snapshot.sharerNote ?? null,
    labels: snapshot.labels.map((label) => ({
      displayName: label.displayName,
    })),
    annotations: snapshot.annotations.map((annotation) => ({
      revision: annotation.revision,
      kind: annotation.kind,
      origin: annotation.origin,
      content: annotation.content,
    })),
    turns: snapshot.turns.map((turn) => ({
      role: turn.role,
      origin: turn.origin,
      content: turn.content,
      name: turn.name,
      occurredAt:
        turn.occurredAt instanceof Date
          ? turn.occurredAt.toISOString()
          : (turn.occurredAt ?? null),
    })),
    syntheses: snapshot.syntheses.map((synthesis) => ({
      version: synthesis.version,
      title: synthesis.title,
      content: synthesis.content,
      confidenceBasisPoints: synthesis.confidenceBasisPoints,
      unresolvedQuestions: [...synthesis.unresolvedQuestions],
    })),
    selectedCategories: [...snapshot.selectedCategories],
    omittedCategories: [...snapshot.omittedCategories],
  };
}

export function knowledgeSharePreviewResponse(
  value: KnowledgeSharePreviewValue,
) {
  return {
    card: knowledgeShareCardResponse(value.card),
    destinationRoom: {
      name: value.destinationRoom.name,
      type: value.destinationRoom.type,
    },
    previewToken: value.previewToken,
    expiresAt: dateTime(value.expiresAt),
    requiresConfirmation: value.requiresConfirmation === true,
  };
}

export function knowledgeShareStatusResponse(
  value: KnowledgeSharePublicStatus,
) {
  return {
    shareId: value.shareId,
    status: value.status,
    version: value.version,
    chatMessageId: value.chatMessageId,
    failureCode: value.failureCode,
    createdAt: dateTime(value.createdAt),
    postedAt: nullableDateTime(value.postedAt),
    failedAt: nullableDateTime(value.failedAt),
    revokedAt: nullableDateTime(value.revokedAt),
  };
}

export function knowledgeShareCommitResponse(
  value: KnowledgeSharePublicCommit,
) {
  return {
    ...knowledgeShareStatusResponse(value),
    created: value.created,
    reused: value.reused,
    resultUnknown: value.resultUnknown,
  };
}

export function knowledgeShareRoomCardResponse(
  value: KnowledgeShareRoomCardValue,
) {
  return {
    shareId: value.shareId,
    status: value.status,
    version: value.version,
    schemaVersion: 1 as const,
    card:
      value.status === 'revoked' || value.card === null
        ? null
        : knowledgeShareCardResponse(value.card),
    canOpenSource:
      value.status === 'posted' && value.card !== null
        ? value.canOpenSource === true
        : false,
  };
}

function failureDetails(result: RouteFailure) {
  if ('error' in result) {
    return {
      statusCode: result.error.status,
      code: result.error.code,
      message: result.error.message,
    };
  }
  return result;
}

function sendResult<T>(
  reply: FastifyReply,
  result: RouteResult<T>,
  mapper: (value: T) => unknown,
  defaultStatusCode = 200,
) {
  if (!result.ok) {
    const failure = failureDetails(result);
    return reply.code(failure.statusCode).send(
      createApiErrorResponse(failure.code, failure.message, {
        category:
          failure.statusCode === 404
            ? 'not_found'
            : failure.statusCode === 409
              ? 'conflict'
              : failure.statusCode === 502
                ? 'external'
                : failure.statusCode === 401 || failure.statusCode === 403
                  ? 'permission'
                  : 'validation',
      }),
    );
  }
  return reply
    .code(result.statusCode ?? defaultStatusCode)
    .send(mapper(result.value));
}

export function knowledgeShareChatActorFromRequest(
  request: FastifyRequest,
): KnowledgeShareChatActor {
  const knowledgeActor = knowledgeActorFromRequest(request, {
    includeChat: true,
  });
  return {
    canonicalUserId: knowledgeActor.userId,
    userId: knowledgeActor.chat?.userId ?? '',
    roles: knowledgeActor.chat?.roles ?? [],
    projectIds: knowledgeActor.chat?.projectIds ?? [],
    groupIds: knowledgeActor.chat?.groupIds ?? [],
    groupAccountIds: knowledgeActor.chat?.groupAccountIds ?? [],
  };
}

function rejectUnsupportedFields(
  topLevelFields: readonly string[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  const topLevel = new Set(topLevelFields);
  const selection = new Set([
    'includeTitle',
    'includeSourceType',
    'includeCanonicalUrl',
    'snapshot',
    'labelAssignmentIds',
    'annotations',
    'conversationTurnIds',
    'syntheses',
    'sharerNote',
  ]);
  const snapshot = new Set([
    'snapshotId',
    'includeProvenance',
    'includeExcerpt',
  ]);
  const annotation = new Set(['annotationId', 'revision']);
  const synthesis = new Set(['synthesisId', 'version']);
  const hasUnknown = (value: unknown, allowed: Set<string>) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).some(
      (key) => !allowed.has(key),
    );

  return async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const record = body as Record<string, unknown>;
    const selected = record.selection;
    const selectedRecord =
      selected && typeof selected === 'object' && !Array.isArray(selected)
        ? (selected as Record<string, unknown>)
        : undefined;
    const unsupported =
      hasUnknown(record, topLevel) ||
      hasUnknown(selected, selection) ||
      hasUnknown(selectedRecord?.snapshot, snapshot) ||
      (Array.isArray(selectedRecord?.annotations) &&
        selectedRecord.annotations.some((value) =>
          hasUnknown(value, annotation),
        )) ||
      (Array.isArray(selectedRecord?.syntheses) &&
        selectedRecord.syntheses.some((value) => hasUnknown(value, synthesis)));
    if (!unsupported) return;
    return reply
      .code(400)
      .send(
        createApiErrorResponse(
          'invalid_request',
          'Request contains an unsupported field',
          { category: 'validation' },
        ),
      );
  };
}

function requestActors(request: FastifyRequest) {
  return {
    actor: knowledgeActorFromRequest(request),
    chatActor: knowledgeShareChatActorFromRequest(request),
  };
}

export async function registerKnowledgeShareRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeShareRouteService } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeShareUseCases({
      store: prismaKnowledgeShareAdapter,
      chatIntegration: prismaKnowledgeShareAdapter,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];
  const chatViewerPreHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(CHAT_ROLES),
  ];

  app.post(
    '/knowledge/items/:itemId/shares/preview',
    {
      preHandler,
      preValidation: rejectUnsupportedFields([
        'destinationRoomId',
        'selection',
      ]),
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
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
      const body = request.body as PreviewBody;
      const result = (await service.preview({
        ...requestActors(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        body,
      })) as RouteResult<KnowledgeSharePreviewValue>;
      return sendResult(reply, result, knowledgeSharePreviewResponse);
    },
  );

  app.post(
    '/knowledge/items/:itemId/shares',
    {
      preHandler,
      preValidation: rejectUnsupportedFields([
        'destinationRoomId',
        'selection',
        'confirmed',
        'previewToken',
        'requestKey',
      ]),
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        body: commitBodySchema,
        response: {
          200: commitResponseSchema,
          201: commitResponseSchema,
          202: commitResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
          502: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CommitBody;
      const result = (await service.commit({
        ...requestActors(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        body,
      })) as RouteResult<KnowledgeSharePublicCommit>;
      const successStatus = result.ok
        ? result.value.status === 'pending'
          ? 202
          : result.value.created
            ? 201
            : 200
        : 200;
      return sendResult(
        reply,
        result,
        knowledgeShareCommitResponse,
        successStatus,
      );
    },
  );

  app.get(
    '/knowledge/shares/:shareId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: shareParamsSchema,
        response: {
          200: statusResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.status({
        ...requestActors(request),
        shareId: (request.params as { shareId: string }).shareId,
      })) as RouteResult<KnowledgeSharePublicStatus>;
      return sendResult(reply, result, knowledgeShareStatusResponse);
    },
  );

  app.post(
    '/knowledge/shares/:shareId/reconcile',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: shareParamsSchema,
        response: {
          200: statusResponseSchema,
          202: statusResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.reconcile({
        ...requestActors(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        shareId: (request.params as { shareId: string }).shareId,
      })) as RouteResult<KnowledgeSharePublicStatus>;
      return sendResult(
        reply,
        result,
        knowledgeShareStatusResponse,
        result.ok && result.value.status === 'pending' ? 202 : 200,
      );
    },
  );

  app.post(
    '/knowledge/shares/:shareId/revoke',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: shareParamsSchema,
        response: {
          200: statusResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
          409: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.revoke({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        shareId: (request.params as { shareId: string }).shareId,
      })) as RouteResult<KnowledgeSharePublicStatus>;
      return sendResult(reply, result, knowledgeShareStatusResponse);
    },
  );

  app.get(
    '/chat-messages/:messageId/knowledge-share',
    {
      preHandler: chatViewerPreHandler,
      schema: {
        tags: ['chat', 'knowledge'],
        params: messageParamsSchema,
        response: {
          200: roomCardResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.roomCard({
        ...requestActors(request),
        messageId: (request.params as { messageId: string }).messageId,
      })) as RouteResult<KnowledgeShareRoomCardValue>;
      return sendResult(reply, result, knowledgeShareRoomCardResponse);
    },
  );

  app.get(
    '/knowledge/shares/:shareId/source',
    {
      preHandler: chatViewerPreHandler,
      schema: {
        tags: ['knowledge'],
        params: shareParamsSchema,
        response: {
          200: sourceResponseSchema,
          400: knowledgeProvenanceErrorResponseSchema,
          401: knowledgeProvenanceErrorResponseSchema,
          403: knowledgeProvenanceErrorResponseSchema,
          404: knowledgeProvenanceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = (await service.openSource({
        ...requestActors(request),
        shareId: (request.params as { shareId: string }).shareId,
      })) as RouteResult<{ knowledgeItemId: string }>;
      return sendResult(reply, result, (value) => ({
        knowledgeItemId: value.knowledgeItemId,
      }));
    },
  );
}
