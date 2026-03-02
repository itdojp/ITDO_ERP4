import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { resolveLeaveRequestMinutesWithCalendar } from './leaveEntitlements.js';
import { ensureLeaveSetting } from './leaveSettings.js';
import { toDateOnly } from '../utils/date.js';

export const COMP_LEAVE_TYPES = ['compensatory', 'substitute'] as const;
export type CompLeaveType = (typeof COMP_LEAVE_TYPES)[number];

export class LeaveCompBalanceShortageError extends Error {
  readonly code = 'LEAVE_COMP_BALANCE_SHORTAGE';
  readonly details: {
    leaveType: CompLeaveType;
    requestedMinutes: number;
    availableMinutes: number;
    reservedPendingMinutes: number;
    projectedRemainingMinutes: number;
    shortageMinutes: number;
    asOfDate: string;
  };

  constructor(details: LeaveCompBalanceShortageError['details']) {
    super('Compensatory leave balance is insufficient');
    this.name = 'LeaveCompBalanceShortageError';
    this.details = details;
  }
}

export type LeaveCompBalanceSummary = {
  userId: string;
  leaveType: CompLeaveType;
  asOfDate: string;
  totalGrantedMinutes: number;
  remainingMinutes: number;
  reservedPendingMinutes: number;
  requestedMinutes: number;
  projectedRemainingMinutes: number;
  shortageMinutes: number;
  shortage: boolean;
};

function normalizeInt(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function dateKey(value: Date) {
  return toDateOnly(value).toISOString().slice(0, 10);
}

export function normalizeCompLeaveType(value: unknown): CompLeaveType | '' {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'compensatory' || normalized === 'substitute') {
    return normalized;
  }
  return '';
}

export function isCompLeaveType(value: unknown): value is CompLeaveType {
  return normalizeCompLeaveType(value) !== '';
}

export async function expireCompLeaveGrants(options?: {
  asOfDate?: Date;
  actorId?: string | null;
  client?: Prisma.TransactionClient | typeof prisma;
}) {
  const client = options?.client ?? prisma;
  const actorId = options?.actorId ?? null;
  const asOfDate = toDateOnly(options?.asOfDate ?? new Date());
  const result = await client.leaveCompGrant.updateMany({
    where: {
      status: 'active',
      remainingMinutes: { gt: 0 },
      expiresAt: { lt: asOfDate },
    },
    data: {
      status: 'expired',
      expiredAt: new Date(),
      updatedBy: actorId,
    },
  });
  return result.count;
}

