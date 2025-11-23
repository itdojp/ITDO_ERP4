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
  return agg.map((g) => ({ userId: g.userId, totalMinutes: g._sum.minutes || 0 }));
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
