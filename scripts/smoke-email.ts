type TestResult = {
  name: string;
  ok: boolean;
  details?: string;
};

type SendEmailResult = {
  channel?: string;
  status: string;
  error?: string;
};

type SendEmailFn = (
  to: string[],
  subject: string,
  body: string,
) => Promise<SendEmailResult>;

function expect(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  // Dist JS is imported for runtime portability; type is narrowed below.
  // @ts-ignore no declaration file is emitted for dist JS modules.
  const notifierModule = await import('../packages/backend/dist/services/notifier.js');
  const { sendEmail } = notifierModule as { sendEmail: SendEmailFn };
  const results: TestResult[] = [];

  async function test(name: string, fn: () => Promise<void>) {
    const originalEnv = { ...process.env };
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({
        name,
        ok: false,
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      process.env = originalEnv;
    }
  }

  await test('stub: invalid recipients fail', async () => {
    process.env.MAIL_TRANSPORT = 'stub';
    process.env.MAIL_FROM = 'noreply@example.com';
    const res = await sendEmail(['invalid'], 'Test', 'Body');
    expect(res.status === 'failed', `expected failed, got ${res.status}`);
    expect(
      res.error === 'invalid_recipient',
      `expected invalid_recipient error, got ${res.error || 'none'}`,
    );
  });

  await test('stub: valid recipients pass', async () => {
    process.env.MAIL_TRANSPORT = 'stub';
    process.env.MAIL_FROM = 'noreply@example.com';
    const res = await sendEmail(['user@example.com'], 'Test', 'Body');
    expect(res.status === 'stub', `expected stub, got ${res.status}`);
    expect(
      res.channel === 'email',
      `expected email channel, got ${res.channel || 'none'}`,
    );
  });

  await test('smtp: missing config fails', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    process.env.MAIL_FROM = 'noreply@example.com';
    process.env.SMTP_HOST = '';
    process.env.SMTP_PORT = '';
    const res = await sendEmail(['user@example.com'], 'Test', 'Body');
    expect(res.status === 'failed', `expected failed, got ${res.status}`);
    expect(
      res.error === 'smtp_config_missing' || res.error === 'smtp_unavailable',
      `unexpected error ${res.error || 'none'}`,
    );
  });

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => {
    if (r.ok) {
      console.log(`[PASS] ${r.name}`);
    } else {
      console.error(`[FAIL] ${r.name}: ${r.details}`);
    }
  });

  if (failed.length) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[smoke-email] unexpected error', err);
  process.exit(1);
});
