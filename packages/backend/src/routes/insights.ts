import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
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
  evidence: InsightEvidence;
};

type InsightSettingSummary = {
  id: string;
  threshold: number | null;
  period: string;
  scopeProjectId?: string | null;
};

type InsightEvidence = {
  period: { from: string | null; to: string | null };
  targets: string[];
  calculation: string;
  settings: InsightSettingSummary[];
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

const PERIOD_LABELS: Record<string, string> = {
  day: '日次',
  week: '週次',
  month: '月次',
};

const THRESHOLD_UNITS: Record<string, string> = {
  budget_overrun: '%',
  overtime: 'h',
  approval_delay: 'h',
  approval_escalation: 'h',
  delivery_due: '件',
  integration_failure: '回',
};

const CALCULATION_BASE: Record<string, string> = {
  budget_overrun: '予算に対する実績超過のアラート集計',
  overtime: '対象期間の残業超過アラート集計',
  approval_delay: '承認待ちの遅延アラート集計',
  approval_escalation: '承認ステップ遅延のエスカレーション集計',
  delivery_due: '納期超過・未請求のマイルストーン集計',
  integration_failure: '外部連携の失敗アラート集計',
};

function normalizeThreshold(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPeriod(period?: string | null) {
  if (!period) return null;
  return PERIOD_LABELS[period] ?? period;
}

function formatThreshold(type: string, threshold: number | null) {
  if (threshold === null) return null;
  const unit = THRESHOLD_UNITS[type];
  return unit ? `${threshold}${unit}` : String(threshold);
}

function formatSettingSummary(type: string, setting: InsightSettingSummary) {
  const parts: string[] = [];
  const threshold = formatThreshold(type, setting.threshold);
  if (threshold) parts.push(`閾値:${threshold}`);
  const periodLabel = formatPeriod(setting.period);
  if (periodLabel) parts.push(`期間:${periodLabel}`);
  if (setting.scopeProjectId) {
    parts.push(`対象案件:${setting.scopeProjectId}`);
  }
  return parts.join(' ');
}

function formatSettingsSummary(
  type: string,
  settings: InsightSettingSummary[],
) {
  if (!settings.length) return null;
  if (settings.length === 1) {
    return `設定: ${formatSettingSummary(type, settings[0])}`;
  }
  const head = formatSettingSummary(type, settings[0]);
  return `設定: ${settings.length}件${head ? `（例: ${head}）` : ''}`;
}

function buildCalculation(type: string, settings: InsightSettingSummary[]) {
  const base = CALCULATION_BASE[type] ?? `アラート(${type})の集計`;
  const settingsSummary = formatSettingsSummary(type, settings);
  return settingsSummary ? `${base} / ${settingsSummary}` : base;
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
          setting: {
            select: {
              id: true,
              type: true,
              threshold: true,
              period: true,
              scopeProjectId: true,
            },
          },
        },
        orderBy: { triggeredAt: 'desc' },
        take: alertLimit,
      });
      const grouped = new Map<
        string,
        {
          count: number;
          latestAt: Date | null;
          sampleTargets: Set<string>;
          settings: Map<string, InsightSettingSummary>;
        }
      >();
      for (const alert of alerts) {
        const type = alert.setting.type;
        const entry = grouped.get(type) ?? {
          count: 0,
          latestAt: null,
          sampleTargets: new Set<string>(),
          settings: new Map<string, InsightSettingSummary>(),
        };
        entry.count += 1;
        if (!entry.latestAt || alert.triggeredAt > entry.latestAt) {
          entry.latestAt = alert.triggeredAt;
        }
        if (entry.sampleTargets.size < 3 && alert.targetRef) {
          entry.sampleTargets.add(alert.targetRef);
        }
        const setting = alert.setting;
        entry.settings.set(setting.id, {
          id: setting.id,
          threshold: normalizeThreshold(setting.threshold),
          period: setting.period,
          scopeProjectId: setting.scopeProjectId ?? null,
        });
        grouped.set(type, entry);
      }
      const items: InsightItem[] = Array.from(grouped.entries()).map(
        ([type, entry]) => {
          const settings = Array.from(entry.settings.values()).slice(0, 5);
          const evidence: InsightEvidence = {
            period: {
              from: fromDate?.toISOString() ?? null,
              to: toDate ? endOfDay(toDate).toISOString() : null,
            },
            targets: Array.from(entry.sampleTargets),
            calculation: buildCalculation(type, settings),
            settings,
          };
          return {
            id: `${type}:${entry.latestAt?.toISOString() ?? 'none'}`,
            type,
            severity: resolveSeverity(entry.count),
            count: entry.count,
            latestAt: entry.latestAt?.toISOString() ?? null,
            sampleTargets: Array.from(entry.sampleTargets),
            evidence,
          };
        },
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
        metadata: { filters: { from, to, projectId, limit } },
        ...auditContextFromRequest(req),
      });
      return { generatedAt: new Date().toISOString(), items: capped };
    },
  );
}
