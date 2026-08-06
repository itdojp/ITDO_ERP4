export const authScopeLimits = {
  count: 100,
  token: 255,
} as const;

const authScopeTokenPattern = /^[A-Za-z0-9._~:/-]+$/;

export class AuthScopeContractError extends Error {
  constructor() {
    super('auth_scope_contract_invalid');
  }
}

function validateScopeToken(value: unknown): string {
  if (typeof value !== 'string') throw new AuthScopeContractError();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > authScopeLimits.token ||
    !authScopeTokenPattern.test(normalized)
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
      ? value.split(/[ ,]+/u).filter(Boolean)
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
