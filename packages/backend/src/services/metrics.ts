import { prisma } from './db.js';
import { calcTimeAmount, resolveRateCard } from './rateCard.js';
import { dateKey, toNumber } from './utils.js';

type AlertSetting = {
  id: string;
  type: string;
  threshold: number | string;
  period: string;
  scopeProjectId?: string | null;
  recipients?: unknown;
  channels?: unknown;
  isEnabled?: boolean;
};
type MetricResult = { metric: number; targetRef: string };
type TimeEntryWhereInput = {
  workDate: { gte: Date; lte: Date };
  deletedAt: null;
  status: { not: string };
  projectId?: string;
};
type ProjectMilestoneWhereInput = {
  dueDate: { lte: Date };
  deletedAt: null;
  project: { deletedAt: null };
  invoices: { none: { deletedAt: null } };
  projectId?: string;
};
type ApprovalInstanceWhereInput = {
  status: { in: string[] };
  projectId?: string;
};

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function resolvePeriodRange(period: string, now = new Date()) {
  const normalized = period?.toLowerCase();
  const end = new Date(now);
  const start = startOfDay(end);
  const days = normalized === 'day' ? 0 : normalized === 'month' ? 29 : 6;
  if (days > 0) {
    start.setDate(start.getDate() - days);
  }
  return { start, end };
}

