import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { endOfDay, parseDateParam } from '../utils/date.js';

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

function formatCsvValue(value: unknown) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(formatCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(formatCsvValue).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function sendCsv(reply: any, filename: string, csv: string) {
  return reply
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .type('text/csv; charset=utf-8')
    .send(csv);
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
        format,
        limit,
      } = req.query as {
        from?: string;
        to?: string;
        userId?: string;
        action?: string;
        targetTable?: string;
        targetId?: string;
        format?: string;
        limit?: string;
      };
      const normalizedFormat = normalizeFormat(format);
      if (!normalizedFormat) {
        return reply.status(400).send({
          error: { code: 'INVALID_FORMAT', message: 'format must be csv or json' },
        });
      }
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      const where: any = {};
      if (userId) where.userId = String(userId);
      if (action) where.action = String(action);
      if (targetTable) where.targetTable = String(targetTable);
      if (targetId) where.targetId = String(targetId);
      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = fromDate;
        if (toDate) where.createdAt.lte = endOfDay(toDate);
      }
      const items = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: normalizeLimit(limit),
      });
      if (normalizedFormat === 'csv') {
        const headers = [
          'id',
          'action',
          'userId',
          'targetTable',
          'targetId',
          'createdAt',
          'metadata',
        ];
        const rows = items.map((item) => [
          item.id,
          item.action,
          item.userId || '',
          item.targetTable || '',
          item.targetId || '',
          item.createdAt.toISOString(),
          item.metadata ? JSON.stringify(item.metadata) : '',
        ]);
        await logAudit({
          action: 'audit_log_exported',
          userId: req.user?.userId,
          metadata: {
            format: 'csv',
            rowCount: items.length,
            filters: {
              from,
              to,
              userId,
              action,
              targetTable,
              targetId,
            },
          },
        });
        const dateLabel = new Date().toISOString().slice(0, 10);
        return sendCsv(reply, `audit-logs-${dateLabel}.csv`, toCsv(headers, rows));
      }
      return { items };
    },
  );
}
