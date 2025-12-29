import { createHash } from 'crypto';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
};

type MailTransportConfig = {
  transport: 'stub' | 'smtp';
  from: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
};

let cachedTransporter: Transporter | null = null;
let cachedFrom: string | null = null;
let cachedError: string | null = null;
let cachedConfigKey: string | null = null;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveMailConfig(): MailTransportConfig {
  const transport =
    (process.env.MAIL_TRANSPORT || 'stub').toLowerCase() === 'smtp'
      ? 'smtp'
      : 'stub';
  const from = process.env.MAIL_FROM || 'noreply@example.com';
  if (transport === 'stub') {
    return { transport, from };
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

function logSmtpError(err: unknown) {
  console.error('[smtp send failed]', {
    message: err instanceof Error ? err.message : 'send_failed',
    code:
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined,
  });
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
  console.log('[email stub]', { to: valid, subject, body, attachmentNames });
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

export async function sendSlackWebhookStub(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  const safeUrl = redactUrl(url);
  console.log('[slack webhook stub]', { url: safeUrl, payload });
  return { status: 'stub', channel: 'slack', target: safeUrl };
}

export async function sendWebhookStub(
  url: string,
  payload: Record<string, unknown>,
): Promise<NotifyResult> {
  const safeUrl = redactUrl(url);
  console.log('[webhook stub]', { url: safeUrl, payload });
  return { status: 'stub', channel: 'webhook', target: safeUrl };
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
  return sendEmail(to, `Invoice ${invoiceNo}`, body, { attachments });
}

export async function sendPurchaseOrderEmail(
  to: string[],
  poNo: string,
  pdf?: PdfInfo,
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
  return sendEmail(to, `PO ${poNo}`, body, { attachments });
}
