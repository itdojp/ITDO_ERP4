import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import {
  closeNotifierResources,
  sendEmail,
} from '../dist/services/notifier.js';

const SMTP_ENV = {
  MAIL_TRANSPORT: 'smtp',
  MAIL_FROM: 'noreply@example.com',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '2525',
  SMTP_SECURE: 'false',
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
};

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('SMTP cleanup closes the cached transporter once and permits safe reuse', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let createCount = 0;
  let closeCount = 0;
  try {
    nodemailer.createTransport = () => {
      createCount += 1;
      return {
        verify: async () => true,
        sendMail: async () => ({ messageId: `message-${createCount}` }),
        close: () => {
          closeCount += 1;
        },
      };
    };

    await withEnv(SMTP_ENV, async () => {
      const first = await sendEmail(['user@example.com'], 'subject', 'body');
      assert.equal(first.status, 'success');
      assert.equal(createCount, 1);

      await closeNotifierResources();
      await closeNotifierResources();
      assert.equal(closeCount, 1);

      const second = await sendEmail(['user@example.com'], 'subject', 'body');
      assert.equal(second.status, 'success');
      assert.equal(createCount, 2);
      await closeNotifierResources();
      assert.equal(closeCount, 2);
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    await closeNotifierResources();
  }
});

test('explicit SMTP cleanup clears cache state even when close throws', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalConsoleError = console.error;
  const secret = 'smtp-close-secret-value';
  const errors = [];
  try {
    nodemailer.createTransport = () => ({
      verify: async () => true,
      sendMail: async () => ({ messageId: 'message-placeholder' }),
      close: () => {
        throw new Error(secret);
      },
    });
    console.error = (...args) => errors.push(args);

    await withEnv(SMTP_ENV, async () => {
      const result = await sendEmail(['user@example.com'], 'subject', 'body');
      assert.equal(result.status, 'success');
      await assert.rejects(closeNotifierResources, { name: 'Error' });
      await closeNotifierResources();
    });

    assert.equal(JSON.stringify(errors).includes(secret), false);
  } finally {
    console.error = originalConsoleError;
    nodemailer.createTransport = originalCreateTransport;
    await closeNotifierResources();
  }
});

test('automatic SMTP cache reset logs only sanitized close failure details', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalConsoleError = console.error;
  const secret = 'smtp-close-secret-value';
  const errors = [];
  let createCount = 0;
  try {
    nodemailer.createTransport = () => {
      createCount += 1;
      return {
        verify: async () => true,
        sendMail: async () => ({ messageId: `message-${createCount}` }),
        close: () => {
          if (createCount === 1) {
            throw Object.assign(new Error(secret), { code: secret });
          }
        },
      };
    };
    console.error = (...args) => errors.push(args);

    await withEnv(SMTP_ENV, async () => {
      assert.equal(
        (await sendEmail(['user@example.com'], 'subject', 'body')).status,
        'success',
      );
      process.env.SMTP_PORT = '2526';
      assert.equal(
        (await sendEmail(['user@example.com'], 'subject', 'body')).status,
        'success',
      );
      await closeNotifierResources();
    });

    const closeFailure = errors.find(
      (entry) => entry[0] === '[smtp close failed]',
    );
    assert.ok(closeFailure);
    assert.equal(closeFailure[1].name, 'Error');
    assert.equal(closeFailure[1].code, undefined);
    assert.equal(JSON.stringify(errors).includes(secret), false);
  } finally {
    console.error = originalConsoleError;
    nodemailer.createTransport = originalCreateTransport;
    await closeNotifierResources();
  }
});
