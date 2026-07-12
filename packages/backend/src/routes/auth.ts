import { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { Type } from '@sinclair/typebox';
import {
  clearUserDbContextCache,
  invalidateUserDbContextCache,
} from '../plugins/auth.js';
import { prisma } from '../services/db.js';
import { createApiErrorResponse } from '../services/errors.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';
import { createAuthSession } from '../services/authGateway.js';
import {
  LOCAL_IDENTITY_ISSUER,
  LOCAL_IDENTITY_PROVIDER,
  buildLocalProviderSubject,
  computeLocalCredentialLockUntil,
  hashLocalPassword,
  isLocalCredentialLocked,
  normalizeLocalLoginId,
  serializeLocalCredentialIdentity,
  validateLocalPassword,
  verifyLocalPassword,
} from '../services/localCredentials.js';
import {
  localCredentialCreateSchema,
  localCredentialListSchema,
  localLoginSchema,
  localCredentialPatchSchema,
  localPasswordRotateSchema,
  userIdentityGoogleLinkSchema,
  userIdentityListSchema,
  userIdentityLocalLinkSchema,
  userIdentityPatchSchema,
} from './validators.js';
import { registerGoogleSessionAuthRoutes } from './auth/googleSessionRoutes.js';
import {
  authCsrfHeadersSchema,
  authGatewayErrorResponseSchema,
  createMemoryRateLimiter,
  enforceAuthCsrf,
  isJwtBffAuthMode,
  respondAuthGatewayDisabled,
} from './auth/http.js';

const demoUser = {
  userId: 'demo-user',
  roles: ['user'],
  orgId: 'org-demo',
  projectIds: ['00000000-0000-0000-0000-000000000001'],
};

const requireSystemAdmin = requireRole(['system_admin']);
const localCredentialAdminRateLimit = getRouteRateLimitOptions(
  'RATE_LIMIT_LOCAL_CREDENTIAL_ADMIN',
  {
    max: 20,
    timeWindow: '1 minute',
  },
);
const localLoginRateLimit = getRouteRateLimitOptions('RATE_LIMIT_LOCAL_LOGIN', {
  max: 10,
  timeWindow: '1 minute',
});
const localCredentialAdminFlexibleLimiter = createMemoryRateLimiter(
  localCredentialAdminRateLimit,
);
const localLoginFlexibleLimiter = createMemoryRateLimiter(localLoginRateLimit);

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLockedUntil(value: unknown) {
  if (value === undefined) {
    return {
      provided: false as const,
      value: undefined as Date | null | undefined,
    };
  }
  if (value === null) {
    return { provided: true as const, value: null };
  }
  if (typeof value !== 'string') {
    return { provided: true as const, invalid: true as const };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    return { provided: true as const, invalid: true as const };
  }
  return { provided: true as const, value: parsed };
}

function parseIdentityWindow(value: unknown, fieldName: string) {
  if (value === undefined) {
    return {
      provided: false as const,
      value: undefined as Date | null | undefined,
      invalidField: null as string | null,
    };
  }
  if (value === null) {
    return { provided: true as const, value: null, invalidField: null };
  }
  if (typeof value !== 'string') {
    return {
      provided: true as const,
      value: undefined,
      invalidField: fieldName,
    };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      provided: true as const,
      value: undefined,
      invalidField: fieldName,
    };
  }
  return { provided: true as const, value: parsed, invalidField: null };
}

function respondValidationError(reply: FastifyReply, invalidFields: string[]) {
  return reply.code(400).send(
    createApiErrorResponse(
      'invalid_local_credential_payload',
      'Invalid local credential payload',
      {
        category: 'validation',
        details: { invalidFields },
      },
    ),
  );
}

function respondLocalAuthValidationError(
  reply: FastifyReply,
  code: string,
  message: string,
  invalidFields: string[],
) {
  return reply.code(400).send(
    createApiErrorResponse(code, message, {
      category: 'validation',
      details: { invalidFields },
    }),
  );
}

