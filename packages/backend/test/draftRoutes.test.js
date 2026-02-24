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

const invoiceFixture = {
  id: 'inv-001',
  projectId: 'proj-001',
  invoiceNo: 'INV-2026-0001',
  currency: 'JPY',
  totalAmount: { toString: () => '120000' },
  issueDate: new Date('2026-02-01T00:00:00.000Z'),
  dueDate: new Date('2026-02-20T00:00:00.000Z'),
  project: {
    id: 'proj-001',
    code: 'PRJ-001',
    name: 'A案件',
    customer: {
      id: 'cust-001',
      name: '株式会社サンプル',
    },
  },
};

test('POST /drafts generates invoice send draft with metadata', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedAudit = null;
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => invoiceFixture,
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-draft-001' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            kind: 'invoice_send',
            targetId: 'inv-001',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.kind, 'invoice_send');
        assert.match(String(body?.draft?.subject ?? ''), /INV-2026-0001/);
        assert.match(String(body?.draft?.body ?? ''), /請求書/);
        assert.equal(body?.metadata?.targetTable, 'invoices');
        assert.equal(body?.metadata?.targetId, 'inv-001');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedAudit?.data?.action, 'draft_generated');
});

test('POST /drafts/regenerate returns subject/body diff', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedAudit = null;
  await withPrismaStubs(
    {
      'invoice.findUnique': async () => invoiceFixture,
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-draft-002' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts/regenerate',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            kind: 'invoice_send',
            targetId: 'inv-001',
            instruction: '入金期限を明確に記載してください',
            previous: {
              subject: '【請求書送付案】INV-2026-0001',
              body: '旧文面',
            },
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.kind, 'invoice_send');
        assert.equal(body.diff.hasChanges, true);
        assert.ok(Number(body.diff.changeCount) > 0);
        assert.equal(
          Array.isArray(body.diff.changes) &&
            body.diff.changes.some((item) => item.field === 'body'),
          true,
        );
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedAudit?.data?.action, 'draft_regenerated');
});

test('POST /drafts/diff returns changed fields', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedAudit = null;
  await withPrismaStubs(
    {
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-draft-003' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts/diff',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            before: {
              subject: '件名A',
              body: '本文A',
            },
            after: {
              subject: '件名A',
              body: '本文B',
            },
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.hasChanges, true);
        assert.equal(body.changeCount, 1);
        assert.equal(body.changes[0]?.field, 'body');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedAudit?.data?.action, 'draft_diff_viewed');
});

test('POST /drafts returns target_required for invoice_send without targetId', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/drafts',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
        payload: {
          kind: 'invoice_send',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      const errorCode =
        typeof body.error === 'string' ? body.error : body?.error?.code;
      assert.equal(errorCode, 'target_required');
    } finally {
      await server.close();
    }
  });
});

test('POST /drafts generates notification_report without targetId', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedAudit = null;
  await withPrismaStubs(
    {
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-draft-004' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            kind: 'notification_report',
            context: {
              reportName: '月次サマリ',
              period: '2026-02',
              highlights: ['売上増', '原価減'],
            },
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.kind, 'notification_report');
        assert.match(String(body?.draft?.subject ?? ''), /月次サマリ/);
        assert.match(String(body?.draft?.body ?? ''), /売上増/);
        assert.equal(body?.metadata?.targetTable, 'report_notifications');
        assert.match(String(body?.metadata?.targetId ?? ''), /^report-/);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedAudit?.data?.action, 'draft_generated');
});

test('POST /drafts returns 403 for non-admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/drafts',
        headers: {
          'x-user-id': 'normal-user',
          'x-roles': 'user',
        },
        payload: {
          kind: 'notification_report',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
    } finally {
      await server.close();
    }
  });
});

test('POST /drafts returns 404 when approval target does not exist', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            kind: 'approval_request',
            targetId: 'approval-unknown',
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'not_found');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /drafts/regenerate returns target_required without targetId for approval_request', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/drafts/regenerate',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
        payload: {
          kind: 'approval_request',
          previous: {
            subject: '旧件名',
            body: '旧本文',
          },
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      const errorCode =
        typeof body.error === 'string' ? body.error : body?.error?.code;
      assert.equal(errorCode, 'target_required');
    } finally {
      await server.close();
    }
  });
});

test('POST /drafts/regenerate returns 404 when approval target does not exist', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/drafts/regenerate',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            kind: 'approval_request',
            targetId: 'approval-unknown',
            previous: {
              subject: '旧件名',
              body: '旧本文',
            },
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'not_found');
      } finally {
        await server.close();
      }
    },
  );
});
