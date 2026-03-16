import { prisma } from './db.js';
import { calcTimeAmount, resolveRateCard } from './rateCard.js';
import { dateKey, toNumber } from './utils.js';

type ResolvedRateCard = Awaited<ReturnType<typeof resolveRateCard>>;
type PrefetchedRateCard = NonNullable<ResolvedRateCard>;

type ManagementAccountingProjectBucket = {
  projectId: string;
  projectCode?: string | null;
  projectName?: string | null;
  currency: string | null;
  revenue: number;
  directCost: number;
  laborCost: number;
  vendorCost: number;
  expenseCost: number;
  grossProfit: number;
  grossMargin: number;
  totalMinutes: number;
};

type ManagementAccountingCurrencyBreakdown = {
  currency: string | null;
  projectCount: number;
  revenue: number;
  directCost: number;
  laborCost: number;
  vendorCost: number;
  expenseCost: number;
  grossProfit: number;
  grossMargin: number;
  totalMinutes: number;
  deliveryDueCount: number;
  deliveryDueAmount: number;
  redProjectCount: number;
  topRedProjects: ManagementAccountingProjectBucket[];
};

function normalizeWorkType(workType?: string | null) {
  const trimmed = workType?.trim();
  return trimmed || null;
}

function buildProjectCurrencyKey(projectId: string, currency: string | null) {
  return `${projectId}|${currency ?? ''}`;
}

function preloadRateCardKey(match: {
  projectId?: string | null;
  workDate: Date;
  workType?: string | null;
}) {
  return `${match.projectId ?? ''}|${dateKey(match.workDate)}|${normalizeWorkType(match.workType) ?? ''}`;
}

