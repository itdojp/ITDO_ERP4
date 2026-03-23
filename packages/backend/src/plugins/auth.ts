import fp from 'fastify-plugin';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';
import { prisma } from '../services/db.js';
import { createApiErrorResponse } from '../services/errors.js';
import { parseGroupToRoleMap } from '../utils/authGroupToRoleMap.js';

export type UserContext = {
  userId: string;
  roles: string[];
  orgId?: string;
  projectIds?: string[];
  groupIds?: string[];
  // Canonical group identifier (GroupAccount.id). Keep groupIds (displayName)
  // during the migration period.
  groupAccountIds?: string[];
  auth?: DelegatedAuthContext;
};

export type DelegatedAuthContext = {
  principalUserId: string;
  actorUserId: string;
  scopes: string[];
  tokenId?: string;
  audience?: string[];
  expiresAt?: number;
  delegated: boolean;
  providerType?: 'google_oidc' | 'local_password' | 'header';
  issuer?: string;
  userAccountId?: string;
  identityId?: string;
};

export type DelegatedScopeDecision = {
  allowed: boolean;
  reason?: 'scope_denied';
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
  }
}

type AuthMode = 'header' | 'jwt' | 'hybrid';

const AUTH_MODE_RAW = (process.env.AUTH_MODE || 'header').trim().toLowerCase();
const RESOLVED_AUTH_MODE: AuthMode =
  AUTH_MODE_RAW === 'jwt' || AUTH_MODE_RAW === 'hybrid'
    ? AUTH_MODE_RAW
    : 'header';
