import type { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  createKnowledgeArtifactPort,
  resolveKnowledgeSnapshotProvider,
} from '../adapters/knowledge/knowledgeArtifactStorageAdapter.js';
import {
  prismaKnowledgeSnapshotRepository,
  prismaKnowledgeSnapshotUnitOfWork,
} from '../adapters/knowledge/prismaKnowledgeSnapshotAdapter.js';
import { knowledgeSnapshotContentByteLimit } from '../application/knowledge/knowledgeSnapshotCapture.js';
import {
  createKnowledgeSnapshotService,
  type KnowledgeSnapshotApplicationFailure,
  type KnowledgeSnapshotService,
} from '../application/knowledge/knowledgeSnapshotUseCases.js';
import {
  knowledgeSnapshotCaptureMethods,
  knowledgeSnapshotLimits,
  knowledgeSnapshotStatuses,
  type KnowledgeSnapshot,
} from '../application/knowledge/knowledgeSnapshotPorts.js';
import { createApiErrorResponse } from '../services/errors.js';
import { requireRole } from '../services/rbac.js';
import {
  knowledgeActorFromRequest,
  knowledgeAuditActorFromRequest,
  requireCanonicalKnowledgeActor,
} from './knowledgeRouteContext.js';

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

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;
const nullableDateTime = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;
const nullableInteger = {
  anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
} as const;
const binaryResponseSchema = { type: 'string', format: 'binary' } as const;
const snapshotDownloadResponse = {
  description: 'Authorized immutable Knowledge snapshot download',
  content: {
    'application/octet-stream': { schema: binaryResponseSchema },
    'text/plain': { schema: binaryResponseSchema },
    'application/pdf': { schema: binaryResponseSchema },
    'image/png': { schema: binaryResponseSchema },
    'image/jpeg': { schema: binaryResponseSchema },
    'image/webp': { schema: binaryResponseSchema },
    'image/gif': { schema: binaryResponseSchema },
  },
} as const;

const snapshotSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'knowledgeItemId',
    'version',
    'status',
    'captureMethod',
    'sourceUrl',
    'originalName',
    'contentType',
    'sizeBytes',
    'sha256',
    'failureCode',
    'capturedAt',
    'capturedBy',
    'readyAt',
    'failedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    knowledgeItemId: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: knowledgeSnapshotStatuses },
    captureMethod: {
      type: 'string',
      enum: knowledgeSnapshotCaptureMethods,
    },
    sourceUrl: nullableString,
    originalName: { type: 'string' },
    contentType: nullableString,
    sizeBytes: nullableInteger,
    sha256: nullableString,
    failureCode: nullableString,
    capturedAt: { type: 'string', format: 'date-time' },
    capturedBy: { type: 'string' },
    readyAt: nullableDateTime,
    failedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const snapshotDetailSchema = {
  ...snapshotSummarySchema,
  required: [...snapshotSummarySchema.required, 'extractedText'],
  properties: {
    ...snapshotSummarySchema.properties,
    extractedText: nullableString,
  },
} as const;

const itemSnapshotParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId', 'snapshotId'],
  properties: {
    itemId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeSnapshotLimits.itemId,
    },
    snapshotId: {
      type: 'string',
      minLength: 1,
      maxLength: knowledgeSnapshotLimits.snapshotId,
    },
  },
} as const;

const itemParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: {
    itemId: itemSnapshotParamsSchema.properties.itemId,
  },
} as const;

const requestKeyProperty = {
  type: 'string',
  minLength: 1,
  maxLength: knowledgeSnapshotLimits.requestKey,
} as const;

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

const rejectUnknownCaptureBodyFields = rejectUnknownBodyFields([
  'captureMethod',
  'requestKey',
  'originalName',
  'text',
  'url',
]);
const rejectUnknownReconcileBodyFields = rejectUnknownBodyFields([
  'requestKey',
]);