async function preloadRateCardsForRange(
  projectIds: string[],
  entries: Array<{ workDate: Date; workType?: string | null }>,
  from: Date,
  to: Date,
): Promise<PrefetchedRateCard[]> {
  if (!entries.length) return [];
  const workTypes = Array.from(
    new Set(
      entries
        .map((entry) => normalizeWorkType(entry.workType))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  return prisma.rateCard.findMany({
    where: {
      AND: [
        { validFrom: { lte: to } },
        { OR: [{ validTo: null }, { validTo: { gte: from } }] },
        { OR: [{ projectId: null }, { projectId: { in: projectIds } }] },
        workTypes.length
          ? { OR: [{ workType: null }, { workType: { in: workTypes } }] }
          : { workType: null },
      ],
    },
    orderBy: [{ validFrom: 'desc' }, { id: 'asc' }],
  });
}

function pickRateCardFromPrefetched(
  items: PrefetchedRateCard[],
  match: {
    projectId?: string | null;
    workDate: Date;
    workType?: string | null;
  },
): PrefetchedRateCard | null {
  if (!items.length) return null;
  const workType = normalizeWorkType(match.workType);
  let best: PrefetchedRateCard | null = null;
  let bestScore = -1;
  for (const item of items) {
    if (item.validFrom.getTime() > match.workDate.getTime()) continue;
    if (item.validTo && item.validTo.getTime() < match.workDate.getTime())
      continue;
    if (item.projectId && item.projectId !== match.projectId) continue;
    const itemWorkType = normalizeWorkType(item.workType);
    if (itemWorkType && itemWorkType !== workType) continue;
    let score = 0;
    if (match.projectId && item.projectId === match.projectId) score += 100;
    if (workType && itemWorkType === workType) score += 10;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

async function sumTimeCost(
  projectId: string,
  from?: Date,
  to?: Date,
): Promise<{ cost: number; minutes: number }> {
  const where: any = {
    projectId,
    deletedAt: null,
    status: { in: ['submitted', 'approved'] },
  };
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const entries = await prisma.timeEntry.findMany({
    where,
    select: { minutes: true, workDate: true, workType: true },
  });
  if (!entries.length) return { cost: 0, minutes: 0 };
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
  let minutes = 0;
  for (const entry of entries) {
    const workType = entry.workType ?? undefined;
    const key = `${dateKey(entry.workDate)}|${workType ?? ''}`;
    const rateCard = rateCardCache.get(key);
    minutes += entry.minutes || 0;
    if (!rateCard) continue;
    total += calcTimeAmount(entry.minutes, toNumber(rateCard.unitPrice));
  }
  return { cost: total, minutes };
}

type LaborCostByUser = {
  totalCost: number;
  totalMinutes: number;
  items: Map<string, { cost: number; minutes: number }>;
};

async function sumTimeCostByUser(
  projectId: string,
  from?: Date,
  to?: Date,
): Promise<LaborCostByUser> {
  const where: any = {
    projectId,
    deletedAt: null,
    status: { in: ['submitted', 'approved'] },
  };
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const entries = await prisma.timeEntry.findMany({
    where,
    select: { userId: true, minutes: true, workDate: true, workType: true },
  });
  if (!entries.length) {
    return { totalCost: 0, totalMinutes: 0, items: new Map() };
  }
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
  const items = new Map<string, { cost: number; minutes: number }>();
  let totalCost = 0;
  let totalMinutes = 0;
  for (const entry of entries) {
    const workType = entry.workType ?? undefined;
    const key = `${dateKey(entry.workDate)}|${workType ?? ''}`;
    const rateCard = rateCardCache.get(key);
    const minutes = entry.minutes || 0;
    totalMinutes += minutes;
    const cost = rateCard
      ? calcTimeAmount(minutes, toNumber(rateCard.unitPrice))
      : 0;
    totalCost += cost;
    const current = items.get(entry.userId) ?? { cost: 0, minutes: 0 };
    current.cost += cost;
    current.minutes += minutes;
    items.set(entry.userId, current);
  }
  return { totalCost, totalMinutes, items };
}

async function resolveRevenueBudget(
  projectId: string,
  from?: Date,
  to?: Date,
  currency?: string | null,
): Promise<number> {
  const estimateWhere: any = {
    projectId,
    deletedAt: null,
    status: 'approved',
  };
  if (from || to) {
    estimateWhere.createdAt = {};
    if (from) estimateWhere.createdAt.gte = from;
    if (to) estimateWhere.createdAt.lte = to;
  }
  if (currency) {
    estimateWhere.currency = currency;
  }
  const estimate = await prisma.estimate.findFirst({
    where: estimateWhere,
    orderBy: { createdAt: 'desc' },
    select: { totalAmount: true },
  });
  const estimateBudgetRaw = estimate?.totalAmount;
  if (estimateBudgetRaw != null) {
    const estimateValue = toNumber(estimateBudgetRaw);
    if (estimateValue > 0) return estimateValue;
  }
  const milestoneWhere: any = { projectId, deletedAt: null };
  if (from || to) {
    milestoneWhere.dueDate = {};
    if (from) milestoneWhere.dueDate.gte = from;
    if (to) milestoneWhere.dueDate.lte = to;
  }
  const milestoneSum = await prisma.projectMilestone.aggregate({
    where: milestoneWhere,
    _sum: { amount: true },
  });
  return toNumber(milestoneSum._sum.amount);
}

export async function reportProjectEffort(
  projectId: string,
  from?: Date,
  to?: Date,
) {
  const where: any = { projectId };
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { currency: true, planHours: true },
  });
  const currency = project?.currency ?? null;
  const planHoursRaw = project?.planHours ?? null;
  const planHours = planHoursRaw == null ? null : toNumber(planHoursRaw);
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const minutes = await prisma.timeEntry.aggregate({
    _sum: { minutes: true },
    where,
  });
  const expenseBaseWhere: any = {
    projectId,
    deletedAt: null,
    status: 'approved',
  };
  if (from || to) {
    expenseBaseWhere.incurredOn = {};
    if (from) expenseBaseWhere.incurredOn.gte = from;
    if (to) expenseBaseWhere.incurredOn.lte = to;
  }
  const expenseWhere: any = { ...expenseBaseWhere };
  if (currency) expenseWhere.currency = currency;
  const expenseMismatch = currency
    ? await prisma.expense.findFirst({
        where: { ...expenseBaseWhere, currency: { not: currency } },
        select: { id: true },
      })
    : null;
  if (expenseMismatch) {
    console.warn('[reports] expense currency mismatch', {
      projectId,
      currency,
    });
  }
  const expenses = await prisma.expense.aggregate({
    _sum: { amount: true },
    where: expenseWhere,
  });
  const planMinutes = planHours == null ? null : planHours * 60;
  const totalMinutes = minutes._sum.minutes || 0;
  return {
    projectId,
    planHours,
    planMinutes,
    totalMinutes,
    varianceMinutes: planMinutes == null ? null : totalMinutes - planMinutes,
    totalExpenses: expenses._sum.amount || 0,
  };
}

export async function reportGroupEffort(
  userIds: string[],
  from?: Date,
  to?: Date,
) {
  const where: any = { userId: { in: userIds } };
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const agg = await prisma.timeEntry.groupBy({
    by: ['userId'],
    _sum: { minutes: true },
    where,
  });
  return agg.map((g: { userId: string; _sum: { minutes: number | null } }) => ({
    userId: g.userId,
    totalMinutes: g._sum.minutes || 0,
  }));
}

export async function reportOvertime(userId: string, from?: Date, to?: Date) {
  const where: any = { userId };
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const agg = await prisma.timeEntry.aggregate({
    _sum: { minutes: true },
    where,
  });
  const totalMinutes = agg._sum.minutes || 0;
  const dailyHours = totalMinutes / 60;
  return { userId, totalMinutes, dailyHours };
}

export async function reportManagementAccountingSummary(from: Date, to: Date) {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, name: true, currency: true },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
  });
  const projectIds = projects.map((project) => project.id);
  const projectIdSet = new Set(projectIds);
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const [invoiceSums, vendorSums, expenseSums, timeEntries, deliveryDueItems] =
    await Promise.all([
      projectIds.length
        ? prisma.invoice.groupBy({
            by: ['projectId', 'currency'],
            where: {
              projectId: { in: projectIds },
              deletedAt: null,
              status: { in: ['approved', 'sent', 'paid'] },
              issueDate: { gte: from, lte: to },
            },
            _sum: { totalAmount: true },
          })
        : [],
      projectIds.length
        ? prisma.vendorInvoice.groupBy({
            by: ['projectId', 'currency'],
            where: {
              projectId: { in: projectIds },
              deletedAt: null,
              status: { in: ['received', 'approved', 'paid'] },
              receivedDate: { gte: from, lte: to },
            },
            _sum: { totalAmount: true },
          })
        : [],
      projectIds.length
        ? prisma.expense.groupBy({
            by: ['projectId', 'currency'],
            where: {
              projectId: { in: projectIds },
              deletedAt: null,
              status: 'approved',
              incurredOn: { gte: from, lte: to },
            },
            _sum: { amount: true },
          })
        : [],
      projectIds.length
        ? prisma.timeEntry.findMany({
            where: {
              projectId: { in: projectIds },
              deletedAt: null,
              status: { in: ['submitted', 'approved'] },
              workDate: { gte: from, lte: to },
            },
            select: {
              projectId: true,
              userId: true,
              workDate: true,
              workType: true,
              minutes: true,
            },
          })
        : [],
      reportDeliveryDue(from, to),
    ]);

  const revenueByProjectCurrency = new Map<string, number>();
  for (const item of invoiceSums) {
    if (!item.projectId) continue;
    const key = buildProjectCurrencyKey(item.projectId, item.currency ?? null);
    revenueByProjectCurrency.set(
      key,
      (revenueByProjectCurrency.get(key) ?? 0) +
        toNumber(item._sum.totalAmount),
    );
  }

  const vendorCostByProjectCurrency = new Map<string, number>();
  for (const item of vendorSums) {
    if (!item.projectId) continue;
    const key = buildProjectCurrencyKey(item.projectId, item.currency ?? null);
    vendorCostByProjectCurrency.set(
      key,
      (vendorCostByProjectCurrency.get(key) ?? 0) +
        toNumber(item._sum.totalAmount),
    );
  }

  const expenseCostByProjectCurrency = new Map<string, number>();
  for (const item of expenseSums) {
    if (!item.projectId) continue;
    const key = buildProjectCurrencyKey(item.projectId, item.currency ?? null);
    expenseCostByProjectCurrency.set(
      key,
      (expenseCostByProjectCurrency.get(key) ?? 0) + toNumber(item._sum.amount),
    );
  }

  const prefetchedRateCards = await preloadRateCardsForRange(
    projectIds,
    timeEntries,
    from,
    to,
  );
  const rateCardCache = new Map<string, PrefetchedRateCard | null>();
  const laborCostByProjectCurrency = new Map<string, number>();
  const minutesByProjectCurrency = new Map<string, number>();
  const minutesByProject = new Map<string, number>();
  const overtimeByUserDay = new Map<string, number>();
  for (const entry of timeEntries) {
    if (!projectIdSet.has(entry.projectId)) continue;
    const rateKey = preloadRateCardKey(entry);
    if (!rateCardCache.has(rateKey)) {
      rateCardCache.set(
        rateKey,
        pickRateCardFromPrefetched(prefetchedRateCards, {
          projectId: entry.projectId,
          workDate: entry.workDate,
          workType: entry.workType,
        }),
      );
    }
    const rateCard = rateCardCache.get(rateKey) ?? null;
    const minutes = entry.minutes || 0;
    minutesByProject.set(
      entry.projectId,
      (minutesByProject.get(entry.projectId) ?? 0) + minutes,
    );
    const laborCurrency =
      rateCard?.currency ?? projectById.get(entry.projectId)?.currency ?? null;
    const bucketKey = buildProjectCurrencyKey(entry.projectId, laborCurrency);
    minutesByProjectCurrency.set(
      bucketKey,
      (minutesByProjectCurrency.get(bucketKey) ?? 0) + minutes,
    );
    if (rateCard) {
      const cost = calcTimeAmount(minutes, toNumber(rateCard.unitPrice));
      laborCostByProjectCurrency.set(
        bucketKey,
        (laborCostByProjectCurrency.get(bucketKey) ?? 0) + cost,
      );
    }
    const overtimeKey = `${entry.userId}:${dateKey(entry.workDate)}`;
    overtimeByUserDay.set(
      overtimeKey,
      (overtimeByUserDay.get(overtimeKey) ?? 0) + minutes,
    );
  }

  let overtimeTotalMinutes = 0;
  for (const totalMinutes of overtimeByUserDay.values()) {
    overtimeTotalMinutes += Math.max(0, totalMinutes - 480);
  }

  const deliveryDueAmountByCurrency = new Map<string, number>();
  const deliveryDueCountByCurrency = new Map<string, number>();
  for (const item of deliveryDueItems) {
    const projectCurrency = item.projectCurrency ?? null;
    const key = projectCurrency ?? '';
    deliveryDueAmountByCurrency.set(
      key,
      (deliveryDueAmountByCurrency.get(key) ?? 0) + toNumber(item.amount),
    );
    deliveryDueCountByCurrency.set(
      key,
      (deliveryDueCountByCurrency.get(key) ?? 0) + 1,
    );
  }

  const projectCurrencyKeys = new Set<string>();
  for (const key of revenueByProjectCurrency.keys())
    projectCurrencyKeys.add(key);
  for (const key of vendorCostByProjectCurrency.keys())
    projectCurrencyKeys.add(key);
  for (const key of expenseCostByProjectCurrency.keys())
    projectCurrencyKeys.add(key);
  for (const key of laborCostByProjectCurrency.keys())
    projectCurrencyKeys.add(key);
  for (const key of minutesByProjectCurrency.keys())
    projectCurrencyKeys.add(key);

  const items = Array.from(projectCurrencyKeys)
    .map((key) => {
      const [projectId, currencyValue] = key.split('|');
      const project = projectById.get(projectId);
      const currency = currencyValue || null;
      const revenue = revenueByProjectCurrency.get(key) ?? 0;
      const vendorCost = vendorCostByProjectCurrency.get(key) ?? 0;
      const expenseCost = expenseCostByProjectCurrency.get(key) ?? 0;
      const laborCost = laborCostByProjectCurrency.get(key) ?? 0;
      const directCost = vendorCost + expenseCost + laborCost;
      const grossProfit = revenue - directCost;
      const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
      const totalMinutes = minutesByProjectCurrency.get(key) ?? 0;
      return {
        projectId,
        projectCode: project?.code ?? null,
        projectName: project?.name ?? null,
        currency,
        revenue,
        directCost,
        laborCost,
        vendorCost,
        expenseCost,
        grossProfit,
        grossMargin,
        totalMinutes,
      };
    })
    .filter(
      (item) =>
        item.revenue !== 0 || item.directCost !== 0 || item.totalMinutes !== 0,
    );

  const currencyBreakdownMap = new Map<
    string,
    ManagementAccountingCurrencyBreakdown
  >();
  for (const item of items) {
    const key = item.currency ?? '';
    if (!currencyBreakdownMap.has(key)) {
      currencyBreakdownMap.set(key, {
        currency: item.currency,
        projectCount: 0,
        revenue: 0,
        directCost: 0,
        laborCost: 0,
        vendorCost: 0,
        expenseCost: 0,
        grossProfit: 0,
        grossMargin: 0,
        totalMinutes: 0,
        deliveryDueCount: deliveryDueCountByCurrency.get(key) ?? 0,
        deliveryDueAmount: deliveryDueAmountByCurrency.get(key) ?? 0,
        redProjectCount: 0,
        topRedProjects: [],
      });
    }
    const bucket = currencyBreakdownMap.get(key);
    if (!bucket) continue;
    bucket.projectCount += 1;
    bucket.revenue += item.revenue;
    bucket.directCost += item.directCost;
    bucket.laborCost += item.laborCost;
    bucket.vendorCost += item.vendorCost;
    bucket.expenseCost += item.expenseCost;
    bucket.grossProfit += item.grossProfit;
    bucket.totalMinutes += item.totalMinutes;
    if (item.grossProfit < 0) bucket.redProjectCount += 1;
    bucket.topRedProjects.push(item);
  }

  const currencyBreakdown = Array.from(currencyBreakdownMap.values())
    .map((bucket) => ({
      ...bucket,
      grossMargin: bucket.revenue > 0 ? bucket.grossProfit / bucket.revenue : 0,
      topRedProjects: bucket.topRedProjects
        .filter((item) => item.grossProfit < 0)
        .sort((a, b) => a.grossProfit - b.grossProfit)
        .slice(0, 5),
    }))
    .sort((a, b) => (a.currency ?? '').localeCompare(b.currency ?? ''));

  const totals = currencyBreakdown.reduce(
    (acc, item) => {
      acc.revenue += item.revenue;
      acc.directCost += item.directCost;
      acc.laborCost += item.laborCost;
      acc.vendorCost += item.vendorCost;
      acc.expenseCost += item.expenseCost;
      acc.grossProfit += item.grossProfit;
      acc.totalMinutes += item.totalMinutes;
      acc.deliveryDueAmount += item.deliveryDueAmount;
      return acc;
    },
    {
      revenue: 0,
      directCost: 0,
      laborCost: 0,
      vendorCost: 0,
      expenseCost: 0,
      grossProfit: 0,
      totalMinutes: 0,
      deliveryDueAmount: 0,
    },
  );
  const mixedCurrency = currencyBreakdown.length > 1;
  const singleCurrencyBucket =
    currencyBreakdown.length === 1 ? currencyBreakdown[0] : null;
  const redProjectCount = new Set(
    items.filter((item) => item.grossProfit < 0).map((item) => item.projectId),
  ).size;

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    projectCount: new Set(items.map((item) => item.projectId)).size,
    currency: singleCurrencyBucket?.currency ?? null,
    mixedCurrency,
    currencyBreakdown,
    revenue: singleCurrencyBucket ? totals.revenue : null,
    directCost: singleCurrencyBucket ? totals.directCost : null,
    laborCost: singleCurrencyBucket ? totals.laborCost : null,
    vendorCost: singleCurrencyBucket ? totals.vendorCost : null,
    expenseCost: singleCurrencyBucket ? totals.expenseCost : null,
    grossProfit: singleCurrencyBucket ? totals.grossProfit : null,
    grossMargin:
      singleCurrencyBucket && totals.revenue > 0
        ? totals.grossProfit / totals.revenue
        : null,
    totalMinutes: totals.totalMinutes,
    overtimeTotalMinutes,
    deliveryDueCount: deliveryDueItems.length,
    deliveryDueAmount: singleCurrencyBucket ? totals.deliveryDueAmount : null,
    redProjectCount,
    topRedProjects: singleCurrencyBucket
      ? singleCurrencyBucket.topRedProjects
      : [],
  };
}

