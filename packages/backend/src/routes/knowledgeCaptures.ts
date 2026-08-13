import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  createKnowledgeArtifactPort,
  resolveKnowledgeSnapshotProvider,
} from '../adapters/knowledge/knowledgeArtifactStorageAdapter.js';
import {
  prismaKnowledgeCaptureRepository,
  prismaKnowledgeCaptureUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeCaptureAdapter.js';
import {
  decodeKnowledgeCaptureJson,
  knowledgeCaptureChannels,
  knowledgeCaptureFieldNames,
  knowledgeCaptureLimits,
} from '../application/knowledge/knowledgeCaptureDraft.js';
import {
  knowledgeCaptureStatuses,
  type KnowledgeCaptureStatus,
} from '../application/knowledge/knowledgeCapturePorts.js';
import {
  createKnowledgeCaptureService,
  type KnowledgeCaptureFailure,
} from '../application/knowledge/knowledgeCaptureUseCases.js';
import {
  knowledgeItemScopes,
  knowledgeSourceTypes,
} from '../application/knowledge/knowledgeItemPorts.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import { enforceAuthCsrf } from './auth/http.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user'] as const;
// Permit bounded JSON-escape overhead while retaining a fixed pre-parse
// transport limit. The service independently enforces the canonical 128 KiB
// draft limit; an excessively escaped representation is still rejected here.
const bodyLimit = knowledgeCaptureLimits.httpEnvelopeBytes;
const requestKeySchema = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeCaptureLimits.requestKeyCodePoints,
  pattern: '^[A-Za-z0-9._-]+$',
} as const;

const errorSchema = {
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

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const draftSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['schemaVersion', 'channel', 'capturedAt'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    channel: { type: 'string', enum: knowledgeCaptureChannels },
    title: nullableString,
    url: nullableString,
    selectedText: nullableString,
    description: nullableString,
    author: nullableString,
    publishedAt: nullableString,
    capturedAt: { type: 'string' },
  },
} as const;

const normalizedDraftSchema = {
  ...draftSchema,
  additionalProperties: false,
} as const;

const requestProperties = {
  draft: draftSchema,
  selectedFields: {
    type: 'array',
    minItems: 1,
    maxItems: knowledgeCaptureFieldNames.length,
    uniqueItems: true,
    items: { type: 'string', enum: knowledgeCaptureFieldNames },
  },
  scope: { type: 'string', enum: knowledgeItemScopes },
  organizationGroupAccountIds: {
    type: 'array',
    maxItems: 100,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 100 },
  },
  sourceType: { type: 'string', enum: knowledgeSourceTypes },
} as const;

const captureResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'captureId',
    'requestCaptureId',
    'itemId',
    'snapshotId',
    'status',
    'failureCode',
    'reused',
    'createdAt',
    'committedAt',
    'failedAt',
  ],
  properties: {
    captureId: { type: 'string' },
    requestCaptureId: { type: 'string' },
    itemId: { type: 'string' },
    snapshotId: { type: 'string' },
    status: { type: 'string', enum: knowledgeCaptureStatuses },
    failureCode: nullableString,
    reused: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    committedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    failedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
  },
} as const;

const previewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'captureId',
    'normalizedDraft',
    'selectedFields',
    'omittedFields',
    'scope',
    'sourceType',
    'fieldCount',
    'byteCount',
    'duplicateCandidate',
    'requiresOrganizationConfirmation',
    'previewToken',
    'expiresAt',
  ],
  properties: {
    captureId: { type: 'string' },
    normalizedDraft: normalizedDraftSchema,
    selectedFields: requestProperties.selectedFields,
    omittedFields: {
      ...requestProperties.selectedFields,
      minItems: 0,
    },
    scope: requestProperties.scope,
    sourceType: requestProperties.sourceType,
    fieldCount: { type: 'integer', minimum: 1, maximum: 6 },
    byteCount: {
      type: 'integer',
      minimum: 1,
      maximum: knowledgeCaptureLimits.totalBytes,
    },
    duplicateCandidate: {
      type: 'object',
      additionalProperties: false,
      required: ['detected', 'status'],
      properties: {
        detected: { type: 'boolean' },
        status: {
          anyOf: [
            { type: 'string', enum: knowledgeCaptureStatuses },
            { type: 'null' },
          ],
        },
      },
    },
    requiresOrganizationConfirmation: { type: 'boolean' },
    previewToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

async function csrfGuard(request: FastifyRequest, reply: FastifyReply) {
  return enforceAuthCsrf(request, reply);
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

const previewFields = [
  'draft',
  'selectedFields',
  'scope',
  'organizationGroupAccountIds',
  'sourceType',
  'requestKey',
] as const;
const commitFields = [
  ...previewFields,
  'confirmed',
  'organizationConfirmed',
  'previewToken',
] as const;
const reconcileFields = [...previewFields, 'previewToken'] as const;

function sendFailure(reply: FastifyReply, result: KnowledgeCaptureFailure) {
  const category =
    result.statusCode === 403
      ? 'permission'
      : result.statusCode === 404
        ? 'not_found'
        : result.statusCode === 409
          ? 'conflict'
          : result.statusCode === 502
            ? 'external'
            : 'validation';
  return reply
    .code(result.statusCode)
    .send(createApiErrorResponse(result.code, result.message, { category }));
}

function serialize(value: {
  captureId: string;
  requestCaptureId: string;
  itemId: string;
  snapshotId: string;
  status: KnowledgeCaptureStatus;
  failureCode: string | null;
  reused: boolean;
  createdAt: Date;
  committedAt: Date | null;
  failedAt: Date | null;
}) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    committedAt: value.committedAt?.toISOString() ?? null,
    failedAt: value.failedAt?.toISOString() ?? null,
  };
}

