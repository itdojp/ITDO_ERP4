import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

async function withHttpServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('sendEmail redacts bounded SendGrid failure diagnostics', async () => {
  const { sendEmail } = await import('../dist/services/notifier.js');
  const originalConsoleError = console.error;
  const errors = [];
  try {
    console.error = (...args) => {
      errors.push(args);
    };
    await withHttpServer(
      (_request, response) => {
        response.writeHead(500, { 'x-request-id': 'sg-req-1' });
        response.end(`authorization=Bearer reflected ${'x'.repeat(3000)}`);
      },
      async (baseUrl) => {
        await withEnv(
          {
            MAIL_TRANSPORT: 'sendgrid',
            SENDGRID_API_KEY: 'sendgrid-secret',
            SENDGRID_BASE_URL: `${baseUrl}/v3`,
            SENDGRID_ALLOW_HTTP: 'true',
            SENDGRID_ALLOW_PRIVATE_IP: 'true',
            SENDGRID_ALLOWED_HOSTS: '127.0.0.1',
            MAIL_FROM: 'noreply@example.com',
          },
          async () => {
            const result = await sendEmail(
              ['user@example.com'],
              'subject',
              'body',
            );
            assert.equal(result.status, 'failed');
            assert.equal(result.error, 'sendgrid_500');
          },
        );
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  const failure = errors.find((entry) => entry[0] === '[sendgrid send failed]');
  assert.ok(failure, 'expected sendgrid failure log');
  const details = failure[1];
  assert.equal(String(details.body).includes('reflected'), false);
  assert.equal(String(details.body).includes('[REDACTED]'), true);
  assert.ok(String(details.body).length < 600);
  assert.equal(details.requestId, 'sg-req-1');
});

test('sendEmail accepts an in-memory attachment without requiring a local path', async () => {
  const { sendEmail } = await import('../dist/services/notifier.js');
  let payload;
  await withHttpServer(
    (request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        payload = JSON.parse(body);
        response.writeHead(202, { 'x-message-id': 'message-placeholder' });
        response.end();
      });
    },
    async (baseUrl) => {
      await withEnv(
        {
          MAIL_TRANSPORT: 'sendgrid',
          SENDGRID_API_KEY: 'test-placeholder',
          SENDGRID_BASE_URL: `${baseUrl}/v3`,
          SENDGRID_ALLOW_HTTP: 'true',
          SENDGRID_ALLOW_PRIVATE_IP: 'true',
          SENDGRID_ALLOWED_HOSTS: '127.0.0.1',
          MAIL_FROM: 'noreply@example.com',
        },
        async () => {
          const result = await sendEmail(
            ['user@example.com'],
            'subject',
            'body',
            {
              attachments: [
                {
                  filename: 'document.pdf',
                  content: Buffer.from('%PDF-placeholder', 'utf8'),
                  contentType: 'application/pdf',
                },
              ],
            },
          );
          assert.equal(result.status, 'success');
        },
      );
    },
  );
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].filename, 'document.pdf');
  assert.equal(
    payload.attachments[0].content,
    Buffer.from('%PDF-placeholder', 'utf8').toString('base64'),
  );
});

test('sendEmail rejects ambiguous attachment sources before transport', async () => {
  const { sendEmail } = await import('../dist/services/notifier.js');
  const result = await sendEmail(['user@example.com'], 'subject', 'body', {
    attachments: [
      {
        filename: 'document.pdf',
        path: '/not/read.pdf',
        content: Buffer.from('%PDF-placeholder', 'utf8'),
      },
    ],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'email_attachment_source_invalid');
});
