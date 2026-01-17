import fp from 'fastify-plugin';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';
import { prisma } from '../services/db.js';
import { createApiErrorResponse } from '../services/errors.js';

export type UserContext = {
  userId: string;
  roles: string[];
  orgId?: string;
  projectIds?: string[];
  groupIds?: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
  }
}

type AuthMode = 'header' | 'jwt' | 'hybrid';

const AUTH_MODE_RAW = (process.env.AUTH_MODE || 'header').toLowerCase();
const RESOLVED_AUTH_MODE: AuthMode =
  AUTH_MODE_RAW === 'jwt' || AUTH_MODE_RAW === 'hybrid'
    ? AUTH_MODE_RAW
    : 'header';
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
const AUTH_DEFAULT_ROLE = process.env.AUTH_DEFAULT_ROLE || 'user';
const USER_ROLE_ALIASES = new Set(['project_lead', 'employee', 'probationary']);
const DEFAULT_GROUP_TO_ROLE_MAP: Record<string, string> = {
  admin: 'admin',
  mgmt: 'mgmt',
  exec: 'exec',
  hr: 'hr',
  'hr-group': 'hr',
};
const AUTH_GROUP_TO_ROLE_MAP_RAW = process.env.AUTH_GROUP_TO_ROLE_MAP || '';
const AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = Number(
  process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS || 0,
);

function parseGroupToRoleMap(raw: string) {
  const map = { ...DEFAULT_GROUP_TO_ROLE_MAP };
  raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      const [groupIdRaw, roleRaw] = token.split('=');
      const groupId = groupIdRaw?.trim();
      const role = roleRaw?.trim();
      if (!groupId || !role) return;
      map[groupId] = role;
    });
  return map;
}

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
  return (payload as Record<string, unknown>)[claim];
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

async function resolveProjectIdsFromDb(userId: string) {
  const members = await prisma.projectMember.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  return members.map((member) => member.projectId);
}

async function resolveUserGroupsFromDb(userId: string) {
  const user = await prisma.userAccount.findUnique({
    where: { userName: userId },
    select: {
      active: true,
      deletedAt: true,
      organization: true,
      memberships: {
        include: { group: { select: { displayName: true, active: true } } },
      },
    },
  });
  if (!user) return null;
  if (!user.active || user.deletedAt) {
    return { blocked: true as const };
  }
  const groupIds = user.memberships
    .filter((membership) => membership.group.active)
    .map((membership) => membership.group.displayName)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    blocked: false as const,
    orgId: user.organization ?? undefined,
    groupIds,
  };
}

type UserDbContext =
  | null
  | { blocked: true }
  | { blocked: false; orgId?: string; groupIds: string[] };

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

async function resolveUserDbContext(userId: string): Promise<UserDbContext> {
  const ttlMs = resolveDbCacheTtlMs();
  if (ttlMs <= 0) {
    return resolveUserGroupsFromDb(userId);
  }
  const cached = userDbContextCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await resolveUserGroupsFromDb(userId);
  userDbContextCache.set(userId, { expiresAt: now + ttlMs, value });
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
    const resolved = await resolveUserDbContext(user.userId);
    if (!resolved) return true;
    if (resolved.blocked) {
      respondUnauthorized(req, reply, 'user_inactive');
      return false;
    }
    const mergedGroupIds = unionStrings(user.groupIds, resolved.groupIds);
    const derivedRoles = deriveRolesFromGroups(mergedGroupIds);
    const mergedRoles = expandRoles(
      unionStrings(user.roles, ['user', ...derivedRoles]),
    );
    user.groupIds = mergedGroupIds;
    user.roles = mergedRoles;
    if (!user.orgId && resolved.orgId) {
      user.orgId = resolved.orgId;
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
    const fromDb = await resolveProjectIdsFromDb(user.userId);
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
  const userId = resolveUserId(payload);
  if (!userId) return null;
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
    userId,
    roles: normalizedRoles,
    orgId: typeof orgId === 'string' ? orgId : undefined,
    projectIds,
    groupIds,
  };
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
  req.user = { userId, roles, orgId, projectIds, groupIds };
}

function respondUnauthorized(req: any, reply: any, reason?: string) {
  if (req.log && typeof req.log.warn === 'function') {
    req.log.warn({ reason }, 'Unauthorized request');
  }
  return reply.code(401).send(
    createApiErrorResponse('unauthorized', 'Unauthorized', {
      category: 'auth',
    }),
  );
}

async function authPlugin(fastify: any) {
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
      applyHeaderAuth(req);
      await ensureProjectIds(req);
      return;
    }
    try {
      req.user = await authenticateJwt(token);
      if (!(await validateAndEnrichUserContext(req, reply))) return;
      await ensureProjectIds(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid_token';
      return respondUnauthorized(req, reply, message);
    }
  });
}

export default fp(authPlugin);
