import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type NotifyResult = {
  channel: string;
  status: string;
  error?: string;
  target?: string;
  messageId?: string;
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
  const port = portRaw ? Number(portRaw) : undefined;
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

function getSmtpTransport() {
  if (cachedTransporter || cachedError) {
    return { transporter: cachedTransporter, from: cachedFrom, error: cachedError };
  }
  const config = resolveMailConfig();
  if (config.transport !== 'smtp') {
    cachedError = 'smtp_disabled';
    return { transporter: null, from: null, error: cachedError };
  }
  if (!config.host || !config.port || !Number.isFinite(config.port)) {
    cachedError = 'smtp_config_missing';
    return { transporter: null, from: null, error: cachedError };
  }
  cachedFrom = config.from;
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? false,
    auth: config.user ? { user: config.user, pass: config.pass || '' } : undefined,
  });
  return { transporter: cachedTransporter, from: cachedFrom, error: null };
}

// stub implementations
export async function sendEmailStub(
  to: string[],
  subject: string,
  body: string,
): Promise<NotifyResult> {
  console.log('[email stub]', { to, subject, body });
  return {
    status: 'stub',
    channel: 'email',
    target: to.join(','),
    messageId: `stub-${Date.now()}`,
  };
}

export async function sendEmail(
  to: string[],
  subject: string,
  body: string,
): Promise<NotifyResult> {
  const config = resolveMailConfig();
  if (config.transport !== 'smtp') {
    return sendEmailStub(to, subject, body);
  }
  const { transporter, from, error } = getSmtpTransport();
  if (!transporter || !from) {
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
      error: error || 'smtp_unavailable',
    };
  }
  try {
    const info = await transporter.sendMail({
      from,
      to: to.join(','),
      subject,
      text: body,
    });
    return {
      status: 'success',
      channel: 'email',
      target: to.join(','),
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      status: 'failed',
      channel: 'email',
      target: to.join(','),
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

export async function recordPdfStub(
  kind: string,
  payload: Record<string, unknown>,
): Promise<{ url: string }> {
  console.log('[pdf stub]', { kind, payload });
  return { url: `stub://${kind}/${payload['id'] || 'unknown'}` };
}

export async function generatePdfStub(
  templateId: string,
  payload: Record<string, unknown>,
): Promise<{ url: string }> {
  console.log('[pdf generate stub]', { templateId, payload });
  return { url: `stub://pdf/${templateId}/${payload['id'] || 'unknown'}` };
}

export function buildStubResults(channels: string[]): NotifyResult[] {
  return channels.map((ch) => ({ channel: ch, status: 'stub' }));
}

export async function sendInvoiceEmail(to: string[], invoiceNo: string) {
  return sendEmail(to, `Invoice ${invoiceNo}`, 'Invoice email');
}

export async function sendPurchaseOrderEmail(to: string[], poNo: string) {
  return sendEmail(to, `PO ${poNo}`, 'Purchase order email');
}
