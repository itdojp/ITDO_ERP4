import { prisma } from './db.js';

type RateCardMatch = {
  projectId?: string | null;
  workType?: string | null;
  workDate: Date;
};

function buildDateRange(workDate: Date) {
  return {
    validFrom: { lte: workDate },
    OR: [{ validTo: null }, { validTo: { gte: workDate } }],
  } as const;
}

export async function resolveRateCard(match: RateCardMatch) {
  const base = buildDateRange(match.workDate);
  const workType = match.workType || undefined;
  if (match.projectId) {
    const project = await prisma.rateCard.findFirst({
      where: {
        ...base,
        projectId: match.projectId,
        ...(workType ? { workType } : {}),
      },
      orderBy: { validFrom: 'desc' },
    });
    if (project) return project;
  }
  return prisma.rateCard.findFirst({
    where: {
      ...base,
      projectId: null,
      ...(workType ? { workType } : {}),
    },
    orderBy: { validFrom: 'desc' },
  });
}

export function calcTimeAmount(minutes: number, unitPrice: number) {
  const hours = minutes / 60;
  return Math.round(hours * unitPrice * 100) / 100;
}
