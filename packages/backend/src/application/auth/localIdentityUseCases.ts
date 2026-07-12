import { Prisma } from '@prisma/client';
import type { AuditContext } from '../../services/audit.js';
import type { ErrorCategory } from '../../services/errors.js';
import { logAudit } from '../../services/audit.js';
import { createAuthSession } from '../../services/authGateway.js';
import { prisma } from '../../services/db.js';
import {
  clearUserDbContextCache,
  invalidateUserDbContextCache,
} from '../../plugins/auth.js';
import {
  LOCAL_IDENTITY_ISSUER,
  LOCAL_IDENTITY_PROVIDER,
  buildLocalProviderSubject,
  hashLocalPassword,
  isLocalCredentialLocked,
  normalizeLocalLoginId,
  serializeLocalCredentialIdentity,
  validateLocalPassword,
  verifyLocalPassword,
} from '../../services/localCredentials.js';
import {
  appendMfaPasswordOnlyOverrideValidation,
  buildIdentityAuditMetadata,
  buildLocalCredentialAuditMetadata,
  buildLocalCredentialAuthSelect,
  buildLocalCredentialSelect,
  buildUserIdentitySelect,
  incrementLocalCredentialFailure,
  isIdentityEffectivelyActive,
  isLocalCredentialUsable,
  normalizeOptionalString,
  parseIdentityWindow,
  parseLockedUntil,
  resetLocalCredentialFailures,
  resolveIssuedLocalCredentialMfaRequired,
  serializeUserIdentity,
  snapshotIdentityState,
} from './localIdentityShared.js';
import type { UserIdentityRecord } from './localIdentityShared.js';
export { localCredentialStateConstants } from './localIdentityShared.js';

export type LocalIdentityApplicationError = {
  statusCode: number;
  code: string;
  message: string;
  category: ErrorCategory;
  details?: Record<string, unknown>;
};

export type LocalIdentityUseCaseResult<T = unknown> =
  | {
      kind: 'success';
      statusCode?: number;
      value?: T;
      setCookie?: string;
    }
  | { kind: 'error'; error: LocalIdentityApplicationError };

export type LocalIdentityMutationContext = {
  actorId: string;
  auditContext: AuditContext;
};

export type LocalAuthRequestContext = {
  sourceIp?: string;
  userAgent?: string;
  auditContext: AuditContext;
};

function appError(
  statusCode: number,
  code: string,
  message: string,
  category: ErrorCategory,
  details?: Record<string, unknown>,
): LocalIdentityUseCaseResult<never> {
  return {
    kind: 'error',
    error: { statusCode, code, message, category, details },
  };
}

function success<T>(value: T, statusCode = 200): LocalIdentityUseCaseResult<T> {
  return { kind: 'success', value, statusCode };
}

function successNoContent(
  setCookie?: string,
): LocalIdentityUseCaseResult<undefined> {
  return { kind: 'success', statusCode: 204, setCookie };
}

function invalidLocalCredentialPayload(invalidFields: string[]) {
  return appError(
    400,
    'invalid_local_credential_payload',
    'Invalid local credential payload',
    'validation',
    { invalidFields: Array.from(new Set(invalidFields)) },
  );
}

function invalidLocalAuthPayload(
  code: string,
  message: string,
  invalidFields: string[],
) {
  return appError(400, code, message, 'validation', {
    invalidFields: Array.from(new Set(invalidFields)),
  });
}

function localLoginFailed(reason = 'invalid_credentials') {
  return appError(
    401,
    'local_login_failed',
    'Invalid local login credentials',
    'auth',
    { reason },
  );
}

function localCredentialLocked(lockedUntil: Date | null) {
  return appError(
    423,
    'local_credential_locked',
    'Local credential is temporarily locked',
    'auth',
    { lockedUntil: lockedUntil?.toISOString() ?? null },
  );
}

function localCredentialConflictFromUniqueError(
  err: Prisma.PrismaClientKnownRequestError,
) {
  const targets = Array.isArray(err.meta?.target)
    ? err.meta.target.map(String)
    : [];
  const conflictCode = targets.includes('loginId')
    ? 'local_login_id_exists'
    : 'local_credential_exists';
  return appError(
    409,
    conflictCode,
    conflictCode === 'local_login_id_exists'
      ? 'loginId already exists'
      : 'Local credential already exists for user account',
    'conflict',
  );
}

