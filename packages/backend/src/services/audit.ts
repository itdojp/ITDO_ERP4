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

export function auditContextFromRequest(
  req: FastifyRequest,
  overrides: Partial<AuditContext> = {},
): AuditContext {
  return {
    userId: req.user?.userId,
    // Use primary role/group for filtering; full list is available in auth context.
    actorRole: resolveActorRole(req.user),
    actorGroupId: req.user?.groupIds?.[0],
    requestId: resolveRequestId(req),
    ipAddress: req.ip,
    userAgent: resolveUserAgent(req),
    source: 'api',
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
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch (err) {
    // 粗めのスタブ: 失敗してもアプリ処理は継続
    console.error('[audit log failed]', err);
  }
}
