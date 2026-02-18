import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { safeFetch } from './safeHttpClient.js';

export type NotifyResult = {
  channel: string;
  status: string;
  error?: string;
  target?: string;
  messageId?: string;
};

type EmailAttachment = {
  filename: string;
  path: string;
  contentType?: string;
};

type EmailOptions = {
  attachments?: EmailAttachment[];
  metadata?: Record<string, string>;
};

type MailTransportConfig = {
  transport: 'stub' | 'smtp' | 'sendgrid';
  from: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  sendgridApiKey?: string;
  sendgridBaseUrl?: string;
};

let cachedTransporter: Transporter | null = null;
let cachedFrom: string | null = null;
let cachedError: string | null = null;
let cachedConfigKey: string | null = null;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseAllowedHosts(raw: string | undefined) {
  return new Set(
    (raw || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveMailConfig(): MailTransportConfig {
  const transportRaw = (process.env.MAIL_TRANSPORT || 'stub').toLowerCase();
  const transport =
    transportRaw === 'smtp'
      ? 'smtp'
      : transportRaw === 'sendgrid'
        ? 'sendgrid'
        : 'stub';
  const from = process.env.MAIL_FROM || 'noreply@example.com';
  if (transport === 'stub') {
    return { transport, from };
  }
  if (transport === 'sendgrid') {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error(
        "SENDGRID_API_KEY is required when MAIL_TRANSPORT is set to 'sendgrid'",
      );
    }
    return {
      transport,
      from,
      sendgridApiKey: process.env.SENDGRID_API_KEY,
      sendgridBaseUrl: process.env.SENDGRID_BASE_URL,
    };
  }
  const portRaw = process.env.SMTP_PORT;
  const parsedPort = portRaw ? Number(portRaw) : undefined;
  const port =
    typeof parsedPort === 'number' && Number.isFinite(parsedPort)
      ? parsedPort
      : undefined;
  return {
    transport,
    from,
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };
}

function buildConfigKey(config: MailTransportConfig) {
  const passHash = config.pass
    ? createHash('sha256').update(config.pass).digest('hex')
    : '';
  return [
    config.transport,
    config.from,
    config.host || '',
    config.port?.toString() || '',
    config.secure ? '1' : '0',
    config.user || '',
    passHash,
  ].join('|');
}

function resetSmtpCache(error?: string, configKey?: string) {
  if (cachedTransporter) {
    cachedTransporter.close();
  }
  cachedTransporter = null;
  cachedFrom = null;
  cachedError = error ?? null;
  cachedConfigKey = configKey ?? null;
}

function getSmtpTransport() {
  const config = resolveMailConfig();
  const configKey = buildConfigKey(config);
  if (cachedConfigKey && cachedConfigKey !== configKey) {
    resetSmtpCache();
  }
  if (cachedTransporter || cachedError) {
    return {
      transporter: cachedTransporter,
      from: cachedFrom,
      error: cachedError,
    };
  }
  if (config.transport !== 'smtp') {
    resetSmtpCache('smtp_disabled', configKey);
    return { transporter: null, from: null, error: cachedError };
  }
  if (!config.host || !config.port || !Number.isFinite(config.port)) {
    resetSmtpCache('smtp_config_missing', configKey);
    return { transporter: null, from: null, error: cachedError };
  }
  cachedFrom = config.from;
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? false,
    auth: config.user
      ? { user: config.user, pass: config.pass || '' }
      : undefined,
  });
  cachedConfigKey = configKey;
  if (cachedTransporter && typeof cachedTransporter.verify === 'function') {
    void Promise.resolve(cachedTransporter.verify()).catch((err) => {
      console.error('[smtp verify failed]', {
        message: err instanceof Error ? err.message : 'verify_failed',
      });
      resetSmtpCache('smtp_verification_failed', configKey);
    });
  }
  return { transporter: cachedTransporter, from: cachedFrom, error: null };
}

function normalizeRecipients(to: string[]) {
  const cleaned = to.map((value) => value.trim()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  const valid = unique.filter((value) => emailRegex.test(value));
  const invalid = unique.filter((value) => !emailRegex.test(value));
  return { valid, invalid };
}

function normalizeMetadata(metadata?: Record<string, string>) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) =>
    value != null && value.trim() ? true : false,
  );
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]));
}

function logSmtpError(err: unknown) {
  console.error('[smtp send failed]', {
    message: err instanceof Error ? err.message : 'send_failed',
    code:
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined,
  });
}

function logSendGridError(err: unknown) {
  console.error('[sendgrid send failed]', {
    message: err instanceof Error ? err.message : 'send_failed',
  });
}