export type KnowledgeCaptureService = ReturnType<
  typeof createKnowledgeCaptureService
>;

async function registerKnowledgeCaptureRouteHandlers(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeCaptureService } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeCaptureService({
      artifacts: createKnowledgeArtifactPort({
        provider: resolveKnowledgeSnapshotProvider(),
      }),
      reader: prismaKnowledgeCaptureRepository,
      unitOfWork: prismaKnowledgeCaptureUnitOfWork,
    });
  const readHandlers = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];
  const mutationHandlers = [...readHandlers, csrfGuard];

  app.post(
    '/knowledge/captures/preview',
    {
      bodyLimit,
      preHandler: mutationHandlers,
      preValidation: rejectUnknownBodyFields(previewFields),
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'draft',
            'selectedFields',
            'scope',
            'organizationGroupAccountIds',
            'requestKey',
          ],
          properties: {
            ...requestProperties,
            requestKey: requestKeySchema,
          },
        },
        response: {
          200: previewSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.preview({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        request: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send({
        ...result.value,
        expiresAt: result.value.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    '/knowledge/captures',
    {
      bodyLimit,
      preHandler: mutationHandlers,
      preValidation: rejectUnknownBodyFields(commitFields),
      schema: {
        tags: ['knowledge'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'draft',
            'selectedFields',
            'scope',
            'organizationGroupAccountIds',
            'confirmed',
            'organizationConfirmed',
            'previewToken',
            'requestKey',
          ],
          properties: {
            ...requestProperties,
            confirmed: { type: 'boolean' },
            organizationConfirmed: { type: 'boolean' },
            previewToken: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeCaptureLimits.previewTokenBytes,
            },
            requestKey: requestKeySchema,
          },
        },
        response: {
          200: captureResultSchema,
          201: captureResultSchema,
          202: captureResultSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.commit({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        request: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply
        .code(
          result.value.status === 'pending'
            ? 202
            : result.value.reused
              ? 200
              : 201,
        )
        .send(serialize(result.value));
    },
  );

  app.get(
    '/knowledge/captures/:captureId',
    {
      preHandler: readHandlers,
      schema: {
        tags: ['knowledge'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['captureId'],
          properties: {
            captureId: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        response: {
          200: captureResultSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        captureId: (request.params as { captureId: string }).captureId,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(serialize(result.value));
    },
  );

  app.post(
    '/knowledge/captures/:captureId/reconcile',
    {
      bodyLimit,
      preHandler: mutationHandlers,
      preValidation: rejectUnknownBodyFields(reconcileFields),
      schema: {
        tags: ['knowledge'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['captureId'],
          properties: {
            captureId: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'draft',
            'selectedFields',
            'scope',
            'organizationGroupAccountIds',
            'sourceType',
            'previewToken',
            'requestKey',
          ],
          properties: {
            ...requestProperties,
            previewToken: {
              type: 'string',
              minLength: 1,
              maxLength: knowledgeCaptureLimits.previewTokenBytes,
            },
            requestKey: requestKeySchema,
          },
        },
        response: {
          200: captureResultSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.reconcile({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        captureId: (request.params as { captureId: string }).captureId,
        request: request.body as never,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply.send(serialize(result.value));
    },
  );
}

export async function registerKnowledgeCaptureRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeCaptureService } = {},
) {
  await app.register(async (captureScope) => {
    // Fastify's default JSON parser decodes malformed UTF-8 with replacement
    // characters. Capture input is an external trust boundary, so replace it
    // only inside this encapsulated route scope with a fatal UTF-8 parser.
    captureScope.removeContentTypeParser('application/json');
    captureScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        try {
          done(null, decodeKnowledgeCaptureJson(body as Buffer));
        } catch {
          const error = Object.assign(
            new Error('Capture JSON payload is invalid'),
            { statusCode: 400 },
          );
          done(error);
        }
      },
    );
    await registerKnowledgeCaptureRouteHandlers(captureScope, dependencies);
  });
}