function summary(snapshot: KnowledgeSnapshot) {
  return {
    id: snapshot.id,
    knowledgeItemId: snapshot.knowledgeItemId,
    version: snapshot.version,
    status: snapshot.status,
    captureMethod: snapshot.captureMethod,
    sourceUrl: snapshot.sourceUrl,
    originalName: snapshot.originalName,
    contentType: snapshot.contentType,
    sizeBytes: snapshot.sizeBytes,
    sha256: snapshot.sha256,
    failureCode: snapshot.failureCode,
    capturedAt: snapshot.capturedAt.toISOString(),
    capturedBy: snapshot.capturedBy,
    readyAt: snapshot.readyAt?.toISOString() ?? null,
    failedAt: snapshot.failedAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function detail(snapshot: KnowledgeSnapshot) {
  return { ...summary(snapshot), extractedText: snapshot.extractedText };
}

function sendFailure(
  reply: FastifyReply,
  failure: KnowledgeSnapshotApplicationFailure,
) {
  const category =
    failure.statusCode === 404
      ? 'not_found'
      : failure.statusCode === 409
        ? 'conflict'
        : failure.statusCode >= 500
          ? 'external'
          : 'validation';
  return reply.code(failure.statusCode).send(
    createApiErrorResponse(failure.code, failure.message, {
      category,
    }),
  );
}

function safeFilename(value: string) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 || /["\\]/.test(character)
        ? '_'
        : character;
    })
    .join('');
}

