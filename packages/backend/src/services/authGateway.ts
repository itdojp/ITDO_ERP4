import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { CryptoKey, JWTPayload, JWTVerifyGetKey } from 'jose';
import { Prisma } from '@prisma/client';

const GOOGLE_OIDC_PROVIDER = 'google_oidc';
const GOOGLE_OIDC_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OIDC_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_SESSION_COOKIE_NAME = 'erp4_session';
const DEFAULT_FLOW_COOKIE_NAME = 'erp4_auth_flow';
const DEFAULT_ABSOLUTE_TTL_HOURS = 12;
const DEFAULT_IDLE_TTL_MINUTES = 120;
const DEFAULT_FLOW_TTL_MINUTES = 10;

type DbClient =
  | Prisma.TransactionClient
  | {
      authSession: Prisma.TransactionClient['authSession'];
      authOidcFlow: Prisma.TransactionClient['authOidcFlow'];
      userIdentity: Prisma.TransactionClient['userIdentity'];
    };

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedPublicKey: CryptoKey | null = null;
let cachedPublicKeyPromise: Promise<CryptoKey> | null = null;
let cachedValidatedJwksUrl: string | null = null;

function normalizeString(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.length ? trimmed : undefined;
}

function parseBoolean(value: string | undefined) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function base64UrlEncode(input: Buffer) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(value: string) {
  return base64UrlEncode(createHash('sha256').update(value).digest());
}

function randomToken(bytes = 32) {
  return base64UrlEncode(randomBytes(bytes));
}

