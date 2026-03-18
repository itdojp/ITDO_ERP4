import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { ensureLeaveSetting } from './leaveSettings.js';
import { resolveLeaveRequestMinutesWithCalendar } from './leaveEntitlements.js';
import { normalizeLeaveTypeInput } from './leaveTypes.js';
import type { WorkdayMinutesSource } from './leaveWorkdayCalendar.js';
import { normalizeWorkMinutes } from './leaveWorkdayCalendar.js';
import { toDateOnly } from '../utils/date.js';

const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATUTORY_DAILY_WORK_MINUTES = 480;

export class AttendanceClosingError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AttendanceClosingError';
    this.code = code;
    this.details = details;
  }
}

type AttendanceClosingClient = Prisma.TransactionClient | typeof prisma;

type UserRow = {
  id: string;
  employeeCode: string | null;
  joinedAt: Date | null;
  leftAt: Date | null;
};

type TimeEntryRow = {
  id: string;
  userId: string;
  workDate: Date;
  minutes: number;
};

type LeaveRow = {
  id: string;
  userId: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  hours: number | null;
  minutes: number | null;
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
};

type LeaveTypeRow = {
  code: string;
  isPaid: boolean;
};

type AttendanceSummaryRow = {
  userId: string;
  employeeCode: string;
  workedDayCount: number;
  scheduledWorkMinutes: number;
  approvedWorkMinutes: number;
  overtimeTotalMinutes: number;
  overtimeWithinStatutoryMinutes: number;
  overtimeOverStatutoryMinutes: number;
  holidayWorkMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  totalLeaveMinutes: number;
  sourceTimeEntryCount: number;
  sourceLeaveRequestCount: number;
};

type WorkdayCalendarRow = {
  workMinutes: number;
  source: WorkdayMinutesSource;
  workDate: Date;
};

export function parseAttendancePeriodKey(periodKey: string) {
  const value = periodKey.trim();
  if (!PERIOD_KEY_PATTERN.test(value)) {
    throw new AttendanceClosingError(
      'invalid_period_key',
      'periodKey must be YYYY-MM',
    );
  }
  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const toExclusive = new Date(Date.UTC(year, monthIndex + 1, 1));
  const toInclusive = new Date(toExclusive.getTime() - DAY_MS);
  return { periodKey: value, from, toExclusive, toInclusive };
}

function enumerateDates(from: Date, toInclusive: Date) {
  const dates: Date[] = [];
  for (
    let current = from.getTime();
    current <= toInclusive.getTime();
    current += DAY_MS
  ) {
    dates.push(new Date(current));
  }
  return dates;
}

function maxDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function toDateKey(value: Date) {
  return toDateOnly(value).toISOString().slice(0, 10);
}

function clipLeaveToPeriod(
  leave: LeaveRow,
  from: Date,
  toInclusive: Date,
): LeaveRow | null {
  const start = toDateOnly(leave.startDate);
  const end = toDateOnly(leave.endDate);
  if (
    end.getTime() < from.getTime() ||
    start.getTime() > toInclusive.getTime()
  ) {
    return null;
  }
  const clippedStart = maxDate(start, from);
  const clippedEnd = minDate(end, toInclusive);
  const unchanged =
    clippedStart.getTime() === start.getTime() &&
    clippedEnd.getTime() === end.getTime();
  return {
    ...leave,
    startDate: clippedStart,
    endDate: clippedEnd,
    hours: unchanged ? leave.hours : null,
    minutes: unchanged ? leave.minutes : null,
    startTimeMinutes: unchanged ? leave.startTimeMinutes : null,
    endTimeMinutes: unchanged ? leave.endTimeMinutes : null,
  };
}

