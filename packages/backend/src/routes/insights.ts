import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { endOfDay, parseDateParam } from '../utils/date.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type InsightItem = {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  count: number;
  latestAt: string | null;
  sampleTargets: string[];
};

function normalizeLimit(raw?: string | number) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function resolveSeverity(count: number): InsightItem['severity'] {
  if (count >= 10) return 'high';
  if (count >= 3) return 'medium';
  return 'low';
}

function severityRank(severity: InsightItem['severity']) {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export async function registerInsightRoutes(app: FastifyInstance) {
  app.get(
    '/insights',
    { preHandler: requireRole(['admin', 'mgmt', 'exec']) },
    async (req) => {
      const { from, to, projectId, limit } = req.query as {
        from?: string;
        to?: string;
        projectId?: string;
        limit?: string;
      };
      const normalizedLimit = normalizeLimit(limit);
      const alertLimit = Math.min(1000, normalizedLimit * 20);
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      const where: Prisma.AlertWhereInput = { status: 'open' };
      const triggeredAt: Prisma.DateTimeFilter = {};
      if (fromDate) triggeredAt.gte = fromDate;
      if (toDate) triggeredAt.lte = endOfDay(toDate);
      if (Object.keys(triggeredAt).length) {
        where.triggeredAt = triggeredAt;
      }
      if (projectId) {
        // projectId が指定された場合は targetRef と scopeProjectId の両方を対象に含める。
        where.OR = [
          { targetRef: projectId },
          { setting: { scopeProjectId: projectId } },
        ];
      }
      const alerts = await prisma.alert.findMany({
        where,
        include: {
          setting: { select: { type: true } },
        },
        orderBy: { triggeredAt: 'desc' },
        take: alertLimit,
      });
      const grouped = new Map<
        string,
        { count: number; latestAt: Date | null; sampleTargets: Set<string> }
      >();
      for (const alert of alerts) {
        const type = alert.setting.type;
        const entry = grouped.get(type) ?? {
          count: 0,
          latestAt: null,
          sampleTargets: new Set<string>(),
        };
        entry.count += 1;
        if (!entry.latestAt || alert.triggeredAt > entry.latestAt) {
          entry.latestAt = alert.triggeredAt;
        }
        if (entry.sampleTargets.size < 3 && alert.targetRef) {
          entry.sampleTargets.add(alert.targetRef);
        }
        grouped.set(type, entry);
      }
      const items: InsightItem[] = Array.from(grouped.entries()).map(
        ([type, entry]) => ({
          id: `${type}:${entry.latestAt?.toISOString() ?? 'none'}`,
          type,
          severity: resolveSeverity(entry.count),
          count: entry.count,
          latestAt: entry.latestAt?.toISOString() ?? null,
          sampleTargets: Array.from(entry.sampleTargets),
        }),
      );
      items.sort((a, b) => {
        const severityDiff =
          severityRank(b.severity) - severityRank(a.severity);
        if (severityDiff !== 0) return severityDiff;
        if (b.count !== a.count) return b.count - a.count;
        return a.type.localeCompare(b.type);
      });
      const capped = items.slice(0, normalizedLimit);
      await logAudit({
        action: 'insights_view',
        userId: req.user?.userId,
        metadata: { filters: { from, to, projectId, limit } },
      });
      return { generatedAt: new Date().toISOString(), items: capped };
    },
  );
}
