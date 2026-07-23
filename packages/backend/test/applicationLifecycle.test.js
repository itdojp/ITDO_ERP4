import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  BACKEND_FAILURE_EXIT_CODE,
  BACKEND_SUCCESS_EXIT_CODE,
  runApplication,
} from '../dist/applicationLifecycle.js';
import { BackendResourceCleanupError } from '../dist/backendResources.js';

class TestSignalSource extends EventEmitter {
  off(event, listener) {
    super.off(event, listener);
    return this;
  }
}

function createLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      info(details, message) {
        entries.push({ level: 'info', details, message });
      },
      warn(details, message) {
        entries.push({ level: 'warn', details, message });
      },
      error(details, message) {
        entries.push({ level: 'error', details, message });
      },
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function startRun(options = {}) {
  const signalSource = new TestSignalSource();
  const { entries, logger } = createLogger();
  const forcedExitCodes = [];
  const configuredStart = options.start
    ? async () => ({ ...(await options.start()), log: logger })
    : undefined;
  const run = runApplication({
    signalSource,
    fallbackLogger: logger,
    shutdownTimeoutMs: 500,
    forceExit: (code) => forcedExitCodes.push(code),
    ...options,
    ...(configuredStart ? { start: configuredStart } : {}),
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { entries, forcedExitCodes, run, signalSource };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} closes the server once and returns the success exit code`, async () => {
    let closeCount = 0;
    const { entries, forcedExitCodes, run, signalSource } = await startRun({
      start: async () => ({
        close: async () => {
          closeCount += 1;
        },
        log: createLogger().logger,
      }),
    });

    signalSource.emit(signal);
    assert.equal(await run, BACKEND_SUCCESS_EXIT_CODE);
    assert.equal(closeCount, 1);
    assert.deepEqual(forcedExitCodes, []);
    assert.equal(signalSource.listenerCount('SIGTERM'), 0);
    assert.equal(signalSource.listenerCount('SIGINT'), 0);
    assert.ok(
      entries.some(
        (entry) =>
          entry.message === 'backend shutdown started' &&
          entry.details.signal === signal,
      ),
    );
  });
}

test('graceful shutdown waits for the server close promise to settle', async () => {
  const closing = createDeferred();
  const { run, signalSource } = await startRun({
    start: async () => ({
      close: () => closing.promise,
      log: createLogger().logger,
    }),
  });
  let settled = false;
  void run.then(() => {
    settled = true;
  });

  signalSource.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false);

  closing.resolve();
  assert.equal(await run, BACKEND_SUCCESS_EXIT_CODE);
});

test('a signal received during startup closes the server after startup resolves', async () => {
  const startup = createDeferred();
  let closeCount = 0;
  const { run, signalSource } = await startRun({
    start: () => startup.promise,
  });

  signalSource.emit('SIGTERM');
  startup.resolve({
    close: async () => {
      closeCount += 1;
    },
    log: createLogger().logger,
  });

  assert.equal(await run, BACKEND_SUCCESS_EXIT_CODE);
  assert.equal(closeCount, 1);
});

test('a second signal forces a deterministic failure exit', async () => {
  const closing = createDeferred();
  let closeCount = 0;
  const { entries, forcedExitCodes, run, signalSource } = await startRun({
    start: async () => ({
      close: () => {
        closeCount += 1;
        return closing.promise;
      },
      log: createLogger().logger,
    }),
  });

  signalSource.emit('SIGTERM');
  signalSource.emit('SIGINT');

  assert.equal(await run, BACKEND_FAILURE_EXIT_CODE);
  assert.equal(closeCount, 1);
  assert.deepEqual(forcedExitCodes, [BACKEND_FAILURE_EXIT_CODE]);
  assert.ok(
    entries.some(
      (entry) =>
        entry.message === 'backend shutdown forced by second signal' &&
        entry.details.firstSignal === 'SIGTERM' &&
        entry.details.signal === 'SIGINT',
    ),
  );
});

test('a repeated signal of the same kind follows the second-signal contract', async () => {
  const closing = createDeferred();
  const { forcedExitCodes, run, signalSource } = await startRun({
    start: async () => ({
      close: () => closing.promise,
      log: createLogger().logger,
    }),
  });

  signalSource.emit('SIGTERM');
  signalSource.emit('SIGTERM');

  assert.equal(await run, BACKEND_FAILURE_EXIT_CODE);
  assert.deepEqual(forcedExitCodes, [BACKEND_FAILURE_EXIT_CODE]);
});

test('shutdown failure returns non-zero and does not log the error message', async () => {
  const secret = 'smtp-close-secret-value';
  const { entries, forcedExitCodes, run, signalSource } = await startRun({
    start: async () => ({
      close: async () => {
        throw new Error(secret);
      },
      log: createLogger().logger,
    }),
  });

  signalSource.emit('SIGTERM');

  assert.equal(await run, BACKEND_FAILURE_EXIT_CODE);
  assert.deepEqual(forcedExitCodes, [BACKEND_FAILURE_EXIT_CODE]);
  assert.equal(JSON.stringify(entries).includes(secret), false);
  assert.ok(
    entries.some((entry) => entry.message === 'backend shutdown failed'),
  );
});

test('resource cleanup failure logs only the safe failed resource names', async () => {
  const { entries, run, signalSource } = await startRun({
    start: async () => ({
      close: async () => {
        throw new BackendResourceCleanupError(['notifier', 'prisma']);
      },
      log: createLogger().logger,
    }),
  });

  signalSource.emit('SIGTERM');
  assert.equal(await run, BACKEND_FAILURE_EXIT_CODE);
  assert.ok(
    entries.some(
      (entry) =>
        entry.message === 'backend shutdown failed' &&
        JSON.stringify(entry.details.failedResources) ===
          JSON.stringify(['notifier', 'prisma']),
    ),
  );
});

test('startup failure returns non-zero and removes signal listeners', async () => {
  const secret = 'database-url-secret-value';
  const source = new TestSignalSource();
  const { entries, logger } = createLogger();
  const error = Object.assign(new Error(secret), { code: 'EADDRINUSE' });

  const exitCode = await runApplication({
    start: async () => {
      throw error;
    },
    signalSource: source,
    fallbackLogger: logger,
  });

  assert.equal(exitCode, BACKEND_FAILURE_EXIT_CODE);
  assert.equal(source.listenerCount('SIGTERM'), 0);
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(JSON.stringify(entries).includes(secret), false);
  assert.ok(
    entries.some(
      (entry) =>
        entry.message === 'backend startup failed' &&
        entry.details.errorCode === 'EADDRINUSE',
    ),
  );
});

test('shutdown timeout is a failure and invokes the forced exit path', async () => {
  const { entries, forcedExitCodes, run, signalSource } = await startRun({
    shutdownTimeoutMs: 20,
    start: async () => ({
      close: () => new Promise(() => {}),
      log: createLogger().logger,
    }),
  });

  signalSource.emit('SIGTERM');
  assert.equal(await run, BACKEND_FAILURE_EXIT_CODE);
  assert.deepEqual(forcedExitCodes, [BACKEND_FAILURE_EXIT_CODE]);
  assert.ok(
    entries.some((entry) => entry.message === 'backend shutdown timed out'),
  );
});