async function buildSendGridAttachments(options?: EmailOptions) {
  const attachments = options?.attachments;
  if (!attachments || attachments.length === 0) return undefined;
  const results = await Promise.all(
    attachments.map(async (item) => {
      const buffer = await fs.readFile(item.path);
      return {
        content: buffer.toString('base64'),
        filename: item.filename,
        type: item.contentType || 'application/octet-stream',
        disposition: 'attachment',
      };
    }),
  );
  return results;
}

async function sendEmailSendGrid(
  to: string[],
  subject: string,
  body: string,
  options: EmailOptions | undefined,
  config: MailTransportConfig,
): Promise<NotifyResult> {
  if (!config.sendgridApiKey) {
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: 'sendgrid_config_missing',
    };
  }
  const baseUrl = config.sendgridBaseUrl || 'https://api.sendgrid.com/v3';
  let attachments;
  try {
    attachments = await buildSendGridAttachments(options);
  } catch (err) {
    logSendGridError(err);
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: 'sendgrid_attachment_failed',
    };
  }
  const customArgs = normalizeMetadata(options?.metadata);
  const payload = {
    personalizations: [
      {
        to: to.map((email) => ({ email })),
      },
    ],
    from: { email: config.from },
    subject,
    content: [{ type: 'text/plain', value: body }],
    ...(customArgs ? { custom_args: customArgs } : {}),
    ...(attachments ? { attachments } : {}),
  };
  try {
    const res = await safeFetch(
      `${baseUrl.replace(/\/$/, '')}/mail/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      {
        timeoutMs: parsePositiveInt(process.env.SENDGRID_TIMEOUT_MS, 5000),
        allowedHosts: parseAllowedHosts(process.env.SENDGRID_ALLOWED_HOSTS),
        allowHttp: process.env.SENDGRID_ALLOW_HTTP === 'true',
        allowPrivateIp: process.env.SENDGRID_ALLOW_PRIVATE_IP === 'true',
      },
    );
    if (!res.ok) {
      const text = await res.text();
      const body =
        process.env.NODE_ENV === 'production' ? text.slice(0, 2000) : text;
      console.error('[sendgrid send failed]', {
        status: res.status,
        body,
      });
      return {
        status: 'failed',
        channel: 'email',
        target: to.join(','),
        error: `sendgrid_${res.status}`,
      };
    }
    const messageId =
      res.headers.get('x-message-id') ||
      res.headers.get('x-request-id') ||
      undefined;
    return {
      status: 'success',
      channel: 'email',
      target: to.join(','),
      messageId,
    };
  } catch (err) {
    logSendGridError(err);
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: err instanceof Error ? err.message : 'send_failed',
    };
  }
}

function registerSmtpShutdownHandlers() {
  if (typeof process === 'undefined' || typeof process.on !== 'function')
    return;
  const shutdown = () => resetSmtpCache();
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  signals.forEach((signal) => process.once(signal, shutdown));
  process.once('beforeExit', shutdown);
}

registerSmtpShutdownHandlers();

// stub implementations
export async function sendEmailStub(
  to: string[],
  subject: string,
  body: string,
  options?: EmailOptions,
): Promise<NotifyResult> {
  const { valid, invalid } = normalizeRecipients(to);
  if (invalid.length) {
    console.warn('[email stub] invalid recipients skipped', { invalid });
  }
  if (!valid.length) {
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: 'invalid_recipient',
    };
  }
  const attachmentNames = options?.attachments?.map((item) => item.filename);
  console.log('[email stub]', {
    to: valid,
    subject,
    body,
    attachmentNames,
    metadata: normalizeMetadata(options?.metadata),
  });
  return {
    status: 'stub',
    channel: 'email',
    target: valid.join(','),
    messageId: `stub-${Date.now()}`,
  };
}

export async function sendEmail(
  to: string[],
  subject: string,
  body: string,
  options?: EmailOptions,
): Promise<NotifyResult> {
  const { valid, invalid } = normalizeRecipients(to);
  if (invalid.length) {
    console.warn('[email] invalid recipients skipped', { invalid });
  }
  if (!valid.length) {
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: 'invalid_recipient',
    };
  }
  const config = resolveMailConfig();
  if (config.transport === 'sendgrid') {
    return sendEmailSendGrid(valid, subject, body, options, config);
  }
  if (config.transport !== 'smtp') {
    return sendEmailStub(valid, subject, body, options);
  }
  const { transporter, from, error } = getSmtpTransport();
  if (!transporter || !from) {
    return {
      status: 'failed',
      channel: 'email',
      target: valid.join(','),
      error: error || 'smtp_unavailable',
    };
  }
  try {
    const attachments =
      options?.attachments && options.attachments.length
        ? options.attachments
        : undefined;
    const info = await transporter.sendMail({
      from,
      to: valid.join(','),
      subject,
      text: body,
      attachments,
    });
    return {
      status: 'success',
      channel: 'email',
      target: valid.join(','),
      messageId: info.messageId,
    };
  } catch (err) {
    logSmtpError(err);
    return {
      status: 'failed',
      channel: 'email',
      target: valid.join(','),
      error: err instanceof Error ? err.message : 'send_failed',
    };
  }
}

function redactUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.split('/').filter(Boolean);
    const hint = path.length ? `/${path[0]}/...` : '';
    return `${parsed.protocol}//${parsed.host}${hint}`;
  } catch {
    return '<invalid-url>';
  }
}

