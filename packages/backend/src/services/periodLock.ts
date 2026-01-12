import { prisma } from './db.js';

export function toPeriodKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function findPeriodLock(
  period: string,
  projectId?: string,
  client = prisma,
) {
  if (!projectId) {
    return client.periodLock.findFirst({
      where: { period, scope: 'global' },
      select: { id: true, scope: true, projectId: true },
    });
  }
  return client.periodLock.findFirst({
    where: {
      period,
      OR: [{ scope: 'global' }, { scope: 'project', projectId }],
    },
    select: { id: true, scope: true, projectId: true },
  });
}
