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

test('GET /audit-logs filters by metadata.sendLogId', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const queries = [];
      const auditCreates = [];
      await withPrismaStubs(
        {
          'auditLog.findMany': async (args) => {
            queries.push(args);
            return [
              {
                id: 'audit-1',
                action: 'document_send_completed',
                userId: 'admin-user',
                actorRole: 'admin',
                actorGroupId: null,
                requestId: 'req-1',
                ipAddress: '127.0.0.1',
                userAgent: 'node-test',
                source: 'api',
                reasonCode: null,
                reasonText: null,
                targetTable: 'estimates',
                targetId: 'est-001',
                createdAt: new Date('2026-03-06T00:00:00Z'),
                metadata: {
                  sendLogId: 'send-log-123',
                  status: 'delivered',
                },
              },
            ];
          },
          'auditLog.create': async ({ data }) => {
            auditCreates.push(data);
            return { id: `audit-create-${auditCreates.length}` };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'GET',
              url: '/audit-logs?format=json&mask=0&sendLogId=send-log-123',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload.items?.length, 1);
            assert.equal(
              payload.items?.[0]?.metadata?.sendLogId,
              'send-log-123',
            );
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(queries.length, 1);
      assert.deepEqual(queries[0]?.where?.metadata, {
        path: ['sendLogId'],
        equals: 'send-log-123',
      });
      assert.ok(auditCreates.length >= 1);
      const exportAudit = auditCreates.find(
        (entry) => entry?.action === 'audit_log_exported',
      );
      assert.ok(exportAudit, 'Expected an audit_log_exported audit log entry');
      assert.equal(
        exportAudit?.metadata?.filters?.sendLogId,
        'send-log-123',
      );
    },
  );
});