function buildEmploymentDates(user: UserRow, from: Date, toInclusive: Date) {
  const joinedAt = user.joinedAt ? toDateOnly(user.joinedAt) : null;
  const leftAt = user.leftAt ? toDateOnly(user.leftAt) : null;
  const effectiveFrom = joinedAt ? maxDate(joinedAt, from) : from;
  const effectiveTo = leftAt ? minDate(leftAt, toInclusive) : toInclusive;
  if (effectiveTo.getTime() < effectiveFrom.getTime()) {
    return [];
  }
  return enumerateDates(effectiveFrom, effectiveTo);
}

function buildLeaveDates(leave: LeaveRow) {
  return enumerateDates(toDateOnly(leave.startDate), toDateOnly(leave.endDate));
}

function buildWorkdayDateSetsByUser(options: {
  users: UserRow[];
  leavesByUser: Map<string, LeaveRow[]>;
  from: Date;
  toInclusive: Date;
}) {
  const targetDatesByUser = new Map<string, Map<string, Date>>();
  for (const user of options.users) {
    const targetDates = new Map<string, Date>();
    for (const workDate of buildEmploymentDates(
      user,
      options.from,
      options.toInclusive,
    )) {
      targetDates.set(toDateKey(workDate), workDate);
    }
    for (const leave of options.leavesByUser.get(user.id) ?? []) {
      for (const workDate of buildLeaveDates(leave)) {
        targetDates.set(toDateKey(workDate), workDate);
      }
    }
    targetDatesByUser.set(user.id, targetDates);
  }
  return targetDatesByUser;
}

async function resolveUsersWorkdayMinutesForDateSets(options: {
  users: UserRow[];
  leavesByUser: Map<string, LeaveRow[]>;
  from: Date;
  toExclusive: Date;
  toInclusive: Date;
  defaultWorkdayMinutes: number;
  client: AttendanceClosingClient;
}) {
  const defaultMinutes = normalizeWorkMinutes(
    options.defaultWorkdayMinutes,
    480,
  );
  const targetDatesByUser = buildWorkdayDateSetsByUser({
    users: options.users,
    leavesByUser: options.leavesByUser,
    from: options.from,
    toInclusive: options.toInclusive,
  });
  const resolvedByUser = new Map<string, Map<string, WorkdayCalendarRow>>();

  for (const [userId, targetDates] of targetDatesByUser.entries()) {
    const resolved = new Map<string, WorkdayCalendarRow>();
    for (const [dateKey, workDate] of targetDates.entries()) {
      resolved.set(dateKey, {
        workMinutes: defaultMinutes,
        source: 'default_setting',
        workDate,
      });
    }
    resolvedByUser.set(userId, resolved);
  }

  if (resolvedByUser.size === 0) {
    return resolvedByUser;
  }

  const userIds = Array.from(resolvedByUser.keys());
  const [holidays, overrides] = await Promise.all([
    options.client.leaveCompanyHoliday.findMany({
      where: { holidayDate: { gte: options.from, lt: options.toExclusive } },
      select: { holidayDate: true },
    }),
    options.client.leaveWorkdayOverride.findMany({
      where: {
        userId: { in: userIds },
        workDate: { gte: options.from, lt: options.toExclusive },
      },
      orderBy: [{ userId: 'asc' }, { createdAt: 'desc' }],
      select: { userId: true, workDate: true, workMinutes: true },
    }),
  ]);

  for (const holiday of holidays) {
    const dateKey = toDateKey(holiday.holidayDate);
    const holidayDate = toDateOnly(holiday.holidayDate);
    for (const resolved of resolvedByUser.values()) {
      if (!resolved.has(dateKey)) continue;
      resolved.set(dateKey, {
        workMinutes: 0,
        source: 'company_holiday',
        workDate: holidayDate,
      });
    }
  }

  for (const override of overrides) {
    const resolved = resolvedByUser.get(override.userId);
    const dateKey = toDateKey(override.workDate);
    if (!resolved || !resolved.has(dateKey)) continue;
    resolved.set(dateKey, {
      workMinutes: normalizeWorkMinutes(override.workMinutes, defaultMinutes),
      source: 'user_override',
      workDate: toDateOnly(override.workDate),
    });
  }

  return resolvedByUser;
}

