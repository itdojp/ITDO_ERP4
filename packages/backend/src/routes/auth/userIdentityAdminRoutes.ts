import type { FastifyInstance } from 'fastify';
import { auditContextFromRequest } from '../../services/audit.js';
import {
  linkGoogleUserIdentity,
  linkLocalUserIdentity,
  listUserIdentities,
  updateUserIdentity,
} from '../../application/auth/localIdentityUseCases.js';
import {
  userIdentityGoogleLinkSchema,
  userIdentityListSchema,
  userIdentityLocalLinkSchema,
  userIdentityPatchSchema,
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
  userIdentityListResponseSchema,
  userIdentitySchema,
} from './localIdentitySchemas.js';

export async function registerUserIdentityAdminRoutes(app: FastifyInstance) {
  app.get(
    '/auth/user-identities',
    {
      preHandler: [
        app.rateLimit(localCredentialAdminRateLimit),
        requireSystemAdmin,
      ],
      schema: {
        ...userIdentityListSchema,
        tags: ['auth'],
        summary: 'List user identities',
        response: {
          200: userIdentityListResponseSchema,
          429: localCredentialErrorResponseSchema,
        },
      },
    },
    async (req) => {
      return listUserIdentities(
        (req.query || {}) as Parameters<typeof listUserIdentities>[0],
      );
    },
  );

  app.post(
    '/auth/user-identities/google-link',
    {
      preHandler: [requireSystemAdmin],
      schema: {
        ...userIdentityGoogleLinkSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Link Google identity to existing user account',
        response: {
          201: userIdentitySchema,
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

      const result = await linkGoogleUserIdentity(req.body || {}, {
        actorId,
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );

  app.post(
    '/auth/user-identities/local-link',
    {
      preHandler: [requireSystemAdmin],
      schema: {
        ...userIdentityLocalLinkSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Link local identity to existing user account',
        response: {
          201: userIdentitySchema,
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

      const result = await linkLocalUserIdentity(req.body || {}, {
        actorId,
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );

  app.patch(
    '/auth/user-identities/:identityId',
    {
      preHandler: [requireSystemAdmin],
      schema: {
        ...userIdentityPatchSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Update user identity state',
        response: {
          200: userIdentitySchema,
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

      const result = await updateUserIdentity(identityId, req.body || {}, {
        actorId,
        auditContext: auditContextFromRequest(req),
      });
      return sendLocalIdentityResult(reply, result);
    },
  );
}
