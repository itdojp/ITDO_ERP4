import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { sendEmail } from './notifier.js';

const DEFAULT_DELIVERY_LIMIT = 50;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MINUTES = 10;
const DEFAULT_RETRY_MAX_DELAY_MINUTES = 24 * 60;

const NON_RETRYABLE_ERRORS = new Set([
  'missing_email',
  'invalid_recipient',
  'smtp_config_missing',
  'smtp_disabled',
  'smtp_unavailable',
]);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveLookbackDays() {
  return parsePositiveInt(
    process.env.NOTIFICATION_DELIVERY_LOOKBACK_DAYS,
    DEFAULT_LOOKBACK_DAYS,
  );
}

function resolveRetryMax() {
  return parseNonNegativeInt(
    process.env.NOTIFICATION_DELIVERY_RETRY_MAX,
    DEFAULT_RETRY_MAX,
  );
}

function resolveRetryBaseMinutes() {
  return parseNonNegativeInt(
    process.env.NOTIFICATION_DELIVERY_RETRY_BASE_MINUTES,
    DEFAULT_RETRY_BASE_MINUTES,
  );
}

function resolveRetryMaxDelayMinutes() {
  return parseNonNegativeInt(
    process.env.NOTIFICATION_DELIVERY_RETRY_MAX_DELAY_MINUTES,
    DEFAULT_RETRY_MAX_DELAY_MINUTES,
  );
}

function computeNextRetryAt(now: Date, attempt: number, baseMinutes: number) {
  if (attempt <= 0 || baseMinutes <= 0) return null;
  const factor = Math.pow(2, attempt - 1);
  const maxDelayMinutes = resolveRetryMaxDelayMinutes();
  const cappedMinutes =
    maxDelayMinutes > 0
      ? Math.min(baseMinutes * factor, maxDelayMinutes)
      : baseMinutes * factor;
  return new Date(now.getTime() + cappedMinutes * 60 * 1000);
}

function isRetryableError(error?: string | null) {
  if (!error) return true;
  return !NON_RETRYABLE_ERRORS.has(error);
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeEmailList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const raw = (item as { value?: unknown }).value;
      return typeof raw === 'string' ? raw.trim() : '';
    })
    .filter(Boolean);
  return Array.from(new Set(items));
}

function pickPrimaryEmail(value: unknown) {
  if (!Array.isArray(value)) return null;
  const primary = value.find((item) => {
    if (!item || typeof item !== 'object') return false;
    return Boolean((item as { primary?: unknown }).primary);
  });
  if (primary && typeof primary === 'object') {
    const email = normalizeString((primary as { value?: unknown }).value);
    if (email) return email;
  }
  const candidates = normalizeEmailList(value);
  return candidates.length ? candidates[0] : null;
}

async function resolveDeliveryEmailTarget(userId: string) {
  const trimmed = userId.trim();
  if (!trimmed) return null;
  if (emailRegex.test(trimmed)) return trimmed;
  const account = await prisma.userAccount.findUnique({
    where: { userName: trimmed },
    select: { emails: true },
  });
  const email = pickPrimaryEmail(account?.emails);
  if (email && emailRegex.test(email)) return email;
  return null;
}

function buildChatMentionEmailSubject(meta: {
  projectCode?: string | null;
  projectName?: string | null;
}) {
  const label = meta.projectCode || meta.projectName;
  return label ? `ERP4: ${label} メンション` : 'ERP4: メンション';
}

function buildChatMentionEmailBody(notification: {
  userId: string;
  createdAt: Date;
  project?: { code?: string | null; name?: string | null } | null;
  messageId?: string | null;
  payload?: Prisma.JsonValue | null;
}) {
  const projectLabel = notification.project
    ? `${notification.project.code || '-'} / ${notification.project.name || '-'}`
    : '-';
  const payload = notification.payload as Record<string, unknown> | null;
  const fromUserId = normalizeString(payload?.fromUserId);
  const excerpt = normalizeString(payload?.excerpt);
  return [
    'chat mention notification',
    `to: ${notification.userId}`,
    `from: ${fromUserId || '-'}`,
    `project: ${projectLabel}`,
    `createdAt: ${notification.createdAt.toISOString()}`,
    `messageId: ${notification.messageId || '-'}`,
    excerpt ? `excerpt: ${excerpt}` : undefined,
  ]
    .filter((line) => typeof line === 'string' && line.trim() !== '')
    .join('\n');
}

function buildChatAckRequiredEmailSubject(meta: {
  projectCode?: string | null;
  projectName?: string | null;
}) {
  const label = meta.projectCode || meta.projectName;
  return label ? `ERP4: ${label} 確認依頼` : 'ERP4: 確認依頼';
}

