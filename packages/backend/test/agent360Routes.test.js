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

test('GET /project-360 returns aggregated response', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'project.groupBy': async () => [
        { status: 'active', _count: { _all: 2 } },
        { status: 'closed', _count: { _all: 1 } },
      ],
      'invoice.groupBy': async () => [
        { status: 'approved', _count: { _all: 3 }, _sum: { totalAmount: 900 } },
      ],
      'timeEntry.groupBy': async () => [
        { status: 'approved', _count: { _all: 5 }, _sum: { minutes: 600 } },
      ],
      'expense.groupBy': async () => [
        { status: 'approved', _count: { _all: 2 }, _sum: { amount: 300 } },
      ],
      'approvalInstance.groupBy': async (args) => {
        assert.deepEqual(args.where?.status, { in: ['pending_qa', 'pending_exec'] });
        return [{ status: 'pending_qa', flowType: 'invoice', _count: { _all: 2 } }];
      },
      'auditLog.create': async () => ({ id: 'audit-1' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/project-360',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.projects.total, 3);
        assert.equal(body.billing.totalAmount, 900);
        assert.equal(body.effort.timeEntries.totalMinutes, 600);
        assert.equal(body.approvals.pendingTotal, 2);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /billing-360 returns receivable/payable summary', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'invoice.groupBy': async (args) => {
        const lte = args.where?.issueDate?.lte;
        assert.equal(lte instanceof Date, true);
        if (lte instanceof Date) {
          assert.equal(lte.getUTCHours(), 23);
          assert.equal(lte.getUTCMinutes(), 59);
        }
        return [
          { status: 'approved', _count: { _all: 2 }, _sum: { totalAmount: 800 } },
          { status: 'paid', _count: { _all: 1 }, _sum: { totalAmount: 200 } },
        ];
      },
      'invoice.aggregate': async (args) => {
        const where = args?.where || {};
        if (where.status?.in) {
          return { _sum: { totalAmount: 800 }, _count: { id: 2 } };
        }
        if (where.status === 'paid') {
          return { _sum: { totalAmount: 200 }, _count: { id: 1 } };
        }
        return { _sum: { totalAmount: 300 }, _count: { id: 1 } };
      },
      'vendorInvoice.groupBy': async () => [
        { status: 'received', _count: { _all: 1 }, _sum: { totalAmount: 120 } },
        { status: 'approved', _count: { _all: 1 }, _sum: { totalAmount: 180 } },
      ],
      'auditLog.create': async () => ({ id: 'audit-2' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/billing-360?to=2026-02-23',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.receivables.openAmount, 800);
        assert.equal(body.receivables.paidAmount, 200);
        assert.equal(body.payables.openAmount, 300);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /project-360 rejects project outside user scope', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'projectMember.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/project-360?projectId=p2',
          headers: {
            'x-user-id': 'normal-user',
            'x-roles': 'user',
            'x-project-ids': 'p1',
          },
        });

        assert.equal(res.statusCode, 403);
        const body = JSON.parse(res.body);
        assert.equal(body.error?.code, 'forbidden_project');
      } finally {
        await server.close();
      }
    },
  );
});
