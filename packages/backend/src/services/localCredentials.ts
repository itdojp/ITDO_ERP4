import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';

export const LOCAL_IDENTITY_PROVIDER = 'local_password';
export const LOCAL_IDENTITY_ISSUER = 'erp4_local';

const LOCAL_PASSWORD_MIN_LENGTH = 12;
const LOCAL_PASSWORD_MAX_LENGTH = 128;

type LocalCredentialRecord = {
  id: string;
  loginId: string;
  passwordAlgo: string;
  mfaRequired: boolean;
  mfaSecretRef: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserAccountSummary = {
  id: string;
  userName: string;
  displayName: string | null;
  active: boolean;
  deletedAt: Date | null;
};

type UserIdentityRecord = {
  id: string;
  userAccountId: string;
  providerType: string;
  providerSubject: string;
  issuer: string;
  status: string;
  lastAuthenticatedAt: Date | null;
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  localCredential: LocalCredentialRecord | null;
  userAccount?: UserAccountSummary;
};

export function buildLocalProviderSubject() {
  return randomUUID();
}

export function normalizeLocalLoginId(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validateLocalPassword(value: unknown) {
  const password = typeof value === 'string' ? value : '';
  const invalidFields: string[] = [];
  if (
    password.length < LOCAL_PASSWORD_MIN_LENGTH ||
    password.length > LOCAL_PASSWORD_MAX_LENGTH
  ) {
    invalidFields.push('password');
  }
  if (!password.trim()) {
    invalidFields.push('password');
  }
  return {
    password,
    invalidFields: Array.from(new Set(invalidFields)),
  };
}

export async function hashLocalPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export function serializeLocalCredentialIdentity(identity: UserIdentityRecord) {
  const credential = identity.localCredential;
  if (!credential) {
    throw new Error('local credential is required');
  }
  const updatedAt =
    identity.updatedAt > credential.updatedAt
      ? identity.updatedAt
      : credential.updatedAt;
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
    status: identity.status,
    loginId: credential.loginId,
    passwordAlgo: credential.passwordAlgo,
    mfaRequired: credential.mfaRequired,
    mfaSecretConfigured: Boolean(credential.mfaSecretRef),
    failedAttempts: credential.failedAttempts,
    lockedUntil: credential.lockedUntil,
    passwordChangedAt: credential.passwordChangedAt,
    lastAuthenticatedAt: identity.lastAuthenticatedAt,
    linkedAt: identity.linkedAt,
    createdAt: identity.createdAt,
    updatedAt,
  };
}
