import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../../services/db.js';
import { createApiErrorResponse } from '../../services/errors.js';
import { auditContextFromRequest, logAudit } from '../../services/audit.js';
import {
  buildAuthCsrfClearCookie,
  buildAuthFlowClearCookie,
  buildAuthSessionClearCookie,
  buildAuthSessionResponse,
  buildSessionRedirectUrl,
  consumeGoogleAuthFlow,
  createAuthSession,
  createGoogleAuthFlow,
  ensureAuthCsrfToken,
  exchangeGoogleAuthorizationCode,
  isIdentityUsable,
  resolveGoogleUserIdentity,
  revokeAuthSession,
  verifyGoogleIdToken,
} from '../../services/authGateway.js';
import {
  authGoogleCallbackSchema,
  authGoogleStartSchema,
  authSessionListSchema,
  authSessionRevokeSchema,
} from '../validators.js';
import {
  authCsrfHeadersSchema,
  authGatewayErrorResponseSchema,
  enforceAuthCsrf,
  enforceAuthGatewayRateLimit,
  isJwtBffAuthMode,
  respondAuthGatewayDisabled,
} from './http.js';

const authSessionSchema = Type.Object(
  {
    sessionId: Type.String(),
    providerType: Type.String(),
    issuer: Type.String(),
    userAccountId: Type.String(),
    userIdentityId: Type.String(),
    expiresAt: Type.String({ format: 'date-time' }),
    idleExpiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

const authSessionResponseSchema = Type.Object(
  {
    user: Type.Object(
      {
        userId: Type.String(),
        roles: Type.Array(Type.String()),
        orgId: Type.Optional(Type.String()),
        projectIds: Type.Optional(Type.Array(Type.String())),
        groupIds: Type.Optional(Type.Array(Type.String())),
        groupAccountIds: Type.Optional(Type.Array(Type.String())),
        auth: Type.Optional(Type.Any()),
      },
      { additionalProperties: true },
    ),
    session: authSessionSchema,
  },
  { additionalProperties: false },
);

const authCsrfResponseSchema = Type.Object(
  {
    csrfToken: Type.String(),
  },
  { additionalProperties: false },
);

const managedAuthSessionSchema = Type.Object(
  {
    sessionId: Type.String(),
    providerType: Type.String(),
    issuer: Type.String(),
    userAccountId: Type.String(),
    userIdentityId: Type.String(),
    sourceIp: Type.Union([Type.String(), Type.Null()]),
    userAgent: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    lastSeenAt: Type.String({ format: 'date-time' }),
    expiresAt: Type.String({ format: 'date-time' }),
    idleExpiresAt: Type.String({ format: 'date-time' }),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    revokedReason: Type.Union([Type.String(), Type.Null()]),
    current: Type.Boolean(),
  },
  { additionalProperties: false },
);

const authSessionListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    items: Type.Array(managedAuthSessionSchema),
  },
  { additionalProperties: false },
);

function serializeManagedAuthSession(
  session: {
    id: string;
    providerType: string;
    issuer: string;
    userAccountId: string;
    userIdentityId: string;
    sourceIp: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    idleExpiresAt: Date;
    revokedAt: Date | null;
    revokedReason: string | null;
  },
  currentSessionId?: string,
) {
  return {
    sessionId: session.id,
    providerType: session.providerType,
    issuer: session.issuer,
    userAccountId: session.userAccountId,
    userIdentityId: session.userIdentityId,
    sourceIp: session.sourceIp,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() ?? null,
    revokedReason: session.revokedReason,
    current: session.id === currentSessionId,
  };
}

