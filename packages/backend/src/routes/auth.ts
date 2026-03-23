import { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { createApiErrorResponse } from '../services/errors.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import {
  LOCAL_IDENTITY_ISSUER,
  LOCAL_IDENTITY_PROVIDER,
  buildLocalProviderSubject,
  hashLocalPassword,
  normalizeLocalLoginId,
  serializeLocalCredentialIdentity,
  validateLocalPassword,
} from '../services/localCredentials.js';
import {
  localCredentialCreateSchema,
  localCredentialListSchema,
  localCredentialPatchSchema,
} from './validators.js';

const demoUser = {
  userId: 'demo-user',
  roles: ['user'],
  orgId: 'org-demo',
  projectIds: ['00000000-0000-0000-0000-000000000001'],
};

const requireSystemAdmin = requireRole(['system_admin']);

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

function buildAuditMetadata(
  actorId: string,
  payload: {
    ticketId: string;
    loginId?: string;
    changedFields?: string[];
    status?: string;
    userAccountId: string;
    identityId?: string;
    mfaRequired?: boolean;
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
  } as Prisma.InputJsonValue;
}

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

  app.get(
    '/auth/local-credentials',
    {
      preHandler: requireSystemAdmin,
      schema: {
        ...localCredentialListSchema,
        tags: ['auth'],
        summary: 'List local credentials',
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
      preHandler: requireSystemAdmin,
      schema: {
        ...localCredentialCreateSchema,
        tags: ['auth'],
        summary: 'Create local credential',
      },
    },
    async (req, reply) => {
      const actorId = req.user?.userId;
      if (!actorId) {
        return reply.code(400).send(
          createApiErrorResponse('missing_user_id', 'user id is required', {
            category: 'validation',
          }),
        );
      }
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
      const { password, invalidFields: passwordInvalidFields } =
        validateLocalPassword(body.password);
      const invalidFields = [...passwordInvalidFields];
      if (!body.userAccountId?.trim()) invalidFields.push('userAccountId');
      if (!loginId) invalidFields.push('loginId');
      if (!ticketId) invalidFields.push('ticketId');
      if (!reasonCode) invalidFields.push('reasonCode');
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
                mfaRequired: body.mfaRequired ?? true,
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
          metadata: buildAuditMetadata(actorId, {
            ticketId,
            loginId,
            status: created.status,
            userAccountId: created.userAccountId,
            identityId: created.id,
            mfaRequired: created.localCredential?.mfaRequired,
          }),
          ...auditContextFromRequest(req),
        });
        return reply.code(201).send(serializeLocalCredentialIdentity(created));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            return reply
              .code(409)
              .send(
                createApiErrorResponse(
                  'local_credential_conflict',
                  'Local credential creation conflict',
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
      preHandler: requireSystemAdmin,
      schema: {
        ...localCredentialPatchSchema,
        tags: ['auth'],
        summary: 'Update local credential',
      },
    },
    async (req, reply) => {
      const actorId = req.user?.userId;
      if (!actorId) {
        return reply.code(400).send(
          createApiErrorResponse('missing_user_id', 'user id is required', {
            category: 'validation',
          }),
        );
      }
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
      if (password !== undefined) {
        updateCredentialData.passwordHash = await hashLocalPassword(password);
        updateCredentialData.passwordAlgo = 'argon2id';
        updateCredentialData.passwordChangedAt = new Date();
        updateCredentialData.failedAttempts = 0;
        updateCredentialData.lockedUntil = null;
        changedFields.push('password');
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
      if (!changedFields.length) {
        return reply.code(400).send(
          createApiErrorResponse(
            'invalid_local_credential_payload',
            'No mutable fields were provided',
            {
              category: 'validation',
              details: { invalidFields: ['payload'] },
            },
          ),
        );
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
          metadata: buildAuditMetadata(actorId, {
            ticketId,
            loginId: updated.localCredential?.loginId,
            changedFields,
            status: updated.status,
            userAccountId: updated.userAccountId,
            identityId: updated.id,
            mfaRequired: updated.localCredential?.mfaRequired,
          }),
          ...auditContextFromRequest(req),
        });
        return serializeLocalCredentialIdentity(updated);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            return reply
              .code(409)
              .send(
                createApiErrorResponse(
                  'local_credential_conflict',
                  'Local credential update conflict',
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