function buildChatAckRequiredEmailBody(notification: {
  userId: string;
  createdAt: Date;
  project?: { code?: string | null; name?: string | null } | null;
  messageId?: string | null;
  payload?: Prisma.JsonValue | null;
}) {
  const projectLabel = notification.project
    ? `${notification.project.code || '-'} / ${notification.project.name || '-'}`
    : '-';
  const payload = notification.payload as Record<string, unknown> | null;
  const fromUserId = normalizeString(payload?.fromUserId);
  const excerpt = normalizeString(payload?.excerpt);
  const dueAt = normalizeString(payload?.dueAt);
  return [
    'chat ack required notification',
    `to: ${notification.userId}`,
    `from: ${fromUserId || '-'}`,
    `project: ${projectLabel}`,
    `createdAt: ${notification.createdAt.toISOString()}`,
    `messageId: ${notification.messageId || '-'}`,
    dueAt ? `dueAt: ${dueAt}` : undefined,
    excerpt ? `excerpt: ${excerpt}` : undefined,
  ]
    .filter((line) => typeof line === 'string' && line.trim() !== '')
    .join('\n');
}

function resolveEmailNotificationKinds() {
  const raw = process.env.NOTIFICATION_EMAIL_KINDS;
  if (!raw) return ['chat_mention', 'daily_report_missing'];
  const kinds = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return kinds.length ? kinds : ['chat_mention', 'daily_report_missing'];
}

type DeliveryRunItem = {
  id: string;
  notificationId: string;
  status: string;
  target?: string | null;
  error?: string | null;
};

export type NotificationDeliveryRunResult = {
  ok: true;
  dryRun: boolean;
  created: number;
  processed: number;
  counts: Record<string, number>;
  items: DeliveryRunItem[];
};

function incrementCount(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] || 0) + 1;
}

function resolveDeliveryLimit(limit: number | undefined) {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_DELIVERY_LIMIT;
  }
  return Math.min(Math.floor(limit), 200);
}

