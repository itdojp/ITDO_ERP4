export type NotifyResult = { channel: string; status: string; error?: string };

// stub implementations
export async function sendEmailStub(to: string[], subject: string, body: string): Promise<NotifyResult> {
  console.log('[email stub]', { to, subject, body });
  return { status: 'stub', channel: 'email' };
}

export async function recordPdfStub(kind: string, payload: Record<string, unknown>): Promise<{ url: string }> {
  console.log('[pdf stub]', { kind, payload });
  return { url: `stub://${kind}/${payload['id'] || 'unknown'}` };
}

export function buildStubResults(channels: string[]): NotifyResult[] {
  return channels.map((ch) => ({ channel: ch, status: 'stub' }));
}
