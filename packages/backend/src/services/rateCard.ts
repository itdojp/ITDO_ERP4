import { prisma } from './db.js';
import { applyRate } from './rate.js';

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
  const workType = match.workType?.trim();
  const workTypeFilter = workType ? { workType } : { workType: null };
  if (match.projectId) {
    const project = await prisma.rateCard.findFirst({
      where: {
        ...base,
        projectId: match.projectId,
        ...workTypeFilter,
      },
      orderBy: { validFrom: 'desc' },
    });
    if (project) return project;
  }
  return prisma.rateCard.findFirst({
    where: {
      ...base,
      projectId: null,
      ...workTypeFilter,
    },
    orderBy: { validFrom: 'desc' },
  });
}

export function calcTimeAmount(minutes: number, unitPrice: number) {
  return applyRate(minutes, unitPrice);
}