function googleIdentityConflictFromUniqueError(
  err: Prisma.PrismaClientKnownRequestError,
) {
  const targets = Array.isArray(err.meta?.target)
    ? err.meta.target.map(String)
    : [];
  const errorCode = targets.includes('providerSubject')
    ? 'google_identity_subject_exists'
    : 'google_identity_exists_for_account';
  return appError(
    409,
    errorCode,
    errorCode === 'google_identity_subject_exists'
      ? 'Google identity subject already exists'
      : 'Google identity already exists for user account',
    'conflict',
  );
}

export async function authenticateLocalCredential(
  body: { loginId?: unknown; password?: unknown },
  context: LocalAuthRequestContext,
): Promise<LocalIdentityUseCaseResult<undefined>> {
  const loginId = normalizeLocalLoginId(body.loginId);
  const password = typeof body.password === 'string' ? body.password : '';
  const invalidFields: string[] = [];
  if (!loginId) invalidFields.push('loginId');
  if (!password) invalidFields.push('password');
  if (invalidFields.length) {
    return invalidLocalAuthPayload(
      'invalid_local_login_payload',
      'Invalid local login payload',
      invalidFields,
    );
  }

  const identity = await prisma.userIdentity.findFirst({
    where: {
      providerType: LOCAL_IDENTITY_PROVIDER,
      issuer: LOCAL_IDENTITY_ISSUER,
      localCredential: { is: { loginId } },
    },
    select: buildLocalCredentialAuthSelect(),
  });
  if (
    !identity ||
    !identity.localCredential ||
    !isLocalCredentialUsable(identity)
  ) {
    await logAudit({
      ...context.auditContext,
      action: 'local_login_failed',
      targetTable: 'LocalCredential',
      reasonCode: 'invalid_credentials',
      metadata: { loginId },
    });
    return localLoginFailed();
  }

  const credential = identity.localCredential;
  if (isLocalCredentialLocked(credential.lockedUntil)) {
    await logAudit({
      ...context.auditContext,
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
    });
    return localCredentialLocked(credential.lockedUntil);
  }

  let passwordMatched = false;
  try {
    passwordMatched = await verifyLocalPassword(
      credential.passwordHash,
      password,
    );
  } catch {
    await logAudit({
      ...context.auditContext,
      action: 'local_login_failed',
      targetTable: 'LocalCredential',
      targetId: credential.id,
      reasonCode: 'credential_verification_error',
      metadata: {
        loginId,
        userAccountId: identity.userAccountId,
        identityId: identity.id,
        errorCode: 'credential_verification_error',
      },
    });
    return localLoginFailed('credential_verification_error');
  }
  if (!passwordMatched) {
    const failedCredential = await incrementLocalCredentialFailure(
      credential.id,
      identity.providerSubject,
    );
    await logAudit({
      ...context.auditContext,
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
    });
    return localLoginFailed();
  }

  await resetLocalCredentialFailures(credential.id, identity.providerSubject);

  if (credential.mustRotatePassword) {
    await logAudit({
      ...context.auditContext,
      action: 'local_login_blocked',
      targetTable: 'LocalCredential',
      targetId: credential.id,
      reasonCode: 'password_rotation_required',
      metadata: {
        loginId,
        userAccountId: identity.userAccountId,
        identityId: identity.id,
      },
    });
    return appError(
      409,
      'local_password_rotation_required',
      'Local password rotation is required before login',
      'auth',
      { reason: 'password_rotation_required' },
    );
  }

  if (credential.mfaRequired && !credential.mfaSecretRef) {
    await logAudit({
      ...context.auditContext,
      action: 'local_login_blocked',
      targetTable: 'LocalCredential',
      targetId: credential.id,
      reasonCode: 'mfa_setup_required',
      metadata: {
        loginId,
        userAccountId: identity.userAccountId,
        identityId: identity.id,
      },
    });
    return appError(
      409,
      'local_mfa_setup_required',
      'Local MFA setup is required before login',
      'auth',
      { reason: 'mfa_setup_required' },
    );
  }

  if (credential.mfaRequired) {
    await logAudit({
      ...context.auditContext,
      action: 'local_login_blocked',
      targetTable: 'LocalCredential',
      targetId: credential.id,
      reasonCode: 'mfa_challenge_required',
      metadata: {
        loginId,
        userAccountId: identity.userAccountId,
        identityId: identity.id,
      },
    });
    return appError(
      409,
      'local_mfa_challenge_required',
      'Local MFA challenge is required before login',
      'auth',
      { reason: 'mfa_challenge_required' },
    );
  }

  const now = new Date();
  await prisma.userIdentity.update({
    where: { id: identity.id },
    data: { lastAuthenticatedAt: now, updatedBy: identity.providerSubject },
  });
  const { session, setCookie } = await createAuthSession(prisma, {
    userAccountId: identity.userAccountId,
    userIdentityId: identity.id,
    providerType: identity.providerType,
    issuer: identity.issuer,
    providerSubject: identity.providerSubject,
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
  });
  await logAudit({
    ...context.auditContext,
    action: 'local_login_succeeded',
    targetTable: 'AuthSession',
    targetId: session.id,
    metadata: {
      loginId,
      userAccountId: identity.userAccountId,
      identityId: identity.id,
      sessionId: session.id,
    },
  });
  return successNoContent(setCookie);
}

