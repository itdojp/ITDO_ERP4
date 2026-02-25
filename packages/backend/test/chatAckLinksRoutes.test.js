import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
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

function withAuthEnv(fn) {
  const prevDatabaseUrl = process.env.DATABASE_URL;
  const prevAuthMode = process.env.AUTH_MODE;
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = prevDatabaseUrl;
      }
      if (prevAuthMode === undefined) {
        delete process.env.AUTH_MODE;
      } else {
        process.env.AUTH_MODE = prevAuthMode;
      }
    });
}

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
}

test('GET /chat-ack-links denies non admin/mgmt role', async () => {
  await withAuthEnv(async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/chat-ack-links?ackRequestId=ack-001',
        headers: userHeaders(),
      });
      assert.equal(res.statusCode, 403, res.body);
    } finally {
      await server.close();
    }
  });
});

test('GET /chat-ack-links returns MISSING_QUERY when query values are blank', async () => {
  await withAuthEnv(async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/chat-ack-links?ackRequestId=%20%20',
        headers: adminHeaders(),
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error?.code, 'MISSING_QUERY');
    } finally {
      await server.close();
    }
  });
});

test('GET /chat-ack-links validates targetId when targetTable is provided', async () => {
  await withAuthEnv(async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/chat-ack-links?ackRequestId=ack-001&targetTable=approval_instances&targetId=%20%20',
        headers: adminHeaders(),
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error?.code, 'INVALID_QUERY');
    } finally {
      await server.close();
    }
  });
});

test('GET /chat-ack-links rejects disallowed targetTable', async () => {
  await withAuthEnv(async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/chat-ack-links?targetTable=vendor_invoices&targetId=vi-001',
        headers: adminHeaders(),
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error?.code, 'INVALID_TARGET_TABLE');
    } finally {
      await server.close();
    }
  });
});

test('GET /chat-ack-links applies query filters and limit clamp', async () => {
  await withAuthEnv(async () => {
    let capturedArgs = null;
    await withPrismaStubs(
      {
        'chatAckLink.findMany': async (args) => {
          capturedArgs = args;
          return [{ id: 'link-001', ackRequestId: 'ack-001' }];
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'GET',
            url: '/chat-ack-links?ackRequestId=ack-001&limit=999',
            headers: adminHeaders(),
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(Array.isArray(body?.items), true);
          assert.equal(body.items.length, 1);
          assert.equal(capturedArgs?.where?.ackRequestId, 'ack-001');
          assert.equal(capturedArgs?.take, 200);
          assert.deepEqual(capturedArgs?.orderBy, { createdAt: 'desc' });
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /chat-ack-links returns TARGET_NOT_FOUND when target does not exist', async () => {
  await withAuthEnv(async () => {
    await withPrismaStubs(
      {
        'approvalInstance.findUnique': async () => null,
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/chat-ack-links',
            headers: adminHeaders(),
            payload: {
              ackRequestId: 'ack-001',
              targetTable: 'approval_instances',
              targetId: 'approval-missing',
            },
          });
          assert.equal(res.statusCode, 404, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body?.error?.code, 'TARGET_NOT_FOUND');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /chat-ack-links returns ACK_REQUEST_CANCELED for canceled request', async () => {
  await withAuthEnv(async () => {
    await withPrismaStubs(
      {
        'approvalInstance.findUnique': async () => ({ id: 'approval-001' }),
        'chatAckRequest.findUnique': async () => ({
          id: 'ack-001',
          messageId: 'msg-001',
          canceledAt: new Date('2026-02-25T00:00:00.000Z'),
          message: { deletedAt: null },
        }),
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/chat-ack-links',
            headers: adminHeaders(),
            payload: {
              ackRequestId: 'ack-001',
              targetTable: 'approval_instances',
              targetId: 'approval-001',
            },
          });
          assert.equal(res.statusCode, 409, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body?.error?.code, 'ACK_REQUEST_CANCELED');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /chat-ack-links creates link and writes audit log', async () => {
  await withAuthEnv(async () => {
    let capturedCreateArgs = null;
    let capturedAuditArgs = null;
    await withPrismaStubs(
      {
        'approvalInstance.findUnique': async () => ({ id: 'approval-001' }),
        'chatAckRequest.findUnique': async () => ({
          id: 'ack-001',
          messageId: 'msg-001',
          canceledAt: null,
          message: { deletedAt: null },
        }),
        'chatAckLink.create': async (args) => {
          capturedCreateArgs = args;
          return {
            id: 'link-001',
            ackRequestId: 'ack-001',
            messageId: 'msg-001',
            targetTable: 'approval_instances',
            targetId: 'approval-001',
            flowType: 'expense',
            actionKey: 'submit',
            createdBy: 'admin-user',
            updatedBy: 'admin-user',
          };
        },
        'auditLog.create': async (args) => {
          capturedAuditArgs = args;
          return { id: 'audit-001' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/chat-ack-links',
            headers: adminHeaders(),
            payload: {
              ackRequestId: 'ack-001',
              targetTable: 'approval_instances',
              targetId: 'approval-001',
              flowType: 'expense',
              actionKey: 'submit',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body?.id, 'link-001');
          assert.equal(capturedCreateArgs?.data?.ackRequestId, 'ack-001');
          assert.equal(
            capturedCreateArgs?.data?.targetTable,
            'approval_instances',
          );
          assert.equal(capturedCreateArgs?.data?.targetId, 'approval-001');
          assert.equal(capturedCreateArgs?.data?.flowType, 'expense');
          assert.equal(capturedCreateArgs?.data?.actionKey, 'submit');
          assert.equal(capturedAuditArgs?.data?.action, 'chat_ack_link_created');
          assert.equal(capturedAuditArgs?.data?.targetTable, 'chat_ack_links');
          assert.equal(capturedAuditArgs?.data?.targetId, 'link-001');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('DELETE /chat-ack-links/:id returns NOT_FOUND when link is absent', async () => {
  await withAuthEnv(async () => {
    await withPrismaStubs(
      {
        'chatAckLink.findUnique': async () => null,
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'DELETE',
            url: '/chat-ack-links/link-missing',
            headers: adminHeaders(),
          });
          assert.equal(res.statusCode, 404, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body?.error?.code, 'NOT_FOUND');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('DELETE /chat-ack-links/:id deletes link and writes audit log', async () => {
  await withAuthEnv(async () => {
    let capturedDeleteArgs = null;
    let capturedAuditArgs = null;
    await withPrismaStubs(
      {
        'chatAckLink.findUnique': async () => ({
          id: 'link-001',
          ackRequestId: 'ack-001',
          messageId: 'msg-001',
          targetTable: 'approval_instances',
          targetId: 'approval-001',
          flowType: null,
          actionKey: null,
        }),
        'chatAckLink.delete': async (args) => {
          capturedDeleteArgs = args;
          return { id: 'link-001' };
        },
        'auditLog.create': async (args) => {
          capturedAuditArgs = args;
          return { id: 'audit-001' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'DELETE',
            url: '/chat-ack-links/link-001',
            headers: adminHeaders(),
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body?.ok, true);
          assert.equal(capturedDeleteArgs?.where?.id, 'link-001');
          assert.equal(capturedAuditArgs?.data?.action, 'chat_ack_link_deleted');
          assert.equal(capturedAuditArgs?.data?.targetTable, 'chat_ack_links');
          assert.equal(capturedAuditArgs?.data?.targetId, 'link-001');
        } finally {
          await server.close();
        }
      },
    );
  });
});
