import {
  buildStubResults,
  sendEmail,
  sendSlackWebhookStub,
  sendWebhookStub,
} from './notifier.js';
import { prisma } from './db.js';
import type {
  AlertSetting as PrismaAlertSetting,
  Prisma,
} from '@prisma/client';

type MetricResult = { metric: number; targetRef: string };
type MetricFetcher = (
  setting: PrismaAlertSetting,
) => Promise<MetricResult | null>;

type AlertRecipients = {
  emails?: string[];
  roles?: string[];
  users?: string[];
  slackWebhooks?: string[];
  webhooks?: string[];
};

type AlertNotificationResult = {
  sentChannels: string[];
  sentResult: unknown[];
};

type SendResultItem = {
  channel?: string;
  status?: string;
  error?: string;
  target?: string;
};

function normalizeChannels(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((c) => String(c)).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).filter(
      (key) => (raw as Record<string, boolean>)[key],
    );
  }
  return ['dashboard'];
}

function resolveEmails(
  recipients: AlertRecipients | null | undefined,
): string[] {
  const emails = recipients?.emails?.filter(Boolean) || [];
  return emails.length ? emails : ['alert@example.com'];
}

function resolveTargets(raw?: string[] | null): string[] {
  return raw?.filter(Boolean) ?? [];
}

function toReminderAt(now: Date, remindAfterHours?: number | null) {
  if (!remindAfterHours || remindAfterHours <= 0) return null;
  return new Date(now.getTime() + remindAfterHours * 60 * 60 * 1000);
}

function normalizeRemindMaxCount(value?: number | null) {
  if (value === undefined || value === null) return 3;
  if (!Number.isFinite(value)) return 3;
  return Math.max(0, Math.floor(value));
}

function mergeSentResults(
  existing: unknown,
  next: unknown[],
): { sentResult: unknown[]; sentChannels: string[] } {
  const current = Array.isArray(existing) ? existing : [];
  const sentResult = [...current, ...next];
  const sentChannels = sentResult
    .map((item) => (item as { channel?: string })?.channel)
    .filter(
      (channel): channel is string =>
        typeof channel === 'string' && channel.length > 0,
    );
  return { sentResult, sentChannels };
}

async function sendAlertNotification(
  setting: { id: string; recipients: unknown; channels: unknown },
  metric: number,
  threshold: number,
  subjectPrefix: string,
): Promise<AlertNotificationResult> {
  const channels = normalizeChannels(setting.channels);
  const recipients = setting.recipients as AlertRecipients | null | undefined;
  const sentResult: SendResultItem[] = [];
  const payload = { settingId: setting.id, metric, threshold };
  if (channels.includes('email')) {
    const emailResult = await sendEmail(
      resolveEmails(recipients),
      `${subjectPrefix} ${setting.id}`,
      `metric ${metric} > ${threshold}`,
    );
    sentResult.unshift(emailResult);
  }
  if (channels.includes('slack')) {
    const targets = resolveTargets(recipients?.slackWebhooks);
    if (!targets.length) {
      sentResult.push({
        channel: 'slack',
        status: 'skipped',
        error: 'missing_slack_webhook',
      });
    } else {
      for (const url of targets) {
        sentResult.push(await sendSlackWebhookStub(url, payload));
      }
    }
  }
  if (channels.includes('webhook')) {
    const targets = resolveTargets(recipients?.webhooks);
    if (!targets.length) {
      sentResult.push({
        channel: 'webhook',
        status: 'skipped',
        error: 'missing_webhook',
      });
    } else {
      for (const url of targets) {
        sentResult.push(await sendWebhookStub(url, payload));
      }
    }
  }
  const otherChannels = channels.filter(
    (c) => !['email', 'slack', 'webhook'].includes(c),
  );
  sentResult.push(...buildStubResults(otherChannels));
  const sentChannels = sentResult
    .map((r) => r.channel)
    .filter(
      (channel): channel is string =>
        typeof channel === 'string' && channel.length > 0,
    );
  return { sentChannels, sentResult };
}

export async function triggerAlert(
  setting: {
    id: string;
    recipients: unknown;
    channels: unknown;
    remindAfterHours?: number | null;
    remindMaxCount?: number | null;
  },
  metric: number,
  threshold: number,
  targetRef: string,
  now = new Date(),
) {
  const existing = await prisma.alert.findFirst({
    where: { settingId: setting.id, targetRef, status: 'open' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reminderAt: true,
      reminderCount: true,
      sentResult: true,
      sentChannels: true,
    },
  });
  const remindAfterHours = setting.remindAfterHours ?? null;
  const remindMaxCount = normalizeRemindMaxCount(setting.remindMaxCount);
  if (existing) {
    if (!remindAfterHours || remindMaxCount <= 0) {
      return existing;
    }
    if (existing.reminderCount >= remindMaxCount) {
      return existing;
    }
    if (!existing.reminderAt) {
      return prisma.alert.update({
        where: { id: existing.id },
        data: { reminderAt: toReminderAt(now, remindAfterHours) },
      });
    }
    if (existing.reminderAt > now) {
      return existing;
    }
    const reminderNotification = await sendAlertNotification(
      {
        id: setting.id,
        recipients: setting.recipients,
        channels: setting.channels,
      },
      metric,
      threshold,
      'Alert reminder',
    );
    const merged = mergeSentResults(
      existing.sentResult,
      reminderNotification.sentResult,
    );
    const reminderCount = existing.reminderCount + 1;
    const reminderAt =
      reminderCount >= remindMaxCount
        ? null
        : toReminderAt(now, remindAfterHours);
    return prisma.alert.update({
      where: { id: existing.id },
      data: {
        reminderAt,
        reminderCount,
        sentChannels: merged.sentChannels as Prisma.InputJsonValue,
        sentResult: merged.sentResult as Prisma.InputJsonValue,
      },
    });
  }

  const reminderAt =
    remindAfterHours && remindMaxCount > 0
      ? toReminderAt(now, remindAfterHours)
      : null;
  const initialNotification = await sendAlertNotification(
    {
      id: setting.id,
      recipients: setting.recipients,
      channels: setting.channels,
    },
    metric,
    threshold,
    'Alert',
  );
  return prisma.alert.create({
    data: {
      settingId: setting.id,
      targetRef,
      status: 'open',
      reminderAt,
      reminderCount: 0,
      sentChannels: initialNotification.sentChannels as Prisma.InputJsonValue,
      sentResult: initialNotification.sentResult as Prisma.InputJsonValue,
    },
  });
}

export async function computeAndTrigger(
  fetchers: Record<string, MetricFetcher>,
) {
  const settings = await prisma.alertSetting.findMany({
    where: { isEnabled: true },
  });
  for (const s of settings) {
    const fetcher = fetchers[s.type as string];
    if (!fetcher) continue;
    const result = await fetcher(s);
    if (!result) continue;
    const threshold = Number(s.threshold);
    const targetRef = result.targetRef ?? s.scopeProjectId ?? 'global';
    if (result.metric > threshold) {
      await triggerAlert(
        {
          id: s.id,
          recipients: s.recipients,
          channels: s.channels,
          remindAfterHours: s.remindAfterHours,
          remindMaxCount: s.remindMaxCount,
        },
        result.metric,
        threshold,
        targetRef,
      );
      continue;
    }
    await prisma.alert.updateMany({
      where: { settingId: s.id, status: 'open', targetRef },
      data: { status: 'closed' },
    });
  }
}