function parseCookieHeader(header: string | undefined, name: string) {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function buildSetCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    maxAge?: number;
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (typeof options.maxAge === 'number')
    parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

function buildClearedCookie(name: string, path = '/') {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function normalizeReturnTo(returnTo: unknown, frontendOrigin: string) {
  if (typeof returnTo !== 'string' || !returnTo.trim()) return '/';
  const normalized = returnTo.trim();
  if (normalized.startsWith('/') && !normalized.startsWith('//'))
    return normalized;
  try {
    const origin = new URL(frontendOrigin);
    const target = new URL(normalized);
    if (target.origin !== origin.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}` || '/';
  } catch {
    return '/';
  }
}

function buildRedirectTarget(frontendOrigin: string, returnTo: string) {
  return new URL(returnTo, frontendOrigin).toString();
}

function getRuntimeConfig() {
  const clientId =
    normalizeString(process.env.GOOGLE_OIDC_CLIENT_ID) ??
    normalizeString(process.env.JWT_AUDIENCE) ??
    '';
  const clientSecret =
    normalizeString(process.env.GOOGLE_OIDC_CLIENT_SECRET) ?? '';
  const redirectUri =
    normalizeString(process.env.GOOGLE_OIDC_REDIRECT_URI) ?? '';
  const frontendOrigin =
    normalizeString(process.env.AUTH_FRONTEND_ORIGIN) ?? '';
  const jwtIssuer = normalizeString(process.env.JWT_ISSUER) ?? '';
  const jwtAudience = normalizeString(process.env.JWT_AUDIENCE) ?? '';
  const jwtJwksUrl = normalizeString(process.env.JWT_JWKS_URL) ?? '';
  const jwtPublicKey = normalizeString(process.env.JWT_PUBLIC_KEY) ?? '';
  const secureCookie =
    parseBoolean(process.env.AUTH_SESSION_COOKIE_SECURE) ??
    (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return {
    clientId,
    clientSecret,
    redirectUri,
    frontendOrigin,
    jwtIssuer,
    jwtAudience,
    jwtJwksUrl,
    jwtPublicKey,
    sessionCookieName:
      normalizeString(process.env.AUTH_SESSION_COOKIE_NAME) ??
      DEFAULT_SESSION_COOKIE_NAME,
    flowCookieName:
      normalizeString(process.env.AUTH_SESSION_FLOW_COOKIE_NAME) ??
      DEFAULT_FLOW_COOKIE_NAME,
    secureCookie,
    sessionAbsoluteTtlHours: parsePositiveInt(
      process.env.AUTH_SESSION_ABSOLUTE_TTL_HOURS,
      DEFAULT_ABSOLUTE_TTL_HOURS,
    ),
    sessionIdleTtlMinutes: parsePositiveInt(
      process.env.AUTH_SESSION_IDLE_TTL_MINUTES,
      DEFAULT_IDLE_TTL_MINUTES,
    ),
    flowTtlMinutes: parsePositiveInt(
      process.env.AUTH_SESSION_FLOW_TTL_MINUTES,
      DEFAULT_FLOW_TTL_MINUTES,
    ),
  };
}

async function resolveJwtKey(config: ReturnType<typeof getRuntimeConfig>) {
  if (config.jwtJwksUrl) {
    if (cachedValidatedJwksUrl !== config.jwtJwksUrl) {
      cachedValidatedJwksUrl = config.jwtJwksUrl;
      cachedJwks = createRemoteJWKSet(new URL(config.jwtJwksUrl));
    }
    return cachedJwks;
  }
  if (config.jwtPublicKey) {
    if (cachedPublicKey) return cachedPublicKey;
    if (!cachedPublicKeyPromise) {
      cachedPublicKeyPromise = importSPKI(config.jwtPublicKey, 'RS256');
    }
    cachedPublicKey = await cachedPublicKeyPromise;
    return cachedPublicKey;
  }
  return null;
}

export function buildAuthCookieHeaders() {
  const config = getRuntimeConfig();
  return {
    sessionCookieName: config.sessionCookieName,
    flowCookieName: config.flowCookieName,
    secureCookie: config.secureCookie,
  };
}

export function readAuthSessionToken(header: string | undefined) {
  const { sessionCookieName } = buildAuthCookieHeaders();
  return parseCookieHeader(header, sessionCookieName);
}

export function buildAuthSessionClearCookie() {
  const { sessionCookieName } = buildAuthCookieHeaders();
  return buildClearedCookie(sessionCookieName);
}

export function buildAuthFlowClearCookie() {
  const { flowCookieName } = buildAuthCookieHeaders();
  return buildClearedCookie(flowCookieName, '/auth/google');
}

export async function createGoogleAuthFlow(
  db: DbClient,
  input: { returnTo?: unknown },
) {
  const config = getRuntimeConfig();
  const flowToken = randomToken();
  const codeVerifier = randomToken(48);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const returnTo = normalizeReturnTo(input.returnTo, config.frontendOrigin);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.flowTtlMinutes * 60 * 1000);

  await db.authOidcFlow.create({
    data: {
      providerType: GOOGLE_OIDC_PROVIDER,
      flowTokenHash: sha256Hex(flowToken),
      state,
      nonce,
      codeVerifier,
      returnTo,
      expiresAt,
    },
  });

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
  });

  return {
    redirectUrl: `${GOOGLE_OIDC_AUTH_URL}?${query.toString()}`,
    setCookie: buildSetCookie(config.flowCookieName, flowToken, {
      path: '/auth/google',
      maxAge: config.flowTtlMinutes * 60,
      secure: config.secureCookie,
    }),
  };
}

export async function consumeGoogleAuthFlow(
  db: DbClient,
  input: { cookieHeader?: string; state?: string },
) {
  const { flowCookieName } = buildAuthCookieHeaders();
  const flowToken = parseCookieHeader(input.cookieHeader, flowCookieName);
  if (!flowToken || !input.state) return null;
  const flow = await db.authOidcFlow.findUnique({
    where: { flowTokenHash: sha256Hex(flowToken) },
  });
  if (!flow) return null;
  if (flow.state !== input.state) return null;
  if (flow.expiresAt.getTime() <= Date.now()) return null;
  await db.authOidcFlow.delete({ where: { id: flow.id } });
  return flow;
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  codeVerifier: string,
) {
  const config = getRuntimeConfig();
  const body = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`google_token_exchange_failed:${res.status}:${errorText}`);
  }
  return (await res.json()) as {
    id_token?: string;
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
) {
  const config = getRuntimeConfig();
  const key = await resolveJwtKey(config);
  if (!key) throw new Error('jwt_key_missing');
  const verifyOptions = {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    algorithms: ['RS256'],
  };
  const { payload } =
    typeof key === 'function'
      ? await jwtVerify(idToken, key as JWTVerifyGetKey, verifyOptions)
      : await jwtVerify(idToken, key as CryptoKey, verifyOptions);
  if (payload.nonce !== expectedNonce) {
    throw new Error('google_nonce_mismatch');
  }
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const iss = typeof payload.iss === 'string' ? payload.iss.trim() : '';
  if (!sub || !iss) {
    throw new Error('google_identity_claim_missing');
  }
  return {
    payload,
    providerType: GOOGLE_OIDC_PROVIDER,
    issuer: iss,
    providerSubject: sub,
    emailSnapshot:
      typeof payload.email === 'string' && payload.email.trim()
        ? payload.email.trim()
        : null,
  };
}

export async function createAuthSession(
  db: DbClient,
  input: {
    userAccountId: string;
    userIdentityId: string;
    providerType: string;
    issuer: string;
    providerSubject: string;
    sourceIp?: string;
    userAgent?: string;
  },
) {
  const config = getRuntimeConfig();
  const sessionToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.sessionAbsoluteTtlHours * 60 * 60 * 1000,
  );
  const idleExpiresAt = new Date(
    now.getTime() + config.sessionIdleTtlMinutes * 60 * 1000,
  );

  const created = await db.authSession.create({
    data: {
      sessionTokenHash: sha256Hex(sessionToken),
      userAccountId: input.userAccountId,
      userIdentityId: input.userIdentityId,
      providerType: input.providerType,
      issuer: input.issuer,
      providerSubject: input.providerSubject,
      sourceIp: input.sourceIp,
      userAgent: input.userAgent,
      expiresAt,
      idleExpiresAt,
    },
  });

  return {
    session: created,
    setCookie: buildSetCookie(config.sessionCookieName, sessionToken, {
      path: '/',
      maxAge: config.sessionAbsoluteTtlHours * 60 * 60,
      secure: config.secureCookie,
    }),
  };
}

export async function resolveAuthSession(db: DbClient, cookieHeader?: string) {
  const { sessionCookieName, sessionIdleTtlMinutes } = getRuntimeConfig();
  const sessionToken = parseCookieHeader(cookieHeader, sessionCookieName);
  if (!sessionToken) return null;
  const session = await db.authSession.findUnique({
    where: { sessionTokenHash: sha256Hex(sessionToken) },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (
    session.expiresAt.getTime() <= now ||
    session.idleExpiresAt.getTime() <= now
  ) {
    return null;
  }
  const nextIdleExpiresAt = new Date(
    Math.min(
      session.expiresAt.getTime(),
      now + sessionIdleTtlMinutes * 60 * 1000,
    ),
  );
  const updated = await db.authSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: new Date(now),
      idleExpiresAt: nextIdleExpiresAt,
    },
  });
  return updated;
}

export async function revokeAuthSession(db: DbClient, cookieHeader?: string) {
  const { sessionCookieName } = getRuntimeConfig();
  const sessionToken = parseCookieHeader(cookieHeader, sessionCookieName);
  if (!sessionToken) return null;
  const session = await db.authSession.findUnique({
    where: { sessionTokenHash: sha256Hex(sessionToken) },
  });
  if (!session || session.revokedAt) return session;
  return db.authSession.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: 'logout',
    },
  });
}

export async function resolveGoogleUserIdentity(
  db: DbClient,
  input: { issuer: string; providerSubject: string },
) {
  return db.userIdentity.findFirst({
    where: {
      providerType: GOOGLE_OIDC_PROVIDER,
      issuer: input.issuer,
      providerSubject: input.providerSubject,
    },
    select: {
      id: true,
      userAccountId: true,
      issuer: true,
      providerSubject: true,
      providerType: true,
      status: true,
      effectiveUntil: true,
      userAccount: {
        select: {
          id: true,
          active: true,
          deletedAt: true,
          userName: true,
          displayName: true,
        },
      },
    },
  });
}

export function isIdentityUsable(identity: {
  status: string;
  effectiveUntil?: Date | null;
  userAccount?: { active: boolean; deletedAt: Date | null } | null;
}) {
  if (identity.status !== 'active') return false;
  if (
    identity.effectiveUntil &&
    identity.effectiveUntil.getTime() <= Date.now()
  ) {
    return false;
  }
  if (
    identity.userAccount &&
    (!identity.userAccount.active || identity.userAccount.deletedAt)
  ) {
    return false;
  }
  return true;
}

export function buildSessionUserContext(session: {
  providerSubject: string;
  providerType: string;
  issuer: string;
  userAccountId: string;
  userIdentityId: string;
}) {
  return {
    userId: session.providerSubject,
    roles: ['user'],
    auth: {
      principalUserId: session.providerSubject,
      actorUserId: session.providerSubject,
      scopes: [],
      delegated: false,
      providerType: session.providerType,
      issuer: session.issuer,
      userAccountId: session.userAccountId,
      identityId: session.userIdentityId,
      sessionBased: true,
    },
  };
}

export function buildAuthSessionResponse(session: {
  id: string;
  providerType: string;
  issuer: string;
  userAccountId: string;
  userIdentityId: string;
  expiresAt: Date;
  idleExpiresAt: Date;
}) {
  return {
    sessionId: session.id,
    providerType: session.providerType,
    issuer: session.issuer,
    userAccountId: session.userAccountId,
    userIdentityId: session.userIdentityId,
    expiresAt: session.expiresAt,
    idleExpiresAt: session.idleExpiresAt,
  };
}

export function buildSessionRedirectUrl(returnTo: string) {
  return buildRedirectTarget(getRuntimeConfig().frontendOrigin, returnTo);
}
