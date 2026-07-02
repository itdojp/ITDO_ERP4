import { Type } from '@sinclair/typebox';

export const chatSettingPatchSchema = {
  body: Type.Object(
    {
      allowUserPrivateGroupCreation: Type.Optional(Type.Boolean()),
      allowDmCreation: Type.Optional(Type.Boolean()),
      ackMaxRequiredUsers: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
      ackMaxRequiredGroups: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
      ackMaxRequiredRoles: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const worklogSettingPatchSchema = {
  body: Type.Object(
    {
      editableDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    },
    { additionalProperties: false },
  ),
};

export const leaveSettingPatchSchema = {
  body: Type.Object(
    {
      timeUnitMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
      defaultWorkdayMinutes: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 1440 }),
      ),
      paidLeaveAdvanceMaxMinutes: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 10080 }),
      ),
      paidLeaveAdvanceRequireNextGrantWithinDays: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 366 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const annotationSettingPatchSchema = {
  body: Type.Object(
    {
      maxExternalUrlCount: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 500 }),
      ),
      maxExternalUrlLength: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200000 }),
      ),
      maxExternalUrlTotalLength: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 2000000 }),
      ),
      maxNotesLength: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 200000 }),
      ),
    },
    { additionalProperties: false },
  ),
};

export const annotationPatchSchema = {
  body: Type.Object(
    {
      notes: Type.Optional(
        Type.Union([Type.String({ maxLength: 200000 }), Type.Null()]),
      ),
      externalUrls: Type.Optional(
        Type.Union([
          Type.Array(Type.String({ maxLength: 200000 }), { maxItems: 500 }),
          Type.Null(),
        ]),
      ),
      internalRefs: Type.Optional(
        Type.Union([
          Type.Array(
            Type.Object(
              {
                kind: Type.String({ minLength: 1, maxLength: 50 }),
                id: Type.String({ minLength: 1, maxLength: 200 }),
                label: Type.Optional(Type.String({ maxLength: 200 })),
              },
              { additionalProperties: false },
            ),
            { maxItems: 500 },
          ),
          Type.Null(),
        ]),
      ),
      reasonText: Type.Optional(Type.String({ maxLength: 20000 })),
    },
    { additionalProperties: false },
  ),
};

const localCredentialStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('disabled'),
]);

const userIdentityProviderTypeSchema = Type.Union([
  Type.Literal('google_oidc'),
  Type.Literal('local_password'),
]);

const userIdentityWindowSchema = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null(),
]);

export const localCredentialListSchema = {
  querystring: Type.Object(
    {
      userAccountId: Type.Optional(Type.String({ minLength: 1 })),
      status: Type.Optional(localCredentialStatusSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    },
    { additionalProperties: false },
  ),
};

export const localCredentialCreateSchema = {
  body: Type.Object(
    {
      userAccountId: Type.String({ minLength: 1 }),
      loginId: Type.String({ minLength: 1, maxLength: 255 }),
      password: Type.String({ minLength: 12, maxLength: 128 }),
      mfaRequired: Type.Optional(Type.Boolean()),
      ticketId: Type.String({ minLength: 1, maxLength: 128 }),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const localCredentialPatchSchema = {
  body: Type.Object(
    {
      loginId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
      password: Type.Optional(Type.String({ minLength: 12, maxLength: 128 })),
      mfaRequired: Type.Optional(Type.Boolean()),
      lockedUntil: Type.Optional(
        Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      ),
      status: Type.Optional(localCredentialStatusSchema),
      ticketId: Type.String({ minLength: 1, maxLength: 128 }),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const localLoginSchema = {
  body: Type.Object(
    {
      loginId: Type.String({ minLength: 1, maxLength: 255 }),
      password: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
};

export const localPasswordRotateSchema = {
  body: Type.Object(
    {
      loginId: Type.String({ minLength: 1, maxLength: 255 }),
      currentPassword: Type.String({ minLength: 1, maxLength: 128 }),
      newPassword: Type.String({ minLength: 12, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
};

export const userIdentityListSchema = {
  querystring: Type.Object(
    {
      userAccountId: Type.Optional(Type.String({ minLength: 1 })),
      providerType: Type.Optional(userIdentityProviderTypeSchema),
      status: Type.Optional(localCredentialStatusSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    },
    { additionalProperties: false },
  ),
};

export const userIdentityGoogleLinkSchema = {
  body: Type.Object(
    {
      userAccountId: Type.String({ minLength: 1 }),
      issuer: Type.String({ minLength: 1, maxLength: 255 }),
      providerSubject: Type.String({ minLength: 1, maxLength: 255 }),
      emailSnapshot: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 255 }),
          Type.Null(),
        ]),
      ),
      effectiveUntil: Type.Optional(userIdentityWindowSchema),
      rollbackWindowUntil: Type.Optional(userIdentityWindowSchema),
      note: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
      ticketId: Type.String({ minLength: 1, maxLength: 128 }),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const userIdentityLocalLinkSchema = {
  body: Type.Object(
    {
      userAccountId: Type.String({ minLength: 1 }),
      loginId: Type.String({ minLength: 1, maxLength: 255 }),
      password: Type.String({ minLength: 12, maxLength: 128 }),
      mfaRequired: Type.Optional(Type.Boolean()),
      effectiveUntil: Type.Optional(userIdentityWindowSchema),
      rollbackWindowUntil: Type.Optional(userIdentityWindowSchema),
      note: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
      ticketId: Type.String({ minLength: 1, maxLength: 128 }),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const userIdentityPatchSchema = {
  body: Type.Object(
    {
      status: Type.Optional(localCredentialStatusSchema),
      effectiveUntil: Type.Optional(userIdentityWindowSchema),
      rollbackWindowUntil: Type.Optional(userIdentityWindowSchema),
      note: Type.Optional(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 2000 }),
          Type.Null(),
        ]),
      ),
      ticketId: Type.String({ minLength: 1, maxLength: 128 }),
      reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
      reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    },
    { additionalProperties: false },
  ),
};

export const authGoogleStartSchema = {
  querystring: Type.Object(
    {
      returnTo: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    },
    { additionalProperties: false },
  ),
};

export const authGoogleCallbackSchema = {
  querystring: Type.Object(
    {
      code: Type.String({ minLength: 1, maxLength: 4096 }),
      state: Type.String({ minLength: 1, maxLength: 1024 }),
    },
    { additionalProperties: false },
  ),
};

export const authSessionListSchema = {
  querystring: Type.Object(
    {
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    },
    { additionalProperties: false },
  ),
};

export const authSessionRevokeSchema = {
  params: Type.Object(
    {
      sessionId: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
};