const NODE_ENV_RAW = (process.env.NODE_ENV || '').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV_RAW === 'production';
const AUTH_ALLOW_HEADER_FALLBACK_IN_PROD = ['1', 'true'].includes(
  (process.env.AUTH_ALLOW_HEADER_FALLBACK_IN_PROD || '').trim().toLowerCase(),
);
const JWT_JWKS_URL = process.env.JWT_JWKS_URL;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;
const JWT_ALGS = (process.env.JWT_ALGS || 'RS256')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const JWT_SUB_CLAIM = process.env.JWT_SUB_CLAIM || 'sub';
const JWT_ROLE_CLAIM = process.env.JWT_ROLE_CLAIM || 'roles';
const JWT_GROUP_CLAIM = process.env.JWT_GROUP_CLAIM || 'group_ids';
const JWT_PROJECT_CLAIM = process.env.JWT_PROJECT_CLAIM || 'project_ids';
const JWT_ORG_CLAIM = process.env.JWT_ORG_CLAIM || 'org_id';
const JWT_SCOPE_CLAIM = process.env.JWT_SCOPE_CLAIM || 'scp';
const JWT_ACTOR_SUB_CLAIM = process.env.JWT_ACTOR_SUB_CLAIM || 'act.sub';
const JWT_TOKEN_ID_CLAIM = process.env.JWT_TOKEN_ID_CLAIM || 'jti';
const AUTH_DEFAULT_ROLE = process.env.AUTH_DEFAULT_ROLE || 'user';
const USER_ROLE_ALIASES = new Set(['project_lead', 'employee', 'probationary']);
const AUTH_GROUP_TO_ROLE_MAP_RAW = process.env.AUTH_GROUP_TO_ROLE_MAP || '';
const AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = Number(
  process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS || 0,
);
const JWT_REVOKED_JTI = new Set(
  (process.env.JWT_REVOKED_JTI || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const AGENT_SCOPE_READ = new Set(
  (
    process.env.AUTH_AGENT_READ_SCOPES ||
    'read-only,read,agent:read-only,agent:read'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const AGENT_SCOPE_WRITE = new Set(
  (
    process.env.AUTH_AGENT_WRITE_SCOPES ||
    'write-limited,write,agent:write-limited,agent:write'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const AGENT_SCOPE_APPROVAL = new Set(
  (
    process.env.AUTH_AGENT_APPROVAL_SCOPES ||
    'approval-required,agent:approval-required'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const AUTH_HEADER_MODE_FORBIDDEN_ERROR_MESSAGE =
  'AUTH_MODE=header is not allowed in production unless AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=true';

const GROUP_TO_ROLE_MAP = parseGroupToRoleMap(AUTH_GROUP_TO_ROLE_MAP_RAW);

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedPublicKey: CryptoKey | null = null;
let cachedPublicKeyPromise: Promise<CryptoKey> | null = null;

let validatedJwksUrl: URL | null = null;
if (typeof JWT_JWKS_URL === 'string' && JWT_JWKS_URL.trim() !== '') {
  try {
    validatedJwksUrl = new URL(JWT_JWKS_URL);
  } catch (err) {
    throw new Error(`Invalid JWT_JWKS_URL configuration: ${JWT_JWKS_URL}`);
  }
}

function parseBearerToken(req: any): string | null {
  const authHeader = req.headers?.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function expandRoles(roles: string[]): string[] {
  const normalized = new Set(roles);
  const hasUserAlias = roles.some((role) => USER_ROLE_ALIASES.has(role));
  if (hasUserAlias) normalized.add('user');
  return Array.from(normalized);
}

function resolveClaim(payload: JWTPayload, claim: string): unknown {
  if (!claim.includes('.')) {
    return (payload as Record<string, unknown>)[claim];
  }
  const parts = claim
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  let current: unknown = payload as Record<string, unknown>;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveUserId(payload: JWTPayload): string | null {
  const primary = resolveClaim(payload, JWT_SUB_CLAIM);
  if (typeof primary === 'string' && primary.trim()) return primary.trim();
  const fallback = resolveClaim(payload, 'email');
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  const alt = resolveClaim(payload, 'preferred_username');
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  return null;
}

function normalizeAudience(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeExpiresAt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function hasAnyScope(scopes: string[], expected: Set<string>): boolean {
  return scopes.some((scope) => expected.has(scope));
}

function isReadMethod(method: string | undefined): boolean {
  const normalized = (method || '').toUpperCase();
  return (
    normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS'
  );
}

export function evaluateDelegatedScope(
  user: UserContext | undefined,
  method: string | undefined,
): DelegatedScopeDecision {
  const auth = user?.auth;
  if (!auth?.delegated) return { allowed: true };

  const scopes = auth.scopes ?? [];
  const canRead =
    hasAnyScope(scopes, AGENT_SCOPE_READ) ||
    hasAnyScope(scopes, AGENT_SCOPE_WRITE) ||
    hasAnyScope(scopes, AGENT_SCOPE_APPROVAL);
  const canWrite =
    hasAnyScope(scopes, AGENT_SCOPE_WRITE) ||
    hasAnyScope(scopes, AGENT_SCOPE_APPROVAL);

  if (isReadMethod(method)) {
    if (canRead) return { allowed: true };
    return { allowed: false, reason: 'scope_denied' };
  }
  if (canWrite) return { allowed: true };
  return { allowed: false, reason: 'scope_denied' };
}

function enforceDelegatedScope(req: any, reply: any): any | null {
  const decision = evaluateDelegatedScope(req.user, req.method);
  if (decision.allowed) return null;
  return respondForbidden(req, reply, decision.reason);
}

async function resolveProjectIdsFromDb(userId: string) {
  const members = await prisma.projectMember.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  return members.map((member) => member.projectId);
}

type UserDbContext =
  | null
  | { blocked: true }
  | {
      blocked: false;
      userAccountId: string;
      identityId?: string;
      orgId?: string;
      groupIds: string[];
      groupAccountIds: string[];
    };

function mapResolvedUserContext(
  user: {
    id?: string;
    active: boolean;
    deletedAt: Date | null;
    organization: string | null;
    memberships: Array<{
      group: { id: string; displayName: string; active: boolean };
    }>;
  },
  options: { userAccountId: string; identityId?: string },
): UserDbContext {
  if (!user.active || user.deletedAt) {
    return { blocked: true as const };
  }
  const groupAccountIds = user.memberships
    .filter((membership) => membership.group.active)
    .map((membership) => membership.group.id)
    .map((value) => value.trim())
    .filter(Boolean);
  const groupIds = user.memberships
    .filter((membership) => membership.group.active)
    .map((membership) => membership.group.displayName)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    blocked: false as const,
    userAccountId: options.userAccountId,
    identityId: options.identityId,
    orgId: user.organization ?? undefined,
    groupIds,
    groupAccountIds,
  };
}

async function resolveUserGroupsFromDb(
  user: UserContext,
): Promise<UserDbContext> {
  const select = {
    id: true,
    active: true,
    deletedAt: true,
    organization: true,
    memberships: {
      include: {
        group: { select: { id: true, displayName: true, active: true } },
      },
    },
  } as const;

  if (
    user.auth?.providerType &&
    user.auth.providerType !== 'header' &&
    user.auth.issuer
  ) {
    const identity = await prisma.userIdentity.findFirst({
      where: {
        providerType: user.auth.providerType,
        issuer: user.auth.issuer,
        providerSubject: user.userId,
        status: 'active',
      },
      select: {
        id: true,
        userAccountId: true,
        userAccount: { select },
      },
    });
    if (identity?.userAccount) {
      return mapResolvedUserContext(identity.userAccount, {
        userAccountId: identity.userAccountId,
        identityId: identity.id,
      });
    }
  }
  const userAccount =
    (await prisma.userAccount.findUnique({
      where: { userName: user.userId },
      select,
    })) ||
    (await prisma.userAccount.findUnique({
      where: { externalId: user.userId },
      select,
    }));
  if (!userAccount) return null;
  return mapResolvedUserContext(userAccount, { userAccountId: userAccount.id });
}

type CachedUserDbContext = {
  expiresAt: number;
  value: UserDbContext;
};

const userDbContextCache = new Map<string, CachedUserDbContext>();

function resolveDbCacheTtlMs() {
  if (!Number.isFinite(AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS)) return 0;
  if (AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS <= 0) return 0;
  return Math.min(
    24 * 60 * 60 * 1000,
    AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS * 1000,
  );
}

function buildUserDbContextCacheKey(user: UserContext) {
  return [
    user.auth?.providerType ?? 'legacy',
    user.auth?.issuer ?? '',
    user.userId,
  ].join('\u0001');
}

async function resolveUserDbContext(user: UserContext): Promise<UserDbContext> {
  const ttlMs = resolveDbCacheTtlMs();
  const cacheKey = buildUserDbContextCacheKey(user);
  if (ttlMs <= 0) {
    return resolveUserGroupsFromDb(user);
  }
  const cached = userDbContextCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await resolveUserGroupsFromDb(user);
  userDbContextCache.set(cacheKey, { expiresAt: now + ttlMs, value });
  return value;
}

function unionStrings(a: string[] | undefined, b: string[]) {
  const set = new Set<string>();
  for (const item of a ?? []) {
    const trimmed = item.trim();
    if (trimmed) set.add(trimmed);
  }
  for (const item of b) {
    const trimmed = item.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set);
}

function deriveRolesFromGroups(groupIds: string[]) {
  const roles: string[] = [];
  for (const groupId of groupIds) {
    const mapped = GROUP_TO_ROLE_MAP[groupId];
    if (mapped) roles.push(mapped);
  }
  return roles;
}

async function validateAndEnrichUserContext(req: any, reply: any) {
  const user = req.user;
  if (!user) return true;
  try {
    const resolved = await resolveUserDbContext(user);
    if (!resolved) return true;
    if (resolved.blocked) {
      respondUnauthorized(req, reply, 'user_inactive');
      return false;
    }
    const mergedGroupIds = unionStrings(user.groupIds, resolved.groupIds);
    const mergedGroupAccountIds = unionStrings(
      user.groupAccountIds,
      resolved.groupAccountIds,
    );
    const derivedRoles = deriveRolesFromGroups(mergedGroupIds);
    const mergedRoles = expandRoles(
      unionStrings(user.roles, ['user', ...derivedRoles]),
    );
    user.groupIds = mergedGroupIds;
    user.groupAccountIds = mergedGroupAccountIds;
    user.roles = mergedRoles;
    if (!user.orgId && resolved.orgId) {
      user.orgId = resolved.orgId;
    }
    if (user.auth && resolved.userAccountId && !user.auth.userAccountId) {
      user.auth.userAccountId = resolved.userAccountId;
    }
    if (user.auth && resolved.identityId && !user.auth.identityId) {
      user.auth.identityId = resolved.identityId;
    }
  } catch (err) {
    if (req.log && typeof req.log.warn === 'function') {
      req.log.warn({ err }, 'Failed to resolve groupIds from DB');
    }
    respondUnauthorized(req, reply, 'group_resolution_failed');
    return false;
  }
  return true;
}

async function ensureProjectIds(req: any) {
  const user = req.user;
  if (!user) return;
  if (user.roles.includes('admin') || user.roles.includes('mgmt')) return;
  const fallback = Array.isArray(user.projectIds) ? user.projectIds : [];
  try {
    const fromDb = await resolveProjectIdsFromDb(
      user.auth?.userAccountId ?? user.userId,
    );
    if (fromDb.length) {
      user.projectIds = fromDb;
    } else if (!fallback.length) {
      user.projectIds = [];
    }
  } catch (err) {
    if (req.log && typeof req.log.warn === 'function') {
      req.log.warn({ err }, 'Failed to resolve projectIds from DB');
    }
    if (!fallback.length) {
      user.projectIds = [];
    }
  }
}

function buildUserContext(payload: JWTPayload): UserContext | null {
  const principalUserId = resolveUserId(payload);
  if (!principalUserId) return null;
  const actorClaim = resolveClaim(payload, JWT_ACTOR_SUB_CLAIM);
  const actorUserId =
    typeof actorClaim === 'string' && actorClaim.trim()
      ? actorClaim.trim()
      : principalUserId;
  const scopes = normalizeList(resolveClaim(payload, JWT_SCOPE_CLAIM));
  const tokenIdClaim = resolveClaim(payload, JWT_TOKEN_ID_CLAIM);
  const tokenId =
    typeof tokenIdClaim === 'string' && tokenIdClaim.trim()
      ? tokenIdClaim.trim()
      : undefined;
  const audience = normalizeAudience(resolveClaim(payload, 'aud'));
  const expiresAt = normalizeExpiresAt(resolveClaim(payload, 'exp'));
  const delegated = actorUserId !== principalUserId || scopes.length > 0;
  const tokenIssuer = resolveClaim(payload, 'iss');
  const roles = expandRoles(
    normalizeList(resolveClaim(payload, JWT_ROLE_CLAIM)),
  );
  const groupIds = normalizeList(resolveClaim(payload, JWT_GROUP_CLAIM));
  const projectIds = normalizeList(resolveClaim(payload, JWT_PROJECT_CLAIM));
  const orgId = resolveClaim(payload, JWT_ORG_CLAIM);
  const normalizedRoles = roles.length
    ? roles
    : AUTH_DEFAULT_ROLE
      ? [AUTH_DEFAULT_ROLE]
      : [];
  return {
    userId: principalUserId,
    roles: normalizedRoles,
    orgId: typeof orgId === 'string' ? orgId : undefined,
    projectIds,
    groupIds,
    auth: {
      principalUserId,
      actorUserId,
      scopes,
      tokenId,
      audience: audience.length ? audience : undefined,
      expiresAt,
      delegated,
      providerType: 'google_oidc',
      issuer:
        typeof tokenIssuer === 'string' && tokenIssuer.trim()
          ? tokenIssuer.trim()
          : undefined,
    },
  };
}

export function buildUserContextFromJwtPayload(
  payload: JWTPayload,
): UserContext | null {
  return buildUserContext(payload);
}

async function resolveJwtKey(): Promise<CryptoKey | JWTVerifyGetKey | null> {
  if (validatedJwksUrl) {
    if (!cachedJwks) {
      cachedJwks = createRemoteJWKSet(validatedJwksUrl);
    }
    return cachedJwks;
  }
  if (JWT_PUBLIC_KEY) {
    if (cachedPublicKey) return cachedPublicKey;
    if (!cachedPublicKeyPromise) {
      const alg = JWT_ALGS[0] || 'RS256';
      cachedPublicKeyPromise = importSPKI(JWT_PUBLIC_KEY, alg);
    }
    cachedPublicKey = await cachedPublicKeyPromise;
    return cachedPublicKey;
  }
  return null;
}

async function authenticateJwt(token: string): Promise<UserContext> {
  const key = await resolveJwtKey();
  if (!key) {
    throw new Error('jwt_key_missing');
  }
  const verifyOptions = {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: JWT_ALGS.length ? JWT_ALGS : undefined,
  };
  const { payload } =
    typeof key === 'function'
      ? await jwtVerify(token, key, verifyOptions)
      : await jwtVerify(token, key, verifyOptions);
  const context = buildUserContext(payload);
  if (!context) {
    throw new Error('jwt_missing_user');
  }
  if (
    context.auth?.tokenId &&
    JWT_REVOKED_JTI.size > 0 &&
    JWT_REVOKED_JTI.has(context.auth.tokenId)
  ) {
    throw new Error('jwt_revoked');
  }
  return context;
}

function applyHeaderAuth(req: any) {
  const userId = (req.headers['x-user-id'] as string) || 'demo-user';
  const rolesHeader = (req.headers['x-roles'] as string) || 'user';
  const roles = expandRoles(
    rolesHeader
      .split(',')
      .map((r: string) => r.trim())
      .filter(Boolean),
  );
  const orgId = (req.headers['x-org-id'] as string) || undefined;
  const projectIdsHeader = (req.headers['x-project-ids'] as string) || '';
  const projectIds = projectIdsHeader
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);
  const groupIdsHeader = (req.headers['x-group-ids'] as string) || '';
  const groupIds = groupIdsHeader
    .split(',')
    .map((g: string) => g.trim())
    .filter(Boolean);
  const groupAccountIdsHeader =
    (req.headers['x-group-account-ids'] as string) || '';
  const groupAccountIds = groupAccountIdsHeader
    .split(',')
    .map((g: string) => g.trim())
    .filter(Boolean);
  req.user = {
    userId,
    roles,
    orgId,
    projectIds,
    groupIds,
    groupAccountIds,
    auth: {
      principalUserId: userId,
      actorUserId: userId,
      scopes: [],
      delegated: false,
      providerType: 'header',
    },
  };
}

function respondUnauthorized(req: any, reply: any, reason?: string) {
  if (req.log && typeof req.log.warn === 'function') {
    req.log.warn({ reason }, 'Unauthorized request');
  }
  return reply.code(401).send(
    createApiErrorResponse('unauthorized', 'Unauthorized', {
      category: 'auth',
      details: reason ? { reason } : undefined,
    }),
  );
}

function respondForbidden(req: any, reply: any, reason?: string) {
  if (req.log && typeof req.log.warn === 'function') {
    req.log.warn({ reason }, 'Forbidden request');
  }
  return reply.code(403).send(
    createApiErrorResponse('scope_denied', 'Forbidden', {
      category: 'permission',
      details: reason ? { reason } : undefined,
    }),
  );
}

function assertRuntimeAuthConfig() {
  if (
    IS_PRODUCTION &&
    RESOLVED_AUTH_MODE === 'header' &&
    !AUTH_ALLOW_HEADER_FALLBACK_IN_PROD
  ) {
    throw new Error(AUTH_HEADER_MODE_FORBIDDEN_ERROR_MESSAGE);
  }
}

async function authPlugin(fastify: any) {
  assertRuntimeAuthConfig();
  fastify.addHook('onRequest', async (req: any, reply: any) => {
    if (
      typeof req.url === 'string' &&
      (req.url.startsWith('/health') || req.url.startsWith('/ready'))
    ) {
      return;
    }
    const mode = RESOLVED_AUTH_MODE;
    if (mode === 'header') {
      applyHeaderAuth(req);
      await ensureProjectIds(req);
      return;
    }
    const token = parseBearerToken(req);
    if (!token) {
      if (mode === 'jwt') {
        return respondUnauthorized(req, reply, 'missing_token');
      }
      if (IS_PRODUCTION && !AUTH_ALLOW_HEADER_FALLBACK_IN_PROD) {
        return respondUnauthorized(req, reply, 'missing_token');
      }
      applyHeaderAuth(req);
      await ensureProjectIds(req);
      return;
    }
    try {
      req.user = await authenticateJwt(token);
      if (!(await validateAndEnrichUserContext(req, reply))) return;
      const scopeDenied = enforceDelegatedScope(req, reply);
      if (scopeDenied) return scopeDenied;
      await ensureProjectIds(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid_token';
      return respondUnauthorized(req, reply, message);
    }
  });
}

export default fp(authPlugin);
