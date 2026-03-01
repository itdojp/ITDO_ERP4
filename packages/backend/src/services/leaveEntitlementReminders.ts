import { prisma } from './db.js';
import { dateKey } from './utils.js';
import { parseDateParam, toDateOnly } from '../utils/date.js';
import {
  filterNotificationRecipients,
  resolveGroupRecipientUserIds,
} from './appNotifications.js';
import { GENERAL_AFFAIRS_GROUP_ACCOUNT_ID } from './leaveEntitlements.js';

type RunLeaveEntitlementReminderOptions = {
  targetDate?: string;
  dryRun?: boolean;
  actorId?: string | null;
  client?: typeof prisma;
  resolveRecipients?: typeof resolveGroupRecipientUserIds;
};

type RunLeaveEntitlementReminderResult = {
  ok: boolean;
  targetDate: string;
  dryRun: boolean;
  matchedProfiles: number;
  createdNotifications: number;
  skippedExistingNotifications: number;
  sampleProfileIds: string[];
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
    Math.floor(parseNumberEnv('LEAVE_ENTITLEMENT_TARGET_OFFSET_DAYS', 0)),
  );
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return toDateOnly(base);
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function runLeaveEntitlementReminders(
  options: RunLeaveEntitlementReminderOptions = {},
): Promise<RunLeaveEntitlementReminderResult> {
  const client = options.client ?? prisma;
  const resolveRecipients =
    options.resolveRecipients ?? resolveGroupRecipientUserIds;
  const dryRun = Boolean(options.dryRun);
  const target = resolveTargetDate(options.targetDate);
  if (!target) {
    throw new Error('invalid_target_date');
  }

  const next = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  const profiles = await client.leaveEntitlementProfile.findMany({
    where: {
      nextGrantDueDate: {
        gte: target,
        lt: next,
      },
    },
    select: {
      id: true,
      userId: true,
      paidLeaveBaseDate: true,
      nextGrantDueDate: true,
    },
  });

  if (!profiles.length) {
    return {
      ok: true,
      targetDate: dateKey(target),
      dryRun,
      matchedProfiles: 0,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      sampleProfileIds: [],
    };
  }

  const gaRecipients = await resolveRecipients([
    GENERAL_AFFAIRS_GROUP_ACCOUNT_ID,
  ]);
  if (!gaRecipients.length) {
    return {
      ok: true,
      targetDate: dateKey(target),
      dryRun,
      matchedProfiles: profiles.length,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      sampleProfileIds: profiles
        .slice(0, 20)
        .map((item: { id: string }) => item.id),
    };
  }
  const filteredRecipients = await filterNotificationRecipients({
    kind: 'leave_grant_reminder',
    userIds: gaRecipients,
    scope: 'global',
    client,
  });
  if (!filteredRecipients.allowed.length) {
    return {
      ok: true,
      targetDate: dateKey(target),
      dryRun,
      matchedProfiles: profiles.length,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      sampleProfileIds: profiles
        .slice(0, 20)
        .map((item: { id: string }) => item.id),
    };
  }

  let createdNotifications = 0;
  let skippedExistingNotifications = 0;
  const sampleProfileIds: string[] = [];
  const targetDateLabel = dateKey(target);

  for (const profile of profiles) {
    const profileId = normalizeId(profile.id);
    const userId = normalizeId(profile.userId);
    if (!profileId || !userId || !profile.nextGrantDueDate) continue;

    if (sampleProfileIds.length < 20) {
      sampleProfileIds.push(profileId);
    }

    const messageId = `${profileId}:${targetDateLabel}`;
    const existing = await client.appNotification.findMany({
      where: {
        kind: 'leave_grant_reminder',
        messageId,
        userId: { in: filteredRecipients.allowed },
      },
      select: { userId: true },
    });
    const existingUsers = new Set(
      existing.map((item) => normalizeId(item.userId)).filter(Boolean),
    );
    skippedExistingNotifications += existingUsers.size;

    const targets = filteredRecipients.allowed.filter(
      (id) => !existingUsers.has(id),
    );
    if (!targets.length) continue;

    const payload = {
      profileId,
      userId,
      paidLeaveBaseDate: dateKey(toDateOnly(profile.paidLeaveBaseDate)),
      nextGrantDueDate: dateKey(toDateOnly(profile.nextGrantDueDate)),
      targetDate: targetDateLabel,
      fromUserId: options.actorId ?? undefined,
    };

    if (dryRun) {
      createdNotifications += targets.length;
      continue;
    }

    const created = await client.appNotification.createMany({
      data: targets.map((recipientId) => ({
        userId: recipientId,
        kind: 'leave_grant_reminder',
        messageId,
        payload,
        createdBy: options.actorId ?? undefined,
        updatedBy: options.actorId ?? undefined,
      })),
    });
    createdNotifications += created.count;
  }

  return {
    ok: true,
    targetDate: targetDateLabel,
    dryRun,
    matchedProfiles: profiles.length,
    createdNotifications,
    skippedExistingNotifications,
    sampleProfileIds,
  };
}