async function readBoundedUpload(stream: Readable, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk);
      sizeBytes += buffer.length;
      if (sizeBytes > maximumBytes) {
        throw new Error('snapshot_content_too_large');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, sizeBytes);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function registerKnowledgeSnapshotRoutes(
  app: FastifyInstance,
  dependencies: { service?: KnowledgeSnapshotService } = {},
) {
  const service =
    dependencies.service ??
    createKnowledgeSnapshotService({
      artifacts: createKnowledgeArtifactPort({
        provider: resolveKnowledgeSnapshotProvider(),
      }),
      reader: prismaKnowledgeSnapshotRepository,
      unitOfWork: prismaKnowledgeSnapshotUnitOfWork,
    });
  const preHandler = [
    requireCanonicalKnowledgeActor,
    requireRole(allowedRoles),
  ];

  app.post(
    '/knowledge/items/:itemId/snapshots',
    {
      preHandler,
      preValidation: rejectUnknownCaptureBodyFields,
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['captureMethod', 'requestKey'],
          properties: {
            captureMethod: { type: 'string', enum: ['text', 'url'] },
            requestKey: requestKeyProperty,
            originalName: {
              type: 'string',
              maxLength: knowledgeSnapshotLimits.originalName,
            },
            text: {
              type: 'string',
              maxLength: knowledgeSnapshotLimits.maxTextBytes,
            },
            url: {
              type: 'string',
              maxLength: knowledgeSnapshotLimits.sourceUrl,
              format: 'uri',
            },
          },
        },
        response: {
          200: snapshotDetailSchema,
          201: snapshotDetailSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          413: errorResponseSchema,
          415: errorResponseSchema,
          502: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        captureMethod: 'text' | 'url';
        requestKey: string;
        originalName?: string;
        text?: string;
        url?: string;
      };
      const result = await service.capture({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        ...body,
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply
        .code(result.value.replayed ? 200 : 201)
        .send(detail(result.value.snapshot));
    },
  );

  app.post(
    '/knowledge/items/:itemId/snapshots/upload',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['requestKey'],
          properties: { requestKey: requestKeyProperty },
        },
        consumes: ['multipart/form-data'],
        response: {
          200: snapshotDetailSchema,
          201: snapshotDetailSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          413: errorResponseSchema,
          415: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let file;
      try {
        file = await request.file({
          limits: {
            fields: 0,
            files: 1,
            fileSize: knowledgeSnapshotLimits.maxBytes,
          },
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        const tooLarge = code === 'FST_REQ_FILE_TOO_LARGE';
        return reply
          .code(tooLarge ? 413 : 400)
          .send(
            createApiErrorResponse(
              tooLarge ? 'snapshot_content_too_large' : 'invalid_request',
              'Invalid snapshot upload',
              { category: 'validation' },
            ),
          );
      }
      if (!file) {
        return reply.code(400).send(
          createApiErrorResponse(
            'invalid_request',
            'Snapshot file is required',
            {
              category: 'validation',
            },
          ),
        );
      }
      const maximumBytes = knowledgeSnapshotContentByteLimit(file.mimetype);
      if (maximumBytes === null) {
        file.file.destroy();
        return reply
          .code(415)
          .send(
            createApiErrorResponse(
              'snapshot_content_type_unsupported',
              'Snapshot content type is not supported',
              { category: 'validation' },
            ),
          );
      }
      let upload: Buffer;
      try {
        upload = await readBoundedUpload(file.file, maximumBytes);
      } catch {
        return reply
          .code(413)
          .send(
            createApiErrorResponse(
              'snapshot_content_too_large',
              'Snapshot file is too large',
              { category: 'validation' },
            ),
          );
      }
      if (file.file.truncated) {
        return reply
          .code(413)
          .send(
            createApiErrorResponse(
              'snapshot_content_too_large',
              'Snapshot file is too large',
              { category: 'validation' },
            ),
          );
      }
      const result = await service.capture({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        requestKey: (request.query as { requestKey: string }).requestKey,
        captureMethod: 'upload',
        upload: {
          body: upload,
          contentType: file.mimetype,
          originalName: file.filename,
        },
      });
      if (!result.ok) return sendFailure(reply, result);
      return reply
        .code(result.value.replayed ? 200 : 201)
        .send(detail(result.value.snapshot));
    },
  );

  app.get(
    '/knowledge/items/:itemId/snapshots',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: knowledgeSnapshotLimits.listLimit,
              default: 50,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              items: { type: 'array', items: snapshotSummarySchema },
            },
          },
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.list({
        actor: knowledgeActorFromRequest(request),
        itemId: (request.params as { itemId: string }).itemId,
        limit: (request.query as { limit?: number }).limit ?? 50,
      });
      if (!result.ok) return sendFailure(reply, result);
      return { items: result.value.items.map(summary) };
    },
  );

  app.get(
    '/knowledge/items/:itemId/snapshots/:snapshotId',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemSnapshotParamsSchema,
        response: {
          200: snapshotDetailSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { itemId: string; snapshotId: string };
      const result = await service.detail({
        actor: knowledgeActorFromRequest(request),
        ...params,
      });
      if (!result.ok) return sendFailure(reply, result);
      return detail(result.value);
    },
  );

  app.post(
    '/knowledge/items/:itemId/snapshots/:snapshotId/reconcile',
    {
      preHandler,
      preValidation: rejectUnknownReconcileBodyFields,
      schema: {
        tags: ['knowledge'],
        params: itemSnapshotParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['requestKey'],
          properties: { requestKey: requestKeyProperty },
        },
        response: {
          200: snapshotDetailSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { itemId: string; snapshotId: string };
      const result = await service.reconcile({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        ...params,
        requestKey: (request.body as { requestKey: string }).requestKey,
      });
      if (!result.ok) return sendFailure(reply, result);
      return detail(result.value);
    },
  );

  app.get(
    '/knowledge/items/:itemId/snapshots/:snapshotId/download',
    {
      preHandler,
      schema: {
        tags: ['knowledge'],
        params: itemSnapshotParamsSchema,
        response: {
          200: snapshotDownloadResponse,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { itemId: string; snapshotId: string };
      const result = await service.openDownload({
        actor: knowledgeActorFromRequest(request),
        auditActor: knowledgeAuditActorFromRequest(request),
        ...params,
      });
      if (!result.ok) return sendFailure(reply, result);
      const { opened, snapshot } = result.value;
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safeFilename(snapshot.originalName)}"`,
      );
      reply.header('Content-Length', String(opened.artifact.sizeBytes));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      reply.type(
        opened.artifact.contentType === 'text/html'
          ? 'application/octet-stream'
          : opened.artifact.contentType || 'application/octet-stream',
      );
      opened.stream.on('error', (error) => {
        opened.stream.destroy();
        request.log.error(
          {
            error:
              error instanceof Error
                ? 'knowledge_snapshot_stream_failed'
                : 'stream_failed',
          },
          'Error while streaming Knowledge snapshot',
        );
      });
      return reply.send(opened.stream);
    },
  );
}