async function buildAttendanceSummaries(options: {
  users: UserRow[];
  timeEntries: TimeEntryRow[];
  leaves: LeaveRow[];
  leaveTypes: LeaveTypeRow[];
  from: Date;
  toInclusive: Date;
  client: AttendanceClosingClient;
}) {
  const leaveSetting = await ensureLeaveSetting({
    actorId: null,
    client: options.client,
  });
  const leaveTypeMap = new Map(
    options.leaveTypes.map(
      (item) => [normalizeLeaveTypeInput(item.code), item.isPaid] as const,
    ),
  );
  const timeEntriesByUser = new Map<string, TimeEntryRow[]>();
  for (const entry of options.timeEntries) {
    const bucket = timeEntriesByUser.get(entry.userId) ?? [];
    bucket.push(entry);
    timeEntriesByUser.set(entry.userId, bucket);
  }
  const leavesByUser = new Map<string, LeaveRow[]>();
  for (const leave of options.leaves) {
    const clipped = clipLeaveToPeriod(leave, options.from, options.toInclusive);
    if (!clipped) continue;
    const bucket = leavesByUser.get(leave.userId) ?? [];
    bucket.push(clipped);
    leavesByUser.set(leave.userId, bucket);
  }
  const workdayMapsByUser = await resolveUsersWorkdayMinutesForDateSets({
    users: options.users,
    leavesByUser,
    from: options.from,
    toExclusive: new Date(options.toInclusive.getTime() + DAY_MS),
    toInclusive: options.toInclusive,
    defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
    client: options.client,
  });

  const rows: AttendanceSummaryRow[] = [];
  for (const user of options.users) {
    if (!user.employeeCode) {
      throw new AttendanceClosingError(
        'attendance_employee_code_missing',
        'employeeCode is required before closing attendance',
        {
          userId: user.id,
        },
      );
    }
    const workdayMap = workdayMapsByUser.get(user.id) ?? new Map();
    let scheduledWorkMinutes = 0;
    for (const employmentDate of buildEmploymentDates(
      user,
      options.from,
      options.toInclusive,
    )) {
      const row = workdayMap.get(toDateKey(employmentDate));
      scheduledWorkMinutes +=
        row?.workMinutes ?? leaveSetting.defaultWorkdayMinutes;
    }

    const approvedEntries = timeEntriesByUser.get(user.id) ?? [];
    let approvedWorkMinutes = 0;
    const dailyTotals = new Map<string, number>();
    for (const entry of approvedEntries) {
      approvedWorkMinutes += entry.minutes;
      const key = toDateKey(entry.workDate);
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + entry.minutes);
    }
    const workedDayCount = Array.from(dailyTotals.values()).filter(
      (value) => value > 0,
    ).length;
    let overtimeTotalMinutes = 0;
    let overtimeWithinStatutoryMinutes = 0;
    let overtimeOverStatutoryMinutes = 0;
    let holidayWorkMinutes = 0;
    for (const [dateKey, totalMinutes] of dailyTotals.entries()) {
      const scheduled =
        workdayMap.get(dateKey)?.workMinutes ??
        leaveSetting.defaultWorkdayMinutes;
      if (scheduled <= 0) {
        holidayWorkMinutes += totalMinutes;
        overtimeTotalMinutes += totalMinutes;
        continue;
      }
      const overtimeMinutes = Math.max(0, totalMinutes - scheduled);
      const overtimeWithinMinutes = Math.max(
        0,
        Math.min(totalMinutes, STATUTORY_DAILY_WORK_MINUTES) -
          Math.min(scheduled, STATUTORY_DAILY_WORK_MINUTES),
      );
      overtimeTotalMinutes += overtimeMinutes;
      overtimeWithinStatutoryMinutes += Math.min(
        overtimeMinutes,
        overtimeWithinMinutes,
      );
      overtimeOverStatutoryMinutes += Math.max(
        0,
        overtimeMinutes - overtimeWithinMinutes,
      );
    }

    const approvedLeaves = leavesByUser.get(user.id) ?? [];
    let paidLeaveMinutes = 0;
    let unpaidLeaveMinutes = 0;
    const leaveWorkdayCache = new Map<string, number>();
    for (const [dateKey, row] of workdayMap.entries()) {
      leaveWorkdayCache.set(dateKey, row.workMinutes);
    }
    for (const leave of approvedLeaves) {
      const requestedMinutes = await resolveLeaveRequestMinutesWithCalendar({
        leave,
        userId: user.id,
        defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
        client: options.client,
        workdayMinutesCache: leaveWorkdayCache,
      });
      const normalizedLeaveType = normalizeLeaveTypeInput(leave.leaveType);
      const isPaidLeave = leaveTypeMap.get(normalizedLeaveType);
      if (isPaidLeave === undefined) {
        throw new AttendanceClosingError(
          'attendance_leave_type_unresolved',
          'leaveType master is required before closing attendance',
          {
            userId: user.id,
            leaveRequestId: leave.id,
            leaveType: normalizedLeaveType,
          },
        );
      }
      if (isPaidLeave === false) {
        unpaidLeaveMinutes += requestedMinutes;
      } else {
        paidLeaveMinutes += requestedMinutes;
      }
    }

    rows.push({
      userId: user.id,
      employeeCode: user.employeeCode,
      workedDayCount,
      scheduledWorkMinutes,
      approvedWorkMinutes,
      overtimeTotalMinutes,
      overtimeWithinStatutoryMinutes,
      overtimeOverStatutoryMinutes,
      holidayWorkMinutes,
      paidLeaveMinutes,
      unpaidLeaveMinutes,
      totalLeaveMinutes: paidLeaveMinutes + unpaidLeaveMinutes,
      sourceTimeEntryCount: approvedEntries.length,
      sourceLeaveRequestCount: approvedLeaves.length,
    });
  }
  rows.sort((left, right) =>
    left.employeeCode.localeCompare(right.employeeCode),
  );
  return rows;
}

