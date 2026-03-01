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

function toDateKey(targetDate: Date) {
  return toDateOnly(targetDate).toISOString().slice(0, 10);
}

export async function resolveUserWorkdayMinutesForDates(options: {
  userId: string;
  targetDates: Date[];
  defaultWorkdayMinutes: number;
  client?: typeof prisma;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const defaultMinutes = normalizeWorkMinutes(
    options.defaultWorkdayMinutes,
    480,
  );
  const uniqueDates = new Map<string, Date>();
  for (const targetDate of options.targetDates) {
    const workDate = toDateOnly(targetDate);
    uniqueDates.set(workDate.toISOString().slice(0, 10), workDate);
  }
  if (uniqueDates.size === 0) {
    return new Map<
      string,
      { workMinutes: number; source: WorkdayMinutesSource; workDate: Date }
    >();
  }

  const keys = Array.from(uniqueDates.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];
  const from = uniqueDates.get(firstKey) ?? toDateOnly(new Date(firstKey));
  const rangeEnd = uniqueDates.get(lastKey) ?? toDateOnly(new Date(lastKey));
  const to = new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const resolved = new Map<
    string,
    { workMinutes: number; source: WorkdayMinutesSource; workDate: Date }
  >();
  for (const [key, workDate] of uniqueDates.entries()) {
    resolved.set(key, {
      workMinutes: defaultMinutes,
      source: 'default_setting',
      workDate,
    });
  }

  const [holidays, overrides] = await Promise.all([
    client.leaveCompanyHoliday.findMany({
      where: { holidayDate: { gte: from, lt: to } },
      select: { holidayDate: true },
    }),
    userId
      ? client.leaveWorkdayOverride.findMany({
          where: {
            userId,
            workDate: { gte: from, lt: to },
          },
          orderBy: { createdAt: 'desc' },
          select: { workDate: true, workMinutes: true },
        })
      : Promise.resolve([]),
  ]);

  for (const holiday of holidays) {
    const key = toDateKey(holiday.holidayDate);
    if (!resolved.has(key)) continue;
    resolved.set(key, {
      workMinutes: 0,
      source: 'company_holiday',
      workDate: toDateOnly(holiday.holidayDate),
    });
  }

  for (const override of overrides) {
    const key = toDateKey(override.workDate);
    if (!resolved.has(key)) continue;
    resolved.set(key, {
      workMinutes: normalizeWorkMinutes(override.workMinutes, defaultMinutes),
      source: 'user_override',
      workDate: toDateOnly(override.workDate),
    });
  }

  return resolved;
}

export async function resolveUserWorkdayMinutes(options: {
  userId: string;
  targetDate: Date;
  defaultWorkdayMinutes: number;
  client?: typeof prisma;
}) {
  const map = await resolveUserWorkdayMinutesForDates({
    userId: options.userId,
    targetDates: [options.targetDate],
    defaultWorkdayMinutes: options.defaultWorkdayMinutes,
    client: options.client,
  });
  const key = toDateKey(options.targetDate);
  return (
    map.get(key) ?? {
      workMinutes: normalizeWorkMinutes(options.defaultWorkdayMinutes, 480),
      source: 'default_setting',
      workDate: toDateOnly(options.targetDate),
    }
  );
}