export async function rotateLocalPassword(
  body: { loginId?: unknown; currentPassword?: unknown; newPassword?: unknown },
  context: LocalAuthRequestContext,
): Promise<LocalIdentityUseCaseResult<undefined>> {
  const loginId = normalizeLocalLoginId(body.loginId);
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const { password: newPassword, invalidFields: passwordInvalidFields } =
    validateLocalPassword(body.newPassword);
  const invalidFields = [...passwordInvalidFields];
  if (!loginId) invalidFields.push('loginId');
  if (!currentPassword) invalidFields.push('currentPassword');
  if (invalidFields.length) {
    return invalidLocalAuthPayload(
      'invalid_local_password_rotation_payload',
      'Invalid local password rotation payload',
      invalidFields,
    );
  }

  const identity = await prisma.userIdentity.findFirst({
    where: {
      providerType: LOCAL_IDENTITY_PROVIDER,
      issuer: LOCAL_IDENTITY_ISSUER,
      localCredential: { is: { loginId } },
    },
    select: buildLocalCredentialAuthSelect(),
  });
  if (
    !identity ||
    !identity.localCredential ||
    !isLocalCredentialUsable(identity)
  ) {
    await logAudit({
      ...context.auditContext,
      action: 'local_password_rotation_failed',
      targetTable: 'LocalCredential',
      reasonCode: 'invalid_credentials',
      metadata: { loginId },
    });
    return localLoginFailed();
  }

  const credential = identity.localCredential;
  if (isLocalCredentialLocked(credential.lockedUntil)) {
    await logAudit({
      ...context.auditContext,
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
    });
    return localCredentialLocked(credential.lockedUntil);
  }

  let passwordMatched = false;
  try {
    passwordMatched = await verifyLocalPassword(
      credential.passwordHash,
      currentPassword,
    );
  } catch {
    await logAudit({
      ...context.auditContext,
      action: 'local_password_rotation_failed',
      targetTable: 'LocalCredential',
      targetId: credential.id,
      reasonCode: 'credential_verification_error',
      metadata: {
        loginId,
        userAccountId: identity.userAccountId,
        identityId: identity.id,
        errorCode: 'credential_verification_error',
      },
    });
    return localLoginFailed('credential_verification_error');
  }
  if (!passwordMatched) {
    const failedCredential = await incrementLocalCredentialFailure(
      credential.id,
      identity.providerSubject,
    );
    await logAudit({
      ...context.auditContext,
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
    });
    return localLoginFailed();
  }

  await resetLocalCredentialFailures(credential.id, identity.providerSubject);

  if (!credential.mustRotatePassword) {
    return appError(
      409,
      'local_password_rotation_not_required',
      'Local password rotation is not required',
      'conflict',
      { reason: 'password_rotation_not_required' },
    );
  }

  const currentAndNextSame = await verifyLocalPassword(
    credential.passwordHash,
    newPassword,
  );
  if (currentAndNextSame) {
    return invalidLocalAuthPayload(
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
    ...context.auditContext,
    action: 'local_password_rotated',
    targetTable: 'LocalCredential',
    targetId: credential.id,
    metadata: {
      loginId,
      userAccountId: identity.userAccountId,
      identityId: identity.id,
    },
  });
  return successNoContent();
}

