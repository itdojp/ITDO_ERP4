import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { endOfDay, parseDateParam } from '../utils/date.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import type { Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function normalizeFormat(raw?: string) {
  const value = (raw || 'json').toLowerCase();
  if (value === 'csv' || value === 'json') return value;
  return null;
}

function normalizeMask(raw: string | undefined, format: 'csv' | 'json') {
  if (raw === undefined || raw === null || raw === '') {
    return format === 'csv';
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return format === 'csv';
}

function normalizeLimit(raw?: string | number) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(value)));
}

function maskEmail(value: string) {
  const [local, domain] = value.split('@');
  if (!domain) return value;
  const prefix = local.slice(0, 2);
  const maskedLocal =
    prefix + '*'.repeat(Math.max(local.length - prefix.length, 3));
  return `${maskedLocal}@${domain}`;
}

function maskId(value: string) {
  if (value.length <= 3) return '*'.repeat(value.length);
  const keep = Math.min(4, Math.max(2, Math.ceil(value.length / 3)));
  return `${value.slice(0, keep)}${'*'.repeat(value.length - keep)}`;
}

function maskIp(value: string) {
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length <= 2) return value;
    return `${parts.slice(0, 2).join(':')}:****`;
  }
  const parts = value.split('.');
  if (parts.length !== 4) return value;
  return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
}

function maskFreeText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) =>
      maskEmail(match),
    )
    .replace(/\b\d{10,13}\b/g, (match) => maskId(match));
}

const SENSITIVE_KEYS = [
  'email',
  'userId',
  'userName',
  'displayName',
  'name',
  'phone',
  'address',
  'recipient',
  'recipients',
];

function maskJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskJsonValue(item));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        if (typeof child === 'string') {
          output[key] = child.includes('@') ? maskEmail(child) : maskId(child);
        } else {
          output[key] = maskJsonValue(child);
        }
      } else {
        output[key] = maskJsonValue(child);
      }
    }
    return output;
  }
  if (typeof value === 'string') {
    return maskFreeText(value);
  }
  return value;
}

function maskAuditLog(item: {
  id: string;
  action: string;
  userId: string | null;
  actorRole: string | null;
  actorGroupId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  source: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  targetTable: string | null;
  targetId: string | null;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
}) {
  return {
    ...item,
    userId: item.userId
      ? item.userId.includes('@')
        ? maskEmail(item.userId)
        : maskId(item.userId)
      : item.userId,
    requestId: item.requestId ? maskId(item.requestId) : item.requestId,
    ipAddress: item.ipAddress ? maskIp(item.ipAddress) : item.ipAddress,
    reasonText: item.reasonText ? maskFreeText(item.reasonText) : item.reasonText,
    metadata: item.metadata ? (maskJsonValue(item.metadata) as Prisma.JsonValue) : item.metadata,
  };
}

export async function registerAuditLogRoutes(app: FastifyInstance) {
  app.get(
    '/audit-logs',
    { preHandler: requireRole(['admin', 'mgmt', 'exec']) },
    async (req, reply) => {
      const {
        from,
        to,
        userId,
        action,
        targetTable,
        targetId,
        reasonCode,
        reasonText,
        source,
        actorRole,
        actorGroupId,
        requestId,
        format,
        mask,
        limit,
      } = req.query as {
        from?: string;
        to?: string;
        userId?: string;
        action?: string;
        targetTable?: string;
        targetId?: string;
        reasonCode?: string;
        reasonText?: string;
        source?: string;
        actorRole?: string;
        actorGroupId?: string;
        requestId?: string;
        format?: string;
        mask?: string;
        limit?: string;
      };
      const normalizedFormat = normalizeFormat(format);
      if (!normalizedFormat) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_FORMAT',
            message: 'format must be csv or json',
          },
        });
      }
      const shouldMask = normalizeMask(mask, normalizedFormat);
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      const where: Prisma.AuditLogWhereInput = {};
      if (userId) where.userId = String(userId);
      if (action) where.action = String(action);
      if (targetTable) where.targetTable = String(targetTable);
      if (targetId) where.targetId = String(targetId);
      if (reasonCode) where.reasonCode = String(reasonCode);
      if (reasonText) {
        where.reasonText = {
          contains: String(reasonText),
          mode: 'insensitive',
        };
      }
      if (source) where.source = String(source);
      if (actorRole) where.actorRole = String(actorRole);
      if (actorGroupId) where.actorGroupId = String(actorGroupId);
      if (requestId) where.requestId = String(requestId);
      const createdAt: Prisma.DateTimeFilter = {};
      if (fromDate) createdAt.gte = fromDate;
      if (toDate) createdAt.lte = endOfDay(toDate);
      if (Object.keys(createdAt).length) {
        where.createdAt = createdAt;
      }
      const items = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: normalizeLimit(limit),
      });
      await logAudit({
        action: 'audit_log_exported',
        metadata: {
          format: normalizedFormat,
          mask: shouldMask,
          rowCount: items.length,
          filters: {
            from,
            to,
            userId,
            action,
            targetTable,
            targetId,
            reasonCode,
            reasonText,
            source,
            actorRole,
            actorGroupId,
            requestId,
            mask,
          },
        },
        ...auditContextFromRequest(req),
      });
      const outputItems = shouldMask ? items.map(maskAuditLog) : items;
      if (normalizedFormat === 'csv') {
        const headers = [
          'id',
          'action',
          'userId',
          'actorRole',
          'actorGroupId',
          'requestId',
          'ipAddress',
          'userAgent',
          'source',
          'reasonCode',
          'reasonText',
          'targetTable',
          'targetId',
          'createdAt',
          'metadata',
        ];
        const rows = outputItems.map((item) => [
          item.id,
          item.action,
          item.userId || '',
          item.actorRole || '',
          item.actorGroupId || '',
          item.requestId || '',
          item.ipAddress || '',
          item.userAgent || '',
          item.source || '',
          item.reasonCode || '',
          item.reasonText || '',
          item.targetTable || '',
          item.targetId || '',
          item.createdAt.toISOString(),
          item.metadata ? JSON.stringify(item.metadata) : '',
        ]);
        const dateLabel = new Date().toISOString().slice(0, 10);
        return sendCsv(
          reply,
          `audit-logs-${dateLabel}.csv`,
          toCsv(headers, rows),
        );
      }
      return { items: outputItems };
    },
  );
}
