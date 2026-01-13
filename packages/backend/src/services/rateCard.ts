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
  if (match.projectId) {
    for (const candidate of workTypeCandidates) {
      const project = await prisma.rateCard.findFirst({
        where: {
          ...base,
          projectId: match.projectId,
          workType: candidate,
        },
        orderBy: { validFrom: 'desc' },
      });
      if (project) return project;
    }
  }
  for (const candidate of workTypeCandidates) {
    const global = await prisma.rateCard.findFirst({
      where: {
        ...base,
        projectId: null,
        workType: candidate,
      },
      orderBy: { validFrom: 'desc' },
    });
    if (global) return global;
  }
  return null;
}

export function calcTimeAmount(minutes: number, unitPrice: number) {
  return applyRate(minutes, unitPrice);
}