export async function listUserIdentities(query: {
  userAccountId?: string;
  providerType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
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
}

export async function linkGoogleUserIdentity(
  body: {
    userAccountId?: unknown;
    issuer?: unknown;
    providerSubject?: unknown;
    emailSnapshot?: unknown;
    effectiveUntil?: unknown;
    rollbackWindowUntil?: unknown;
    note?: unknown;
    ticketId?: unknown;
    reasonCode?: unknown;
    reasonText?: unknown;
  },
  context: LocalIdentityMutationContext,
): Promise<
  LocalIdentityUseCaseResult<ReturnType<typeof serializeUserIdentity>>
> {
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
  if (invalidFields.length) return invalidLocalCredentialPayload(invalidFields);

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
    return appError(
      404,
      'user_account_not_found',
      'User account not found',
      'not_found',
    );
  }
  if (!userAccount.active || userAccount.deletedAt) {
    return appError(
      409,
      'user_identity_user_inactive',
      'Inactive or deleted user cannot receive identities',
      'conflict',
    );
  }
  if (userAccount.identities.length > 0) {
    return appError(
      409,
      'google_identity_exists_for_account',
      'Google identity already exists for user account',
      'conflict',
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
        createdBy: context.actorId,
        updatedBy: context.actorId,
      },
      select: buildUserIdentitySelect(),
    });
    await logAudit({
      ...context.auditContext,
      action: 'user_identity_google_linked',
      targetTable: 'UserIdentity',
      targetId: created.id,
      reasonCode,
      reasonText,
      metadata: buildIdentityAuditMetadata(context.actorId, {
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
    });
    clearUserDbContextCache();
    return success(serializeUserIdentity(created), 201);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return googleIdentityConflictFromUniqueError(err);
    }
    throw err;
  }
}

export async function linkLocalUserIdentity(
  body: {
    userAccountId?: unknown;
    loginId?: unknown;
    password?: unknown;
    effectiveUntil?: unknown;
    rollbackWindowUntil?: unknown;
    note?: unknown;
    ticketId?: unknown;
    reasonCode?: unknown;
    reasonText?: unknown;
    mfaRequired?: unknown;
  },
  context: LocalIdentityMutationContext,
): Promise<
  LocalIdentityUseCaseResult<ReturnType<typeof serializeUserIdentity>>
> {
  const userAccountId = normalizeOptionalString(body.userAccountId);
  const loginId = normalizeLocalLoginId(body.loginId);
  const note =
    body.note === null ? null : normalizeOptionalString(body.note) || null;
  const ticketId = normalizeOptionalString(body.ticketId);
  const reasonCode = normalizeOptionalString(body.reasonCode);
  const reasonText = normalizeOptionalString(body.reasonText) || undefined;
  const mfaRequired = resolveIssuedLocalCredentialMfaRequired(body.mfaRequired);
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
  if (invalidFields.length) return invalidLocalCredentialPayload(invalidFields);

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
    return appError(
      404,
      'user_account_not_found',
      'User account not found',
      'not_found',
    );
  }
  if (!userAccount.active || userAccount.deletedAt) {
    return appError(
      409,
      'local_credential_user_inactive',
      'Inactive or deleted user cannot receive local credentials',
      'conflict',
    );
  }
  if (userAccount.identities.length > 0) {
    return appError(
      409,
      'local_credential_exists',
      'Local credential already exists for user account',
      'conflict',
    );
  }
  const existingLogin = await prisma.localCredential.findUnique({
    where: { loginId },
    select: { id: true },
  });
  if (existingLogin) {
    return appError(
      409,
      'local_login_id_exists',
      'loginId already exists',
      'conflict',
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
        createdBy: context.actorId,
        updatedBy: context.actorId,
        localCredential: {
          create: {
            loginId,
            passwordHash,
            passwordAlgo: 'argon2id',
            mfaRequired,
            mustRotatePassword: true,
            failedAttempts: 0,
            passwordChangedAt: now,
            createdBy: context.actorId,
            updatedBy: context.actorId,
          },
        },
      },
      select: buildUserIdentitySelect(),
    });
    await logAudit({
      ...context.auditContext,
      action: 'user_identity_local_linked',
      targetTable: 'UserIdentity',
      targetId: created.id,
      reasonCode,
      reasonText,
      metadata: buildIdentityAuditMetadata(context.actorId, {
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
    });
    clearUserDbContextCache();
    return success(serializeUserIdentity(created), 201);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return localCredentialConflictFromUniqueError(err);
    }
    throw err;
  }
}

