import { Prisma } from '@prisma/client';
import { prisma } from '../../services/db.js';
import {
  LOCAL_IDENTITY_ISSUER,
  LOCAL_IDENTITY_PROVIDER,
  LOCAL_LOGIN_MAX_FAILED_ATTEMPTS,
  LOCAL_LOGIN_LOCKOUT_MINUTES,
  computeLocalCredentialLockUntil,
} from '../../services/localCredentials.js';

export function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseLockedUntil(value: unknown) {
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

export function parseIdentityWindow(value: unknown, fieldName: string) {
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

export function buildLocalCredentialAuditMetadata(
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

export function buildIdentityAuditMetadata(
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

export function resolveIssuedLocalCredentialMfaRequired(mfaRequired: unknown) {
  return mfaRequired !== false;
}

export function appendMfaPasswordOnlyOverrideValidation(
  invalidFields: string[],
  mfaRequired: boolean,
  reasonText: string | undefined,
) {
  if (!mfaRequired && !reasonText) {
    invalidFields.push('reasonText');
  }
}

export function snapshotIdentityState(identity: {
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

export function buildLocalCredentialSelect() {
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

export function buildLocalCredentialAuthSelect() {
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

export function buildUserIdentitySelect() {
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

export type UserIdentityRecord = Prisma.UserIdentityGetPayload<{
  select: ReturnType<typeof buildUserIdentitySelect>;
}>;

export type LocalCredentialRecord = Prisma.UserIdentityGetPayload<{
  select: ReturnType<typeof buildLocalCredentialSelect>;
}>;

export type LocalCredentialAuthRecord = Prisma.UserIdentityGetPayload<{
  select: ReturnType<typeof buildLocalCredentialAuthSelect>;
}>;

export function serializeUserIdentity(identity: UserIdentityRecord) {
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

export function isIdentityEffectivelyActive(identity: {
  status: string;
  effectiveUntil?: Date | null;
}) {
  return (
    identity.status === 'active' &&
    (!identity.effectiveUntil || identity.effectiveUntil.getTime() > Date.now())
  );
}

export function isLocalCredentialUsable(
  identity: LocalCredentialAuthRecord | null,
) {
  if (!identity || !identity.localCredential) return false;
  if (!isIdentityEffectivelyActive(identity)) return false;
  if (!identity.userAccount?.active || identity.userAccount.deletedAt) {
    return false;
  }
  return true;
}

export async function incrementLocalCredentialFailure(
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

export async function resetLocalCredentialFailures(
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

export const localCredentialStateConstants = {
  providerType: LOCAL_IDENTITY_PROVIDER,
  issuer: LOCAL_IDENTITY_ISSUER,
  maxFailedAttempts: LOCAL_LOGIN_MAX_FAILED_ATTEMPTS,
  lockoutMinutes: LOCAL_LOGIN_LOCKOUT_MINUTES,
} as const;
