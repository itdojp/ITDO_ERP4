import { prisma } from './db.js';

export async function reportProjectEffort(projectId: string, from?: Date, to?: Date) {
  const where: any = { projectId };
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = from;
    if (to) where.workDate.lte = to;
  }
  const minutes = await prisma.timeEntry.aggregate({ _sum: { minutes: true }, where });
  const expenses = await prisma.expense.aggregate({ _sum: { amount: true }, where: { projectId } });
  return {
    projectId,
    totalMinutes: minutes._sum.minutes || 0,
    totalExpenses: expenses._sum.amount || 0,
  };
}

export async function reportGroupEffort(userIds: string[], from?: Date, to?: Date) {
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
  const agg = await prisma.timeEntry.aggregate({ _sum: { minutes: true }, where });
  const totalMinutes = agg._sum.minutes || 0;
  const dailyHours = totalMinutes / 60;
  return { userId, totalMinutes, dailyHours };
}

export async function reportDeliveryDue(from?: Date, to?: Date, projectId?: string) {
  const where: any = { deletedAt: null };
  if (projectId) where.projectId = projectId;
  const dueDate: any = { not: null };
  if (from) dueDate.gte = from;
  if (to) dueDate.lte = to;
  where.dueDate = dueDate;
  const items = await prisma.projectMilestone.findMany({
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
  });
  return items.map((item) => ({
    milestoneId: item.id,
    projectId: item.projectId,
    projectCode: item.project?.code || null,
    projectName: item.project?.name || null,
    name: item.name,
    amount: item.amount,
    dueDate: item.dueDate,
    invoiceCount: item.invoices.length,
    invoiceNos: item.invoices.map((inv) => inv.invoiceNo),
    invoiceStatuses: item.invoices.map((inv) => inv.status),
  }));
}
