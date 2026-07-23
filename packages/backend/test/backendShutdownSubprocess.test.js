import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENTRYPOINT = path.join(BACKEND_ROOT, 'dist', 'index.js');
const LIFECYCLE_FIXTURE = path.join(
  BACKEND_ROOT,
  'test-support',
  'backendLifecycleProcess.js',
);
const PROCESS_TIMEOUT_MS = 15_000;

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  return port;
}

function minimalBackendEnv(port) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/postgres?schema=public',
    AUTH_MODE: 'header',
    AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'false',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_ENABLED: '0',
    MAIL_TRANSPORT: 'stub',
    PDF_PROVIDER: 'local',
    EVIDENCE_ARCHIVE_PROVIDER: 'local',
    CHAT_ATTACHMENT_PROVIDER: 'local',
    REPORT_PROVIDER: 'local',
    LOG_LEVEL: 'info',
  };
}

function spawnBackend(port) {
  const child = spawn(process.execPath, [ENTRYPOINT], {
    cwd: BACKEND_ROOT,
    env: minimalBackendEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const events = new EventEmitter();
  let output = '';
  const append = (chunk) => {
    output += chunk.toString();
    events.emit('output');
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return { child, events, output: () => output };
}

function spawnLifecycleFixture(mode) {
  const child = spawn(process.execPath, [LIFECYCLE_FIXTURE, mode], {
    cwd: BACKEND_ROOT,
    env: minimalBackendEnv(3001),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const events = new EventEmitter();
  let output = '';
  const append = (chunk) => {
    output += chunk.toString();
    events.emit('output');
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return { child, events, output: () => output };
}

async function waitForOutput(tracked, expected) {
  if (tracked.output().includes(expected)) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`timed out waiting for backend output marker: ${expected}`),
      );
    }, PROCESS_TIMEOUT_MS);
    const onOutput = () => {
      if (!tracked.output().includes(expected)) return;
      cleanup();
      resolve();
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `backend exited before output marker: code=${code} signal=${signal}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      tracked.events.off('output', onOutput);
      tracked.child.off('exit', onExit);
    };
    tracked.events.on('output', onOutput);
    tracked.child.once('exit', onExit);
  });
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('backend subprocess did not exit before timeout'));
    }, PROCESS_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`backend entrypoint exits cleanly after ${signal}`, async (t) => {
    const port = await reservePort();
    const tracked = spawnBackend(port);
    t.after(() => {
      if (tracked.child.exitCode === null) tracked.child.kill('SIGKILL');
    });
    await waitForOutput(tracked, 'Server listening at');

    const startedAt = process.hrtime.bigint();
    assert.equal(tracked.child.kill(signal), true);
    const result = await waitForExit(tracked.child);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    assert.deepEqual(result, { code: 0, signal: null });
    assert.ok(durationMs < 5000, `shutdown took ${durationMs.toFixed(1)}ms`);
    assert.match(tracked.output(), /backend shutdown started/);
    assert.match(tracked.output(), /backend shutdown completed/);
    assert.doesNotMatch(
      tracked.output(),
      /shutdown timed out|forced by second signal|SIGKILL/i,
    );
  });
}

test('listen failure exits non-zero without leaving the entrypoint running', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '0.0.0.0', resolve);
  });
  t.after(() => blocker.close());
  const address = blocker.address();
  assert.ok(address && typeof address === 'object');

  const tracked = spawnBackend(address.port);
  t.after(() => {
    if (tracked.child.exitCode === null) tracked.child.kill('SIGKILL');
  });
  const result = await waitForExit(tracked.child);

  assert.deepEqual(result, { code: 1, signal: null });
  assert.match(tracked.output(), /backend startup failed/);
  assert.match(tracked.output(), /EADDRINUSE/);
});

test('a second signal forces a non-zero subprocess exit', async (t) => {
  const tracked = spawnLifecycleFixture('second-signal');
  t.after(() => {
    if (tracked.child.exitCode === null) tracked.child.kill('SIGKILL');
  });
  await waitForOutput(tracked, 'lifecycle fixture ready');

  assert.equal(tracked.child.kill('SIGTERM'), true);
  await waitForOutput(tracked, 'backend shutdown started');
  assert.equal(tracked.child.kill('SIGINT'), true);
  const result = await waitForExit(tracked.child);

  assert.deepEqual(result, { code: 1, signal: null });
  assert.match(tracked.output(), /forced by second signal/);
  assert.doesNotMatch(tracked.output(), /fixture-secret-value/);
});

test('shutdown timeout forces a non-zero subprocess exit', async (t) => {
  const tracked = spawnLifecycleFixture('timeout');
  t.after(() => {
    if (tracked.child.exitCode === null) tracked.child.kill('SIGKILL');
  });
  await waitForOutput(tracked, 'lifecycle fixture ready');

  const startedAt = process.hrtime.bigint();
  assert.equal(tracked.child.kill('SIGTERM'), true);
  const result = await waitForExit(tracked.child);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  assert.deepEqual(result, { code: 1, signal: null });
  assert.ok(durationMs < 1000, `timeout exit took ${durationMs.toFixed(1)}ms`);
  assert.match(tracked.output(), /backend shutdown timed out/);
});

test('shutdown failure is a sanitized non-zero subprocess exit', async (t) => {
  const tracked = spawnLifecycleFixture('shutdown-failure');
  t.after(() => {
    if (tracked.child.exitCode === null) tracked.child.kill('SIGKILL');
  });
  await waitForOutput(tracked, 'lifecycle fixture ready');

  assert.equal(tracked.child.kill('SIGTERM'), true);
  const result = await waitForExit(tracked.child);

  assert.deepEqual(result, { code: 1, signal: null });
  assert.match(tracked.output(), /backend shutdown failed/);
  assert.match(tracked.output(), /ECLOSE/);
  assert.doesNotMatch(tracked.output(), /fixture-secret-value/);
});
