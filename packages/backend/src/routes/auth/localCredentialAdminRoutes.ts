import type { FastifyInstance } from 'fastify';
import { auditContextFromRequest } from '../../services/audit.js';
import {
  createLocalCredential,
  listLocalCredentials,
  updateLocalCredential,
} from '../../application/auth/localIdentityUseCases.js';
import {
  localCredentialCreateSchema,
  localCredentialListSchema,
  localCredentialPatchSchema,
} from '../validators.js';
import { authCsrfHeadersSchema, enforceAuthCsrf } from './http.js';
import {
  enforceLocalCredentialAdminRateLimit,
  localCredentialAdminRateLimit,
  requireActorUserId,
  requireSystemAdmin,
  sendLocalIdentityResult,
} from './localIdentityHttp.js';
import {
  localCredentialErrorResponseSchema,
  localCredentialIdentitySchema,
  localCredentialListResponseSchema,
} from './localIdentitySchemas.js';

export async function registerLocalCredentialAdminRoutes(app: FastifyInstance) {
  app.get(
    '/auth/local-credentials',
    {
      preHandler: [
        app.rateLimit(localCredentialAdminRateLimit),
        requireSystemAdmin,
      ],
      schema: {
        ...localCredentialListSchema,
        tags: ['auth'],
        summary: 'List local credentials',
        response: {
          200: localCredentialListResponseSchema,
          429: localCredentialErrorResponseSchema,
        },
      },
    },
    async (req) => {
      return listLocalCredentials(
        (req.query || {}) as Parameters<typeof listLocalCredentials>[0],
      );
    },
  );

  app.post(
    '/auth/local-credentials',
    {
      preHandler: [requireSystemAdmin],
      schema: {
        ...localCredentialCreateSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Create local credential',
        response: {
          201: localCredentialIdentitySchema,
          400: localCredentialErrorResponseSchema,
          403: localCredentialErrorResponseSchema,
          404: localCredentialErrorResponseSchema,
          409: localCredentialErrorResponseSchema,
          429: localCredentialErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const rateLimitError = await enforceLocalCredentialAdminRateLimit(
        req,
        reply,
      );
      if (rateLimitError) return reply;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;

      const result = await createLocalCredential(req.body || {}, {
        actorId,
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );

  app.patch(
    '/auth/local-credentials/:identityId',
    {
      preHandler: [requireSystemAdmin],
      schema: {
        ...localCredentialPatchSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Update local credential',
        response: {
          200: localCredentialIdentitySchema,
          400: localCredentialErrorResponseSchema,
          403: localCredentialErrorResponseSchema,
          404: localCredentialErrorResponseSchema,
          409: localCredentialErrorResponseSchema,
          429: localCredentialErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const rateLimitError = await enforceLocalCredentialAdminRateLimit(
        req,
        reply,
      );
      if (rateLimitError) return reply;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;
      const { identityId } = req.params as { identityId: string };

      const result = await updateLocalCredential(identityId, req.body || {}, {
        actorId,
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );
}
