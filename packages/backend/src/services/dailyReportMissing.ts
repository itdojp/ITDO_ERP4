import { prisma } from './db.js';
import { dateKey } from './utils.js';
import { parseDateParam, toDateOnly } from '../utils/date.js';
import { triggerAlert } from './alert.js';

type RunDailyReportMissingOptions = {
  targetDate?: string;
  dryRun?: boolean;
  actorId?: string | null;
};

type RunDailyReportMissingResult = {
  ok: boolean;
  targetDate: string;
  skipped?: string;
  dryRun: boolean;
  missingCount: number;
  createdNotifications: number;
  skippedExistingNotifications: number;
  alerted: number;
  closedAlerts: number;
  sampleMissingUserIds: string[];
};

function parseBooleanEnv(name: string, defaultValue: boolean) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumberEnv(name: string, defaultValue: number) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}

function isWeekend(target: Date) {
  const day = target.getUTCDay();
  return day === 0 || day === 6;
}

function resolveTargetDate(targetDate?: string) {
  if (targetDate) {
    const parsed = parseDateParam(targetDate);
    if (!parsed) return null;
    return toDateOnly(parsed);
  }
  const offsetDays = Math.max(
    0,
    Math.floor(parseNumberEnv('DAILY_REPORT_MISSING_TARGET_OFFSET_DAYS', 1)),
  );
  const now = new Date();
  const base = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
  return toDateOnly(base);
}

export async function runDailyReportMissingNotifications(
  options: RunDailyReportMissingOptions = {},
): Promise<RunDailyReportMissingResult> {
  const dryRun = Boolean(options.dryRun);
  const target = resolveTargetDate(options.targetDate);
  if (!target) {
    throw new Error('invalid_target_date');
  }

  const skipWeekend = parseBooleanEnv(
    'DAILY_REPORT_MISSING_SKIP_WEEKEND',
    true,
  );
  if (skipWeekend && isWeekend(target)) {
    return {
      ok: true,
      targetDate: dateKey(target),
      skipped: 'weekend',
      dryRun,
      missingCount: 0,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      alerted: 0,
      closedAlerts: 0,
      sampleMissingUserIds: [],
    };
  }

  const requireTimeEntry = parseBooleanEnv(
    'DAILY_REPORT_MISSING_REQUIRE_TIME_ENTRY',
    false,
  );

  const users = await prisma.userAccount.findMany({
    where: { active: true, deletedAt: null },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) {
    return {
      ok: true,
      targetDate: dateKey(target),
      dryRun,
      missingCount: 0,
      createdNotifications: 0,
      skippedExistingNotifications: 0,
      alerted: 0,
      closedAlerts: 0,
      sampleMissingUserIds: [],
    };
  }

  const reports = await prisma.dailyReport.findMany({
    where: { reportDate: target, userId: { in: userIds } },
    select: { userId: true },
  });
  const reported = new Set(reports.map((report) => report.userId));
  let missingUserIds = userIds.filter((id) => !reported.has(id));

  if (requireTimeEntry && missingUserIds.length > 0) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        workDate: target,
        userId: { in: missingUserIds },
        deletedAt: null,
        status: { not: 'rejected' },
      },
      select: { userId: true },
    });
    const entryUsers = new Set(entries.map((entry) => entry.userId));
    missingUserIds = missingUserIds.filter((id) => entryUsers.has(id));
  }

  const targetDateKey = dateKey(target);
  const messageId = `daily-report-missing:${targetDateKey}`;
  let skippedExistingNotifications = 0;
  let createdNotifications = 0;
  if (missingUserIds.length > 0) {
    const existing = await prisma.appNotification.findMany({
      where: {
        kind: 'daily_report_missing',
        messageId,
        userId: { in: missingUserIds },
      },
      select: { userId: true },
    });
    const existingUsers = new Set(existing.map((item) => item.userId));
    skippedExistingNotifications = existingUsers.size;
    const targets = missingUserIds.filter((id) => !existingUsers.has(id));
    if (!dryRun && targets.length > 0) {
      const result = await prisma.appNotification.createMany({
        data: targets.map((userId) => ({
          userId,
          kind: 'daily_report_missing',
          messageId,
          payload: { reportDate: targetDateKey },
          createdBy: options.actorId ?? undefined,
          updatedBy: options.actorId ?? undefined,
        })),
      });
      createdNotifications = result.count;
    }
  }

  const alertSettings = await prisma.alertSetting.findMany({
    where: { type: 'daily_report_missing', isEnabled: true },
  });
  let alerted = 0;
  let closedAlerts = 0;
  for (const setting of alertSettings) {
    const threshold = Number(setting.threshold);
    if (!Number.isFinite(threshold)) continue;
    const targetRef = `daily-report:${targetDateKey}`;
    if (missingUserIds.length > threshold) {
      if (!dryRun) {
        await triggerAlert(
          {
            id: setting.id,
            recipients: setting.recipients,
            channels: setting.channels,
            remindAfterHours: setting.remindAfterHours,
            remindMaxCount: setting.remindMaxCount,
          },
          missingUserIds.length,
          threshold,
          targetRef,
        );
      }
      alerted += 1;
    } else if (!dryRun) {
      const result = await prisma.alert.updateMany({
        where: { settingId: setting.id, status: 'open', targetRef },
        data: { status: 'closed' },
      });
      closedAlerts += result.count;
    }
  }

  return {
    ok: true,
    targetDate: targetDateKey,
    dryRun,
    missingCount: missingUserIds.length,
    createdNotifications,
    skippedExistingNotifications,
    alerted,
    closedAlerts,
    sampleMissingUserIds: missingUserIds.slice(0, 20),
  };
}