export async function reportDeliveryDue(
  from?: Date,
  to?: Date,
  projectId?: string,
) {
  const where: any = {
    deletedAt: null,
    invoices: { none: { deletedAt: null } },
  };
  if (projectId) where.projectId = projectId;
  if (from || to) {
    where.dueDate = {};
    if (from) where.dueDate.gte = from;
    if (to) where.dueDate.lte = to;
  } else {
    where.dueDate = { not: null };
  }
  type DeliveryDueInvoice = {
    id: string;
    invoiceNo: string | null;
    status: string | null;
  };
  type DeliveryDueItem = {
    id: string;
    projectId: string;
    name: string | null;
    amount: unknown;
    dueDate: Date | null;
    project: {
      code: string | null;
      name: string | null;
      currency: string | null;
    } | null;
    invoices: DeliveryDueInvoice[];
  };

  const items = (await prisma.projectMilestone.findMany({
    where: {
      ...where,
      project: { deletedAt: null },
    },
    select: {
      id: true,
      projectId: true,
      name: true,
      amount: true,
      dueDate: true,
      project: { select: { code: true, name: true, currency: true } },
      invoices: {
        where: { deletedAt: null },
        select: { id: true, invoiceNo: true, status: true },
      },
    },
    orderBy: { dueDate: 'asc' },
  })) as DeliveryDueItem[];
  return items.map((item: DeliveryDueItem) => ({
    milestoneId: item.id,
    projectId: item.projectId,
    projectCode: item.project?.code || null,
    projectName: item.project?.name || null,
    projectCurrency: item.project?.currency || null,
    name: item.name,
    amount: item.amount,
    dueDate: item.dueDate,
    invoiceCount: item.invoices.length,
    invoiceNos: item.invoices.map((inv: DeliveryDueInvoice) => inv.invoiceNo),
    invoiceStatuses: item.invoices.map((inv: DeliveryDueInvoice) => inv.status),
  }));
}

