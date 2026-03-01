import type { LeaveRequest } from '@prisma/client';
import { prisma } from './db.js';
import { ensureLeaveSetting } from './leaveSettings.js';
import { resolveUserWorkdayMinutesForDates } from './leaveWorkdayCalendar.js';
import { diffInDays, endOfDay, toDateOnly } from '../utils/date.js';

export const GENERAL_AFFAIRS_GROUP_ACCOUNT_ID = 'general_affairs';

type LeaveRequestForMinutes = Pick<
  LeaveRequest,
  | 'startDate'
  | 'endDate'
  | 'hours'
  | 'minutes'
  | 'startTimeMinutes'
  | 'endTimeMinutes'
>;

export type PaidLeaveShortageWarning = {
  code: 'PAID_LEAVE_ADVANCE_WARNING' | 'PAID_LEAVE_SHORTAGE_WARNING';
  message: string;
  shortageMinutes: number;
  advanceAllowed: boolean;
  withinAdvanceLimit: boolean;
  withinNextGrantWindow: boolean;
  nextGrantDueDate: string | null;
  daysUntilNextGrant: number | null;
};

export type PaidLeaveBalanceSummary = {
  userId: string;
  asOfDate: string;
  paidLeaveBaseDate: string | null;
  nextGrantDueDate: string | null;
  totalGrantedMinutes: number;
  usedApprovedMinutes: number;
  reservedPendingMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  requestedMinutes: number;
  projectedRemainingMinutes: number;
  setting: {
    paidLeaveAdvanceMaxMinutes: number;
    paidLeaveAdvanceRequireNextGrantWithinDays: number;
    defaultWorkdayMinutes: number;
  };
  shortageWarning: PaidLeaveShortageWarning | null;
};

function toDateKey(value: Date | null | undefined) {
  if (!value) return null;
  return toDateOnly(value).toISOString().slice(0, 10);
}

function normalizeNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function resolveInclusiveDayCount(startDate: Date, endDate: Date) {
  return Math.max(1, diffInDays(startDate, endDate) + 1);
}

export function resolveLeaveRequestMinutes(options: {
  leave: LeaveRequestForMinutes;
  defaultWorkdayMinutes: number;
}) {
  const defaultWorkdayMinutes = normalizeNonNegativeInt(
    options.defaultWorkdayMinutes,
  );
  const leave = options.leave;

  if (
    leave.startTimeMinutes !== null &&
    leave.startTimeMinutes !== undefined &&
    leave.endTimeMinutes !== null &&
    leave.endTimeMinutes !== undefined
  ) {
    if (leave.minutes !== null && leave.minutes !== undefined) {
      return normalizeNonNegativeInt(leave.minutes);
    }
    return normalizeNonNegativeInt(
      leave.endTimeMinutes - leave.startTimeMinutes,
    );
  }

  if (leave.minutes !== null && leave.minutes !== undefined) {
    return normalizeNonNegativeInt(leave.minutes);
  }

  if (leave.hours !== null && leave.hours !== undefined) {
    return normalizeNonNegativeInt(leave.hours * 60);
  }

  const days = resolveInclusiveDayCount(leave.startDate, leave.endDate);
  return normalizeNonNegativeInt(days * defaultWorkdayMinutes);
}

function isLeaveMinutesExplicit(leave: LeaveRequestForMinutes) {
  if (
    leave.startTimeMinutes !== null &&
    leave.startTimeMinutes !== undefined &&
    leave.endTimeMinutes !== null &&
    leave.endTimeMinutes !== undefined
  ) {
    return true;
  }
  return (
    (leave.minutes !== null && leave.minutes !== undefined) ||
    (leave.hours !== null && leave.hours !== undefined)
  );
}

