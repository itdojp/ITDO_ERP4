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

function normalizeLimit(raw?: string | number) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(value)));
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
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      const where: Prisma.AuditLogWhereInput = {};
      if (userId) where.userId = String(userId);
      if (action) where.action = String(action);
      if (targetTable) where.targetTable = String(targetTable);
      if (targetId) where.targetId = String(targetId);
      if (reasonCode) where.reasonCode = String(reasonCode);
      if (reasonText) {
        where.reasonText = { contains: String(reasonText) };
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
          },
        },
        ...auditContextFromRequest(req),
      });
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
        const rows = items.map((item) => [
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
      return { items };
    },
  );
}
