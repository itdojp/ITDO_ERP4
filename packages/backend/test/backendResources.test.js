import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackendResourceCleanupError,
  closeBackendResources,
} from '../dist/backendResources.js';

test('backend resource cleanup closes notifier, Prisma, and owned Redis', async () => {
  const calls = [];
  await closeBackendResources({
    closeNotifier: async () => calls.push('notifier'),
    disconnectPrisma: async () => calls.push('prisma'),
    rateLimitRedisClient: {
      quit: async () => calls.push('redis-quit'),
      disconnect: () => calls.push('redis-disconnect'),
    },
  });

  assert.deepEqual(calls.sort(), ['notifier', 'prisma', 'redis-quit']);
});

test('backend resource cleanup attempts every close and reports only safe resource names', async () => {
  const secret = 'resource-cleanup-secret-value';
  let redisDisconnected = 0;
  const failure = await closeBackendResources({
    closeNotifier: async () => {
      throw new Error(secret);
    },
    disconnectPrisma: async () => {
      throw new Error(secret);
    },
    rateLimitRedisClient: {
      quit: async () => {
        throw Object.assign(new Error(secret), { code: secret });
      },
      disconnect: () => {
        redisDisconnected += 1;
      },
    },
  }).then(
    () => null,
    (err) => err,
  );

  assert.ok(failure instanceof BackendResourceCleanupError);
  assert.deepEqual(failure.resources, [
    'notifier',
    'prisma',
    'rate-limit-redis',
  ]);
  assert.equal(redisDisconnected, 1);
  assert.equal(JSON.stringify(failure).includes(secret), false);
});
