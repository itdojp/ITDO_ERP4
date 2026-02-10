import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { logAudit } from './audit.js';
import { isWebPushEnabled, sendWebPush } from './webPush.js';

const DEFAULT_PUSH_ICON = '/icon.svg';
const DEFAULT_ENABLED_PUSH_KINDS = [
  'chat_mention',
  'chat_ack_required',
  'approval_pending',
  'approval_approved',
  'approval_rejected',
  'daily_report_missing',
];

type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userId: string;
};

type PushClient = {
  pushSubscription: {
    findMany(args: {
      where: { userId: { in: string[] }; isActive: boolean };
      select: Record<string, true>;
    }): Promise<PushSubscriptionRecord[]>;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { isActive: boolean; lastSeenAt: Date; updatedBy: string };
    }): Promise<{ count: number }>;
  };
};

type DispatchNotificationPushOptions = {
  kind: string;
  userIds: string[];
  payload?: Prisma.InputJsonValue | null;
  messageId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
};

type DispatchNotificationPushDeps = {
  client?: PushClient;
  now?: Date;
  isWebPushEnabledFn?: () => boolean;
  sendWebPushFn?: typeof sendWebPush;
  logAuditFn?: typeof logAudit;
  pushKindsEnv?: string | undefined;
};

export type NotificationPushDispatchResult = {
  attempted: boolean;
  reason?:
    | 'no_recipients'
    | 'kind_disabled'
    | 'webpush_disabled'
    | 'no_subscriptions';
  kind: string;
  recipientCount: number;
  subscriptionCount: number;
  deliveredCount: number;
  failedCount: number;
  disabledCount: number;
};

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUserIds(values: string[]) {
  return Array.from(
    new Set(
      values.map((value) => normalizeId(value)).filter((value) => value !== ''),
    ),
  );
}

function parsePushKinds(raw: string | undefined): Set<string> | null {
  if (raw === undefined) {
    return new Set(DEFAULT_ENABLED_PUSH_KINDS);
  }
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) {
    return new Set();
  }
  if (items.includes('*')) {
    return null;
  }
  return new Set(items);
}

export function isNotificationPushKindEnabled(
  kind: string,
  rawEnv: string | undefined = process.env.NOTIFICATION_PUSH_KINDS,
) {
  const enabledKinds = parsePushKinds(rawEnv);
  if (enabledKinds === null) return true;
  return enabledKinds.has(kind);
}

