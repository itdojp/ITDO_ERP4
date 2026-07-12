import type { FastifyReply, FastifyRequest } from 'fastify';
import { createApiErrorResponse } from '../../services/errors.js';
import { getRouteRateLimitOptions } from '../../services/rateLimitOverrides.js';
import { requireRole } from '../../services/rbac.js';
import { createMemoryRateLimiter } from './http.js';
import type { LocalIdentityUseCaseResult } from '../../application/auth/localIdentityUseCases.js';

export const requireSystemAdmin = requireRole(['system_admin']);

export const localCredentialAdminRateLimit = getRouteRateLimitOptions(
  'RATE_LIMIT_LOCAL_CREDENTIAL_ADMIN',
  { max: 20, timeWindow: '1 minute' },
);

const localLoginRateLimit = getRouteRateLimitOptions('RATE_LIMIT_LOCAL_LOGIN', {
  max: 10,
  timeWindow: '1 minute',
});

const localCredentialAdminFlexibleLimiter = createMemoryRateLimiter(
  localCredentialAdminRateLimit,
);
const localLoginFlexibleLimiter = createMemoryRateLimiter(localLoginRateLimit);

export async function enforceLocalLoginRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await localLoginFlexibleLimiter.consume(req.ip || 'unknown');
  } catch {
    reply
      .code(429)
      .send(
        createApiErrorResponse(
          'local_login_rate_limited',
          'Too many local login requests',
          { category: 'rate_limit' },
        ),
      );
    return true;
  }
  return false;
}

export async function enforceLocalCredentialAdminRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await localCredentialAdminFlexibleLimiter.consume(req.ip);
  } catch {
    reply
      .code(429)
      .send(
        createApiErrorResponse(
          'local_credential_rate_limited',
          'Too many local credential admin requests',
          { category: 'rate_limit' },
        ),
      );
    return true;
  }
  return false;
}

export function requireActorUserId(
  req: { user?: { userId?: string } },
  reply: FastifyReply,
) {
  const actorId = req.user?.userId;
  if (actorId) return actorId;
  reply.code(400).send(
    createApiErrorResponse('missing_user_id', 'user id is required', {
      category: 'validation',
    }),
  );
  return null;
}

export function sendLocalIdentityResult<T>(
  reply: FastifyReply,
  result: LocalIdentityUseCaseResult<T>,
) {
  if (result.kind === 'error') {
    const { statusCode, code, message, category, details } = result.error;
    return reply.code(statusCode).send(
      createApiErrorResponse(code, message, {
        category,
        ...(details ? { details } : {}),
      }),
    );
  }
  if (result.value === undefined) {
    return reply.code(result.statusCode ?? 204).send();
  }
  return reply.code(result.statusCode ?? 200).send(result.value);
}
