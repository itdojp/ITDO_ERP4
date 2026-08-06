export const authScopeLimits = {
  count: 100,
  token: 255,
} as const;

const authScopeTokenDisallowedPattern = /[^A-Za-z0-9._~:/-]/u;

export class AuthScopeContractError extends Error {
  constructor() {
    super('auth_scope_contract_invalid');
  }
}

function validateScopeToken(value: unknown): string {
  if (typeof value !== 'string') throw new AuthScopeContractError();
  // Only ordinary ASCII spaces are normalization whitespace. Other whitespace,
  // controls, and format characters must reach the allowlist and fail closed.
  const normalized = value.replace(/^ +| +$/g, '');
  if (
    normalized.length === 0 ||
    normalized.length > authScopeLimits.token ||
    authScopeTokenDisallowedPattern.test(normalized)
  ) {
    throw new AuthScopeContractError();
  }
  return normalized;
}

export function normalizeAuthScopes(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const rawScopes = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[ \t\r\n\f\v]+/).filter(Boolean)
      : (() => {
          throw new AuthScopeContractError();
        })();
  if (rawScopes.length > authScopeLimits.count) {
    throw new AuthScopeContractError();
  }
  const scopes = [...new Set(rawScopes.map(validateScopeToken))];
  if (scopes.length > authScopeLimits.count) {
    throw new AuthScopeContractError();
  }
  return scopes;
}
