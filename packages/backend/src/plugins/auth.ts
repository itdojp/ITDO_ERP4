import fp from 'fastify-plugin';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';
import { prisma } from '../services/db.js';

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

async function ensureProjectIds(req: any) {
  const user = req.user;
  if (!user) return;
  if (user.roles.includes('admin') || user.roles.includes('mgmt')) return;
  const fallback = Array.isArray(user.projectIds) ? user.projectIds : [];
  const fromDb = await resolveProjectIdsFromDb(user.userId);
  if (fromDb.length) {
    user.projectIds = fromDb;
  } else if (!fallback.length) {
    user.projectIds = [];
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
  return reply.code(401).send({ error: 'unauthorized' });
}

async function authPlugin(fastify: any) {
  fastify.addHook('onRequest', async (req: any, reply: any) => {
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
      await ensureProjectIds(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid_token';
      return respondUnauthorized(req, reply, message);
    }
  });
}

export default fp(authPlugin);
