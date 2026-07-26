import assert from 'node:assert/strict';
import test from 'node:test';
import { startServerWithBuilder } from '../dist/server.js';

function captureFailure(promise) {
  return promise.then(
    () => null,
    (err) => err,
  );
}

test('partial server build failure closes the created server and preserves the startup error', async () => {
  const startupError = Object.assign(new Error('startup-secret-value'), {
    code: 'ESTARTUP',
  });
  let closeCount = 0;
  const server = {
    close: async () => {
      closeCount += 1;
    },
    listen: async () => {
      throw new Error('listen must not be called');
    },
    log: { error: () => {} },
  };

  const failure = await captureFailure(
    startServerWithBuilder(async (onServerCreated) => {
      onServerCreated(server);
      throw startupError;
    }, 0),
  );

  assert.equal(failure, startupError);
  assert.equal(closeCount, 1);
});

test('listen cleanup failure keeps the original error and logs no error details', async () => {
  const listenError = Object.assign(new Error('listen-secret-value'), {
    code: 'EADDRINUSE',
  });
  const entries = [];
  let closeCount = 0;
  const server = {
    close: async () => {
      closeCount += 1;
      throw new Error('cleanup-secret-value');
    },
    listen: async () => {
      throw listenError;
    },
    log: {
      error(details, message) {
        entries.push({ details, message });
      },
    },
  };

  const failure = await captureFailure(
    startServerWithBuilder(async (onServerCreated) => {
      onServerCreated(server);
      return server;
    }, 0),
  );

  assert.equal(failure, listenError);
  assert.equal(closeCount, 1);
  assert.deepEqual(entries, [
    {
      details: { phase: 'startup-cleanup' },
      message: 'backend startup cleanup failed',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /secret-value/);
});

test('startup cleanup timeout preserves the original error and does not hang', async () => {
  const listenError = Object.assign(new Error('listen-secret-value'), {
    code: 'EADDRINUSE',
  });
  const entries = [];
  const server = {
    close: () => new Promise(() => {}),
    listen: async () => {
      throw listenError;
    },
    log: {
      error(details, message) {
        entries.push({ details, message });
      },
    },
  };
  const startedAt = process.hrtime.bigint();

  const failure = await captureFailure(
    startServerWithBuilder(async (onServerCreated) => {
      onServerCreated(server);
      return server;
    }, 0, 20),
  );
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  assert.equal(failure, listenError);
  assert.ok(durationMs < 1000, `startup cleanup took ${durationMs.toFixed(1)}ms`);
  assert.deepEqual(entries, [
    {
      details: { phase: 'startup-cleanup', timeoutMs: 20 },
      message: 'backend startup cleanup timed out',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /secret-value/);
});
