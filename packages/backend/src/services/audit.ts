import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { UserContext } from '../plugins/auth.js';
import { prisma } from './db.js';

export type AuditContext = {
  userId?: string;
  actorRole?: string;
  actorGroupId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
  reasonCode?: string;
  reasonText?: string;
  principalUserId?: string;
  actorUserId?: string;
  authScopes?: string[];
  authTokenId?: string;
  authAudience?: string[];
  authExpiresAt?: number;
  agentRunId?: string;
  decisionRequestId?: string;
};

type AuditInput = AuditContext & {
  action: string;
  targetTable?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
};

function resolveRequestId(req: FastifyRequest): string | undefined {
  const raw = req.id as unknown;
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

function resolveUserAgent(req: FastifyRequest): string | undefined {
  const agent = req.headers['user-agent'];
  if (typeof agent === 'string') return agent;
  return undefined;
}

function resolveActorRole(user?: UserContext): string | undefined {
  const roles = user?.roles || [];
  return roles.length ? roles[0] : undefined;
}

function normalizeStringArray(
  value: string[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (!normalized.length) return undefined;
  return normalized as Prisma.InputJsonValue;
}

export function buildAuditMetadata(
  entry: AuditInput,
): Prisma.InputJsonValue | undefined {
  const metadata: Record<string, Prisma.InputJsonValue> =
    entry.metadata &&
    typeof entry.metadata === 'object' &&
    !Array.isArray(entry.metadata)
      ? { ...(entry.metadata as Record<string, Prisma.InputJsonValue>) }
      : {};

  if (entry.metadata !== undefined && Object.keys(metadata).length === 0) {
    metadata._raw = entry.metadata;
  }

  const auth: Record<string, Prisma.InputJsonValue> = {};
  if (entry.principalUserId) auth.principalUserId = entry.principalUserId;
  if (entry.actorUserId) auth.actorUserId = entry.actorUserId;
  const normalizedScopes = normalizeStringArray(entry.authScopes);
  if (normalizedScopes) auth.scopes = normalizedScopes;
  if (entry.authTokenId) auth.tokenId = entry.authTokenId;
  const normalizedAudience = normalizeStringArray(entry.authAudience);
  if (normalizedAudience) auth.audience = normalizedAudience;
  if (typeof entry.authExpiresAt === 'number')
    auth.expiresAt = entry.authExpiresAt;
  if (Object.keys(auth).length > 0) metadata._auth = auth;

  const requestInfo: Record<string, Prisma.InputJsonValue> = {};
  if (entry.requestId) requestInfo.id = entry.requestId;
  if (entry.source) requestInfo.source = entry.source;
  if (Object.keys(requestInfo).length > 0) metadata._request = requestInfo;

  const agentInfo: Record<string, Prisma.InputJsonValue> = {};
  if (entry.agentRunId) agentInfo.runId = entry.agentRunId;
  if (entry.decisionRequestId)
    agentInfo.decisionRequestId = entry.decisionRequestId;
  if (Object.keys(agentInfo).length > 0) metadata._agent = agentInfo;

  return Object.keys(metadata).length > 0
    ? (metadata as Prisma.InputJsonObject)
    : undefined;
}

export function auditContextFromRequest(
  req: FastifyRequest,
  overrides: Partial<AuditContext> = {},
): AuditContext {
  const principalUserId = req.user?.auth?.principalUserId ?? req.user?.userId;
  const actorUserId = req.user?.auth?.actorUserId ?? req.user?.userId;
  return {
    userId: req.user?.userId,
    // Use primary role/group for filtering; full list is available in auth context.
    actorRole: resolveActorRole(req.user),
    actorGroupId: req.user?.groupIds?.[0],
    requestId: resolveRequestId(req),
    ipAddress: req.ip,
    userAgent: resolveUserAgent(req),
    source: req.user?.auth?.delegated ? 'agent' : 'api',
    principalUserId,
    actorUserId,
    authScopes: req.user?.auth?.scopes ?? undefined,
    authTokenId: req.user?.auth?.tokenId,
    authAudience: req.user?.auth?.audience ?? undefined,
    authExpiresAt: req.user?.auth?.expiresAt,
    agentRunId: req.agentRun?.runId,
    decisionRequestId: req.agentRun?.decisionRequestId,
    ...overrides,
  };
}

export async function logAudit(entry: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId,
        actorRole: entry.actorRole,
        actorGroupId: entry.actorGroupId,
        requestId: entry.requestId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        source: entry.source,
        reasonCode: entry.reasonCode,
        reasonText: entry.reasonText,
        targetTable: entry.targetTable,
        targetId: entry.targetId,
        metadata: buildAuditMetadata(entry),
      },
    });
  } catch (err) {
    // 粗めのスタブ: 失敗してもアプリ処理は継続
    console.error('[audit log failed]', err);
  }
}
