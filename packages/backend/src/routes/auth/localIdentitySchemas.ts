import { Type } from '@sinclair/typebox';

export const localCredentialIdentitySchema = Type.Object(
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

export const localCredentialListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    items: Type.Array(localCredentialIdentitySchema),
  },
  { additionalProperties: false },
);

export const localCredentialErrorResponseSchema = Type.Object(
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

export const userIdentitySchema = Type.Object(
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

export const userIdentityListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    items: Type.Array(userIdentitySchema),
  },
  { additionalProperties: false },
);
