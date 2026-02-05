import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { sendEmail, type NotifyResult } from './notifier.js';

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

function buildChatMessageEmailSubject(meta: {
  projectCode?: string | null;
  projectName?: string | null;
}) {
  const label = meta.projectCode || meta.projectName;
  return label ? `ERP4: ${label} チャット投稿` : 'ERP4: チャット投稿';
}

function buildChatMessageEmailBody(notification: {
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
    'chat message notification',
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
  escalation?: boolean;
}) {
  const label = meta.projectCode || meta.projectName;
  const suffix = meta.escalation ? '確認依頼（エスカレーション）' : '確認依頼';
  return label ? `ERP4: ${label} ${suffix}` : `ERP4: ${suffix}`;
}

function buildChatAckRequiredEmailBody(
  notification: {
    userId: string;
    createdAt: Date;
    project?: { code?: string | null; name?: string | null } | null;
    messageId?: string | null;
    payload?: Prisma.JsonValue | null;
  },
  meta: { escalation?: boolean } = {},
) {
  const projectLabel = notification.project
    ? `${notification.project.code || '-'} / ${notification.project.name || '-'}`
    : '-';
  const payload = notification.payload as Record<string, unknown> | null;
  const fromUserId = normalizeString(payload?.fromUserId);
  const excerpt = normalizeString(payload?.excerpt);
  const dueAt = normalizeString(payload?.dueAt);
  const escalation =
    meta.escalation !== undefined
      ? meta.escalation
      : Boolean(payload?.escalation);
  return [
    escalation
      ? 'chat ack required escalation'
      : 'chat ack required notification',
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

type DigestNotification = {
  userId: string;
  kind: string;
  createdAt: Date;
  messageId?: string | null;
  payload?: Prisma.JsonValue | null;
  project?: { code?: string | null; name?: string | null } | null;
};

function buildNotificationDigestSubject(count: number) {
  return `ERP4: 通知まとめ (${count}件)`;
}

function formatDigestNotificationLine(notification: DigestNotification) {
  const projectLabel = notification.project
    ? `${notification.project.code || '-'} / ${notification.project.name || '-'}`
    : '-';
  const payload = notification.payload as Record<string, unknown> | null;
  const excerpt = normalizeString(payload?.excerpt);
  const dueAt = normalizeString(payload?.dueAt);
  const reportDate = normalizeString(payload?.reportDate);
  const parts = [
    notification.kind,
    projectLabel,
    notification.createdAt.toISOString(),
  ];
  if (dueAt) parts.push(`dueAt=${dueAt}`);
  if (reportDate) parts.push(`reportDate=${reportDate}`);
  if (excerpt) parts.push(`excerpt=${excerpt}`);
  return `- ${parts.join(' | ')}`;
}

function buildNotificationDigestBody(options: {
  userId: string;
  notifications: DigestNotification[];
  generatedAt: Date;
}) {
  const lines = [
    'notification digest',
    `to: ${options.userId}`,
    `count: ${options.notifications.length}`,
    `generatedAt: ${options.generatedAt.toISOString()}`,
  ];
  options.notifications.forEach((notification) => {
    lines.push(formatDigestNotificationLine(notification));
  });
  return lines.join('\n');
}

const FLOW_TYPE_LABEL_MAP: Record<string, string> = {
  estimate: '見積',
  invoice: '請求',
  purchase_order: '発注',
  vendor_quote: '仕入見積',
  vendor_invoice: '仕入請求',
  expense: '経費',
  leave: '休暇',
  time: '工数',
};

function formatFlowTypeLabel(flowType: string) {
  return FLOW_TYPE_LABEL_MAP[flowType] ?? flowType;
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

const DEFAULT_EMAIL_DIGEST_INTERVAL_MINUTES = 10;
const EMAIL_SENT_STATUSES = [
  'sent',
  'success',
  'stub',
  'delivered',
  'opened',
  'clicked',
  'processed',
];

type UserEmailPreference = {
  userId: string;
  emailMode: 'realtime' | 'digest';
  emailDigestIntervalMinutes: number;
};

function normalizeEmailMode(value: unknown): 'realtime' | 'digest' {
  return value === 'realtime' ? 'realtime' : 'digest';
}

function normalizeEmailDigestInterval(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EMAIL_DIGEST_INTERVAL_MINUTES;
  }
  const rounded = Math.floor(value);
  if (rounded < 1 || rounded > 1440) {
    return DEFAULT_EMAIL_DIGEST_INTERVAL_MINUTES;
  }
  return rounded;
}

async function resolveEmailPreferences(userIds: string[]) {
  const normalized = Array.from(
    new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  );
  if (normalized.length === 0) return new Map<string, UserEmailPreference>();
  const rows = await prisma.userNotificationPreference.findMany({
    where: { userId: { in: normalized } },
    select: {
      userId: true,
      emailMode: true,
      emailDigestIntervalMinutes: true,
    },
  });
  const map = new Map<string, UserEmailPreference>();
  rows.forEach((row) => {
    map.set(row.userId, {
      userId: row.userId,
      emailMode: normalizeEmailMode(row.emailMode),
      emailDigestIntervalMinutes: normalizeEmailDigestInterval(
        row.emailDigestIntervalMinutes,
      ),
    });
  });
  return map;
}

async function resolveLastEmailSentAt(userId: string) {
  return prisma.appNotificationDelivery.findFirst({
    where: {
      channel: 'email',
      status: { in: EMAIL_SENT_STATUSES },
      sentAt: { not: null },
      notification: { userId },
    },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
}

type DeliveryRunItem = {
  id: string;
  notificationId: string;
  status: string;
  target?: string | null;
  error?: string | null;
};

type DeliveryWithNotification = Prisma.AppNotificationDeliveryGetPayload<{
  include: {
    notification: {
      include: { project: { select: { code: true; name: true } } };
    };
  };
}>;

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

async function applyEmailResultToDelivery(options: {
  delivery: DeliveryWithNotification;
  emailResult: NotifyResult;
  sentAt: Date;
  emailTarget: string;
  retryMax: number;
  retryBase: number;
}): Promise<DeliveryRunItem> {
  const { delivery, emailResult, sentAt, emailTarget, retryMax, retryBase } =
    options;
  const error = emailResult.error ?? null;

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
          status === 'failed' || status === 'failed_permanent' ? sentAt : null,
        sentAt,
      },
    });
    return {
      id: delivery.id,
      notificationId: delivery.notificationId,
      status,
      target: emailResult.target || emailTarget,
      error,
    };
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
        status === 'failed' || status === 'failed_permanent' ? sentAt : null,
      sentAt,
    },
  });
  return {
    id: delivery.id,
    notificationId: delivery.notificationId,
    status,
    target: emailResult.target || emailTarget,
    error,
  };
}

