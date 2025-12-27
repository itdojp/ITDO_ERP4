import { prisma } from './db.js';
import { calcTimeAmount, resolveRateCard } from './rateCard.js';
import { dateKey, toNumber } from './utils.js';

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
): Promise<number> {
  const estimateWhere: any = {
    projectId,
    deletedAt: null,
    status: { notIn: ['cancelled', 'rejected'] },
  };
  if (from || to) {
    estimateWhere.createdAt = {};
    if (from) estimateWhere.createdAt.gte = from;
    if (to) estimateWhere.createdAt.lte = to;
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
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const minutes = await prisma.timeEntry.aggregate({
    _sum: { minutes: true },
    where,
  });
  const expenses = await prisma.expense.aggregate({
    _sum: { amount: true },
    where: { projectId },
  });
  return {
    projectId,
    totalMinutes: minutes._sum.minutes || 0,
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
    project: { code: string | null; name: string | null } | null;
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
      project: { select: { code: true, name: true } },
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

  const [invoiceSum, vendorSum, expenseSum, time] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: vendorWhere,
      _sum: { totalAmount: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhere,
      _sum: { amount: true },
    }),
    sumTimeCost(projectId, from, to),
  ]);
  const revenue = toNumber(invoiceSum._sum.totalAmount);
  const vendorCost = toNumber(vendorSum._sum.totalAmount);
  const expenseCost = toNumber(expenseSum._sum.amount);
  const laborCost = time.cost;
  const directCost = vendorCost + expenseCost + laborCost;
  const grossProfit = revenue - directCost;
  const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
  const budgetRevenue = await resolveRevenueBudget(projectId, from, to);
  const varianceRevenue = revenue - budgetRevenue;
  return {
    projectId,
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

export async function reportProjectProfitByUser(
  projectId: string,
  from?: Date,
  to?: Date,
  userIds?: string[],
) {
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

  const [invoiceSum, vendorSum, expenseAgg, labor] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: vendorWhere,
      _sum: { totalAmount: true },
    }),
    prisma.expense.groupBy({
      by: ['userId'],
      where: expenseWhere,
      _sum: { amount: true },
    }),
    sumTimeCostByUser(projectId, from, to),
  ]);
  const revenue = toNumber(invoiceSum._sum.totalAmount);
  const vendorCost = toNumber(vendorSum._sum.totalAmount);
  const totalLaborCost = labor.totalCost;
  const totalMinutes = labor.totalMinutes;
  const totalExpenseCost = expenseAgg.reduce(
    (sum: number, row: { _sum: { amount: unknown } }) =>
      sum + toNumber(row._sum.amount),
    0,
  );

  const allocationMethod =
    totalLaborCost > 0 ? 'labor_cost' : totalMinutes > 0 ? 'minutes' : 'none';

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
    const share =
      allocationMethod === 'labor_cost' && totalLaborCost > 0
        ? laborItem.cost / totalLaborCost
        : allocationMethod === 'minutes' && totalMinutes > 0
          ? laborItem.minutes / totalMinutes
          : 0;
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
