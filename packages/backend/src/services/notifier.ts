export type NotifyResult = {
  channel: string;
  status: string;
  error?: string;
  target?: string;
};

// stub implementations
export async function sendEmailStub(
  to: string[],
  subject: string,
  body: string,
): Promise<NotifyResult> {
  console.log('[email stub]', { to, subject, body });
  return { status: 'stub', channel: 'email' };
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
  return sendEmailStub(to, `Invoice ${invoiceNo}`, 'Invoice email stub');
}

export async function sendPurchaseOrderEmail(to: string[], poNo: string) {
  return sendEmailStub(to, `PO ${poNo}`, 'Purchase order email stub');
}
