import { FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createApiErrorResponse } from '../../services/errors.js';
import { getRouteRateLimitOptions } from '../../services/rateLimitOverrides.js';
import { readAuthCsrfToken } from '../../services/authGateway.js';

const AUTH_MODE = (process.env.AUTH_MODE || 'header').trim().toLowerCase();

export const authGatewayErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        category: Type.Optional(Type.String()),
        details: Type.Optional(Type.Any()),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: false },
);

export const authCsrfHeadersSchema = Type.Object(
  {
    'x-csrf-token': Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

function parseRateLimitWindowSeconds(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(
    /^(\d+)\s*(second|seconds|minute|minutes|hour|hours)$/,
  );
  if (!match) return 60;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 60;
  switch (match[2]) {
    case 'second':
    case 'seconds':
      return amount;
    case 'minute':
    case 'minutes':
      return amount * 60;
    case 'hour':
    case 'hours':
      return amount * 60 * 60;
    default:
      return 60;
  }
}

export function createMemoryRateLimiter(options: {
  max: number;
  timeWindow: string;
}) {
  return new RateLimiterMemory({
    points: options.max,
    duration: parseRateLimitWindowSeconds(options.timeWindow),
  });
}

const authGatewayRateLimit = getRouteRateLimitOptions(
  'RATE_LIMIT_AUTH_GATEWAY',
  {
    max: 60,
    timeWindow: '1 minute',
  },
);
const authGatewayFlexibleLimiter =
  createMemoryRateLimiter(authGatewayRateLimit);

export async function enforceAuthGatewayRateLimit(
  req: { ip?: string },
  reply: FastifyReply,
) {
  try {
    await authGatewayFlexibleLimiter.consume(req.ip || 'unknown');
    return null;
  } catch {
    return reply.code(429).send(
      createApiErrorResponse('auth_gateway_rate_limited', 'Too many requests', {
        category: 'rate_limit',
      }),
    );
  }
}

export function isJwtBffAuthMode() {
  return AUTH_MODE === 'jwt_bff';
}

export function respondAuthGatewayDisabled(reply: FastifyReply) {
  return reply.code(404).send(
    createApiErrorResponse('not_found', 'Not Found', {
      category: 'not_found',
    }),
  );
}

function readCsrfHeader(req: {
  headers?: Record<string, string | string[] | undefined>;
}) {
  const raw = req.headers?.['x-csrf-token'];
  if (Array.isArray(raw)) {
    const first = raw.find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
    return first?.trim() || '';
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

export function enforceAuthCsrf(
  req: {
    headers: {
      cookie?: string;
      'x-csrf-token'?: string | string[];
    };
  },
  reply: FastifyReply,
) {
  if (!isJwtBffAuthMode()) return null;
  const cookieToken = readAuthCsrfToken(req.headers.cookie);
  const headerToken = readCsrfHeader(req);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return reply.code(403).send(
      createApiErrorResponse('invalid_csrf_token', 'Invalid CSRF token', {
        category: 'auth',
      }),
    );
  }
  return null;
}