export async function reportProjectProfit(
  projectId: string,
  from?: Date,
  to?: Date,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { currency: true },
  });
  const currency = project?.currency ?? null;
  const invoiceWhere: any = {
    projectId,
    deletedAt: null,
    status: { in: ['approved', 'sent', 'paid'] },
  };
  if (from || to) {
    invoiceWhere.issueDate = {};
    if (from) invoiceWhere.issueDate.gte = from;
    if (to) invoiceWhere.issueDate.lte = to;
  }
  const invoiceWhereFiltered = currency
    ? { ...invoiceWhere, currency }
    : invoiceWhere;
  const vendorWhere: any = {
    projectId,
    deletedAt: null,
    status: { in: ['received', 'approved', 'paid'] },
  };
  if (from || to) {
    vendorWhere.receivedDate = {};
    if (from) vendorWhere.receivedDate.gte = from;
    if (to) vendorWhere.receivedDate.lte = to;
  }
  const vendorWhereFiltered = currency
    ? { ...vendorWhere, currency }
    : vendorWhere;
  const expenseWhere: any = {
    projectId,
    deletedAt: null,
    status: 'approved',
  };
  if (from || to) {
    expenseWhere.incurredOn = {};
    if (from) expenseWhere.incurredOn.gte = from;
    if (to) expenseWhere.incurredOn.lte = to;
  }
  const expenseWhereFiltered = currency
    ? { ...expenseWhere, currency }
    : expenseWhere;

  const [invoiceSum, vendorSum, expenseSum, time] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhereFiltered,
      _sum: { totalAmount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: vendorWhereFiltered,
      _sum: { totalAmount: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhereFiltered,
      _sum: { amount: true },
    }),
    sumTimeCost(projectId, from, to),
  ]);
  if (currency) {
    const [invoiceMismatch, vendorMismatch, expenseMismatch] =
      await Promise.all([
        prisma.invoice.findFirst({
          where: { ...invoiceWhere, currency: { not: currency } },
          select: { id: true },
        }),
        prisma.vendorInvoice.findFirst({
          where: { ...vendorWhere, currency: { not: currency } },
          select: { id: true },
        }),
        prisma.expense.findFirst({
          where: { ...expenseWhere, currency: { not: currency } },
          select: { id: true },
        }),
      ]);
    if (invoiceMismatch) {
      console.warn('[reports] invoice currency mismatch', {
        projectId,
        currency,
      });
    }
    if (vendorMismatch) {
      console.warn('[reports] vendor invoice currency mismatch', {
        projectId,
        currency,
      });
    }
    if (expenseMismatch) {
      console.warn('[reports] expense currency mismatch', {
        projectId,
        currency,
      });
    }
  }
  const revenue = toNumber(invoiceSum._sum.totalAmount);
  const vendorCost = toNumber(vendorSum._sum.totalAmount);
  const expenseCost = toNumber(expenseSum._sum.amount);
  const laborCost = time.cost;
  const directCost = vendorCost + expenseCost + laborCost;
  const grossProfit = revenue - directCost;
  const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
  const budgetRevenue = await resolveRevenueBudget(
    projectId,
    from,
    to,
    currency,
  );
  const varianceRevenue = revenue - budgetRevenue;
  return {
    projectId,
    currency,
    revenue,
    budgetRevenue,
    varianceRevenue,
    directCost,
    costBreakdown: {
      vendorCost,
      expenseCost,
      laborCost,
    },
    grossProfit,
    grossMargin,
    totalMinutes: time.minutes,
  };
}

