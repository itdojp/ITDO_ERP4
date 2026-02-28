import { prisma } from './db.js';

export const LEAVE_SETTING_ID = 'default';

export const DEFAULT_LEAVE_SETTING = {
  timeUnitMinutes: 10,
  defaultWorkdayMinutes: 480,
} as const;

export async function ensureLeaveSetting(options: {
  actorId?: string | null;
  client?: typeof prisma;
} = {}) {
  const client = options.client ?? prisma;
  const actorId = options.actorId ?? null;
  return client.leaveSetting.upsert({
    where: { id: LEAVE_SETTING_ID },
    create: {
      id: LEAVE_SETTING_ID,
      ...DEFAULT_LEAVE_SETTING,
      createdBy: actorId,
      updatedBy: actorId,
    },
    update: {},
  });
}