export async function computeCompLeaveBalance(options: {
  userId: string;
  leaveType: CompLeaveType;
  additionalRequestedMinutes?: number;
  excludeLeaveRequestId?: string;
  asOfDate?: Date;
  client?: Prisma.TransactionClient | typeof prisma;
  actorId?: string | null;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  const leaveType = options.leaveType;
  const asOfDate = toDateOnly(options.asOfDate ?? new Date());
  const additionalRequestedMinutes = normalizeInt(
    options.additionalRequestedMinutes,
  );
  const excludeLeaveRequestId = options.excludeLeaveRequestId?.trim() || '';
  const setting = await ensureLeaveSetting({
    actorId: options.actorId ?? null,
    client,
  });

  await expireCompLeaveGrants({
    asOfDate,
    actorId: options.actorId ?? null,
    client,
  });

  const [grants, pendingLeaves] = await Promise.all([
    client.leaveCompGrant.findMany({
      where: {
        userId,
        leaveType,
        status: 'active',
        remainingMinutes: { gt: 0 },
        expiresAt: { gte: asOfDate },
      },
      select: { grantedMinutes: true, remainingMinutes: true },
    }),
    client.leaveRequest.findMany({
      where: {
        userId,
        leaveType,
        status: 'pending_manager',
        ...(excludeLeaveRequestId
          ? { id: { not: excludeLeaveRequestId } }
          : {}),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        hours: true,
        minutes: true,
        startTimeMinutes: true,
        endTimeMinutes: true,
      },
    }),
  ]);

  const totalGrantedMinutes = grants.reduce(
    (sum, grant) => sum + normalizeInt(grant.grantedMinutes),
    0,
  );
  const remainingMinutes = grants.reduce(
    (sum, grant) => sum + normalizeInt(grant.remainingMinutes),
    0,
  );

  const workdayMinutesCache = new Map<string, number>();
  let reservedPendingMinutes = 0;
  const futurePendingLeaves = pendingLeaves.filter(
    (leave) => toDateOnly(leave.startDate).getTime() >= asOfDate.getTime(),
  );
  for (const leave of futurePendingLeaves) {
    reservedPendingMinutes += await resolveLeaveRequestMinutesWithCalendar({
      leave,
      userId,
      defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
      client,
      workdayMinutesCache,
    });
  }

  const projectedRemainingMinutes =
    remainingMinutes - reservedPendingMinutes - additionalRequestedMinutes;
  const shortageMinutes = Math.max(0, -projectedRemainingMinutes);

  const summary: LeaveCompBalanceSummary = {
    userId,
    leaveType,
    asOfDate: dateKey(asOfDate),
    totalGrantedMinutes,
    remainingMinutes,
    reservedPendingMinutes,
    requestedMinutes: additionalRequestedMinutes,
    projectedRemainingMinutes,
    shortageMinutes,
    shortage: projectedRemainingMinutes < 0,
  };
  return summary;
}

export async function consumeCompLeaveForRequest(options: {
  leaveRequestId: string;
  userId: string;
  leaveType: CompLeaveType;
  requestedMinutes: number;
  leaveStartDate: Date;
  consumedAt?: Date;
  actorId?: string | null;
  client: Prisma.TransactionClient;
}) {
  const client = options.client;
  const leaveRequestId = options.leaveRequestId.trim();
  const userId = options.userId.trim();
  const leaveType = options.leaveType;
  const requestedMinutes = normalizeInt(options.requestedMinutes);
  const leaveStartDate = toDateOnly(options.leaveStartDate);
  if (!requestedMinutes) {
    return {
      consumedMinutes: 0,
      items: [] as Array<{ grantId: string; consumedMinutes: number }>,
    };
  }

  await expireCompLeaveGrants({
    asOfDate: leaveStartDate,
    actorId: options.actorId ?? null,
    client,
  });

  const existing = await client.leaveCompConsumption.findMany({
    where: { leaveRequestId },
    select: { grantId: true, consumedMinutes: true },
    orderBy: [{ consumedAt: 'asc' }, { id: 'asc' }],
  });
  if (existing.length > 0) {
    return {
      consumedMinutes: existing.reduce(
        (sum, item) => sum + normalizeInt(item.consumedMinutes),
        0,
      ),
      items: existing,
    };
  }

  const grants = await client.leaveCompGrant.findMany({
    where: {
      userId,
      leaveType,
      status: 'active',
      remainingMinutes: { gt: 0 },
      expiresAt: { gte: leaveStartDate },
    },
    select: {
      id: true,
      remainingMinutes: true,
      expiresAt: true,
      sourceDate: true,
      createdAt: true,
    },
    orderBy: [
      { expiresAt: 'asc' },
      { sourceDate: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  let needed = requestedMinutes;
  const allocations: Array<{ grantId: string; consumedMinutes: number }> = [];
  for (const grant of grants) {
    if (needed <= 0) break;
    const available = normalizeInt(grant.remainingMinutes);
    if (!available) continue;
    const consume = Math.min(available, needed);
    needed -= consume;
    allocations.push({ grantId: grant.id, consumedMinutes: consume });
  }

  if (needed > 0) {
    const balance = await computeCompLeaveBalance({
      userId,
      leaveType,
      additionalRequestedMinutes: requestedMinutes,
      asOfDate: leaveStartDate,
      client,
      actorId: options.actorId ?? null,
    });
    throw new LeaveCompBalanceShortageError({
      leaveType,
      requestedMinutes,
      availableMinutes: balance.remainingMinutes,
      reservedPendingMinutes: balance.reservedPendingMinutes,
      projectedRemainingMinutes: balance.projectedRemainingMinutes,
      shortageMinutes: Math.max(needed, balance.shortageMinutes),
      asOfDate: balance.asOfDate,
    });
  }

  const now = options.consumedAt ?? new Date();
  const actorId = options.actorId ?? null;
  for (const allocation of allocations) {
    const updateResult = await client.leaveCompGrant.updateMany({
      where: {
        id: allocation.grantId,
        status: 'active',
        expiresAt: { gte: leaveStartDate },
        remainingMinutes: {
          gte: allocation.consumedMinutes,
        },
      },
      data: {
        remainingMinutes: {
          decrement: allocation.consumedMinutes,
        },
        status: 'active',
        updatedBy: actorId,
      },
    });
    if (updateResult.count !== 1) {
      const balance = await computeCompLeaveBalance({
        userId,
        leaveType,
        additionalRequestedMinutes: requestedMinutes,
        asOfDate: leaveStartDate,
        client,
        actorId: options.actorId ?? null,
      });
      throw new LeaveCompBalanceShortageError({
        leaveType,
        requestedMinutes,
        availableMinutes: balance.remainingMinutes,
        reservedPendingMinutes: balance.reservedPendingMinutes,
        projectedRemainingMinutes: balance.projectedRemainingMinutes,
        shortageMinutes: Math.max(1, balance.shortageMinutes),
        asOfDate: balance.asOfDate,
      });
    }
    const updatedGrant = await client.leaveCompGrant.findUnique({
      where: { id: allocation.grantId },
      select: { remainingMinutes: true },
    });
    const remainingAfterConsumption = normalizeInt(
      updatedGrant?.remainingMinutes,
    );
    if (remainingAfterConsumption === 0) {
      await client.leaveCompGrant.update({
        where: { id: allocation.grantId },
        data: {
          status: 'consumed',
          consumedAt: now,
          updatedBy: actorId,
        },
      });
    }
    await client.leaveCompConsumption.create({
      data: {
        grantId: allocation.grantId,
        leaveRequestId,
        consumedMinutes: allocation.consumedMinutes,
        consumedAt: now,
        createdBy: actorId,
      },
    });
  }

  return {
    consumedMinutes: requestedMinutes,
    items: allocations,
  };
}