type ProfitBreakdownItem = {
  userId: string;
  laborCost: number;
  expenseCost: number;
  allocatedVendorCost: number;
  allocatedRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  minutes: number;
};

export type ProfitAllocationMethod = 'labor_cost' | 'minutes' | 'none';

export function resolveProfitAllocationMethod(
  totalLaborCost: number,
  totalMinutes: number,
): ProfitAllocationMethod {
  if (Number.isFinite(totalLaborCost) && totalLaborCost > 0) {
    return 'labor_cost';
  }
  if (Number.isFinite(totalMinutes) && totalMinutes > 0) {
    return 'minutes';
  }
  return 'none';
}

export function resolveProfitAllocationShare(input: {
  allocationMethod: ProfitAllocationMethod;
  userLaborCost: number;
  totalLaborCost: number;
  userMinutes: number;
  totalMinutes: number;
}): number {
  if (input.allocationMethod === 'labor_cost') {
    if (
      !Number.isFinite(input.userLaborCost) ||
      !Number.isFinite(input.totalLaborCost) ||
      input.userLaborCost <= 0 ||
      input.totalLaborCost <= 0
    ) {
      return 0;
    }
    return input.userLaborCost / input.totalLaborCost;
  }
  if (input.allocationMethod === 'minutes') {
    if (
      !Number.isFinite(input.userMinutes) ||
      !Number.isFinite(input.totalMinutes) ||
      input.userMinutes <= 0 ||
      input.totalMinutes <= 0
    ) {
      return 0;
    }
    return input.userMinutes / input.totalMinutes;
  }
  return 0;
}