function buildSummaryTotals(rows: AttendanceSummaryRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.summaryCount += 1;
      acc.workedDayCountTotal += row.workedDayCount;
      acc.scheduledWorkMinutesTotal += row.scheduledWorkMinutes;
      acc.approvedWorkMinutesTotal += row.approvedWorkMinutes;
      acc.overtimeTotalMinutesTotal += row.overtimeTotalMinutes;
      acc.overtimeWithinStatutoryMinutesTotal +=
        row.overtimeWithinStatutoryMinutes;
      acc.overtimeOverStatutoryMinutesTotal += row.overtimeOverStatutoryMinutes;
      acc.holidayWorkMinutesTotal += row.holidayWorkMinutes;
      acc.paidLeaveMinutesTotal += row.paidLeaveMinutes;
      acc.unpaidLeaveMinutesTotal += row.unpaidLeaveMinutes;
      acc.totalLeaveMinutesTotal += row.totalLeaveMinutes;
      acc.sourceTimeEntryCount += row.sourceTimeEntryCount;
      acc.sourceLeaveRequestCount += row.sourceLeaveRequestCount;
      return acc;
    },
    {
      summaryCount: 0,
      workedDayCountTotal: 0,
      scheduledWorkMinutesTotal: 0,
      approvedWorkMinutesTotal: 0,
      overtimeTotalMinutesTotal: 0,
      overtimeWithinStatutoryMinutesTotal: 0,
      overtimeOverStatutoryMinutesTotal: 0,
      holidayWorkMinutesTotal: 0,
      paidLeaveMinutesTotal: 0,
      unpaidLeaveMinutesTotal: 0,
      totalLeaveMinutesTotal: 0,
      sourceTimeEntryCount: 0,
      sourceLeaveRequestCount: 0,
    },
  );
}

function isPrismaUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

