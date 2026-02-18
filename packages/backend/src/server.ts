import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import authPlugin from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { prisma } from './services/db.js';
import { assertValidBackendEnv } from './services/envValidation.js';
import {
  getReadinessReport,
  toPublicReadinessReport,
} from './services/readiness.js';
import {
  createApiErrorResponse,
  mapErrorToResponse,
  normalizeLegacyErrorResponse,
} from './services/errors.js';

type BuildServerOptions = {
  logger?: boolean;
};

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_SAFE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const CACHE_CONTROL_HEADER = 'cache-control';
const PRAGMA_HEADER = 'pragma';
const CACHE_CONTROL_NO_STORE = 'no-store';
const PRAGMA_NO_CACHE = 'no-cache';
const READY_ROUTE_RATE_LIMIT = {
  max: 600,
  timeWindow: '1 minute',
};

type RateLimitRedisClient = {
  ping: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  disconnect: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullSchemaObject(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.type === 'null') return true;
  if (
    Array.isArray(value.enum) &&
    value.enum.length === 1 &&
    value.enum[0] === null
  ) {
    return true;
  }
  return false;
}

function normalizeOpenApiNullable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenApiNullable);
  if (!isPlainObject(value)) return value;

  const cloned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    cloned[key] = normalizeOpenApiNullable(child);
  }

  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    const unionRaw = cloned[unionKey];
    if (!Array.isArray(unionRaw)) continue;

    const nonNullSchemas = unionRaw.filter((item) => !isNullSchemaObject(item));
    const hasNull = nonNullSchemas.length !== unionRaw.length;
    if (!hasNull || nonNullSchemas.length === 0) continue;

    cloned.nullable = true;

    if (nonNullSchemas.length === 1) {
      const base = nonNullSchemas[0];
      delete cloned[unionKey];

      if (isPlainObject(base) && typeof base.$ref === 'string') {
        return {
          ...cloned,
          allOf: [base],
        };
      }
      if (isPlainObject(base)) {
        return {
          ...base,
          ...cloned,
        };
      }

      return cloned;
    }

    cloned[unionKey] = nonNullSchemas;
  }

  const typeRaw = cloned.type;
  if (Array.isArray(typeRaw) && typeRaw.includes('null')) {
    const nonNullTypes = typeRaw.filter((t) => t !== 'null');
    if (nonNullTypes.length > 0) {
      cloned.nullable = true;
      cloned.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
    }
  }

  const exclusiveMinimumRaw = cloned.exclusiveMinimum;
  if (
    typeof exclusiveMinimumRaw === 'number' &&
    Number.isFinite(exclusiveMinimumRaw)
  ) {
    cloned.minimum = exclusiveMinimumRaw;
    cloned.exclusiveMinimum = true;
  }

  const exclusiveMaximumRaw = cloned.exclusiveMaximum;
  if (
    typeof exclusiveMaximumRaw === 'number' &&
    Number.isFinite(exclusiveMaximumRaw)
  ) {
    cloned.maximum = exclusiveMaximumRaw;
    cloned.exclusiveMaximum = true;
  }

  return cloned;
}

async function registerOpenApiIfEnabled(server: FastifyInstance) {
  const enabled =
    process.env.OPENAPI_EXPORT === '1' || process.env.OPENAPI_EXPOSE === '1';
  if (!enabled) return;

  const { default: swagger } = await import('@fastify/swagger');
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'ITDO ERP4 API',
        version: process.env.API_VERSION || '0.1.0',
      },
      components: {
        schemas: {
          ApiError: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              category: { type: 'string' },
            },
            required: ['code', 'message'],
          },
          ApiErrorResponse: {
            type: 'object',
            additionalProperties: false,
            properties: {
              error: { $ref: '#/components/schemas/ApiError' },
            },
            required: ['error'],
          },
        },
      },
    },
    transformObject: (documentObject) => {
      if ('openapiObject' in documentObject) {
        return normalizeOpenApiNullable(documentObject.openapiObject) as any;
      }
      return documentObject.swaggerObject;
    },
  });
}

function generateRequestId() {
  return crypto.randomUUID();
}

function sanitizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!REQUEST_ID_SAFE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function buildLoggerOptions() {
  const levelRaw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const level = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(
    levelRaw,
  )
    ? levelRaw
    : 'info';
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.set-cookie',
        'req.headers.x-api-key',
      ],
      censor: '[REDACTED]',
    },
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  assertValidBackendEnv();
  const server = Fastify({
    logger: options.logger === false ? false : buildLoggerOptions(),
    bodyLimit: 1024 * 1024,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => generateRequestId(),
  });

  server.addHook('onRequest', async (req) => {
    const incoming = sanitizeRequestId(req.headers[REQUEST_ID_HEADER]);
    if (incoming) {
      req.id = incoming;
    }
  });

  server.addHook('onSend', async (req, reply, payload) => {
    reply.header(REQUEST_ID_HEADER, req.id);
    if (!reply.hasHeader(CACHE_CONTROL_HEADER)) {
      reply.header(CACHE_CONTROL_HEADER, CACHE_CONTROL_NO_STORE);
    }
    if (!reply.hasHeader(PRAGMA_HEADER)) {
      reply.header(PRAGMA_HEADER, PRAGMA_NO_CACHE);
    }
    return payload;
  });

  server.addHook('preSerialization', async (_req, _reply, payload) => {
    return normalizeLegacyErrorResponse(payload);
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  await server.register(cors, {
    origin:
      allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : false,
    maxAge: 86400,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
      },
    },
  });

  await server.register(authPlugin);
  await registerOpenApiIfEnabled(server);

  const rateLimitEnabled =
    process.env.RATE_LIMIT_ENABLED === '1' ||
    process.env.NODE_ENV === 'production';
  if (rateLimitEnabled) {
    const max = parsePositiveInt(process.env.RATE_LIMIT_MAX, 600);
    const timeWindow = process.env.RATE_LIMIT_WINDOW || '1 minute';
    const redisUrl = (process.env.RATE_LIMIT_REDIS_URL || '').trim();
    const redisNamespace =
      (process.env.RATE_LIMIT_REDIS_NAMESPACE || '').trim() ||
      'erp4-rate-limit-';
    const redisConnectTimeoutMs = parsePositiveInt(
      process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS,
      3000,
    );
    let redisClient: RateLimitRedisClient | null = null;
    if (redisUrl) {
      const { default: IORedis } = await import('ioredis');
      redisClient = new IORedis(redisUrl, {
        connectTimeout: redisConnectTimeoutMs,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      }) as unknown as RateLimitRedisClient;
      redisClient.on('error', (err) => {
        server.log.warn({ err }, 'rate-limit redis connection error');
      });
      await redisClient.ping();
      server.addHook('onClose', async () => {
        if (!redisClient) return;
        try {
          await redisClient.quit();
        } catch {
          redisClient.disconnect();
        }
      });
    }
    await server.register(rateLimit, {
      global: true,
      max,
      timeWindow,
      ...(redisClient
        ? {
            redis: redisClient,
            nameSpace: redisNamespace,
          }
        : {}),
      allowList: (req) => {
        const url = req.url;
        return (
          typeof url === 'string' &&
          url.startsWith('/health')
        );
      },
    });
  }

  const chatAttachmentMaxBytes = Number(
    process.env.CHAT_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024,
  );
  await server.register(multipart, {
    limits: {
      fileSize:
        Number.isFinite(chatAttachmentMaxBytes) && chatAttachmentMaxBytes > 0
          ? Math.floor(chatAttachmentMaxBytes)
          : 10 * 1024 * 1024,
    },
  });

  server.get('/health', async () => ({ ok: true }));
  server.get('/healthz', async () => ({ ok: true }));
  server.get(
    '/readyz',
    {
      config: {
        rateLimit: READY_ROUTE_RATE_LIMIT,
      }
    },
    async (req, reply) => {
      const report = await getReadinessReport(prisma);
      if (!report.ok) {
        const error = report.checks.db.error;
        if (error) {
          req.log.error({ err: error }, 'readiness check failed');
        }
      }
      const publicReport = toPublicReadinessReport(report);
      return reply.code(report.ok ? 200 : 503).send(publicReport);
    },
  );

  server.setNotFoundHandler(async (_req, reply) => {
    return reply.code(404).send(
      createApiErrorResponse('not_found', 'Not found', {
        category: 'not_found',
      }),
    );
  });

  server.setErrorHandler((err, req, reply) => {
    const mapped = mapErrorToResponse(err);
    const errorCode = mapped.body.error.code;
    if (mapped.statusCode >= 500) {
      req.log.error({ err, errorCode }, 'request failed');
    } else {
      req.log.warn({ err, errorCode }, 'request failed');
    }
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  await registerRoutes(server);
  return server;
}

export async function startServer() {
  const server = await buildServer();
  const port = Number(process.env.PORT || 3001);
  server.listen({ port, host: '0.0.0.0' }).catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
}
