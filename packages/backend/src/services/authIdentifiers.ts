const unsafeAuthIdentifierCharacterPattern = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const authIdentifierLimits = {
  identifier: 255,
  issuer: 2_048,
  audienceCount: 100,
} as const;

export class AuthIdentifierContractError extends Error {
  constructor() {
    super('auth_identifier_contract_invalid');
    this.name = 'AuthIdentifierContractError';
  }
}

export function normalizeAuthIdentifier(
  value: unknown,
  maximum: number = authIdentifierLimits.identifier,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    unsafeAuthIdentifierCharacterPattern.test(value) ||
    value !== value.trim()
  ) {
    throw new AuthIdentifierContractError();
  }
  return value;
}