export async function resolveLeaveRequestMinutesWithCalendar(options: {
  leave: LeaveRequestForMinutes;
  userId: string;
  defaultWorkdayMinutes: number;
  client?: typeof prisma;
  workdayMinutesCache?: Map<string, number>;
}) {
  const { leave } = options;
  if (isLeaveMinutesExplicit(leave)) {
    return resolveLeaveRequestMinutes({
      leave,
      defaultWorkdayMinutes: options.defaultWorkdayMinutes,
    });
  }

  const client = options.client ?? prisma;
  const defaultWorkdayMinutes = normalizeNonNegativeInt(
    options.defaultWorkdayMinutes,
  );
  const workdayMinutesCache = options.workdayMinutesCache ?? new Map();
  const startDate = toDateOnly(leave.startDate);
  const days = resolveInclusiveDayCount(leave.startDate, leave.endDate);
  const unresolved: Array<{ key: string; workDate: Date }> = [];
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    const workDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = toDateKey(workDate);
    if (!key) continue;
    const cached = workdayMinutesCache.get(key);
    if (cached !== undefined) {
      total += cached;
      continue;
    }
    unresolved.push({ key, workDate });
  }

  if (unresolved.length > 0) {
    const resolved = await resolveUserWorkdayMinutesForDates({
      userId: options.userId,
      targetDates: unresolved.map((item) => item.workDate),
      defaultWorkdayMinutes,
      client,
    });
    for (const item of unresolved) {
      const row = resolved.get(item.key);
      const minutes = normalizeNonNegativeInt(
        row?.workMinutes ?? defaultWorkdayMinutes,
      );
      workdayMinutesCache.set(item.key, minutes);
      total += minutes;
    }
  }

  return normalizeNonNegativeInt(total);
}

function buildShortageWarning(options: {
  projectedRemainingMinutes: number;
  nextGrantDueDate: Date | null;
  asOfDate: Date;
  paidLeaveAdvanceMaxMinutes: number;
  paidLeaveAdvanceRequireNextGrantWithinDays: number;
}): PaidLeaveShortageWarning | null {
  const projected = Math.floor(options.projectedRemainingMinutes);
  if (projected >= 0) return null;

  const shortageMinutes = Math.abs(projected);
  const nextGrantDueDate = options.nextGrantDueDate;
  const daysUntilNextGrant = nextGrantDueDate
    ? diffInDays(options.asOfDate, nextGrantDueDate)
    : null;
  const withinAdvanceLimit =
    shortageMinutes <= options.paidLeaveAdvanceMaxMinutes;
  const withinNextGrantWindow =
    daysUntilNextGrant !== null &&
    daysUntilNextGrant <= options.paidLeaveAdvanceRequireNextGrantWithinDays;
  const advanceAllowed = withinAdvanceLimit && withinNextGrantWindow;

  if (advanceAllowed) {
    return {
      code: 'PAID_LEAVE_ADVANCE_WARNING',
      message:
        '有給残高が不足していますが、前借り許容ポリシーの範囲内です（総務確認推奨）',
      shortageMinutes,
      advanceAllowed: true,
      withinAdvanceLimit,
      withinNextGrantWindow,
      nextGrantDueDate: toDateKey(nextGrantDueDate),
      daysUntilNextGrant,
    };
  }

  return {
    code: 'PAID_LEAVE_SHORTAGE_WARNING',
    message:
      '有給残高が不足し、前借り許容ポリシーの範囲外です（申請は可能ですが総務確認が必要です）',
    shortageMinutes,
    advanceAllowed: false,
    withinAdvanceLimit,
    withinNextGrantWindow,
    nextGrantDueDate: toDateKey(nextGrantDueDate),
    daysUntilNextGrant,
  };
}

