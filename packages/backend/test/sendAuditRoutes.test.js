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
      target = prisma;
      method = parts[0];
    } else {
      const [model, member] = parts;
      target = prisma[model];
      method = member;
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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function invoiceDraft() {
  return {
    id: 'inv-001',
    status: 'approved',
    projectId: 'proj-001',
    invoiceNo: 'INV-001',
  };
}

function createTransactionStub() {
  return async (callback) => callback(prisma);
}

function auditByAction(entries, action) {
  return entries.filter((entry) => entry?.action === action);
}

test('POST /invoices/:id/send logs requested/completed audit with sendLogId', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'off',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
      MAIL_TRANSPORT: 'stub',
    },
    async () => {
      const sendLogs = [];
      const auditEntries = [];
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceDraft(),
          'invoice.update': async ({ data }) => ({
            ...invoiceDraft(),
            status: data.status,
            pdfUrl: data.pdfUrl,
            emailMessageId: data.emailMessageId,
          }),
          'actionPolicy.findMany': async () => [],
          'docTemplateSetting.findFirst': async () => null,
          'documentSendLog.create': async ({ data }) => {
            const id = `send-log-${sendLogs.length + 1}`;
            sendLogs.push({ id, data });
            return { id };
          },
          'documentSendLog.update': async () => ({}),
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
              url: '/invoices/inv-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 200, res.body);
          } finally {
            await server.close();
          }
        },
      );

      const requested = auditByAction(auditEntries, 'document_send_requested');
      const completed = auditByAction(auditEntries, 'document_send_completed');
      assert.equal(requested.length, 1);
      assert.equal(completed.length, 1);
      assert.equal(requested[0]?.targetTable, 'invoices');
      assert.equal(requested[0]?.targetId, 'inv-001');
      assert.equal(requested[0]?.metadata?.sendLogId, 'send-log-1');
      assert.equal(requested[0]?.metadata?.status, 'requested');
      assert.equal(completed[0]?.metadata?.sendLogId, 'send-log-1');
      assert.equal(completed[0]?.metadata?.status, 'stub');
      assert.equal(completed[0]?.metadata?.channel, 'email');
      assert.ok(
        typeof completed[0]?.metadata?._request?.id === 'string' &&
          completed[0].metadata._request.id.length > 0,
      );
      assert.equal(completed[0]?.metadata?._request?.source, 'api');
      assert.equal(completed[0]?.metadata?._auth?.principalUserId, 'admin-user');
      assert.equal(completed[0]?.metadata?._auth?.actorUserId, 'admin-user');
    },
  );
});

test('POST /invoices/:id/send logs failed audit when mail delivery fails', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'off',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_SECURE: 'false',
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
    },
    async () => {
      const auditEntries = [];
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceDraft(),
          'invoice.update': async ({ data }) => ({
            ...invoiceDraft(),
            status: data.status,
            pdfUrl: data.pdfUrl,
            emailMessageId: data.emailMessageId,
          }),
          'actionPolicy.findMany': async () => [],
          'docTemplateSetting.findFirst': async () => null,
          'documentSendLog.create': async () => ({ id: 'send-log-1' }),
          'documentSendLog.update': async () => ({}),
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
              url: '/invoices/inv-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 200, res.body);
          } finally {
            await server.close();
          }
        },
      );

      const failed = auditByAction(auditEntries, 'document_send_failed');
      assert.equal(failed.length, 1);
      assert.equal(failed[0]?.metadata?.sendLogId, 'send-log-1');
      assert.equal(failed[0]?.metadata?.status, 'failed');
      assert.ok(
        typeof failed[0]?.metadata?.error === 'string' &&
          failed[0].metadata.error.length > 0,
      );
    },
  );
});

test('POST /document-send-logs/:id/retry logs retried/completed audit with retryOf', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'off',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
      MAIL_TRANSPORT: 'stub',
      SEND_LOG_RETRY_COOLDOWN_MINUTES: '0',
    },
    async () => {
      const auditEntries = [];
      await withPrismaStubs(
        {
          'documentSendLog.findUnique': async () => ({
            id: 'send-log-1',
            kind: 'invoice',
            targetTable: 'invoices',
            targetId: 'inv-001',
            status: 'failed',
            recipients: ['fin@example.com'],
            templateId: 'invoice-default',
            metadata: {},
            updatedAt: new Date(0),
            createdAt: new Date(0),
          }),
          'documentSendEvent.findFirst': async () => null,
          'invoice.findUnique': async () => invoiceDraft(),
          'invoice.update': async ({ data }) => ({
            ...invoiceDraft(),
            status: data.status,
            pdfUrl: data.pdfUrl,
            emailMessageId: data.emailMessageId,
          }),
          'docTemplateSetting.findFirst': async () => null,
          'documentSendLog.create': async () => ({ id: 'retry-log-1' }),
          'documentSendLog.update': async () => ({}),
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
              url: '/document-send-logs/send-log-1/retry',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload.retryLogId, 'retry-log-1');
          } finally {
            await server.close();
          }
        },
      );

      const retried = auditByAction(auditEntries, 'document_send_retried');
      const completed = auditByAction(auditEntries, 'document_send_completed');
      assert.equal(retried.length, 1);
      assert.equal(completed.length, 1);
      assert.equal(retried[0]?.metadata?.sendLogId, 'retry-log-1');
      assert.equal(retried[0]?.metadata?.retryOf, 'send-log-1');
      assert.equal(retried[0]?.metadata?.status, 'requested');
      assert.equal(completed[0]?.metadata?.sendLogId, 'retry-log-1');
      assert.equal(completed[0]?.metadata?.retryOf, 'send-log-1');
      assert.equal(completed[0]?.metadata?.status, 'stub');
    },
  );
});