async function withAttendanceClosingTransaction<T>(
  client: AttendanceClosingClient | undefined,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const host = client ?? prisma;
  try {
    if ('$transaction' in host && typeof host.$transaction === 'function') {
      return await host.$transaction(async (tx: Prisma.TransactionClient) =>
        callback(tx),
      );
    }
    return await callback(host as Prisma.TransactionClient);
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new AttendanceClosingError(
        'attendance_period_concurrent_close',
        'attendance period was closed concurrently',
      );
    }
    throw error;
  }
}

export async function closeAttendancePeriod(options: {
  periodKey: string;
  reclose?: boolean;
  actorId?: string | null;
  client?: AttendanceClosingClient;
}) {
  const { periodKey, from, toExclusive, toInclusive } =
    parseAttendancePeriodKey(options.periodKey);
  return withAttendanceClosingTransaction(options.client, async (tx) => {
    const latestClose = await tx.attendanceClosingPeriod.findFirst({
      where: { periodKey },
      orderBy: [{ version: 'desc' }],
      select: { id: true, version: true, status: true },
    });
    if (latestClose?.status === 'closed' && !options.reclose) {
      throw new AttendanceClosingError(
        'attendance_period_already_closed',
        'attendance period already closed',
        {
          periodKey,
          latestClosingId: latestClose.id,
          latestVersion: latestClose.version,
        },
      );
    }

    const users = await tx.userAccount.findMany({
      where: {
        deletedAt: null,
        OR: [{ joinedAt: null }, { joinedAt: { lt: toExclusive } }],
        AND: [{ OR: [{ leftAt: null }, { leftAt: { gte: from } }] }],
      },
      select: {
        id: true,
        employeeCode: true,
        joinedAt: true,
        leftAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const approvedTimeEntries = await tx.timeEntry.findMany({
      where: {
        deletedAt: null,
        status: 'approved',
        workDate: { gte: from, lt: toExclusive },
      },
      select: { id: true, userId: true, workDate: true, minutes: true },
    });
    const approvedUserIds = new Set(
      approvedTimeEntries.map((item) => item.userId),
    );

    const pendingTimeEntries = await tx.timeEntry.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['approved', 'rejected'] },
        workDate: { gte: from, lt: toExclusive },
      },
      select: { id: true },
      take: 20,
    });

    const approvedLeaves = await tx.leaveRequest.findMany({
      where: {
        status: 'approved',
        startDate: { lt: toExclusive },
        endDate: { gte: from },
      },
      select: {
        id: true,
        userId: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        hours: true,
        minutes: true,
        startTimeMinutes: true,
        endTimeMinutes: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    for (const leave of approvedLeaves) approvedUserIds.add(leave.userId);

    const pendingLeaves = await tx.leaveRequest.findMany({
      where: {
        status: { notIn: ['approved', 'rejected'] },
        startDate: { lt: toExclusive },
        endDate: { gte: from },
      },
      select: { id: true },
      take: 20,
    });

    if (pendingTimeEntries.length || pendingLeaves.length) {
      throw new AttendanceClosingError(
        'attendance_period_unconfirmed',
        'attendance period contains unconfirmed entries',
        {
          periodKey,
          pendingTimeEntryIds: pendingTimeEntries.map((item) => item.id),
          pendingLeaveRequestIds: pendingLeaves.map((item) => item.id),
        },
      );
    }

    const inScopeUsers = users.filter((user) => {
      const hasEmploymentOverlap =
        buildEmploymentDates(user, from, toInclusive).length > 0;
      return hasEmploymentOverlap || approvedUserIds.has(user.id);
    });
    const missingEmployeeCode = inScopeUsers
      .filter((user) => !user.employeeCode)
      .map((user) => user.id)
      .slice(0, 20);
    if (missingEmployeeCode.length) {
      throw new AttendanceClosingError(
        'attendance_employee_code_missing',
        'employeeCode is required before closing attendance',
        {
          periodKey,
          userIds: missingEmployeeCode,
        },
      );
    }

    const leaveTypeCodes = Array.from(
      new Set(
        approvedLeaves
          .map((item) => normalizeLeaveTypeInput(item.leaveType))
          .filter(Boolean),
      ),
    );
    const leaveTypes = leaveTypeCodes.length
      ? await tx.leaveType.findMany({
          where: { code: { in: leaveTypeCodes } },
          select: { code: true, isPaid: true },
        })
      : [];
    const resolvedLeaveTypeCodes = new Set(
      leaveTypes.map((item) => normalizeLeaveTypeInput(item.code)),
    );
    const unresolvedLeaveTypeCodes = leaveTypeCodes.filter(
      (code) => !resolvedLeaveTypeCodes.has(code),
    );
    if (unresolvedLeaveTypeCodes.length) {
      throw new AttendanceClosingError(
        'attendance_leave_type_unresolved',
        'leaveType master is required before closing attendance',
        {
          periodKey,
          leaveTypes: unresolvedLeaveTypeCodes,
        },
      );
    }

    const rows = await buildAttendanceSummaries({
      users: inScopeUsers,
      timeEntries: approvedTimeEntries,
      leaves: approvedLeaves,
      leaveTypes,
      from,
      toInclusive,
      client: tx,
    });
    const totals = buildSummaryTotals(rows);
    const version = (latestClose?.version ?? 0) + 1;

    if (latestClose?.status === 'closed') {
      await tx.attendanceClosingPeriod.update({
        where: { id: latestClose.id },
        data: {
          status: 'superseded',
          supersededAt: new Date(),
          supersededBy: options.actorId ?? null,
          updatedBy: options.actorId ?? null,
        },
      });
    }

    const closing = await tx.attendanceClosingPeriod.create({
      data: {
        periodKey,
        version,
        status: 'closed',
        closedAt: new Date(),
        closedBy: options.actorId ?? null,
        createdBy: options.actorId ?? null,
        updatedBy: options.actorId ?? null,
        ...totals,
      },
      select: {
        id: true,
        periodKey: true,
        version: true,
        status: true,
        closedAt: true,
        closedBy: true,
        summaryCount: true,
        workedDayCountTotal: true,
        scheduledWorkMinutesTotal: true,
        approvedWorkMinutesTotal: true,
        overtimeTotalMinutesTotal: true,
        overtimeWithinStatutoryMinutesTotal: true,
        overtimeOverStatutoryMinutesTotal: true,
        holidayWorkMinutesTotal: true,
        paidLeaveMinutesTotal: true,
        unpaidLeaveMinutesTotal: true,
        totalLeaveMinutesTotal: true,
        sourceTimeEntryCount: true,
        sourceLeaveRequestCount: true,
      },
    });

    if (rows.length > 0) {
      await tx.attendanceMonthlySummary.createMany({
        data: rows.map((row) => ({
          closingPeriodId: closing.id,
          periodKey,
          version,
          userId: row.userId,
          employeeCode: row.employeeCode,
          workedDayCount: row.workedDayCount,
          scheduledWorkMinutes: row.scheduledWorkMinutes,
          approvedWorkMinutes: row.approvedWorkMinutes,
          overtimeTotalMinutes: row.overtimeTotalMinutes,
          overtimeWithinStatutoryMinutes: row.overtimeWithinStatutoryMinutes,
          overtimeOverStatutoryMinutes: row.overtimeOverStatutoryMinutes,
          holidayWorkMinutes: row.holidayWorkMinutes,
          paidLeaveMinutes: row.paidLeaveMinutes,
          unpaidLeaveMinutes: row.unpaidLeaveMinutes,
          totalLeaveMinutes: row.totalLeaveMinutes,
          sourceTimeEntryCount: row.sourceTimeEntryCount,
          sourceLeaveRequestCount: row.sourceLeaveRequestCount,
          createdBy: options.actorId ?? null,
          updatedBy: options.actorId ?? null,
        })),
      });
    }

    return {
      closing,
      summaries: rows,
    };
  });
}