export async function reportProjectProfitByUser(
  projectId: string,
  from?: Date,
  to?: Date,
  userIds?: string[],
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { currency: true },
  });
  const currency = project?.currency ?? null;
  const invoiceWhere: any = {
    projectId,
    deletedAt: null,
    status: { in: ['approved', 'sent', 'paid'] },
  };
  if (from || to) {
    invoiceWhere.issueDate = {};
    if (from) invoiceWhere.issueDate.gte = from;
    if (to) invoiceWhere.issueDate.lte = to;
  }
  const invoiceWhereFiltered = currency
    ? { ...invoiceWhere, currency }
    : invoiceWhere;
  const vendorWhere: any = {
    projectId,
    deletedAt: null,
    status: { in: ['received', 'approved', 'paid'] },
  };
  if (from || to) {
    vendorWhere.receivedDate = {};
    if (from) vendorWhere.receivedDate.gte = from;
    if (to) vendorWhere.receivedDate.lte = to;
  }
  const vendorWhereFiltered = currency
    ? { ...vendorWhere, currency }
    : vendorWhere;
  const expenseWhere: any = {
    projectId,
    deletedAt: null,
    status: 'approved',
  };
  if (from || to) {
    expenseWhere.incurredOn = {};
    if (from) expenseWhere.incurredOn.gte = from;
    if (to) expenseWhere.incurredOn.lte = to;
  }
  const expenseWhereFiltered = currency
    ? { ...expenseWhere, currency }
    : expenseWhere;

  const [invoiceSum, vendorSum, expenseAgg, labor] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhereFiltered,
      _sum: { totalAmount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: vendorWhereFiltered,
      _sum: { totalAmount: true },
    }),
    prisma.expense.groupBy({
      by: ['userId'],
      where: expenseWhereFiltered,
      _sum: { amount: true },
    }),
    sumTimeCostByUser(projectId, from, to),
  ]);
  if (currency) {
    const [invoiceMismatch, vendorMismatch, expenseMismatch] =
      await Promise.all([
        prisma.invoice.findFirst({
          where: { ...invoiceWhere, currency: { not: currency } },
          select: { id: true },
        }),
        prisma.vendorInvoice.findFirst({
          where: { ...vendorWhere, currency: { not: currency } },
          select: { id: true },
        }),
        prisma.expense.findFirst({
          where: { ...expenseWhere, currency: { not: currency } },
          select: { id: true },
        }),
      ]);
    if (invoiceMismatch) {
      console.warn('[reports] invoice currency mismatch', {
        projectId,
        currency,
      });
    }
    if (vendorMismatch) {
      console.warn('[reports] vendor invoice currency mismatch', {
        projectId,
        currency,
      });
    }
    if (expenseMismatch) {
      console.warn('[reports] expense currency mismatch', {
        projectId,
        currency,
      });
    }
  }
  const revenue = toNumber(invoiceSum._sum.totalAmount);
  const vendorCost = toNumber(vendorSum._sum.totalAmount);
  const totalLaborCost = labor.totalCost;
  const totalMinutes = labor.totalMinutes;
  const totalExpenseCost = expenseAgg.reduce(
    (sum: number, row: { _sum: { amount: unknown } }) =>
      sum + toNumber(row._sum.amount),
    0,
  );

  const allocationMethod = resolveProfitAllocationMethod(
    totalLaborCost,
    totalMinutes,
  );

  const expenseByUser = new Map<string, number>();
  for (const row of expenseAgg) {
    expenseByUser.set(row.userId, toNumber(row._sum.amount));
  }

  const userIdSet = new Set<string>([
    ...labor.items.keys(),
    ...expenseByUser.keys(),
  ]);
  const filteredUserIds = userIds?.length
    ? Array.from(userIdSet).filter((id) => userIds.includes(id))
    : Array.from(userIdSet);

  const items: ProfitBreakdownItem[] = filteredUserIds.map((userId) => {
    const laborItem = labor.items.get(userId) ?? { cost: 0, minutes: 0 };
    const expenseCost = expenseByUser.get(userId) ?? 0;
    const share = resolveProfitAllocationShare({
      allocationMethod,
      userLaborCost: laborItem.cost,
      totalLaborCost,
      userMinutes: laborItem.minutes,
      totalMinutes,
    });
    const allocatedRevenue = revenue * share;
    const allocatedVendorCost = vendorCost * share;
    const totalCost = laborItem.cost + expenseCost + allocatedVendorCost;
    const grossProfit = allocatedRevenue - totalCost;
    const grossMargin =
      allocatedRevenue > 0 ? grossProfit / allocatedRevenue : 0;
    return {
      userId,
      laborCost: laborItem.cost,
      expenseCost,
      allocatedVendorCost,
      allocatedRevenue,
      totalCost,
      grossProfit,
      grossMargin,
      minutes: laborItem.minutes,
    };
  });

  return {
    projectId,
    revenue,
    vendorCost,
    laborCost: totalLaborCost,
    expenseCost: totalExpenseCost,
    totalMinutes,
    allocationMethod,
    items,
  };
}