export async function registerGoogleSessionAuthRoutes(app: FastifyInstance) {
  app.get(
    '/auth/google/start',
    {
      schema: {
        ...authGoogleStartSchema,
        tags: ['auth'],
        summary: 'Start Google OIDC authorization code flow',
        response: {
          400: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
          302: Type.Null(),
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const query = (req.query || {}) as { returnTo?: string };
      try {
        const { redirectUrl, setCookie } = await createGoogleAuthFlow(prisma, {
          returnTo: query.returnTo,
        });
        reply.header('set-cookie', setCookie);
        return reply.redirect(redirectUrl, 302);
      } catch (err) {
        req.log?.warn?.({ err }, 'google_auth_start_failed');
        return reply
          .code(400)
          .send(
            createApiErrorResponse(
              'google_auth_start_failed',
              'Failed to initialize Google authentication flow',
              { category: 'auth' },
            ),
          );
      }
    },
  );

  app.get(
    '/auth/google/callback',
    {
      schema: {
        ...authGoogleCallbackSchema,
        tags: ['auth'],
        summary: 'Complete Google OIDC authorization code flow',
        response: {
          302: Type.Null(),
          400: authGatewayErrorResponseSchema,
          401: authGatewayErrorResponseSchema,
          403: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const query = (req.query || {}) as { code: string; state: string };
      const flow = await consumeGoogleAuthFlow(prisma, {
        cookieHeader: req.headers.cookie,
        state: query.state,
      });
      if (!flow) {
        await logAudit({
          action: 'google_oidc_login_failed',
          targetTable: 'AuthOidcFlow',
          reasonCode: 'invalid_flow',
          metadata: { state: query.state },
          ...auditContextFromRequest(req),
        });
        reply.header('set-cookie', buildAuthFlowClearCookie());
        return reply
          .code(400)
          .send(
            createApiErrorResponse(
              'google_auth_flow_invalid',
              'Google authentication flow is invalid or expired',
              { category: 'auth' },
            ),
          );
      }

      try {
        const tokenResponse = await exchangeGoogleAuthorizationCode(
          query.code,
          flow.codeVerifier,
        );
        if (!tokenResponse.id_token) {
          throw new Error('google_id_token_missing');
        }
        const verified = await verifyGoogleIdToken(
          tokenResponse.id_token,
          flow.nonce,
        );
        const identity = await resolveGoogleUserIdentity(prisma, {
          issuer: verified.issuer,
          providerSubject: verified.providerSubject,
        });
        if (!identity || !isIdentityUsable(identity)) {
          await logAudit({
            action: 'google_oidc_login_failed',
            targetTable: 'UserIdentity',
            targetId: identity?.id,
            reasonCode: 'identity_unavailable',
            metadata: {
              issuer: verified.issuer,
              providerSubject: verified.providerSubject,
            },
            ...auditContextFromRequest(req),
          });
          reply.header('set-cookie', buildAuthFlowClearCookie());
          return reply
            .code(403)
            .send(
              createApiErrorResponse(
                'google_identity_unavailable',
                'Google identity is not linked to an active ERP4 account',
                { category: 'auth' },
              ),
            );
        }

        const { session, setCookie } = await createAuthSession(prisma, {
          userAccountId: identity.userAccountId,
          userIdentityId: identity.id,
          providerType: identity.providerType,
          issuer: identity.issuer,
          providerSubject: identity.providerSubject,
          sourceIp: req.ip,
          userAgent:
            typeof req.headers['user-agent'] === 'string'
              ? req.headers['user-agent']
              : undefined,
        });

        await logAudit({
          action: 'google_oidc_login_succeeded',
          targetTable: 'AuthSession',
          targetId: session.id,
          metadata: {
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            issuer: identity.issuer,
            providerSubject: identity.providerSubject,
          },
          ...auditContextFromRequest(req),
        });

        reply.header('set-cookie', [setCookie, buildAuthFlowClearCookie()]);
        return reply.redirect(
          buildSessionRedirectUrl(flow.returnTo || '/'),
          302,
        );
      } catch (err) {
        req.log?.warn?.({ err }, 'google_auth_callback_failed');
        await logAudit({
          action: 'google_oidc_login_failed',
          targetTable: 'AuthOidcFlow',
          reasonCode: 'callback_validation_failed',
          metadata: {
            state: query.state,
            error: err instanceof Error ? err.message : String(err),
          },
          ...auditContextFromRequest(req),
        });
        reply.header('set-cookie', buildAuthFlowClearCookie());
        return reply.code(401).send(
          createApiErrorResponse(
            'google_auth_callback_failed',
            'Google authentication callback validation failed',
            {
              category: 'auth',
              details: {
                reason: 'callback_validation_failed',
              },
            },
          ),
        );
      }
    },
  );

  app.get(
    '/auth/session',
    {
      schema: {
        tags: ['auth'],
        summary: 'Return current authenticated BFF session',
        response: {
          200: authSessionResponseSchema,
          401: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const session = req.authSession;
      if (!session || !req.user) {
        return reply.code(401).send(
          createApiErrorResponse('unauthorized', 'Unauthorized', {
            category: 'auth',
            details: { reason: 'missing_session' },
          }),
        );
      }
      return {
        user: req.user,
        session: buildAuthSessionResponse(session),
      };
    },
  );

  app.get(
    '/auth/csrf',
    {
      schema: {
        tags: ['auth'],
        summary: 'Return CSRF token for BFF authenticated routes',
        response: {
          200: authCsrfResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const { csrfToken, setCookie } = ensureAuthCsrfToken(req.headers.cookie);
      reply.header('cache-control', 'no-store');
      reply.header('pragma', 'no-cache');
      if (setCookie) {
        reply.header('set-cookie', setCookie);
      }
      return { csrfToken };
    },
  );

  app.get(
    '/auth/sessions',
    {
      schema: {
        ...authSessionListSchema,
        tags: ['auth'],
        summary: 'List active authenticated sessions for current user',
        response: {
          200: authSessionListResponseSchema,
          401: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const session = req.authSession;
      if (!session) {
        return reply.code(401).send(
          createApiErrorResponse('unauthorized', 'Unauthorized', {
            category: 'auth',
            details: { reason: 'missing_session' },
          }),
        );
      }
      const query = (req.query || {}) as { limit?: number; offset?: number };
      const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
      const offset = Math.max(query.offset ?? 0, 0);
      const now = new Date();
      const items = await prisma.authSession.findMany({
        where: {
          userAccountId: session.userAccountId,
          revokedAt: null,
          expiresAt: { gt: now },
          idleExpiresAt: { gt: now },
        },
        orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
        skip: offset,
        take: limit,
      });
      return {
        limit,
        offset,
        items: items.map((item) =>
          serializeManagedAuthSession(item, session.id),
        ),
      };
    },
  );

  app.post(
    '/auth/sessions/:sessionId/revoke',
    {
      schema: {
        ...authSessionRevokeSchema,
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Revoke an active authenticated session for current user',
        response: {
          200: managedAuthSessionSchema,
          403: authGatewayErrorResponseSchema,
          401: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const currentSession = req.authSession;
      if (!currentSession) {
        return reply.code(401).send(
          createApiErrorResponse('unauthorized', 'Unauthorized', {
            category: 'auth',
            details: { reason: 'missing_session' },
          }),
        );
      }
      const { sessionId } = (req.params || {}) as { sessionId: string };
      const now = new Date();
      const target = await prisma.authSession.findFirst({
        where: {
          id: sessionId,
          userAccountId: currentSession.userAccountId,
          revokedAt: null,
          expiresAt: { gt: now },
          idleExpiresAt: { gt: now },
        },
      });
      if (!target) {
        return reply.code(404).send(
          createApiErrorResponse(
            'auth_session_not_found',
            'Auth session not found',
            {
              category: 'not_found',
            },
          ),
        );
      }
      const revoked = await prisma.authSession.update({
        where: { id: target.id },
        data: {
          revokedAt: new Date(),
          revokedReason: 'user_requested',
        },
      });
      await logAudit({
        action: 'auth_session_revoked',
        targetTable: 'AuthSession',
        targetId: revoked.id,
        metadata: {
          userAccountId: revoked.userAccountId,
          identityId: revoked.userIdentityId,
          issuer: revoked.issuer,
          providerSubject: revoked.providerSubject,
          revokedBySessionId: currentSession.id,
        },
        ...auditContextFromRequest(req),
      });
      if (revoked.id === currentSession.id) {
        reply.header('set-cookie', [
          buildAuthSessionClearCookie(),
          buildAuthCsrfClearCookie(),
        ]);
      }
      return serializeManagedAuthSession(revoked, currentSession.id);
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        headers: authCsrfHeadersSchema,
        tags: ['auth'],
        summary: 'Revoke current authenticated session',
        response: {
          204: Type.Null(),
          403: authGatewayErrorResponseSchema,
          404: authGatewayErrorResponseSchema,
          429: authGatewayErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      const rateLimited = await enforceAuthGatewayRateLimit(req, reply);
      if (rateLimited) return rateLimited;
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const revoked = await revokeAuthSession(prisma, req.headers.cookie);
      if (revoked) {
        await logAudit({
          action: 'auth_session_logout',
          targetTable: 'AuthSession',
          targetId: revoked.id,
          metadata: {
            userAccountId: revoked.userAccountId,
            identityId: revoked.userIdentityId,
            issuer: revoked.issuer,
            providerSubject: revoked.providerSubject,
          },
          ...auditContextFromRequest(req),
        });
      }
      reply.header('set-cookie', [
        buildAuthSessionClearCookie(),
        buildAuthCsrfClearCookie(),
      ]);
      return reply.code(204).send();
    },
  );
}
