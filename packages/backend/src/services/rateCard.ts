import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { applyRate } from './rate.js';

type RateCardMatch = {
  projectId?: string | null;
  workType?: string | null;
  workDate: Date;
};

function buildDateRange(workDate: Date): Prisma.RateCardWhereInput {
  return {
    validFrom: { lte: workDate },
    OR: [{ validTo: null }, { validTo: { gte: workDate } }],
  };
}

export async function resolveRateCard(match: RateCardMatch) {
  const base = buildDateRange(match.workDate);
  const workType = match.workType?.trim();
  const workTypeCandidates = workType ? [workType, null] : [null];
  const candidates: Prisma.RateCardWhereInput[] = [];
  if (match.projectId) {
    for (const candidate of workTypeCandidates) {
      candidates.push({ projectId: match.projectId, workType: candidate });
    }
  }
  for (const candidate of workTypeCandidates) {
    candidates.push({ projectId: null, workType: candidate });
  }
  if (!candidates.length) return null;
  const items = await prisma.rateCard.findMany({
    where: { AND: [base, { OR: candidates }] },
    orderBy: { validFrom: 'desc' },
    take: 50,
  });
  if (!items.length) return null;

  const score = (item: {
    projectId: string | null;
    workType: string | null;
  }) => {
    let value = 0;
    if (match.projectId && item.projectId === match.projectId) value += 100;
    if (workType && item.workType === workType) value += 10;
    return value;
  };

  let best: (typeof items)[number] | null = null;
  let bestScore = -1;
  for (const item of items) {
    const currentScore = score(item);
    if (currentScore > bestScore) {
      best = item;
      bestScore = currentScore;
    }
  }
  return best;
}

export function calcTimeAmount(minutes: number, unitPrice: number) {
  return applyRate(minutes, unitPrice);
}