async function applyEmailErrorToDelivery(options: {
  delivery: DeliveryWithNotification;
  errorMessage: string;
  sentAt: Date;
  emailTarget: string;
  retryMax: number;
  retryBase: number;
}): Promise<DeliveryRunItem> {
  const { delivery, errorMessage, sentAt, emailTarget, retryMax, retryBase } =
    options;
  const isRetry = delivery.status === 'failed';
  const nextRetryCount = isRetry
    ? delivery.retryCount + 1
    : delivery.retryCount;
  const retryable = isRetry
    ? isRetryableError(errorMessage) &&
      retryMax > 0 &&
      retryBase > 0 &&
      nextRetryCount < retryMax
    : isRetryableError(errorMessage) && retryMax > 0 && retryBase > 0;
  const attempt = isRetry ? nextRetryCount + 1 : delivery.retryCount + 1;
  const nextRetryAt = retryable
    ? computeNextRetryAt(sentAt, attempt, retryBase)
    : null;
  const status = retryable ? 'failed' : 'failed_permanent';
  await prisma.appNotificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      error: errorMessage,
      target: emailTarget,
      retryCount: isRetry ? nextRetryCount : undefined,
      nextRetryAt,
      lastErrorAt: sentAt,
      sentAt,
    },
  });
  return {
    id: delivery.id,
    notificationId: delivery.notificationId,
    status,
    target: emailTarget,
    error: errorMessage,
  };
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

  const userIds = Array.from(
    new Set(dueDeliveries.map((delivery) => delivery.notification.userId)),
  );
  const preferenceMap = await resolveEmailPreferences(userIds);
  const resolvePreference = (userId: string): UserEmailPreference => {
    const pref = preferenceMap.get(userId);
    if (pref) return pref;
    return {
      userId,
      emailMode: 'digest',
      emailDigestIntervalMinutes: DEFAULT_EMAIL_DIGEST_INTERVAL_MINUTES,
    };
  };

  const realtimeDeliveries: DeliveryWithNotification[] = [];
  const digestDeliveriesByUser = new Map<string, DeliveryWithNotification[]>();
  dueDeliveries.forEach((delivery) => {
    const pref = resolvePreference(delivery.notification.userId);
    if (pref.emailMode === 'realtime') {
      realtimeDeliveries.push(delivery);
      return;
    }
    const list = digestDeliveriesByUser.get(pref.userId) || [];
    list.push(delivery);
    digestDeliveriesByUser.set(pref.userId, list);
  });

  const items: DeliveryRunItem[] = [];
  const retryBase = resolveRetryBaseMinutes();
  const markSkipped = async (
    delivery: DeliveryWithNotification,
    reason: string,
    sentAt: Date,
    target?: string,
  ) => {
    await prisma.appNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'skipped',
        error: reason,
        target,
        sentAt,
      },
    });
    items.push({
      id: delivery.id,
      notificationId: delivery.notificationId,
      status: 'skipped',
      target,
      error: reason,
    });
    incrementCount(counts, 'skipped');
  };

  for (const delivery of realtimeDeliveries) {
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
      await markSkipped(delivery, 'already_read', sentAt);
      continue;
    }

    const emailTarget = await resolveDeliveryEmailTarget(notification.userId);
    if (!emailTarget) {
      await markSkipped(delivery, 'missing_email', sentAt, notification.userId);
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
    } else if (notification.kind === 'chat_message') {
      subject = buildChatMessageEmailSubject({
        projectCode: notification.project?.code,
        projectName: notification.project?.name,
      });
      body = buildChatMessageEmailBody(notification);
    } else if (
      notification.kind === 'chat_ack_required' ||
      notification.kind === 'chat_ack_escalation'
    ) {
      const payload = notification.payload as Record<string, unknown> | null;
      const escalation =
        notification.kind === 'chat_ack_escalation' ||
        Boolean(payload?.escalation);
      subject = buildChatAckRequiredEmailSubject({
        projectCode: notification.project?.code,
        projectName: notification.project?.name,
        escalation,
      });
      body = buildChatAckRequiredEmailBody(notification, { escalation });
    } else if (
      notification.kind === 'approval_pending' ||
      notification.kind === 'approval_approved' ||
      notification.kind === 'approval_rejected'
    ) {
      const projectLabel = notification.project
        ? `${notification.project.code || '-'} / ${notification.project.name || '-'}`
        : '-';
      const payload = notification.payload as Record<string, unknown> | null;
      const fromUserId = normalizeString(payload?.fromUserId);
      const flowType = normalizeString(payload?.flowType);
      const flowLabel = flowType ? formatFlowTypeLabel(flowType) : '申請';
      const approvalInstanceId = normalizeString(payload?.approvalInstanceId);
      const targetTable = normalizeString(payload?.targetTable);
      const targetId = normalizeString(payload?.targetId);

      const subjectSuffix =
        notification.kind === 'approval_pending'
          ? `${flowLabel} 承認依頼`
          : notification.kind === 'approval_approved'
            ? `${flowLabel} 承認完了`
            : `${flowLabel} 差戻し`;
      subject =
        projectLabel !== '-'
          ? `ERP4: ${projectLabel} ${subjectSuffix}`
          : `ERP4: ${subjectSuffix}`;
      body = [
        'approval notification',
        `kind: ${notification.kind}`,
        `to: ${notification.userId}`,
        `from: ${fromUserId || '-'}`,
        `project: ${projectLabel}`,
        `createdAt: ${notification.createdAt.toISOString()}`,
        `approvalInstanceId: ${approvalInstanceId || '-'}`,
        `targetTable: ${targetTable || '-'}`,
        `targetId: ${targetId || '-'}`,
      ]
        .filter((line) => typeof line === 'string' && line.trim() !== '')
        .join('\n');
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
      const item = await applyEmailResultToDelivery({
        delivery,
        emailResult,
        sentAt,
        emailTarget,
        retryMax,
        retryBase,
      });
      items.push(item);
      incrementCount(counts, item.status);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'send_failed';
      const item = await applyEmailErrorToDelivery({
        delivery,
        errorMessage,
        sentAt,
        emailTarget,
        retryMax,
        retryBase,
      });
      items.push(item);
      incrementCount(counts, item.status);
    }
  }

  for (const [userId, deliveries] of digestDeliveriesByUser) {
    const preference = resolvePreference(userId);
    const lastSent = await resolveLastEmailSentAt(userId);
    if (lastSent?.sentAt) {
      const nextAllowed =
        lastSent.sentAt.getTime() +
        preference.emailDigestIntervalMinutes * 60 * 1000;
      if (nextAllowed > now.getTime()) {
        incrementCount(counts, 'digest_skipped_interval');
        continue;
      }
    }

    const eligibleDeliveries: DeliveryWithNotification[] = [];
    for (const delivery of deliveries) {
      const sentAt = new Date();
      if (delivery.notification.readAt) {
        await markSkipped(delivery, 'already_read', sentAt);
        continue;
      }
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
      eligibleDeliveries.push(delivery);
    }

    if (eligibleDeliveries.length === 0) continue;

    const emailTarget = await resolveDeliveryEmailTarget(userId);
    if (!emailTarget) {
      const sentAt = new Date();
      await Promise.all(
        eligibleDeliveries.map((delivery) =>
          markSkipped(delivery, 'missing_email', sentAt, userId),
        ),
      );
      continue;
    }

    const digestSentAt = new Date();
    const subject = buildNotificationDigestSubject(eligibleDeliveries.length);
    const body = buildNotificationDigestBody({
      userId,
      notifications: eligibleDeliveries.map(
        (delivery) => delivery.notification,
      ),
      generatedAt: digestSentAt,
    });

    try {
      const emailResult = await sendEmail([emailTarget], subject, body, {
        metadata: {
          kind: 'notification_digest',
          userId,
        },
      });
      for (const delivery of eligibleDeliveries) {
        const item = await applyEmailResultToDelivery({
          delivery,
          emailResult,
          sentAt: digestSentAt,
          emailTarget,
          retryMax,
          retryBase,
        });
        items.push(item);
        incrementCount(counts, item.status);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'send_failed';
      for (const delivery of eligibleDeliveries) {
        const item = await applyEmailErrorToDelivery({
          delivery,
          errorMessage,
          sentAt: digestSentAt,
          emailTarget,
          retryMax,
          retryBase,
        });
        items.push(item);
        incrementCount(counts, item.status);
      }
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