export async function updateUserIdentity(
  identityId: string,
  body: {
    status?: 'active' | 'disabled';
    effectiveUntil?: unknown;
    rollbackWindowUntil?: unknown;
    note?: unknown;
    ticketId?: unknown;
    reasonCode?: unknown;
    reasonText?: unknown;
  },
  context: LocalIdentityMutationContext,
): Promise<
  LocalIdentityUseCaseResult<ReturnType<typeof serializeUserIdentity>>
> {
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
  if (invalidFields.length) return invalidLocalCredentialPayload(invalidFields);

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
        if (!currentIdentity) return { kind: 'not_found' as const };

        const updateData: Prisma.UserIdentityUpdateInput = {
          updatedBy: context.actorId,
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
          return { kind: 'noop' as const, currentIdentity };
        }

        const resultingStatus =
          (updateData.status as string | undefined) ?? currentIdentity.status;
        const resultingEffectiveUntil = effectiveUntil.provided
          ? (effectiveUntil.value ?? null)
          : currentIdentity.effectiveUntil;
        const willRemainUsable =
          resultingStatus === 'active' &&
          (!resultingEffectiveUntil ||
            resultingEffectiveUntil.getTime() > Date.now());
        if (!willRemainUsable && isIdentityEffectivelyActive(currentIdentity)) {
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
            return { kind: 'last_active_conflict' as const };
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (transactionResult.kind === 'not_found') {
      return appError(
        404,
        'user_identity_not_found',
        'User identity not found',
        'not_found',
      );
    }
    if (transactionResult.kind === 'last_active_conflict') {
      return appError(
        409,
        'identity_last_active_conflict',
        'Cannot disable the last active identity',
        'conflict',
      );
    }
    if (transactionResult.kind === 'noop') {
      return success(serializeUserIdentity(transactionResult.currentIdentity));
    }

    current = transactionResult.currentIdentity;
    updated = transactionResult.updatedIdentity;
    changedFields = transactionResult.transactionChangedFields;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2034'
    ) {
      return appError(
        409,
        'identity_update_conflict',
        'Concurrent identity update detected',
        'conflict',
      );
    }
    throw err;
  }

  if (!current || !updated) {
    throw new Error('identity update transaction returned no result');
  }
  await logAudit({
    ...context.auditContext,
    action: 'user_identity_updated',
    targetTable: 'UserIdentity',
    targetId: updated.id,
    reasonCode,
    reasonText,
    metadata: buildIdentityAuditMetadata(context.actorId, {
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
  });
  clearUserDbContextCache();
  return success(serializeUserIdentity(updated));
}

export async function listLocalCredentials(query: {
  userAccountId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
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
}

export async function createLocalCredential(
  body: {
    userAccountId?: unknown;
    loginId?: unknown;
    password?: unknown;
    mfaRequired?: unknown;
    ticketId?: unknown;
    reasonCode?: unknown;
    reasonText?: unknown;
  },
  context: LocalIdentityMutationContext,
): Promise<
  LocalIdentityUseCaseResult<
    ReturnType<typeof serializeLocalCredentialIdentity>
  >
> {
  const loginId = normalizeLocalLoginId(body.loginId);
  const userAccountId = normalizeOptionalString(body.userAccountId);
  const ticketId = normalizeOptionalString(body.ticketId);
  const reasonCode = normalizeOptionalString(body.reasonCode);
  const reasonText = normalizeOptionalString(body.reasonText) || undefined;
  const mfaRequired = resolveIssuedLocalCredentialMfaRequired(body.mfaRequired);
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
  if (invalidFields.length) return invalidLocalCredentialPayload(invalidFields);

  const userAccount = await prisma.userAccount.findUnique({
    where: { id: userAccountId },
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
    return appError(
      404,
      'user_account_not_found',
      'User account not found',
      'not_found',
    );
  }
  if (!userAccount.active || userAccount.deletedAt) {
    return appError(
      409,
      'local_credential_user_inactive',
      'Inactive or deleted user cannot receive local credentials',
      'conflict',
    );
  }
  if (userAccount.identities.length > 0) {
    return appError(
      409,
      'local_credential_exists',
      'Local credential already exists for user account',
      'conflict',
    );
  }
  const existingLogin = await prisma.localCredential.findUnique({
    where: { loginId },
    select: { id: true },
  });
  if (existingLogin) {
    return appError(
      409,
      'local_login_id_exists',
      'loginId already exists',
      'conflict',
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
        createdBy: context.actorId,
        updatedBy: context.actorId,
        localCredential: {
          create: {
            loginId,
            passwordHash,
            passwordAlgo: 'argon2id',
            mfaRequired,
            mustRotatePassword: true,
            failedAttempts: 0,
            passwordChangedAt: now,
            createdBy: context.actorId,
            updatedBy: context.actorId,
          },
        },
      },
      select: buildLocalCredentialSelect(),
    });
    await logAudit({
      ...context.auditContext,
      action: 'local_credential_created',
      targetTable: 'LocalCredential',
      targetId: created.localCredential?.id,
      reasonCode,
      reasonText,
      metadata: buildLocalCredentialAuditMetadata(context.actorId, {
        ticketId,
        loginId,
        status: created.status,
        userAccountId: created.userAccountId,
        identityId: created.id,
        mfaRequired: created.localCredential?.mfaRequired,
        mfaDefaultOverridden: !mfaRequired,
      }),
    });
    invalidateLocalIdentityCache(created.providerSubject, created.issuer);
    return success(serializeLocalCredentialIdentity(created), 201);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return localCredentialConflictFromUniqueError(err);
    }
    throw err;
  }
}