export async function computePaidLeaveBalance(options: {
  userId: string;
  additionalRequestedMinutes?: number;
  actorId?: string | null;
  asOfDate?: Date;
  client?: typeof prisma;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const actorId = options.actorId ?? null;
  const asOfDate = toDateOnly(options.asOfDate ?? new Date());
  const asOfDateEnd = endOfDay(asOfDate);

  const [setting, profile, grants, consumedLeaves] = await Promise.all([
    ensureLeaveSetting({ actorId, client }),
    client.leaveEntitlementProfile.findUnique({
      where: { userId },
      select: {
        paidLeaveBaseDate: true,
        nextGrantDueDate: true,
      },
    }),
    client.leaveGrant.findMany({
      where: {
        userId,
        grantDate: { lte: asOfDateEnd },
        OR: [{ expiresAt: null }, { expiresAt: { gte: asOfDate } }],
      },
      select: {
        grantedMinutes: true,
      },
    }),
    client.leaveRequest.findMany({
      where: {
        userId,
        leaveType: 'paid',
        status: { in: ['pending_manager', 'approved'] },
      },
      select: {
        startDate: true,
        endDate: true,
        hours: true,
        minutes: true,
        startTimeMinutes: true,
        endTimeMinutes: true,
        status: true,
      },
    }),
  ]);

  const totalGrantedMinutes = grants.reduce(
    (sum: number, item: { grantedMinutes: number }) =>
      sum + normalizeNonNegativeInt(item.grantedMinutes),
    0,
  );

  let usedApprovedMinutes = 0;
  let reservedPendingMinutes = 0;
  const workdayMinutesCache = new Map<string, number>();
  const prefetchDates = new Map<string, Date>();
  for (const leave of consumedLeaves) {
    if (isLeaveMinutesExplicit(leave)) continue;
    const startDate = toDateOnly(leave.startDate);
    const days = resolveInclusiveDayCount(leave.startDate, leave.endDate);
    for (let i = 0; i < days; i += 1) {
      const workDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const key = toDateKey(workDate);
      if (!key || prefetchDates.has(key)) continue;
      prefetchDates.set(key, workDate);
    }
  }
  if (prefetchDates.size > 0) {
    const prefetched = await resolveUserWorkdayMinutesForDates({
      userId,
      targetDates: Array.from(prefetchDates.values()),
      defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
      client,
    });
    for (const [key, row] of prefetched.entries()) {
      workdayMinutesCache.set(key, normalizeNonNegativeInt(row.workMinutes));
    }
  }
  for (const leave of consumedLeaves) {
    const minutes = await resolveLeaveRequestMinutesWithCalendar({
      leave,
      userId,
      defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
      client,
      workdayMinutesCache,
    });
    if (leave.status === 'approved') {
      usedApprovedMinutes += minutes;
      continue;
    }
    if (leave.status === 'pending_manager') {
      reservedPendingMinutes += minutes;
    }
  }

  const consumedMinutes = usedApprovedMinutes + reservedPendingMinutes;
  const remainingMinutes = totalGrantedMinutes - consumedMinutes;
  const requestedMinutes = normalizeNonNegativeInt(
    options.additionalRequestedMinutes ?? 0,
  );
  const projectedRemainingMinutes = remainingMinutes - requestedMinutes;

  const shortageWarning = buildShortageWarning({
    projectedRemainingMinutes,
    nextGrantDueDate: profile?.nextGrantDueDate ?? null,
    asOfDate,
    paidLeaveAdvanceMaxMinutes: setting.paidLeaveAdvanceMaxMinutes,
    paidLeaveAdvanceRequireNextGrantWithinDays:
      setting.paidLeaveAdvanceRequireNextGrantWithinDays,
  });

  const result: PaidLeaveBalanceSummary = {
    userId,
    asOfDate: toDateKey(asOfDate) || '',
    paidLeaveBaseDate: toDateKey(profile?.paidLeaveBaseDate),
    nextGrantDueDate: toDateKey(profile?.nextGrantDueDate),
    totalGrantedMinutes,
    usedApprovedMinutes,
    reservedPendingMinutes,
    consumedMinutes,
    remainingMinutes,
    requestedMinutes,
    projectedRemainingMinutes,
    setting: {
      paidLeaveAdvanceMaxMinutes: setting.paidLeaveAdvanceMaxMinutes,
      paidLeaveAdvanceRequireNextGrantWithinDays:
        setting.paidLeaveAdvanceRequireNextGrantWithinDays,
      defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
    },
    shortageWarning,
  };

  return result;
}
