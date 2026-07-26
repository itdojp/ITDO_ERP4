import assert from 'node:assert/strict';
import test from 'node:test';

const SIGNAL_EVENTS = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'beforeExit'];

function listenerCounts() {
  return Object.fromEntries(
    SIGNAL_EVENTS.map((event) => [event, process.listenerCount(event)]),
  );
}

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

test('notifier and server module imports do not own process signals', async () => {
  const before = listenerCounts();
  await import('../dist/services/notifier.js');
  assert.deepEqual(listenerCounts(), before);
  await import('../dist/server.js');
  assert.deepEqual(listenerCounts(), before);
});

test('repeated server build and close does not add process listeners', async () => {
  const { buildServer } = await import('../dist/server.js');
  const before = listenerCounts();

  await withEnv(
    {
      NODE_ENV: 'test',
      AUTH_MODE: 'header',
      MAIL_TRANSPORT: 'stub',
      RATE_LIMIT_ENABLED: '0',
      RATE_LIMIT_REDIS_URL: undefined,
    },
    async () => {
      for (let index = 0; index < 2; index += 1) {
        const server = await buildServer({ logger: false });
        await server.close();
        assert.deepEqual(listenerCounts(), before);
      }
    },
  );
});