type WebhookPolicy = {
  enabled: boolean;
  allowedHosts: Set<string>;
  allowHttp: boolean;
  allowPrivateIp: boolean;
  timeoutMs: number;
  maxBytes: number;
};

let cachedWebhookPolicy: WebhookPolicy | null = null;
let cachedWebhookPolicyKey: string | null = null;

function resolveWebhookPolicy(): WebhookPolicy {
  const rawHosts = process.env.WEBHOOK_ALLOWED_HOSTS || '';
  const allowed = rawHosts
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const timeoutRaw = process.env.WEBHOOK_TIMEOUT_MS;
  const parsedTimeout = timeoutRaw ? Number(timeoutRaw) : Number.NaN;
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.floor(parsedTimeout)
      : 5000;
  const maxBytesRaw = process.env.WEBHOOK_MAX_BYTES;
  const parsedMaxBytes = maxBytesRaw ? Number(maxBytesRaw) : Number.NaN;
  const maxBytes =
    Number.isFinite(parsedMaxBytes) && parsedMaxBytes > 0
      ? Math.floor(parsedMaxBytes)
      : 1024 * 1024;
  const allowHttp = process.env.WEBHOOK_ALLOW_HTTP === 'true';
  const allowPrivateIp = process.env.WEBHOOK_ALLOW_PRIVATE_IP === 'true';
  return {
    enabled: allowed.length > 0,
    allowedHosts: new Set(allowed),
    allowHttp,
    allowPrivateIp,
    timeoutMs,
    maxBytes,
  };
}

function getWebhookPolicy(): WebhookPolicy {
  const key = [
    process.env.WEBHOOK_ALLOWED_HOSTS || '',
    process.env.WEBHOOK_TIMEOUT_MS || '',
    process.env.WEBHOOK_MAX_BYTES || '',
    process.env.WEBHOOK_ALLOW_HTTP || '',
    process.env.WEBHOOK_ALLOW_PRIVATE_IP || '',
  ].join('|');
  if (cachedWebhookPolicy && cachedWebhookPolicyKey === key) {
    return cachedWebhookPolicy;
  }
  cachedWebhookPolicy = resolveWebhookPolicy();
  cachedWebhookPolicyKey = key;
  return cachedWebhookPolicy;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((value) => Number(value));
  if (parts.length !== 4) return true;
  if (
    parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return true;
  const [a, b, c, d] = parts;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fec0:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;
  if (normalized.startsWith('::ffff:')) {
    const tail = normalized.slice('::ffff:'.length);
    if (isIP(tail) === 4) return isPrivateIPv4(tail);
  }
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

async function validateWebhookUrl(
  rawUrl: string,
  policy: WebhookPolicy,
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(policy.allowHttp && protocol === 'http:')) {
    return { ok: false, error: 'insecure_scheme' };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, error: 'missing_hostname' };
  if (!policy.allowedHosts.has(hostname)) {
    return { ok: false, error: 'host_not_allowed' };
  }
  const port = parsed.port;
  const defaultPort = protocol === 'https:' ? '443' : '80';
  if (port && port !== defaultPort) {
    return { ok: false, error: 'port_not_allowed' };
  }
  if (policy.allowPrivateIp) {
    return { ok: true, url: parsed };
  }
  if (isIP(hostname)) {
    return isPrivateAddress(hostname)
      ? { ok: false, error: 'private_ip_blocked' }
      : { ok: true, url: parsed };
  }
  try {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!resolved.length) {
      return { ok: false, error: 'dns_lookup_failed' };
    }
    const hasPrivate = resolved.some(({ address }) =>
      isPrivateAddress(address),
    );
    if (hasPrivate) {
      return { ok: false, error: 'private_ip_blocked' };
    }
  } catch {
    return { ok: false, error: 'dns_lookup_failed' };
  }
  return { ok: true, url: parsed };
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
  channel: 'slack' | 'webhook',
): Promise<NotifyResult> {
  const safeUrl = redactUrl(url);
  const policy = getWebhookPolicy();
  if (!policy.enabled) {
    return { status: 'skipped', channel, target: safeUrl, error: 'disabled' };
  }
  const validation = await validateWebhookUrl(url, policy);
  if (!validation.ok) {
    return {
      status: 'skipped',
      channel,
      target: safeUrl,
      error: validation.error,
    };
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > policy.maxBytes) {
    return {
      status: 'failed',
      channel,
      target: safeUrl,
      error: 'payload_too_large',
    };
  }
  if (!policy.allowPrivateIp) {
    const hostname = validation.url.hostname.toLowerCase();
    if (!isIP(hostname)) {
      try {
        const resolved = await dnsLookup(hostname, {
          all: true,
          verbatim: true,
        });
        const hasPrivate = resolved.some(({ address }) =>
          isPrivateAddress(address),
        );
        if (hasPrivate) {
          return {
            status: 'skipped',
            channel,
            target: safeUrl,
            error: 'private_ip_blocked',
          };
        }
      } catch {
        return {
          status: 'skipped',
          channel,
          target: safeUrl,
          error: 'dns_lookup_failed',
        };
      }
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    const res = await fetch(validation.url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ITDO_ERP4/0.1',
      },
      signal: controller.signal,
      redirect: 'error',
      body,
    });
    if (!res.ok) {
      return {
        status: 'failed',
        channel,
        target: safeUrl,
        error: `http_${res.status}`,
      };
    }
    return { status: 'success', channel, target: safeUrl };
  } catch (err) {
    const message =
      err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError'
        ? 'timeout'
        : 'send_failed';
    return { status: 'failed', channel, target: safeUrl, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function buildSlackPayload(payload: Record<string, unknown>) {
  const settingId = payload.settingId;
  const metric = payload.metric;
  const threshold = payload.threshold;
  if (
    typeof settingId === 'string' &&
    typeof metric === 'number' &&
    typeof threshold === 'number'
  ) {
    return {
      text: `[ERP4] Alert triggered: ${settingId} (metric=${metric}, threshold=${threshold})`,
    };
  }
  return {
    text: '[ERP4] Alert notification sent',
  };
}

export async function sendSlackWebhookStub(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  const safeUrl = redactUrl(url);
  console.log('[slack webhook stub]', { url: safeUrl, payload });
  return { status: 'stub', channel: 'slack', target: safeUrl };
}

export async function sendSlackWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  return postJson(url, buildSlackPayload(payload), 'slack');
}

export async function sendWebhookStub(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  const safeUrl = redactUrl(url);
  console.log('[webhook stub]', { url: safeUrl, payload });
  return { status: 'stub', channel: 'webhook', target: safeUrl };
}

export async function sendWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  return postJson(url, payload, 'webhook');
}