export async function runNotificationEmailDeliveries(options: {
  actorId?: string;
  dryRun?: boolean;
  limit?: number;
}): Promise<NotificationDeliveryRunResult> {
  const actorId = options.actorId;
  const dryRun = Boolean(options.dryRun);
  const limit = resolveDeliveryLimit(options.limit);
  const counts: Record<string, number> = {};

  const now = new Date();
  const lookbackDays = resolveLookbackDays();
  const lookbackFrom = new Date(
    now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
  );

  const candidates = await prisma.appNotification.findMany({
    where: {
      kind: { in: resolveEmailNotificationKinds() },
      readAt: null,
      createdAt: { gte: lookbackFrom },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      deliveries: {
        where: { channel: 'email' },
        select: { id: true },
      },
    },
  });

  const missingDeliveries = candidates.filter(
    (item) => item.deliveries.length === 0,
  );

  let created = 0;
  if (!dryRun && missingDeliveries.length > 0) {
    const result = await prisma.appNotificationDelivery.createMany({
      data: missingDeliveries.map((item) => ({
        notificationId: item.id,
        channel: 'email',
        status: 'pending',
        createdBy: actorId,
      })),
      skipDuplicates: true,
    });
    created = result.count;
  }
  counts.candidate_notifications = candidates.length;

  const retryMax = resolveRetryMax();
  const dueDeliveries = await prisma.appNotificationDelivery.findMany({
    where: {
      channel: 'email',
      OR: [
        { status: 'pending' },
        {
          status: 'failed',
          retryCount: { lt: retryMax },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
      ],
    },
    orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    include: {
      notification: {
        include: {
          project: { select: { code: true, name: true } },
        },
      },
    },
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      created: 0,
      processed: dueDeliveries.length,
      counts: {
        ...counts,
        due_deliveries: dueDeliveries.length,
        missing_deliveries: missingDeliveries.length,
      },
      items: dueDeliveries.map((item) => ({
        id: item.id,
        notificationId: item.notificationId,
        status: 'dry_run',
        target: item.target,
        error: item.error,
      })),
    };
  }

  const items: DeliveryRunItem[] = [];
  for (const delivery of dueDeliveries) {
    const claimed = await prisma.appNotificationDelivery.updateMany({
      where: {
        id: delivery.id,
        channel: 'email',
        OR: [
          { status: 'pending' },
          {
            status: 'failed',
            retryCount: { lt: retryMax },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
        ],
      },
      data: { status: 'sending', nextRetryAt: null },
    });
    if (claimed.count === 0) {
      items.push({
        id: delivery.id,
        notificationId: delivery.notificationId,
        status: 'skipped',
        error: 'already_claimed',
      });
      incrementCount(counts, 'skipped');
      continue;
    }

    const sentAt = new Date();
    const notification = delivery.notification;
    if (notification.readAt) {
      await prisma.appNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'skipped',
          error: 'already_read',
          sentAt,
        },
      });
      items.push({
        id: delivery.id,
        notificationId: delivery.notificationId,
        status: 'skipped',
        error: 'already_read',
      });
      incrementCount(counts, 'skipped');
      continue;
    }

    const emailTarget = await resolveDeliveryEmailTarget(notification.userId);
    if (!emailTarget) {
      await prisma.appNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'skipped',
          error: 'missing_email',
          target: notification.userId,
          sentAt,
        },
      });
      items.push({
        id: delivery.id,
        notificationId: delivery.notificationId,
        status: 'skipped',
        target: notification.userId,
        error: 'missing_email',
      });
      incrementCount(counts, 'skipped');
      continue;
    }

    let subject = `ERP4: ${notification.kind}`;
    let body = `${notification.kind}`;
    if (notification.kind === 'chat_mention') {
      subject = buildChatMentionEmailSubject({
        projectCode: notification.project?.code,
        projectName: notification.project?.name,
      });
      body = buildChatMentionEmailBody(notification);
    } else if (notification.kind === 'chat_ack_required') {
      subject = buildChatAckRequiredEmailSubject({
        projectCode: notification.project?.code,
        projectName: notification.project?.name,
      });
      body = buildChatAckRequiredEmailBody(notification);
    } else if (notification.kind === 'daily_report_missing') {
      const payload = notification.payload as
        | { reportDate?: string }
        | undefined;
      const reportDate = payload?.reportDate || '';
      subject = reportDate
        ? `ERP4: 日報未提出（${reportDate}）`
        : 'ERP4: 日報未提出';
      body = reportDate
        ? `日報が未提出です。対象日: ${reportDate}`
        : '日報が未提出です。';
    }

    try {
      const emailResult = await sendEmail([emailTarget], subject, body, {
        metadata: {
          notificationId: notification.id,
          deliveryId: delivery.id,
          kind: notification.kind,
        },
      });
      const error = emailResult.error ?? null;
      const retryBase = resolveRetryBaseMinutes();

      if (delivery.status === 'failed') {
        const nextRetryCount = delivery.retryCount + 1;
        const retryable =
          emailResult.status === 'failed' &&
          isRetryableError(error) &&
          retryBase > 0 &&
          nextRetryCount < retryMax;
        const nextRetryAt = retryable
          ? computeNextRetryAt(sentAt, nextRetryCount + 1, retryBase)
          : null;
        const status =
          emailResult.status === 'failed' && !retryable
            ? 'failed_permanent'
            : emailResult.status;
        await prisma.appNotificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status,
            error: error ?? undefined,
            target: emailResult.target || emailTarget,
            providerMessageId: emailResult.messageId,
            retryCount: nextRetryCount,
            nextRetryAt,
            lastErrorAt:
              status === 'failed' || status === 'failed_permanent'
                ? sentAt
                : null,
            sentAt,
          },
        });
        items.push({
          id: delivery.id,
          notificationId: delivery.notificationId,
          status,
          target: emailResult.target || emailTarget,
          error,
        });
        incrementCount(counts, status);
        continue;
      }

      const retryable =
        emailResult.status === 'failed' &&
        isRetryableError(error) &&
        retryMax > 0 &&
        retryBase > 0;
      const nextRetryAt = retryable
        ? computeNextRetryAt(sentAt, delivery.retryCount + 1, retryBase)
        : null;
      const status =
        emailResult.status === 'failed' && !retryable
          ? 'failed_permanent'
          : emailResult.status;
      await prisma.appNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          error: error ?? undefined,
          target: emailResult.target || emailTarget,
          providerMessageId: emailResult.messageId,
          nextRetryAt,
          lastErrorAt:
            status === 'failed' || status === 'failed_permanent'
              ? sentAt
              : null,
          sentAt,
        },
      });
      items.push({
        id: delivery.id,
        notificationId: delivery.notificationId,
        status,
        target: emailResult.target || emailTarget,
        error,
      });
      incrementCount(counts, status);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'send_failed';
      const retryBase = resolveRetryBaseMinutes();
      const isRetry = delivery.status === 'failed';
      const nextRetryCount = isRetry
        ? delivery.retryCount + 1
        : delivery.retryCount;
      const retryable = isRetry
        ? isRetryableError(error) &&
          retryMax > 0 &&
          retryBase > 0 &&
          nextRetryCount < retryMax
        : isRetryableError(error) && retryMax > 0 && retryBase > 0;
      const attempt = isRetry ? nextRetryCount + 1 : delivery.retryCount + 1;
      const nextRetryAt = retryable
        ? computeNextRetryAt(sentAt, attempt, retryBase)
        : null;
      const status = retryable ? 'failed' : 'failed_permanent';
      await prisma.appNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          error,
          target: emailTarget,
          retryCount: isRetry ? nextRetryCount : undefined,
          nextRetryAt,
          lastErrorAt: sentAt,
          sentAt,
        },
      });
      items.push({
        id: delivery.id,
        notificationId: delivery.notificationId,
        status,
        target: emailTarget,
        error,
      });
      incrementCount(counts, status);
    }
  }

  return {
    ok: true,
    dryRun: false,
    created,
    processed: items.length,
    counts: {
      ...counts,
      due_deliveries: dueDeliveries.length,
      missing_deliveries: missingDeliveries.length,
    },
    items,
  };
}
