import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { auditContextFromRequest } from '../../services/audit.js';
import {
  authenticateLocalCredential,
  rotateLocalPassword,
} from '../../application/auth/localIdentityUseCases.js';
import { localLoginSchema, localPasswordRotateSchema } from '../validators.js';
import {
  authCsrfHeadersSchema,
  authGatewayErrorResponseSchema,
  enforceAuthCsrf,
  isJwtBffAuthMode,
  respondAuthGatewayDisabled,
} from './http.js';
import {
  enforceLocalLoginRateLimit,
  sendLocalIdentityResult,
} from './localIdentityHttp.js';

function requestUserAgent(req: { headers: Record<string, unknown> }) {
  return typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent']
    : undefined;
}

export async function registerLocalAuthRoutes(app: FastifyInstance) {
  app.post(
    '/auth/local/login',
    {
      schema: {
        ...localLoginSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Authenticate with local credentials and create BFF session',
        response: {
          204: Type.Null(),
          400: authGatewayErrorResponseSchema,
          403: authGatewayErrorResponseSchema,
          401: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          409: authGatewayErrorResponseSchema,
          423: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) return respondAuthGatewayDisabled(reply);
      const rateLimitError = await enforceLocalLoginRateLimit(req, reply);
      if (rateLimitError) return reply;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;

      const result = await authenticateLocalCredential(req.body || {}, {
        sourceIp: req.ip,
        userAgent: requestUserAgent(req),
        auditContext: auditContextFromRequest(req),
      });
      if (result.kind === 'error') {
        return sendLocalIdentityResult(reply, result);
      }
      if (result.setCookie) {
        // The value is an opaque HTTP-only session cookie delivered to the browser,
        // not application-side clear-text persistence.

        // codeql[js/clear-text-storage-of-sensitive-data]
        reply.header('set-cookie', result.setCookie);
      }
      return sendLocalIdentityResult(reply, result);
    },
  );

  app.post(
    '/auth/local/password/rotate',
    {
      schema: {
        ...localPasswordRotateSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Rotate bootstrap local password before MFA-enabled login',
        response: {
          204: Type.Null(),
          400: authGatewayErrorResponseSchema,
          403: authGatewayErrorResponseSchema,
          401: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          409: authGatewayErrorResponseSchema,
          423: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) return respondAuthGatewayDisabled(reply);
      const rateLimitError = await enforceLocalLoginRateLimit(req, reply);
      if (rateLimitError) return reply;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;

      const result = await rotateLocalPassword(req.body || {}, {
        sourceIp: req.ip,
        userAgent: requestUserAgent(req),
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );
}