export function buildStubResults(channels: string[]): NotifyResult[] {
  return channels.map((ch) => ({ channel: ch, status: 'stub' }));
}

type PdfInfo = {
  filename?: string;
  path?: string;
  url?: string;
};

export async function sendInvoiceEmail(
  to: string[],
  invoiceNo: string,
  pdf?: PdfInfo,
  options?: Pick<EmailOptions, 'metadata'>,
) {
  const body = pdf?.url
    ? `Invoice email (placeholder)\nPDF: ${pdf.url}`
    : 'Invoice email (placeholder)';
  const attachments =
    pdf?.path && pdf.filename
      ? [
          {
            filename: pdf.filename,
            path: pdf.path,
            contentType: 'application/pdf',
          },
        ]
      : undefined;
  return sendEmail(to, `Invoice ${invoiceNo}`, body, {
    attachments,
    metadata: options?.metadata,
  });
}

export async function sendEstimateEmail(
  to: string[],
  estimateNo: string,
  pdf?: PdfInfo,
  options?: Pick<EmailOptions, 'metadata'>,
) {
  const body = pdf?.url
    ? `Estimate email (placeholder)\nPDF: ${pdf.url}`
    : 'Estimate email (placeholder)';
  const attachments =
    pdf?.path && pdf.filename
      ? [
          {
            filename: pdf.filename,
            path: pdf.path,
            contentType: 'application/pdf',
          },
        ]
      : undefined;
  return sendEmail(to, `Estimate ${estimateNo}`, body, {
    attachments,
    metadata: options?.metadata,
  });
}

export async function sendPurchaseOrderEmail(
  to: string[],
  poNo: string,
  pdf?: PdfInfo,
  options?: Pick<EmailOptions, 'metadata'>,
) {
  const body = pdf?.url
    ? `Purchase order email (placeholder)\nPDF: ${pdf.url}`
    : 'Purchase order email (placeholder)';
  const attachments =
    pdf?.path && pdf.filename
      ? [
          {
            filename: pdf.filename,
            path: pdf.path,
            contentType: 'application/pdf',
          },
        ]
      : undefined;
  return sendEmail(to, `PO ${poNo}`, body, {
    attachments,
    metadata: options?.metadata,
  });
}
