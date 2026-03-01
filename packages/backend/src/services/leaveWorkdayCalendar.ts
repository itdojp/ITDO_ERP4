import { prisma } from './db.js';
import { toDateOnly } from '../utils/date.js';

export type WorkdayMinutesSource =
  | 'user_override'
  | 'company_holiday'
  | 'default_setting';

export function normalizeWorkMinutes(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(24 * 60, Math.floor(value)));
}

export function buildUtcDayRange(targetDate: Date) {
  const from = toDateOnly(targetDate);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function resolveUserWorkdayMinutes(options: {
  userId: string;
  targetDate: Date;
  defaultWorkdayMinutes: number;
  client?: typeof prisma;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const { from, to } = buildUtcDayRange(options.targetDate);
  const defaultMinutes = normalizeWorkMinutes(
    options.defaultWorkdayMinutes,
    480,
  );

  if (!userId) {
    return {
      workMinutes: defaultMinutes,
      source: 'default_setting' as WorkdayMinutesSource,
      workDate: from,
    };
  }

  const override = await client.leaveWorkdayOverride.findFirst({
    where: {
      userId,
      workDate: { gte: from, lt: to },
    },
    orderBy: { createdAt: 'desc' },
    select: { workMinutes: true },
  });
  if (override) {
    return {
      workMinutes: normalizeWorkMinutes(override.workMinutes, defaultMinutes),
      source: 'user_override' as WorkdayMinutesSource,
      workDate: from,
    };
  }

  const holiday = await client.leaveCompanyHoliday.findFirst({
    where: { holidayDate: { gte: from, lt: to } },
    select: { id: true },
  });
  if (holiday) {
    return {
      workMinutes: 0,
      source: 'company_holiday' as WorkdayMinutesSource,
      workDate: from,
    };
  }

  return {
    workMinutes: defaultMinutes,
    source: 'default_setting' as WorkdayMinutesSource,
    workDate: from,
  };
}