async function resolveProjectBudget(projectId: string): Promise<number> {
  const estimate = await prisma.estimate.findFirst({
    where: {
      projectId,
      deletedAt: null,
      status: { notIn: ['cancelled', 'rejected'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { totalAmount: true },
  });
  const estimateBudgetRaw = estimate?.totalAmount;
  if (estimateBudgetRaw != null) {
    const estimateValue = toNumber(estimateBudgetRaw);
    if (estimateValue > 0) return estimateValue;
  }
  const milestoneSum = await prisma.projectMilestone.aggregate({
    where: { projectId, deletedAt: null },
    _sum: { amount: true },
  });
  if (milestoneSum._sum.amount == null) {
    console.warn('[metrics] budget missing for project', projectId);
    return 0;
  }
  return toNumber(milestoneSum._sum.amount);
}

async function sumTimeCost(projectId: string): Promise<number> {
  const entries = await prisma.timeEntry.findMany({
    where: {
      projectId,
      deletedAt: null,
      status: { not: 'rejected' },
    },
    select: { minutes: true, workDate: true, workType: true },
  });
  if (!entries.length) return 0;
  const uniqueCombos = new Map<string, { workDate: Date; workType?: string }>();
  for (const entry of entries) {
    const workType = entry.workType ?? undefined;
    const key = `${dateKey(entry.workDate)}|${workType ?? ''}`;
    if (!uniqueCombos.has(key)) {
      uniqueCombos.set(key, { workDate: entry.workDate, workType });
    }
  }
  const rateCardCache = new Map<
    string,
    Awaited<ReturnType<typeof resolveRateCard>>
  >();
  await Promise.all(
    Array.from(uniqueCombos.entries()).map(async ([key, combo]) => {
      const rateCard = await resolveRateCard({
        projectId,
        workDate: combo.workDate,
        workType: combo.workType,
      });
      rateCardCache.set(key, rateCard);
    }),
  );
  let total = 0;
  for (const entry of entries) {
    const workType = entry.workType ?? undefined;
    const key = `${dateKey(entry.workDate)}|${workType ?? ''}`;
    const rateCard = rateCardCache.get(key);
    if (!rateCard) continue;
    total += calcTimeAmount(entry.minutes, toNumber(rateCard.unitPrice));
  }
  return total;
}

async function sumExpenseCost(projectId: string): Promise<number> {
  const sum = await prisma.expense.aggregate({
    where: {
      projectId,
      deletedAt: null,
      status: { notIn: ['cancelled', 'rejected'] },
    },
    _sum: { amount: true },
  });
  return toNumber(sum._sum.amount);
}

async function sumVendorInvoiceCost(projectId: string): Promise<number> {
  const sum = await prisma.vendorInvoice.aggregate({
    where: {
      projectId,
      deletedAt: null,
      status: { notIn: ['cancelled', 'rejected'] },
    },
    _sum: { totalAmount: true },
  });
  return toNumber(sum._sum.totalAmount);
}

export async function computeBudgetOverrun(
  setting: AlertSetting,
): Promise<MetricResult | null> {
  const projectIds = setting.scopeProjectId
    ? [setting.scopeProjectId]
    : (
        await prisma.project.findMany({
          where: { deletedAt: null },
          select: { id: true },
        })
      ).map((project: { id: string }) => project.id);
  if (!projectIds.length) return null;
  let best: MetricResult | null = null;
  for (const projectId of projectIds) {
    const budget = await resolveProjectBudget(projectId);
    if (!budget) continue;
    const [expenseCost, vendorCost, timeCost] = await Promise.all([
      sumExpenseCost(projectId),
      sumVendorInvoiceCost(projectId),
      sumTimeCost(projectId),
    ]);
    const actual = expenseCost + vendorCost + timeCost;
    // metric is percent over budget (0 when <= 100% utilization)
    const overPercent = Math.max(0, (actual / budget - 1) * 100);
    const metric = Math.round(overPercent * 100) / 100;
    if (!best || metric > best.metric) {
      best = { metric, targetRef: projectId };
    }
  }
  return best;
}

export async function computeOvertime(
  setting: AlertSetting,
): Promise<MetricResult | null> {
  const { start, end } = resolvePeriodRange(setting.period);
  const where: TimeEntryWhereInput = {
    workDate: { gte: start, lte: end },
    deletedAt: null,
    status: { not: 'rejected' },
  };
  if (setting.scopeProjectId) {
    where.projectId = setting.scopeProjectId;
  }
  const entries = await prisma.timeEntry.findMany({
    where,
    select: { userId: true, workDate: true, minutes: true },
  });
  if (!entries.length) return null;
  const dailyTotals = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.userId}:${dateKey(entry.workDate)}`;
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + entry.minutes);
  }
  const overtimeByUser = new Map<string, number>();
  for (const [key, totalMinutes] of dailyTotals.entries()) {
    const userId = key.split(':')[0];
    const overtimeMinutes = Math.max(0, totalMinutes - 480);
    overtimeByUser.set(
      userId,
      (overtimeByUser.get(userId) ?? 0) + overtimeMinutes,
    );
  }
  let maxMinutes = 0;
  let maxUserId = 'global';
  for (const [userId, minutes] of overtimeByUser.entries()) {
    if (minutes > maxMinutes) {
      maxMinutes = minutes;
      maxUserId = userId;
    }
  }
  const hours = Math.round((maxMinutes / 60) * 100) / 100;
  return { metric: hours, targetRef: maxUserId };
}

export async function computeApprovalDelay(
  setting: AlertSetting,
): Promise<MetricResult | null> {
  const where: ApprovalInstanceWhereInput = {
    status: { in: ['pending_qa', 'pending_exec'] },
  };
  if (setting.scopeProjectId) {
    where.projectId = setting.scopeProjectId;
  }
  const pending = await prisma.approvalInstance.findMany({
    where,
    select: { id: true, createdAt: true },
  });
  if (!pending.length) return null;
  const now = Date.now();
  let maxHours = 0;
  let targetRef = pending[0].id;
  for (const instance of pending) {
    const hours = (now - instance.createdAt.getTime()) / 3600000;
    if (hours > maxHours) {
      maxHours = hours;
      targetRef = instance.id;
    }
  }
  const metric = Math.round(maxHours * 100) / 100;
  return { metric, targetRef };
}

export async function computeDeliveryDue(
  setting: AlertSetting,
): Promise<MetricResult | null> {
  const now = new Date();
  const where: ProjectMilestoneWhereInput = {
    dueDate: { lte: now },
    deletedAt: null,
    project: { deletedAt: null },
    invoices: { none: { deletedAt: null } },
  };
  if (setting.scopeProjectId) {
    where.projectId = setting.scopeProjectId;
  }
  const count = await prisma.projectMilestone.count({ where });
  return { metric: count, targetRef: setting.scopeProjectId ?? 'global' };
}
