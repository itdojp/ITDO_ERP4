import { prisma } from './db.js';
import { dateKey } from './utils.js';
import { parseDateParam, toDateOnly } from '../utils/date.js';
import {
  filterNotificationRecipients,
  resolveRoleRecipientUserIds,
} from './appNotifications.js';

type RunLeaveUpcomingOptions = {
  targetDate?: string;
  dryRun?: boolean;
  actorId?: string | null;
};

type RunLeaveUpcomingResult = {
  ok: boolean;
  targetDate: string;
  dryRun: boolean;
  matchedCount: number;
  createdNotifications: number;
  skippedExistingNotifications: number;
  sampleLeaveRequestIds: string[];
};

function parseNumberEnv(name: string, defaultValue: number) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}

function resolveTargetDate(targetDate?: string) {
  if (targetDate) {
    const parsed = parseDateParam(targetDate);
    if (!parsed) return null;
    return toDateOnly(parsed);
  }
  const offsetDays = Math.max(
    0,
    Math.floor(parseNumberEnv('LEAVE_UPCOMING_TARGET_OFFSET_DAYS', 1)),
  );
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return toDateOnly(base);
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function runLeaveUpcomingNotifications(
  options: RunLeaveUpcomingOptions = {},
): Promise<RunLeaveUpcomingResult> {
  const dryRun = Boolean(options.dryRun);
  const target = resolveTargetDate(options.targetDate);
  if (!target) {
    throw new Error('invalid_target_date');
  }

  const next = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      status: 'approved',
      startDate: { gte: target, lt: next },
    },
    select: {
      id: true,
      userId: true,
      leaveType: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!leaveRequests.length) {
    return {
      ok: true,
      targetDate: dateKey(target),
      dryRun,
      matchedCount: 0,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      sampleLeaveRequestIds: [],
    };
  }

  const roleRecipients = await resolveRoleRecipientUserIds(['admin', 'mgmt']);
  let createdNotifications = 0;
  let skippedExistingNotifications = 0;
  const sampleLeaveRequestIds: string[] = [];

  for (const leave of leaveRequests) {
    const leaveRequestId = normalizeId(leave.id);
    const userId = normalizeId(leave.userId);
    if (!leaveRequestId || !userId) continue;

    if (sampleLeaveRequestIds.length < 20) {
      sampleLeaveRequestIds.push(leaveRequestId);
    }

    const recipients = new Set<string>([userId, ...roleRecipients]);
    const targetUserIds = Array.from(recipients);
    if (!targetUserIds.length) continue;
    const filtered = await filterNotificationRecipients({
      kind: 'leave_upcoming',
      userIds: targetUserIds,
      scope: 'global',
    });
    if (!filtered.allowed.length) continue;

    const existing = await prisma.appNotification.findMany({
      where: {
        kind: 'leave_upcoming',
        messageId: leaveRequestId,
        userId: { in: filtered.allowed },
      },
      select: { userId: true },
    });
    const existingUsers = new Set(
      existing.map((item) => normalizeId(item.userId)).filter(Boolean),
    );
    skippedExistingNotifications += existingUsers.size;

    const targets = filtered.allowed.filter((id) => !existingUsers.has(id));
    if (!targets.length) continue;

    const startDate = dateKey(toDateOnly(leave.startDate));
    const endDate = dateKey(toDateOnly(leave.endDate));
    const payload = {
      leaveRequestId,
      startDate,
      endDate,
      leaveType: leave.leaveType,
      fromUserId: options.actorId ?? undefined,
    };

    if (dryRun) {
      createdNotifications += targets.length;
      continue;
    }

    const result = await prisma.appNotification.createMany({
      data: targets.map((recipientId) => ({
        userId: recipientId,
        kind: 'leave_upcoming',
        messageId: leaveRequestId,
        payload,
        createdBy: options.actorId ?? undefined,
        updatedBy: options.actorId ?? undefined,
      })),
    });
    createdNotifications += result.count;
  }

  return {
    ok: true,
    targetDate: dateKey(target),
    dryRun,
    matchedCount: leaveRequests.length,
    createdNotifications,
    skippedExistingNotifications,
    sampleLeaveRequestIds,
  };
}
