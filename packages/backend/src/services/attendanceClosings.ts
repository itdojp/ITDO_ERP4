import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { ensureLeaveSetting } from './leaveSettings.js';
import { resolveLeaveRequestMinutesWithCalendar } from './leaveEntitlements.js';
import { normalizeLeaveTypeInput } from './leaveTypes.js';
import { resolveUserWorkdayMinutesForDates } from './leaveWorkdayCalendar.js';
import { toDateOnly } from '../utils/date.js';

const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  totalLeaveMinutes: number;
  sourceTimeEntryCount: number;
  sourceLeaveRequestCount: number;
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
    const targetDates = buildEmploymentDates(
      user,
      options.from,
      options.toInclusive,
    );
    const workdayMap = await resolveUserWorkdayMinutesForDates({
      userId: user.id,
      targetDates,
      defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
      client: options.client,
    });
    let scheduledWorkMinutes = 0;
    for (const row of workdayMap.values()) {
      scheduledWorkMinutes += row.workMinutes;
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
    for (const [dateKey, totalMinutes] of dailyTotals.entries()) {
      const scheduled =
        workdayMap.get(dateKey)?.workMinutes ??
        leaveSetting.defaultWorkdayMinutes;
      overtimeTotalMinutes += Math.max(0, totalMinutes - scheduled);
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
      if (leaveTypeMap.get(normalizedLeaveType) === false) {
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
      paidLeaveMinutesTotal: 0,
      unpaidLeaveMinutesTotal: 0,
      totalLeaveMinutesTotal: 0,
      sourceTimeEntryCount: 0,
      sourceLeaveRequestCount: 0,
    },
  );
}

export async function closeAttendancePeriod(options: {
  periodKey: string;
  reclose?: boolean;
  actorId?: string | null;
  client?: AttendanceClosingClient;
}) {
  const client = options.client ?? prisma;
  const { periodKey, from, toExclusive, toInclusive } =
    parseAttendancePeriodKey(options.periodKey);

  const latestClose = await client.attendanceClosingPeriod.findFirst({
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

  const users = await client.userAccount.findMany({
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

  const approvedTimeEntries = await client.timeEntry.findMany({
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

  const pendingTimeEntries = await client.timeEntry.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['approved', 'rejected'] },
      workDate: { gte: from, lt: toExclusive },
    },
    select: { id: true },
    take: 20,
  });

  const approvedLeaves = await client.leaveRequest.findMany({
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

  const pendingLeaves = await client.leaveRequest.findMany({
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
    ? await client.leaveType.findMany({
        where: { code: { in: leaveTypeCodes } },
        select: { code: true, isPaid: true },
      })
    : [];
  const rows = await buildAttendanceSummaries({
    users: inScopeUsers,
    timeEntries: approvedTimeEntries,
    leaves: approvedLeaves,
    leaveTypes,
    from,
    toInclusive,
    client,
  });
  const totals = buildSummaryTotals(rows);
  const version = (latestClose?.version ?? 0) + 1;

  const transactionHost =
    '$transaction' in client && typeof client.$transaction === 'function'
      ? client
      : prisma;
  return transactionHost.$transaction(async (tx: Prisma.TransactionClient) => {
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