function requireActorUserId(
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

function buildLocalCredentialAuditMetadata(
  actorId: string,
  payload: {
    ticketId: string;
    loginId?: string;
    changedFields?: string[];
    status?: string;
    userAccountId: string;
    identityId?: string;
    mfaRequired?: boolean;
    mfaDefaultOverridden?: boolean;
  },
) {
  return {
    actorAdminUserId: actorId,
    targetUserAccountId: payload.userAccountId,
    identityId: payload.identityId,
    ticketId: payload.ticketId,
    loginId: payload.loginId,
    changedFields: payload.changedFields,
    status: payload.status,
    mfaRequired: payload.mfaRequired,
    mfaDefaultOverridden: payload.mfaDefaultOverridden,
  } as Prisma.InputJsonValue;
}

function buildIdentityAuditMetadata(
  actorId: string,
  payload: {
    ticketId: string;
    targetUserAccountId: string;
    targetIdentityId?: string;
    providerType?: string;
    issuer?: string;
    providerSubject?: string;
    changedFields?: string[];
    beforeState?: Record<
      string,
      Prisma.InputJsonValue | null | undefined
    > | null;
    afterState?: Record<
      string,
      Prisma.InputJsonValue | null | undefined
    > | null;
    mfaRequired?: boolean;
    mfaDefaultOverridden?: boolean;
  },
) {
  return {
    actorAdminUserId: actorId,
    targetUserAccountId: payload.targetUserAccountId,
    targetIdentityId: payload.targetIdentityId,
    ticketId: payload.ticketId,
    providerType: payload.providerType,
    issuer: payload.issuer,
    providerSubject: payload.providerSubject,
    changedFields: payload.changedFields,
    beforeState: payload.beforeState ?? null,
    afterState: payload.afterState ?? null,
    mfaRequired: payload.mfaRequired,
    mfaDefaultOverridden: payload.mfaDefaultOverridden,
  } as Prisma.InputJsonValue;
}

function resolveIssuedLocalCredentialMfaRequired(mfaRequired: unknown) {
  return mfaRequired !== false;
}

function appendMfaPasswordOnlyOverrideValidation(
  invalidFields: string[],
  mfaRequired: boolean,
  reasonText: string | undefined,
) {
  if (!mfaRequired && !reasonText) {
    invalidFields.push('reasonText');
  }
}

function snapshotIdentityState(identity: {
  status: string;
  effectiveUntil?: Date | null;
  rollbackWindowUntil?: Date | null;
  note?: string | null;
}) {
  return {
    status: identity.status,
    effectiveUntil: identity.effectiveUntil?.toISOString() ?? null,
    rollbackWindowUntil: identity.rollbackWindowUntil?.toISOString() ?? null,
    note: identity.note ?? null,
  };
}

const localCredentialIdentitySchema = Type.Object(
  {
    identityId: Type.String(),
    userAccountId: Type.String(),
    userName: Type.Optional(Type.String()),
    displayName: Type.Union([Type.String(), Type.Null()]),
    userActive: Type.Boolean(),
    userDeletedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    providerType: Type.String(),
    issuer: Type.String(),
    providerSubject: Type.String(),
    status: Type.String(),
    loginId: Type.String(),
    passwordAlgo: Type.String(),
    mfaRequired: Type.Boolean(),
    mfaSecretConfigured: Type.Boolean(),
    failedAttempts: Type.Integer(),
    lockedUntil: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    passwordChangedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    lastAuthenticatedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    linkedAt: Type.String({ format: 'date-time' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

const localCredentialListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    items: Type.Array(localCredentialIdentitySchema),
  },
  { additionalProperties: false },
);

const localCredentialErrorResponseSchema = Type.Object(
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

const userIdentitySchema = Type.Object(
  {
    identityId: Type.String(),
    userAccountId: Type.String(),
    userName: Type.Optional(Type.String()),
    displayName: Type.Union([Type.String(), Type.Null()]),
    userActive: Type.Boolean(),
    userDeletedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    providerType: Type.String(),
    issuer: Type.String(),
    providerSubject: Type.String(),
    emailSnapshot: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
    lastAuthenticatedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    linkedAt: Type.String({ format: 'date-time' }),
    effectiveUntil: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    rollbackWindowUntil: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
    note: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    localCredential: Type.Union([
      Type.Object(
        {
          loginId: Type.String(),
          passwordAlgo: Type.String(),
          mfaRequired: Type.Boolean(),
          mfaSecretConfigured: Type.Boolean(),
          mustRotatePassword: Type.Boolean(),
          failedAttempts: Type.Integer(),
          lockedUntil: Type.Union([
            Type.String({ format: 'date-time' }),
            Type.Null(),
          ]),
          passwordChangedAt: Type.Union([
            Type.String({ format: 'date-time' }),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const userIdentityListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    items: Type.Array(userIdentitySchema),
  },
  { additionalProperties: false },
);

function buildLocalCredentialSelect() {
  return {
    id: true,
    userAccountId: true,
    providerType: true,
    providerSubject: true,
    issuer: true,
    status: true,
    lastAuthenticatedAt: true,
    linkedAt: true,
    createdAt: true,
    updatedAt: true,
    userAccount: {
      select: {
        id: true,
        userName: true,
        displayName: true,
        active: true,
        deletedAt: true,
      },
    },
    localCredential: {
      select: {
        id: true,
        loginId: true,
        passwordAlgo: true,
        mfaRequired: true,
        mfaSecretRef: true,
        failedAttempts: true,
        lockedUntil: true,
        passwordChangedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    },
  } as const;
}

function buildLocalCredentialAuthSelect() {
  return {
    id: true,
    userAccountId: true,
    providerType: true,
    providerSubject: true,
    issuer: true,
    status: true,
    effectiveUntil: true,
    userAccount: {
      select: {
        id: true,
        userName: true,
        displayName: true,
        active: true,
        deletedAt: true,
      },
    },
    localCredential: {
      select: {
        id: true,
        loginId: true,
        passwordHash: true,
        passwordAlgo: true,
        mfaRequired: true,
        mfaSecretRef: true,
        mustRotatePassword: true,
        failedAttempts: true,
        lockedUntil: true,
        passwordChangedAt: true,
      },
    },
  } as const;
}

function buildUserIdentitySelect() {
  return {
    id: true,
    userAccountId: true,
    providerType: true,
    providerSubject: true,
    issuer: true,
    emailSnapshot: true,
    status: true,
    lastAuthenticatedAt: true,
    linkedAt: true,
    effectiveUntil: true,
    rollbackWindowUntil: true,
    note: true,
    createdAt: true,
    updatedAt: true,
    userAccount: {
      select: {
        id: true,
        userName: true,
        displayName: true,
        active: true,
        deletedAt: true,
      },
    },
    localCredential: {
      select: {
        loginId: true,
        passwordAlgo: true,
        mfaRequired: true,
        mfaSecretRef: true,
        mustRotatePassword: true,
        failedAttempts: true,
        lockedUntil: true,
        passwordChangedAt: true,
      },
    },
  } as const;
}

type UserIdentityRecord = Prisma.UserIdentityGetPayload<{
  select: ReturnType<typeof buildUserIdentitySelect>;
}>;

type LocalCredentialAuthRecord = Prisma.UserIdentityGetPayload<{
  select: ReturnType<typeof buildLocalCredentialAuthSelect>;
}>;

function serializeUserIdentity(identity: UserIdentityRecord) {
  return {
    identityId: identity.id,
    userAccountId: identity.userAccountId,
    userName: identity.userAccount?.userName,
    displayName: identity.userAccount?.displayName ?? null,
    userActive: identity.userAccount?.active ?? true,
    userDeletedAt: identity.userAccount?.deletedAt ?? null,
    providerType: identity.providerType,
    issuer: identity.issuer,
    providerSubject: identity.providerSubject,
    emailSnapshot: identity.emailSnapshot ?? null,
    status: identity.status,
    lastAuthenticatedAt: identity.lastAuthenticatedAt,
    linkedAt: identity.linkedAt,
    effectiveUntil: identity.effectiveUntil ?? null,
    rollbackWindowUntil: identity.rollbackWindowUntil ?? null,
    note: identity.note ?? null,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    localCredential: identity.localCredential
      ? {
          loginId: identity.localCredential.loginId,
          passwordAlgo: identity.localCredential.passwordAlgo,
          mfaRequired: identity.localCredential.mfaRequired,
          mfaSecretConfigured: Boolean(identity.localCredential.mfaSecretRef),
          mustRotatePassword: identity.localCredential.mustRotatePassword,
          failedAttempts: identity.localCredential.failedAttempts,
          lockedUntil: identity.localCredential.lockedUntil,
          passwordChangedAt: identity.localCredential.passwordChangedAt,
        }
      : null,
  };
}

function isIdentityEffectivelyActive(identity: {
  status: string;
  effectiveUntil?: Date | null;
}) {
  return (
    identity.status === 'active' &&
    (!identity.effectiveUntil || identity.effectiveUntil.getTime() > Date.now())
  );
}

function isLocalCredentialUsable(identity: LocalCredentialAuthRecord | null) {
  if (!identity || !identity.localCredential) return false;
  if (!isIdentityEffectivelyActive(identity)) return false;
  if (!identity.userAccount?.active || identity.userAccount.deletedAt) {
    return false;
  }
  return true;
}

function respondLocalLoginFailed(
  reply: FastifyReply,
  reason = 'invalid_credentials',
) {
  return reply.code(401).send(
    createApiErrorResponse(
      'local_login_failed',
      'Invalid local login credentials',
      {
        category: 'auth',
        details: { reason },
      },
    ),
  );
}

async function incrementLocalCredentialFailure(
  credentialId: string,
  updatedBy: string,
) {
  const updated = await prisma.localCredential.update({
    where: { id: credentialId },
    data: {
      failedAttempts: { increment: 1 },
      updatedBy,
    },
    select: {
      failedAttempts: true,
      lockedUntil: true,
    },
  });
  const nextLockedUntil = computeLocalCredentialLockUntil(
    updated.failedAttempts,
  );
  if (
    nextLockedUntil &&
    (!updated.lockedUntil ||
      updated.lockedUntil.getTime() < nextLockedUntil.getTime())
  ) {
    return prisma.localCredential.update({
      where: { id: credentialId },
      data: {
        lockedUntil: nextLockedUntil,
        updatedBy,
      },
      select: {
        failedAttempts: true,
        lockedUntil: true,
      },
    });
  }
  return updated;
}

async function resetLocalCredentialFailures(
  credentialId: string,
  updatedBy: string,
) {
  return prisma.localCredential.update({
    where: { id: credentialId },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      updatedBy,
    },
    select: {
      failedAttempts: true,
      lockedUntil: true,
    },
  });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const user = req.user || demoUser;
    const isPrivileged =
      user.roles.includes('admin') || user.roles.includes('mgmt');
    const ownerProjects = isPrivileged
      ? 'all'
      : user.projectIds || demoUser.projectIds;
    const ownerOrgId = isPrivileged
      ? user.orgId || 'all'
      : user.orgId || demoUser.orgId;
    return { user: { ...user, ownerOrgId, ownerProjects } };
  });

  await registerGoogleSessionAuthRoutes(app);

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
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      try {
        await localLoginFlexibleLimiter.consume(req.ip || 'unknown');
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_login_rate_limited',
              'Too many local login requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;

      const body = (req.body || {}) as { loginId: string; password: string };
      const loginId = normalizeLocalLoginId(body.loginId);
      const password = typeof body.password === 'string' ? body.password : '';
      const invalidFields: string[] = [];
      if (!loginId) invalidFields.push('loginId');
      if (!password) invalidFields.push('password');
      if (invalidFields.length) {
        return respondLocalAuthValidationError(
          reply,
          'invalid_local_login_payload',
          'Invalid local login payload',
          invalidFields,
        );
      }

      const identity = await prisma.userIdentity.findFirst({
        where: {
          providerType: LOCAL_IDENTITY_PROVIDER,
          issuer: LOCAL_IDENTITY_ISSUER,
          localCredential: {
            is: {
              loginId,
            },
          },
        },
        select: buildLocalCredentialAuthSelect(),
      });
      if (
        !identity ||
        !identity.localCredential ||
        !isLocalCredentialUsable(identity)
      ) {
        await logAudit({
          action: 'local_login_failed',
          targetTable: 'LocalCredential',
          reasonCode: 'invalid_credentials',
          metadata: {
            loginId,
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply);
      }

      const credential = identity.localCredential;
      if (isLocalCredentialLocked(credential.lockedUntil)) {
        await logAudit({
          action: 'local_login_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'credential_locked',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            lockedUntil: credential.lockedUntil?.toISOString() ?? null,
          },
          ...auditContextFromRequest(req),
        });
        return reply.code(423).send(
          createApiErrorResponse(
            'local_credential_locked',
            'Local credential is temporarily locked',
            {
              category: 'auth',
              details: {
                lockedUntil: credential.lockedUntil?.toISOString() ?? null,
              },
            },
          ),
        );
      }

      let passwordMatched = false;
      try {
        passwordMatched = await verifyLocalPassword(
          credential.passwordHash,
          password,
        );
      } catch (err) {
        await logAudit({
          action: 'local_login_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'credential_verification_error',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply, 'credential_verification_error');
      }
      if (!passwordMatched) {
        const failedCredential = await incrementLocalCredentialFailure(
          credential.id,
          identity.providerSubject,
        );
        await logAudit({
          action: 'local_login_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: failedCredential.lockedUntil
            ? 'locked_after_failed_attempts'
            : 'invalid_credentials',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            failedAttempts: failedCredential.failedAttempts,
            lockedUntil: failedCredential.lockedUntil?.toISOString() ?? null,
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply);
      }

      await resetLocalCredentialFailures(
        credential.id,
        identity.providerSubject,
      );

      if (credential.mustRotatePassword) {
        await logAudit({
          action: 'local_login_blocked',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'password_rotation_required',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
          },
          ...auditContextFromRequest(req),
        });
        return reply.code(409).send(
          createApiErrorResponse(
            'local_password_rotation_required',
            'Local password rotation is required before login',
            {
              category: 'auth',
              details: { reason: 'password_rotation_required' },
            },
          ),
        );
      }

      if (credential.mfaRequired && !credential.mfaSecretRef) {
        await logAudit({
          action: 'local_login_blocked',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'mfa_setup_required',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
          },
          ...auditContextFromRequest(req),
        });
        return reply.code(409).send(
          createApiErrorResponse(
            'local_mfa_setup_required',
            'Local MFA setup is required before login',
            {
              category: 'auth',
              details: { reason: 'mfa_setup_required' },
            },
          ),
        );
      }

      if (credential.mfaRequired) {
        await logAudit({
          action: 'local_login_blocked',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'mfa_challenge_required',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
          },
          ...auditContextFromRequest(req),
        });
        return reply.code(409).send(
          createApiErrorResponse(
            'local_mfa_challenge_required',
            'Local MFA challenge is required before login',
            {
              category: 'auth',
              details: { reason: 'mfa_challenge_required' },
            },
          ),
        );
      }

      const now = new Date();
      await prisma.userIdentity.update({
        where: { id: identity.id },
        data: {
          lastAuthenticatedAt: now,
          updatedBy: identity.providerSubject,
        },
      });
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
        action: 'local_login_succeeded',
        targetTable: 'AuthSession',
        targetId: session.id,
        metadata: {
          loginId,
          userAccountId: identity.userAccountId,
          identityId: identity.id,
          sessionId: session.id,
        },
        ...auditContextFromRequest(req),
      });
      reply.header('set-cookie', setCookie);
      return reply.code(204).send();
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
      if (!isJwtBffAuthMode()) {
        return respondAuthGatewayDisabled(reply);
      }
      try {
        await localLoginFlexibleLimiter.consume(req.ip || 'unknown');
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_login_rate_limited',
              'Too many local login requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;

      const body = (req.body || {}) as {
        loginId: string;
        currentPassword: string;
        newPassword: string;
      };
      const loginId = normalizeLocalLoginId(body.loginId);
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const { password: newPassword, invalidFields: passwordInvalidFields } =
        validateLocalPassword(body.newPassword);
      const invalidFields = [...passwordInvalidFields];
      if (!loginId) invalidFields.push('loginId');
      if (!currentPassword) invalidFields.push('currentPassword');
      if (invalidFields.length) {
        return respondLocalAuthValidationError(
          reply,
          'invalid_local_password_rotation_payload',
          'Invalid local password rotation payload',
          Array.from(new Set(invalidFields)),
        );
      }

      const identity = await prisma.userIdentity.findFirst({
        where: {
          providerType: LOCAL_IDENTITY_PROVIDER,
          issuer: LOCAL_IDENTITY_ISSUER,
          localCredential: {
            is: {
              loginId,
            },
          },
        },
        select: buildLocalCredentialAuthSelect(),
      });
      if (
        !identity ||
        !identity.localCredential ||
        !isLocalCredentialUsable(identity)
      ) {
        await logAudit({
          action: 'local_password_rotation_failed',
          targetTable: 'LocalCredential',
          reasonCode: 'invalid_credentials',
          metadata: {
            loginId,
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply);
      }

      const credential = identity.localCredential;
      if (isLocalCredentialLocked(credential.lockedUntil)) {
        await logAudit({
          action: 'local_password_rotation_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'credential_locked',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            lockedUntil: credential.lockedUntil?.toISOString() ?? null,
          },
          ...auditContextFromRequest(req),
        });
        return reply.code(423).send(
          createApiErrorResponse(
            'local_credential_locked',
            'Local credential is temporarily locked',
            {
              category: 'auth',
              details: {
                lockedUntil: credential.lockedUntil?.toISOString() ?? null,
              },
            },
          ),
        );
      }

      let passwordMatched = false;
      try {
        passwordMatched = await verifyLocalPassword(
          credential.passwordHash,
          currentPassword,
        );
      } catch (err) {
        await logAudit({
          action: 'local_password_rotation_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: 'credential_verification_error',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply, 'credential_verification_error');
      }
      if (!passwordMatched) {
        const failedCredential = await incrementLocalCredentialFailure(
          credential.id,
          identity.providerSubject,
        );
        await logAudit({
          action: 'local_password_rotation_failed',
          targetTable: 'LocalCredential',
          targetId: credential.id,
          reasonCode: failedCredential.lockedUntil
            ? 'locked_after_failed_attempts'
            : 'invalid_credentials',
          metadata: {
            loginId,
            userAccountId: identity.userAccountId,
            identityId: identity.id,
            failedAttempts: failedCredential.failedAttempts,
            lockedUntil: failedCredential.lockedUntil?.toISOString() ?? null,
          },
          ...auditContextFromRequest(req),
        });
        return respondLocalLoginFailed(reply);
      }

      await resetLocalCredentialFailures(
        credential.id,
        identity.providerSubject,
      );

      if (!credential.mustRotatePassword) {
        return reply.code(409).send(
          createApiErrorResponse(
            'local_password_rotation_not_required',
            'Local password rotation is not required',
            {
              category: 'conflict',
              details: { reason: 'password_rotation_not_required' },
            },
          ),
        );
      }

      const currentAndNextSame = await verifyLocalPassword(
        credential.passwordHash,
        newPassword,
      );
      if (currentAndNextSame) {
        return respondLocalAuthValidationError(
          reply,
          'invalid_local_password_rotation_payload',
          'Invalid local password rotation payload',
          ['newPassword'],
        );
      }

      await prisma.localCredential.update({
        where: { id: credential.id },
        data: {
          passwordHash: await hashLocalPassword(newPassword),
          passwordAlgo: 'argon2id',
          mustRotatePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
          updatedBy: identity.providerSubject,
        },
      });
      await logAudit({
        action: 'local_password_rotated',
        targetTable: 'LocalCredential',
        targetId: credential.id,
        metadata: {
          loginId,
          userAccountId: identity.userAccountId,
          identityId: identity.id,
        },
        ...auditContextFromRequest(req),
      });
      return reply.code(204).send();
    },
  );

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
      const query = (req.query || {}) as {
        userAccountId?: string;
        providerType?: string;
        status?: string;
        limit?: number;
        offset?: number;
      };
      const where: Prisma.UserIdentityWhereInput = {};
      if (query.userAccountId) where.userAccountId = query.userAccountId;
      if (query.providerType) where.providerType = query.providerType;
      if (query.status) where.status = query.status;
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const items = await prisma.userIdentity.findMany({
        where,
        select: buildUserIdentitySelect(),
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        skip: offset,
      });
      return {
        limit,
        offset,
        items: items.map((item) => serializeUserIdentity(item)),
      };
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
      try {
        await localCredentialAdminFlexibleLimiter.consume(req.ip);
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_credential_rate_limited',
              'Too many local credential admin requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;

      const body = req.body as {
        userAccountId: string;
        issuer: string;
        providerSubject: string;
        emailSnapshot?: string | null;
        effectiveUntil?: string | null;
        rollbackWindowUntil?: string | null;
        note?: string | null;
        ticketId: string;
        reasonCode: string;
        reasonText?: string;
      };
      const userAccountId = normalizeOptionalString(body.userAccountId);
      const issuer = normalizeOptionalString(body.issuer);
      const providerSubject = normalizeOptionalString(body.providerSubject);
      const emailSnapshot =
        body.emailSnapshot === null
          ? null
          : normalizeOptionalString(body.emailSnapshot) || null;
      const note =
        body.note === null ? null : normalizeOptionalString(body.note) || null;
      const ticketId = normalizeOptionalString(body.ticketId);
      const reasonCode = normalizeOptionalString(body.reasonCode);
      const reasonText = normalizeOptionalString(body.reasonText) || undefined;
      const effectiveUntil = parseIdentityWindow(
        body.effectiveUntil,
        'effectiveUntil',
      );
      const rollbackWindowUntil = parseIdentityWindow(
        body.rollbackWindowUntil,
        'rollbackWindowUntil',
      );
      const invalidFields: string[] = [];
      if (!userAccountId) invalidFields.push('userAccountId');
      if (!issuer) invalidFields.push('issuer');
      if (!providerSubject) invalidFields.push('providerSubject');
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
      if (effectiveUntil.invalidField)
        invalidFields.push(effectiveUntil.invalidField);
      if (rollbackWindowUntil.invalidField) {
        invalidFields.push(rollbackWindowUntil.invalidField);
      }
      if (
        rollbackWindowUntil.value &&
        rollbackWindowUntil.value.getTime() <= Date.now()
      ) {
        invalidFields.push('rollbackWindowUntil');
      }
      if (invalidFields.length) {
        return respondValidationError(
          reply,
          Array.from(new Set(invalidFields)),
        );
      }

      const userAccount = await prisma.userAccount.findUnique({
        where: { id: userAccountId },
        select: {
          id: true,
          active: true,
          deletedAt: true,
          identities: {
            where: { providerType: 'google_oidc' },
            select: { id: true },
          },
        },
      });
      if (!userAccount) {
        return reply.code(404).send(
          createApiErrorResponse(
            'user_account_not_found',
            'User account not found',
            {
              category: 'not_found',
            },
          ),
        );
      }
      if (!userAccount.active || userAccount.deletedAt) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'user_identity_user_inactive',
              'Inactive or deleted user cannot receive identities',
              { category: 'conflict' },
            ),
          );
      }
      if (userAccount.identities.length > 0) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'google_identity_exists_for_account',
              'Google identity already exists for user account',
              { category: 'conflict' },
            ),
          );
      }

      try {
        const created = await prisma.userIdentity.create({
          data: {
            userAccountId,
            providerType: 'google_oidc',
            issuer,
            providerSubject,
            emailSnapshot,
            status: 'active',
            effectiveUntil: effectiveUntil.value,
            rollbackWindowUntil: rollbackWindowUntil.value,
            note,
            createdBy: actorId,
            updatedBy: actorId,
          },
          select: buildUserIdentitySelect(),
        });
        await logAudit({
          action: 'user_identity_google_linked',
          targetTable: 'UserIdentity',
          targetId: created.id,
          reasonCode,
          reasonText,
          metadata: buildIdentityAuditMetadata(actorId, {
            ticketId,
            targetUserAccountId: userAccountId,
            targetIdentityId: created.id,
            providerType: created.providerType,
            issuer: created.issuer,
            providerSubject: created.providerSubject,
            changedFields: [
              'providerType',
              'issuer',
              'providerSubject',
              'effectiveUntil',
              'rollbackWindowUntil',
              'note',
            ],
            beforeState: null,
            afterState: snapshotIdentityState(created),
          }),
          ...auditContextFromRequest(req),
        });
        clearUserDbContextCache();
        return reply.code(201).send(serializeUserIdentity(created));
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const targets = Array.isArray(err.meta?.target)
            ? err.meta.target.map(String)
            : [];
          const errorCode = targets.includes('providerSubject')
            ? 'google_identity_subject_exists'
            : 'google_identity_exists_for_account';
          return reply
            .code(409)
            .send(
              createApiErrorResponse(
                errorCode,
                errorCode === 'google_identity_subject_exists'
                  ? 'Google identity subject already exists'
                  : 'Google identity already exists for user account',
                { category: 'conflict' },
              ),
            );
        }
        throw err;
      }
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
      try {
        await localCredentialAdminFlexibleLimiter.consume(req.ip);
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_credential_rate_limited',
              'Too many local credential admin requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;

      const body = req.body as {
        userAccountId: string;
        loginId: string;
        password: string;
        effectiveUntil?: string | null;
        rollbackWindowUntil?: string | null;
        note?: string | null;
        ticketId: string;
        reasonCode: string;
        reasonText?: string;
        mfaRequired?: boolean;
      };
      const userAccountId = normalizeOptionalString(body.userAccountId);
      const loginId = normalizeLocalLoginId(body.loginId);
      const note =
        body.note === null ? null : normalizeOptionalString(body.note) || null;
      const ticketId = normalizeOptionalString(body.ticketId);
      const reasonCode = normalizeOptionalString(body.reasonCode);
      const reasonText = normalizeOptionalString(body.reasonText) || undefined;
      const mfaRequired = resolveIssuedLocalCredentialMfaRequired(
        body.mfaRequired,
      );
      const effectiveUntil = parseIdentityWindow(
        body.effectiveUntil,
        'effectiveUntil',
      );
      const rollbackWindowUntil = parseIdentityWindow(
        body.rollbackWindowUntil,
        'rollbackWindowUntil',
      );
      const { password, invalidFields: passwordInvalidFields } =
        validateLocalPassword(body.password);
      const invalidFields = [...passwordInvalidFields];
      if (!userAccountId) invalidFields.push('userAccountId');
      if (!loginId) invalidFields.push('loginId');
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
      appendMfaPasswordOnlyOverrideValidation(
        invalidFields,
        mfaRequired,
        reasonText,
      );
      if (effectiveUntil.invalidField)
        invalidFields.push(effectiveUntil.invalidField);
      if (rollbackWindowUntil.invalidField) {
        invalidFields.push(rollbackWindowUntil.invalidField);
      }
      if (
        rollbackWindowUntil.value &&
        rollbackWindowUntil.value.getTime() <= Date.now()
      ) {
        invalidFields.push('rollbackWindowUntil');
      }
      if (invalidFields.length) {
        return respondValidationError(
          reply,
          Array.from(new Set(invalidFields)),
        );
      }

      const userAccount = await prisma.userAccount.findUnique({
        where: { id: userAccountId },
        select: {
          id: true,
          userName: true,
          displayName: true,
          active: true,
          deletedAt: true,
          identities: {
            where: {
              providerType: LOCAL_IDENTITY_PROVIDER,
              issuer: LOCAL_IDENTITY_ISSUER,
            },
            select: { id: true },
          },
        },
      });
      if (!userAccount) {
        return reply.code(404).send(
          createApiErrorResponse(
            'user_account_not_found',
            'User account not found',
            {
              category: 'not_found',
            },
          ),
        );
      }
      if (!userAccount.active || userAccount.deletedAt) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_credential_user_inactive',
              'Inactive or deleted user cannot receive local credentials',
              { category: 'conflict' },
            ),
          );
      }
      if (userAccount.identities.length > 0) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_credential_exists',
              'Local credential already exists for user account',
              { category: 'conflict' },
            ),
          );
      }
      const existingLogin = await prisma.localCredential.findUnique({
        where: { loginId },
        select: { id: true },
      });
      if (existingLogin) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_login_id_exists',
              'loginId already exists',
              { category: 'conflict' },
            ),
          );
      }

      const now = new Date();
      const passwordHash = await hashLocalPassword(password);
      try {
        const created = await prisma.userIdentity.create({
          data: {
            userAccountId,
            providerType: LOCAL_IDENTITY_PROVIDER,
            issuer: LOCAL_IDENTITY_ISSUER,
            providerSubject: buildLocalProviderSubject(),
            emailSnapshot: null,
            status: 'active',
            effectiveUntil: effectiveUntil.value,
            rollbackWindowUntil: rollbackWindowUntil.value,
            note,
            createdBy: actorId,
            updatedBy: actorId,
            localCredential: {
              create: {
                loginId,
                passwordHash,
                passwordAlgo: 'argon2id',
                mfaRequired,
                mustRotatePassword: true,
                failedAttempts: 0,
                passwordChangedAt: now,
                createdBy: actorId,
                updatedBy: actorId,
              },
            },
          },
          select: buildUserIdentitySelect(),
        });
        await logAudit({
          action: 'user_identity_local_linked',
          targetTable: 'UserIdentity',
          targetId: created.id,
          reasonCode,
          reasonText,
          metadata: buildIdentityAuditMetadata(actorId, {
            ticketId,
            targetUserAccountId: userAccountId,
            targetIdentityId: created.id,
            providerType: created.providerType,
            issuer: created.issuer,
            providerSubject: created.providerSubject,
            changedFields: [
              'providerType',
              'issuer',
              'providerSubject',
              'loginId',
              'effectiveUntil',
              'rollbackWindowUntil',
              'note',
              'mfaRequired',
              'mustRotatePassword',
            ],
            beforeState: null,
            afterState: snapshotIdentityState(created),
            mfaRequired: created.localCredential?.mfaRequired,
            mfaDefaultOverridden: !mfaRequired,
          }),
          ...auditContextFromRequest(req),
        });
        clearUserDbContextCache();
        return reply.code(201).send(serializeUserIdentity(created));
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const targets = Array.isArray(err.meta?.target)
            ? err.meta.target.map(String)
            : [];
          const errorCode = targets.includes('loginId')
            ? 'local_login_id_exists'
            : 'local_credential_exists';
          return reply
            .code(409)
            .send(
              createApiErrorResponse(
                errorCode,
                errorCode === 'local_login_id_exists'
                  ? 'loginId already exists'
                  : 'Local credential already exists for user account',
                { category: 'conflict' },
              ),
            );
        }
        throw err;
      }
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
      try {
        await localCredentialAdminFlexibleLimiter.consume(req.ip);
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_credential_rate_limited',
              'Too many local credential admin requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;

      const { identityId } = req.params as { identityId: string };
      const body = req.body as {
        status?: 'active' | 'disabled';
        effectiveUntil?: string | null;
        rollbackWindowUntil?: string | null;
        note?: string | null;
        ticketId: string;
        reasonCode: string;
        reasonText?: string;
      };
      const ticketId = normalizeOptionalString(body.ticketId);
      const reasonCode = normalizeOptionalString(body.reasonCode);
      const reasonText = normalizeOptionalString(body.reasonText) || undefined;
      const effectiveUntil = parseIdentityWindow(
        body.effectiveUntil,
        'effectiveUntil',
      );
      const rollbackWindowUntil = parseIdentityWindow(
        body.rollbackWindowUntil,
        'rollbackWindowUntil',
      );
      const note =
        body.note === undefined
          ? undefined
          : body.note === null
            ? null
            : normalizeOptionalString(body.note) || null;
      const invalidFields: string[] = [];
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
      if (effectiveUntil.invalidField)
        invalidFields.push(effectiveUntil.invalidField);
      if (rollbackWindowUntil.invalidField) {
        invalidFields.push(rollbackWindowUntil.invalidField);
      }
      if (
        rollbackWindowUntil.value &&
        rollbackWindowUntil.value.getTime() <= Date.now()
      ) {
        invalidFields.push('rollbackWindowUntil');
      }
      if (invalidFields.length) {
        return respondValidationError(
          reply,
          Array.from(new Set(invalidFields)),
        );
      }

      let current: UserIdentityRecord | null = null;
      let updated: UserIdentityRecord | null = null;
      let changedFields: string[] = [];

      try {
        const transactionResult = await prisma.$transaction(
          async (tx) => {
            const currentIdentity = await tx.userIdentity.findUnique({
              where: { id: identityId },
              select: buildUserIdentitySelect(),
            });
            if (!currentIdentity) {
              return {
                kind: 'not_found' as const,
              };
            }

            const updateData: Prisma.UserIdentityUpdateInput = {
              updatedBy: actorId,
            };
            const transactionChangedFields: string[] = [];
            if (body.status && body.status !== currentIdentity.status) {
              updateData.status = body.status;
              transactionChangedFields.push('status');
            }
            if (effectiveUntil.provided) {
              const nextIso = effectiveUntil.value?.toISOString() ?? null;
              const currentIso =
                currentIdentity.effectiveUntil?.toISOString() ?? null;
              if (nextIso !== currentIso) {
                updateData.effectiveUntil = effectiveUntil.value;
                transactionChangedFields.push('effectiveUntil');
              }
            }
            if (rollbackWindowUntil.provided) {
              const nextIso = rollbackWindowUntil.value?.toISOString() ?? null;
              const currentIso =
                currentIdentity.rollbackWindowUntil?.toISOString() ?? null;
              if (nextIso !== currentIso) {
                updateData.rollbackWindowUntil = rollbackWindowUntil.value;
                transactionChangedFields.push('rollbackWindowUntil');
              }
            }
            if (note !== undefined && note !== (currentIdentity.note ?? null)) {
              updateData.note = note;
              transactionChangedFields.push('note');
            }
            if (!transactionChangedFields.length) {
              return {
                kind: 'noop' as const,
                currentIdentity,
              };
            }

            const resultingStatus =
              (updateData.status as string | undefined) ??
              currentIdentity.status;
            const resultingEffectiveUntil = effectiveUntil.provided
              ? (effectiveUntil.value ?? null)
              : currentIdentity.effectiveUntil;
            const willRemainUsable =
              resultingStatus === 'active' &&
              (!resultingEffectiveUntil ||
                resultingEffectiveUntil.getTime() > Date.now());
            if (
              !willRemainUsable &&
              isIdentityEffectivelyActive(currentIdentity)
            ) {
              const alternativeActiveCount = await tx.userIdentity.count({
                where: {
                  userAccountId: currentIdentity.userAccountId,
                  id: { not: currentIdentity.id },
                  status: 'active',
                  OR: [
                    { effectiveUntil: null },
                    { effectiveUntil: { gt: new Date() } },
                  ],
                },
              });
              if (alternativeActiveCount === 0) {
                return {
                  kind: 'last_active_conflict' as const,
                };
              }
            }

            const updatedIdentity = await tx.userIdentity.update({
              where: { id: identityId },
              data: updateData,
              select: buildUserIdentitySelect(),
            });
            return {
              kind: 'updated' as const,
              currentIdentity,
              updatedIdentity,
              transactionChangedFields,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        if (transactionResult.kind === 'not_found') {
          return reply.code(404).send(
            createApiErrorResponse(
              'user_identity_not_found',
              'User identity not found',
              {
                category: 'not_found',
              },
            ),
          );
        }
        if (transactionResult.kind === 'last_active_conflict') {
          return reply
            .code(409)
            .send(
              createApiErrorResponse(
                'identity_last_active_conflict',
                'Cannot disable the last active identity',
                { category: 'conflict' },
              ),
            );
        }
        if (transactionResult.kind === 'noop') {
          return serializeUserIdentity(transactionResult.currentIdentity);
        }

        current = transactionResult.currentIdentity;
        updated = transactionResult.updatedIdentity;
        changedFields = transactionResult.transactionChangedFields;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034'
        ) {
          return reply
            .code(409)
            .send(
              createApiErrorResponse(
                'identity_update_conflict',
                'Concurrent identity update detected',
                { category: 'conflict' },
              ),
            );
        }
        throw err;
      }

      if (!current || !updated) {
        throw new Error('identity update transaction returned no result');
      }
      await logAudit({
        action: 'user_identity_updated',
        targetTable: 'UserIdentity',
        targetId: updated.id,
        reasonCode,
        reasonText,
        metadata: buildIdentityAuditMetadata(actorId, {
          ticketId,
          targetUserAccountId: updated.userAccountId,
          targetIdentityId: updated.id,
          providerType: updated.providerType,
          issuer: updated.issuer,
          providerSubject: updated.providerSubject,
          changedFields,
          beforeState: snapshotIdentityState(current),
          afterState: snapshotIdentityState(updated),
        }),
        ...auditContextFromRequest(req),
      });
      clearUserDbContextCache();
      return serializeUserIdentity(updated);
    },
  );

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
      const query = (req.query || {}) as {
        userAccountId?: string;
        status?: string;
        limit?: number;
        offset?: number;
      };
      const where: Prisma.UserIdentityWhereInput = {
        providerType: LOCAL_IDENTITY_PROVIDER,
        issuer: LOCAL_IDENTITY_ISSUER,
        localCredential: { isNot: null },
      };
      if (query.userAccountId) where.userAccountId = query.userAccountId;
      if (query.status) where.status = query.status;
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const items = await prisma.userIdentity.findMany({
        where,
        select: buildLocalCredentialSelect(),
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        skip: offset,
      });
      return {
        limit,
        offset,
        items: items.map((item) => serializeLocalCredentialIdentity(item)),
      };
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
      try {
        await localCredentialAdminFlexibleLimiter.consume(req.ip);
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_credential_rate_limited',
              'Too many local credential admin requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;
      const body = req.body as {
        userAccountId: string;
        loginId: string;
        password: string;
        mfaRequired?: boolean;
        ticketId: string;
        reasonCode: string;
        reasonText?: string;
      };
      const loginId = normalizeLocalLoginId(body.loginId);
      const ticketId = normalizeOptionalString(body.ticketId);
      const reasonCode = normalizeOptionalString(body.reasonCode);
      const reasonText = normalizeOptionalString(body.reasonText) || undefined;
      const mfaRequired = resolveIssuedLocalCredentialMfaRequired(
        body.mfaRequired,
      );
      const { password, invalidFields: passwordInvalidFields } =
        validateLocalPassword(body.password);
      const invalidFields = [...passwordInvalidFields];
      if (!body.userAccountId?.trim()) invalidFields.push('userAccountId');
      if (!loginId) invalidFields.push('loginId');
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
      appendMfaPasswordOnlyOverrideValidation(
        invalidFields,
        mfaRequired,
        reasonText,
      );
      if (invalidFields.length) {
        return respondValidationError(
          reply,
          Array.from(new Set(invalidFields)),
        );
      }
      const userAccount = await prisma.userAccount.findUnique({
        where: { id: body.userAccountId.trim() },
        select: {
          id: true,
          userName: true,
          displayName: true,
          active: true,
          deletedAt: true,
          identities: {
            where: { providerType: LOCAL_IDENTITY_PROVIDER },
            select: {
              id: true,
              status: true,
              localCredential: { select: { id: true } },
            },
          },
        },
      });
      if (!userAccount) {
        return reply
          .code(404)
          .send(
            createApiErrorResponse(
              'user_account_not_found',
              'User account not found',
              { category: 'not_found' },
            ),
          );
      }
      if (!userAccount.active || userAccount.deletedAt) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_credential_user_inactive',
              'Inactive or deleted user cannot receive local credentials',
              { category: 'conflict' },
            ),
          );
      }
      if (userAccount.identities.length > 0) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_credential_exists',
              'Local credential already exists for user account',
              { category: 'conflict' },
            ),
          );
      }
      const existingLogin = await prisma.localCredential.findUnique({
        where: { loginId },
        select: { id: true },
      });
      if (existingLogin) {
        return reply
          .code(409)
          .send(
            createApiErrorResponse(
              'local_login_id_exists',
              'loginId already exists',
              { category: 'conflict' },
            ),
          );
      }
      const now = new Date();
      const passwordHash = await hashLocalPassword(password);
      try {
        const created = await prisma.userIdentity.create({
          data: {
            userAccountId: userAccount.id,
            providerType: LOCAL_IDENTITY_PROVIDER,
            issuer: LOCAL_IDENTITY_ISSUER,
            providerSubject: buildLocalProviderSubject(),
            emailSnapshot: null,
            status: 'active',
            createdBy: actorId,
            updatedBy: actorId,
            localCredential: {
              create: {
                loginId,
                passwordHash,
                passwordAlgo: 'argon2id',
                mfaRequired,
                mustRotatePassword: true,
                failedAttempts: 0,
                passwordChangedAt: now,
                createdBy: actorId,
                updatedBy: actorId,
              },
            },
          },
          select: buildLocalCredentialSelect(),
        });
        await logAudit({
          action: 'local_credential_created',
          targetTable: 'LocalCredential',
          targetId: created.localCredential?.id,
          reasonCode,
          reasonText,
          metadata: buildLocalCredentialAuditMetadata(actorId, {
            ticketId,
            loginId,
            status: created.status,
            userAccountId: created.userAccountId,
            identityId: created.id,
            mfaRequired: created.localCredential?.mfaRequired,
            mfaDefaultOverridden: !mfaRequired,
          }),
          ...auditContextFromRequest(req),
        });
        invalidateUserDbContextCache({
          userId: created.providerSubject,
          auth: {
            principalUserId: created.providerSubject,
            actorUserId: created.providerSubject,
            scopes: [],
            delegated: false,
            providerType: 'local_password',
            issuer: created.issuer,
          },
        });
        return reply.code(201).send(serializeLocalCredentialIdentity(created));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            const targets = Array.isArray(err.meta?.target)
              ? err.meta.target.map(String)
              : [];
            const conflictCode = targets.includes('loginId')
              ? 'local_login_id_exists'
              : 'local_credential_exists';
            return reply
              .code(409)
              .send(
                createApiErrorResponse(
                  conflictCode,
                  conflictCode === 'local_login_id_exists'
                    ? 'loginId already exists'
                    : 'Local credential already exists for user account',
                  { category: 'conflict' },
                ),
              );
          }
        }
        throw err;
      }
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
      try {
        await localCredentialAdminFlexibleLimiter.consume(req.ip);
      } catch {
        return reply
          .code(429)
          .send(
            createApiErrorResponse(
              'local_credential_rate_limited',
              'Too many local credential admin requests',
              { category: 'rate_limit' },
            ),
          );
      }
      const csrfError = enforceAuthCsrf(req, reply);
      if (csrfError) return csrfError;
      const actorId = requireActorUserId(req, reply);
      if (!actorId) return;
      const { identityId } = req.params as { identityId: string };
      const body = req.body as {
        loginId?: string;
        password?: string;
        mfaRequired?: boolean;
        lockedUntil?: string | null;
        status?: 'active' | 'disabled';
        ticketId: string;
        reasonCode: string;
        reasonText?: string;
      };
      const current = await prisma.userIdentity.findUnique({
        where: { id: identityId },
        select: buildLocalCredentialSelect(),
      });
      if (
        !current ||
        current.providerType !== LOCAL_IDENTITY_PROVIDER ||
        current.issuer !== LOCAL_IDENTITY_ISSUER ||
        !current.localCredential
      ) {
        return reply
          .code(404)
          .send(
            createApiErrorResponse(
              'local_credential_not_found',
              'Local credential not found',
              { category: 'not_found' },
            ),
          );
      }
      const loginId =
        body.loginId === undefined
          ? undefined
          : normalizeLocalLoginId(body.loginId);
      const ticketId = normalizeOptionalString(body.ticketId);
      const reasonCode = normalizeOptionalString(body.reasonCode);
      const reasonText = normalizeOptionalString(body.reasonText) || undefined;
      const lockedUntil = parseLockedUntil(body.lockedUntil);
      const { password, invalidFields: passwordInvalidFields } =
        body.password === undefined
          ? { password: undefined, invalidFields: [] as string[] }
          : validateLocalPassword(body.password);
      const invalidFields = [...passwordInvalidFields];
      if (body.loginId !== undefined && !loginId) invalidFields.push('loginId');
      if (lockedUntil.invalid) invalidFields.push('lockedUntil');
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
      if (
        body.mfaRequired === false &&
        current.localCredential.mfaRequired !== false
      ) {
        appendMfaPasswordOnlyOverrideValidation(
          invalidFields,
          false,
          reasonText,
        );
      }
      const updateCredentialData: Prisma.LocalCredentialUpdateInput = {
        updatedBy: actorId,
      };
      const updateIdentityData: Prisma.UserIdentityUpdateInput = {
        updatedBy: actorId,
      };
      const changedFields: string[] = [];
      if (
        loginId !== undefined &&
        loginId !== current.localCredential.loginId
      ) {
        updateCredentialData.loginId = loginId;
        changedFields.push('loginId');
      }
      if (
        body.mfaRequired !== undefined &&
        body.mfaRequired !== current.localCredential.mfaRequired
      ) {
        updateCredentialData.mfaRequired = body.mfaRequired;
        changedFields.push('mfaRequired');
      }
      if (lockedUntil.provided) {
        updateCredentialData.lockedUntil = lockedUntil.value;
        if (
          lockedUntil.value?.toISOString() !==
          current.localCredential.lockedUntil?.toISOString()
        ) {
          changedFields.push('lockedUntil');
        }
      }
      if (body.status && body.status !== current.status) {
        updateIdentityData.status = body.status;
        changedFields.push('status');
      }
      if (invalidFields.length) {
        return respondValidationError(
          reply,
          Array.from(new Set(invalidFields)),
        );
      }
      if (password !== undefined) {
        updateCredentialData.passwordHash = await hashLocalPassword(password);
        updateCredentialData.passwordAlgo = 'argon2id';
        updateCredentialData.passwordChangedAt = new Date();
        updateCredentialData.mustRotatePassword = true;
        updateCredentialData.failedAttempts = 0;
        updateCredentialData.lockedUntil = null;
        changedFields.push('password');
      }
      if (!changedFields.length) {
        return serializeLocalCredentialIdentity(current);
      }
      try {
        const updated = await prisma.userIdentity.update({
          where: { id: identityId },
          data: {
            ...updateIdentityData,
            localCredential: {
              update: updateCredentialData,
            },
          },
          select: buildLocalCredentialSelect(),
        });
        await logAudit({
          action: 'local_credential_updated',
          targetTable: 'LocalCredential',
          targetId: updated.localCredential?.id,
          reasonCode,
          reasonText,
          metadata: buildLocalCredentialAuditMetadata(actorId, {
            ticketId,
            loginId: updated.localCredential?.loginId,
            changedFields,
            status: updated.status,
            userAccountId: updated.userAccountId,
            identityId: updated.id,
            mfaRequired: updated.localCredential?.mfaRequired,
            mfaDefaultOverridden: changedFields.includes('mfaRequired')
              ? updated.localCredential?.mfaRequired === false
              : undefined,
          }),
          ...auditContextFromRequest(req),
        });
        invalidateUserDbContextCache({
          userId: updated.providerSubject,
          auth: {
            principalUserId: updated.providerSubject,
            actorUserId: updated.providerSubject,
            scopes: [],
            delegated: false,
            providerType: 'local_password',
            issuer: updated.issuer,
          },
        });
        return serializeLocalCredentialIdentity(updated);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            const targets = Array.isArray(err.meta?.target)
              ? err.meta.target.map(String)
              : [];
            const conflictCode = targets.includes('loginId')
              ? 'local_login_id_exists'
              : 'local_credential_exists';
            return reply
              .code(409)
              .send(
                createApiErrorResponse(
                  conflictCode,
                  conflictCode === 'local_login_id_exists'
                    ? 'loginId already exists'
                    : 'Local credential already exists for user account',
                  { category: 'conflict' },
                ),
              );
          }
        }
        throw err;
      }
    },
  );
}