function toObject(
  value: Prisma.InputJsonValue | null | undefined,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getPayloadString(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!payload) return null;
  const raw = payload[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function buildOpenHash(kind: string, id: string) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  params.set('id', id);
  return `/#/open?${params.toString()}`;
}

function buildNotificationPushPayload(
  options: DispatchNotificationPushOptions,
) {
  const payload = toObject(options.payload ?? null);
  const excerpt = getPayloadString(payload, 'excerpt');

  let title = 'ERP4';
  let body = excerpt ?? '新しい通知があります';
  let url = '/';

  switch (options.kind) {
    case 'chat_mention':
      title = 'ERP4: メンション';
      body = excerpt ?? 'メンション通知があります';
      if (normalizeId(options.messageId)) {
        url = buildOpenHash('chat_message', normalizeId(options.messageId));
      }
      break;
    case 'chat_message':
      title = 'ERP4: 新着メッセージ';
      body = excerpt ?? '新着メッセージがあります';
      if (normalizeId(options.messageId)) {
        url = buildOpenHash('chat_message', normalizeId(options.messageId));
      }
      break;
    case 'chat_ack_required':
      title = 'ERP4: 確認依頼';
      body = excerpt ?? '確認依頼があります';
      if (normalizeId(options.messageId)) {
        url = buildOpenHash('chat_message', normalizeId(options.messageId));
      }
      break;
    case 'chat_ack_escalation':
      title = 'ERP4: 確認依頼（期限超過）';
      body = excerpt ?? '期限超過の確認依頼があります';
      if (normalizeId(options.messageId)) {
        url = buildOpenHash('chat_message', normalizeId(options.messageId));
      }
      break;
    case 'approval_pending':
      title = 'ERP4: 承認依頼';
      body = '承認待ちの申請があります';
      url = buildOpenHash('approvals', 'inbox');
      break;
    case 'approval_approved':
      title = 'ERP4: 承認完了';
      body = '申請が承認されました';
      url = buildOpenHash('approvals', 'inbox');
      break;
    case 'approval_rejected':
      title = 'ERP4: 差戻し';
      body = '申請が差戻しされました';
      url = buildOpenHash('approvals', 'inbox');
      break;
    case 'daily_report_missing': {
      const reportDate = getPayloadString(payload, 'reportDate');
      title = 'ERP4: 日報リマインダー';
      body = reportDate
        ? `${reportDate} の日報が未提出です`
        : '日報が未提出です';
      if (reportDate) {
        url = buildOpenHash('daily_report', reportDate);
      }
      break;
    }
    case 'daily_report_submitted': {
      const reportDate = getPayloadString(payload, 'reportDate');
      title = 'ERP4: 日報提出';
      body = reportDate
        ? `${reportDate} の日報が提出されました`
        : '日報が提出されました';
      if (reportDate) {
        url = buildOpenHash('daily_report', reportDate);
      }
      break;
    }
    case 'daily_report_updated': {
      const reportDate = getPayloadString(payload, 'reportDate');
      title = 'ERP4: 日報更新';
      body = reportDate
        ? `${reportDate} の日報が更新されました`
        : '日報が更新されました';
      if (reportDate) {
        url = buildOpenHash('daily_report', reportDate);
      }
      break;
    }
    case 'expense_mark_paid': {
      const expenseId =
        getPayloadString(payload, 'expenseId') ||
        normalizeId(options.messageId);
      title = 'ERP4: 経費支払完了';
      body = '経費精算の支払が完了しました';
      if (expenseId) {
        url = buildOpenHash('expense', expenseId);
      }
      break;
    }
    case 'project_member_added':
      title = 'ERP4: プロジェクト通知';
      body = 'プロジェクトにメンバーが追加されました';
      if (normalizeId(options.projectId)) {
        url = buildOpenHash('project', normalizeId(options.projectId));
      }
      break;
    case 'project_created': {
      const projectId =
        normalizeId(options.projectId) || normalizeId(options.messageId);
      title = 'ERP4: 新規プロジェクト';
      body = 'プロジェクトが作成されました';
      if (projectId) {
        url = buildOpenHash('project', projectId);
      }
      break;
    }
    case 'project_status_changed':
      title = 'ERP4: プロジェクト状態変更';
      body = 'プロジェクトステータスが更新されました';
      if (normalizeId(options.projectId)) {
        url = buildOpenHash('project', normalizeId(options.projectId));
      }
      break;
    default:
      break;
  }

  return { title, body, url, icon: DEFAULT_PUSH_ICON };
}

export async function dispatchNotificationPushes(
  options: DispatchNotificationPushOptions,
  deps: DispatchNotificationPushDeps = {},
): Promise<NotificationPushDispatchResult> {
  const client = deps.client ?? (prisma as unknown as PushClient);
  const now = deps.now ?? new Date();
  const isWebPushEnabledFn = deps.isWebPushEnabledFn ?? isWebPushEnabled;
  const sendWebPushFn = deps.sendWebPushFn ?? sendWebPush;
  const logAuditFn = deps.logAuditFn ?? logAudit;
  const kind = normalizeId(options.kind);
  const recipients = normalizeUserIds(options.userIds || []);

  if (!recipients.length) {
    return {
      attempted: false,
      reason: 'no_recipients',
      kind,
      recipientCount: 0,
      subscriptionCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      disabledCount: 0,
    };
  }

  if (!isNotificationPushKindEnabled(kind, deps.pushKindsEnv)) {
    return {
      attempted: false,
      reason: 'kind_disabled',
      kind,
      recipientCount: recipients.length,
      subscriptionCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      disabledCount: 0,
    };
  }

  if (!isWebPushEnabledFn()) {
    return {
      attempted: false,
      reason: 'webpush_disabled',
      kind,
      recipientCount: recipients.length,
      subscriptionCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      disabledCount: 0,
    };
  }

  const subscriptions = await client.pushSubscription.findMany({
    where: { userId: { in: recipients }, isActive: true },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      userId: true,
    },
  });
  if (!subscriptions.length) {
    return {
      attempted: false,
      reason: 'no_subscriptions',
      kind,
      recipientCount: recipients.length,
      subscriptionCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      disabledCount: 0,
    };
  }

  const pushPayload = buildNotificationPushPayload(options);
  const sendResult = await sendWebPushFn(
    subscriptions.map((sub) => ({
      id: sub.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    })),
    pushPayload,
  );

  const disabledIds = sendResult.results
    .filter((result) => result.shouldDisable)
    .map((result) => result.subscriptionId);
  if (disabledIds.length) {
    await client.pushSubscription.updateMany({
      where: { id: { in: disabledIds } },
      data: {
        isActive: false,
        lastSeenAt: now,
        updatedBy: normalizeId(options.actorUserId) || 'system',
      },
    });
  }

  const deliveredCount = sendResult.results.filter(
    (result) => result.status === 'success',
  ).length;
  const failedCount = sendResult.results.length - deliveredCount;
  await logAuditFn({
    action: 'notification_push_dispatched',
    targetTable: 'app_notifications',
    targetId: normalizeId(options.messageId) || undefined,
    source: 'system',
    userId: normalizeId(options.actorUserId) || undefined,
    metadata: {
      kind,
      recipientCount: recipients.length,
      subscriptionCount: subscriptions.length,
      deliveredCount,
      failedCount,
      disabledCount: disabledIds.length,
      messageId: normalizeId(options.messageId) || undefined,
      projectId: normalizeId(options.projectId) || undefined,
    } as Prisma.InputJsonValue,
  });

  return {
    attempted: true,
    kind,
    recipientCount: recipients.length,
    subscriptionCount: subscriptions.length,
    deliveredCount,
    failedCount,
    disabledCount: disabledIds.length,
  };
}
