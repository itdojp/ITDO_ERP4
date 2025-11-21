export async function sendEmailStub(to: string[], subject: string, body: string) {
  console.log('[email stub]', { to, subject, body });
  return { status: 'stub', to };
}

export async function recordPdfStub(kind: string, payload: Record<string, unknown>) {
  console.log('[pdf stub]', { kind, payload });
  return { url: `stub://${kind}/${payload['id'] || 'unknown'}` };
}
