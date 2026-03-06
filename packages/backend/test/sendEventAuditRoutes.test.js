import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const parts = path.split('.');
    let target;
    let method;
    if (parts.length === 1) {
      const rootMethod = parts[0];
      if (!rootMethod || !rootMethod.startsWith('$')) {
        throw new Error(`invalid stub path: ${path}`);
      }
      target = prisma;
      method = rootMethod;
    } else if (parts.length === 2) {
      const [model, member] = parts;
      if (!model || !member) {
        throw new Error(`invalid stub path: ${path}`);
      }
      target = prisma[model];
      method = member;
    } else {
      throw new Error(`invalid stub path: ${path}`);
    }
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function createTransactionStub() {
  return async (callback) => callback(prisma);
}

function baseSendLog(overrides = {}) {
  return {
    id: 'send-log-1',
    kind: 'invoice',
    targetTable: 'invoices',
    targetId: 'inv-001',
    channel: 'email',
    providerMessageId: 'sg-message-1',
    status: 'requested',
    error: null,
    ...overrides,
  };
}

test('POST /webhooks/sendgrid/events logs audit for delivered milestone', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const createdEvents = [];
      const updatedLogs = [];
      const auditEntries = [];
      await withPrismaStubs(
        {
          'documentSendLog.findMany': async () => [baseSendLog()],
          'documentSendEvent.create': async ({ data }) => {
            createdEvents.push(data);
            return { id: `event-${createdEvents.length}` };
          },
          'documentSendLog.updateMany': async ({ data, where }) => {
            updatedLogs.push({ data, where });
            return { count: 1 };
          },
          'auditLog.create': async ({ data }) => {
            auditEntries.push(data);
            return { id: `audit-${auditEntries.length}` };
          },
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/webhooks/sendgrid/events',
              payload: [
                {
                  event: 'delivered',
                  timestamp: 1700000000,
                  custom_args: { sendLogId: 'send-log-1' },
                },
              ],
            });
            assert.equal(res.statusCode, 200, res.body);
            assert.deepEqual(JSON.parse(res.body), { received: 1, stored: 1 });
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(createdEvents.length, 1);
      assert.equal(createdEvents[0]?.sendLogId, 'send-log-1');
      assert.equal(createdEvents[0]?.eventType, 'delivered');
      assert.equal(updatedLogs.length, 1);
      assert.equal(updatedLogs[0]?.data?.status, 'delivered');
      assert.equal(auditEntries.length, 1);
      assert.equal(
        auditEntries[0]?.action,
        'document_send_provider_status_updated',
      );
      assert.equal(auditEntries[0]?.targetTable, 'invoices');
      assert.equal(auditEntries[0]?.targetId, 'inv-001');
      assert.equal(auditEntries[0]?.source, 'webhook');
      assert.equal(auditEntries[0]?.metadata?.sendLogId, 'send-log-1');
      assert.equal(auditEntries[0]?.metadata?.eventType, 'delivered');
      assert.equal(auditEntries[0]?.metadata?.previousStatus, 'requested');
      assert.equal(auditEntries[0]?.metadata?.nextStatus, 'delivered');
      assert.equal(
        auditEntries[0]?.metadata?.providerMessageId,
        'sg-message-1',
      );
    },
  );
});

test('POST /webhooks/sendgrid/events does not write audit for open-only event', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const auditEntries = [];
      const updatedLogs = [];
      await withPrismaStubs(
        {
          'documentSendLog.findMany': async () => [baseSendLog()],
          'documentSendEvent.create': async () => ({ id: 'event-1' }),
          'documentSendLog.updateMany': async ({ data }) => {
            updatedLogs.push(data);
            return { count: 1 };
          },
          'auditLog.create': async ({ data }) => {
            auditEntries.push(data);
            return { id: `audit-${auditEntries.length}` };
          },
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/webhooks/sendgrid/events',
              payload: [
                {
                  event: 'open',
                  timestamp: 1700000001,
                  custom_args: { sendLogId: 'send-log-1' },
                },
              ],
            });
            assert.equal(res.statusCode, 200, res.body);
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(updatedLogs.length, 1);
      assert.equal(updatedLogs[0]?.status, 'opened');
      assert.equal(auditEntries.length, 0);
    },
  );
});

test('POST /webhooks/sendgrid/events logs audit for bounce resolved by sg_message_id', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const auditEntries = [];
      const updatedLogs = [];
      await withPrismaStubs(
        {
          'documentSendLog.findMany': async () => [
            baseSendLog({
              id: 'send-log-bounce',
              targetId: 'inv-002',
              providerMessageId: 'smtp:sg-message-2.filter',
            }),
          ],
          'documentSendEvent.create': async () => ({ id: 'event-1' }),
          'documentSendLog.updateMany': async ({ data, where }) => {
            updatedLogs.push({ data, where });
            return { count: 1 };
          },
          'auditLog.create': async ({ data }) => {
            auditEntries.push(data);
            return { id: `audit-${auditEntries.length}` };
          },
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/webhooks/sendgrid/events',
              payload: [
                {
                  event: 'bounce',
                  sg_message_id: 'sg-message-2',
                  timestamp: 1700000002,
                },
              ],
            });
            assert.equal(res.statusCode, 200, res.body);
            assert.deepEqual(JSON.parse(res.body), { received: 1, stored: 1 });
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(updatedLogs.length, 1);
      assert.equal(updatedLogs[0]?.data?.status, 'bounced');
      assert.equal(updatedLogs[0]?.data?.error, 'sendgrid_bounce');
      assert.equal(auditEntries.length, 1);
      assert.equal(auditEntries[0]?.metadata?.sendLogId, 'send-log-bounce');
      assert.equal(auditEntries[0]?.metadata?.eventType, 'bounce');
      assert.equal(auditEntries[0]?.metadata?.nextStatus, 'bounced');
      assert.equal(auditEntries[0]?.metadata?.error, 'sendgrid_bounce');
      assert.equal(
        auditEntries[0]?.metadata?.providerMessageId,
        'smtp:sg-message-2.filter',
      );
    },
  );
});