export async function reportProjectProfitByGroup(
  projectId: string,
  userIds: string[],
  from?: Date,
  to?: Date,
  label?: string,
) {
  const res = await reportProjectProfitByUser(projectId, from, to, userIds);
  const totals = res.items.reduce(
    (acc, item) => {
      acc.laborCost += item.laborCost;
      acc.expenseCost += item.expenseCost;
      acc.allocatedVendorCost += item.allocatedVendorCost;
      acc.allocatedRevenue += item.allocatedRevenue;
      acc.totalCost += item.totalCost;
      acc.grossProfit += item.grossProfit;
      acc.minutes += item.minutes;
      return acc;
    },
    {
      laborCost: 0,
      expenseCost: 0,
      allocatedVendorCost: 0,
      allocatedRevenue: 0,
      totalCost: 0,
      grossProfit: 0,
      minutes: 0,
    },
  );
  const grossMargin =
    totals.allocatedRevenue > 0
      ? totals.grossProfit / totals.allocatedRevenue
      : 0;
  return {
    projectId,
    label: label ?? null,
    userIds,
    allocationMethod: res.allocationMethod,
    totals: {
      revenue: res.revenue,
      vendorCost: res.vendorCost,
      laborCost: res.laborCost,
      expenseCost: res.expenseCost,
      totalMinutes: res.totalMinutes,
    },
    group: {
      ...totals,
      grossMargin,
    },
  };
}
