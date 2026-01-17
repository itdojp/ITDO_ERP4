import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import authPlugin from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { prisma } from './services/db.js';
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

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
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
  server.get('/readyz', async (req, reply) => {
    const report = await getReadinessReport(prisma);
    if (!report.ok) {
      const error = report.checks.db.error;
      if (error) {
        req.log.error({ err: error }, 'readiness check failed');
      }
    }
    const publicReport = toPublicReadinessReport(report);
    return reply.code(report.ok ? 200 : 503).send(publicReport);
  });

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