function invalidateLocalIdentityCache(providerSubject: string, issuer: string) {
  invalidateUserDbContextCache({
    userId: providerSubject,
    auth: {
      principalUserId: providerSubject,
      actorUserId: providerSubject,
      scopes: [],
      delegated: false,
      providerType: LOCAL_IDENTITY_PROVIDER,
      issuer,
    },
  });
}

export async function updateLocalCredential(
  identityId: string,
  body: {
    loginId?: unknown;
    password?: unknown;
    mfaRequired?: boolean;
    lockedUntil?: unknown;
    status?: 'active' | 'disabled';
    ticketId?: unknown;
    reasonCode?: unknown;
    reasonText?: unknown;
  },
  context: LocalIdentityMutationContext,
): Promise<
  LocalIdentityUseCaseResult<
    ReturnType<typeof serializeLocalCredentialIdentity>
  >
> {
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
    return appError(
      404,
      'local_credential_not_found',
      'Local credential not found',
      'not_found',
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
    appendMfaPasswordOnlyOverrideValidation(invalidFields, false, reasonText);
  }

  const updateCredentialData: Prisma.LocalCredentialUpdateInput = {
    updatedBy: context.actorId,
  };
  const updateIdentityData: Prisma.UserIdentityUpdateInput = {
    updatedBy: context.actorId,
  };
  const changedFields: string[] = [];
  if (loginId !== undefined && loginId !== current.localCredential.loginId) {
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
  if (invalidFields.length) return invalidLocalCredentialPayload(invalidFields);

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
    return success(serializeLocalCredentialIdentity(current));
  }

  try {
    const updated = await prisma.userIdentity.update({
      where: { id: identityId },
      data: {
        ...updateIdentityData,
        localCredential: { update: updateCredentialData },
      },
      select: buildLocalCredentialSelect(),
    });
    await logAudit({
      ...context.auditContext,
      action: 'local_credential_updated',
      targetTable: 'LocalCredential',
      targetId: updated.localCredential?.id,
      reasonCode,
      reasonText,
      metadata: buildLocalCredentialAuditMetadata(context.actorId, {
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
    });
    invalidateLocalIdentityCache(updated.providerSubject, updated.issuer);
    return success(serializeLocalCredentialIdentity(updated));
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return localCredentialConflictFromUniqueError(err);
    }
    throw err;
  }
}
