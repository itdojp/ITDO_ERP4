import webpush from 'web-push';

const MAX_ERROR_MESSAGE_LENGTH = 2000;

type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

export type WebPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushResult = {
  subscriptionId: string;
  status: 'success' | 'failed';
  error?: string;
  statusCode?: number;
  shouldDisable?: boolean;
};

let cachedConfigKey: string | null = null;

function resolveVapidConfig(): VapidConfig | null {
  const subject = (process.env.VAPID_SUBJECT || '').trim();
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

function ensureConfigured(config: VapidConfig) {
  const key = `${config.subject}|${config.publicKey}|${config.privateKey}`;
  if (cachedConfigKey === key) return;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  cachedConfigKey = key;
}

export function isWebPushEnabled(): boolean {
  return resolveVapidConfig() !== null;
}

type WebPushError = {
  statusCode?: number;
  body?: string;
  message?: string;
};

function normalizeError(err: unknown): {
  message: string;
  statusCode?: number;
} {
  if (!err || typeof err !== 'object') return { message: 'send_failed' };
  const webPushError = err as WebPushError;
  const statusCode =
    typeof webPushError.statusCode === 'number'
      ? webPushError.statusCode
      : undefined;
  const message =
    typeof webPushError.body === 'string' && webPushError.body.trim()
      ? webPushError.body.slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : typeof webPushError.message === 'string' && webPushError.message.trim()
        ? webPushError.message
        : 'send_failed';
  return { message, statusCode };
}

export async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: Record<string, unknown>,
): Promise<{ enabled: boolean; results: WebPushResult[] }> {
  const config = resolveVapidConfig();
  if (!config) {
    return {
      enabled: false,
      results: subscriptions.map((sub) => ({
        subscriptionId: sub.id,
        status: 'failed',
        error: 'vapid_not_configured',
      })),
    };
  }
  ensureConfigured(config);
  const body = JSON.stringify(payload);
  const sendPromises: Promise<WebPushResult>[] = subscriptions.map(
    async (sub): Promise<WebPushResult> => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        return { subscriptionId: sub.id, status: 'success' as const };
      } catch (err) {
        const normalized = normalizeError(err);
        const shouldDisable =
          normalized.statusCode === 404 || normalized.statusCode === 410;
        return {
          subscriptionId: sub.id,
          status: 'failed' as const,
          error: normalized.message,
          statusCode: normalized.statusCode,
          shouldDisable,
        };
      }
    },
  );
  const results = await Promise.all(sendPromises);
  return { enabled: true, results };
}
