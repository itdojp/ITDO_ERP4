import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function expenseDraft(overrides = {}) {
  return {
    id: 'exp-001',
    userId: 'user-001',
    projectId: 'proj-001',
    amount: 12000,
    currency: 'JPY',
    incurredOn: new Date('2026-01-15T00:00:00.000Z'),
    status: 'draft',
    settlementStatus: 'unpaid',
    receiptUrl: 'https://example.com/receipt.pdf',
    deletedAt: null,
    paidAt: null,
    paidBy: null,
    updatedBy: 'seed-user',
    ...overrides,
  };
}

async function withServer(fn) {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

test('POST /expenses/:id/reassign rejects invalid status before guard evaluation', async () => {
  let approvalFindFirstCalled = 0;
  await withPrismaStubs(
    {
      'expense.findUnique': async () => expenseDraft({ status: 'approved' }),
      'approvalInstance.findFirst': async () => {
        approvalFindFirstCalled += 1;
        return null;
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/expenses/exp-001/reassign',
          headers: adminHeaders(),
          payload: {
            toProjectId: 'proj-002',
            reasonCode: 'project_misassignment',
            reasonText: 'move to correct project',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_STATUS');
        assert.equal(approvalFindFirstCalled, 0);
      });
    },
  );
});

test('POST /expenses/:id/reassign maps approval_open guard failure to PENDING_APPROVAL', async () => {
  let projectLookupCalled = 0;
  await withPrismaStubs(
    {
      'expense.findUnique': async () => expenseDraft(),
      'approvalInstance.findFirst': async (args) => {
        assert.equal(args.where.flowType, 'expense');
        assert.equal(args.where.targetTable, 'expenses');
        assert.equal(args.where.targetId, 'exp-001');
        return { id: 'approval-001', status: 'pending_qa' };
      },
      'project.findUnique': async () => {
        projectLookupCalled += 1;
        return { id: 'proj-002', deletedAt: null };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/expenses/exp-001/reassign',
          headers: adminHeaders(),
          payload: {
            toProjectId: 'proj-002',
            reasonCode: 'project_misassignment',
            reasonText: 'move to correct project',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'PENDING_APPROVAL');
        assert.equal(projectLookupCalled, 0);
      });
    },
  );
});

test('POST /expenses/:id/reassign maps period_lock guard failure to PERIOD_LOCKED', async () => {
  let periodFindManyCalled = 0;
  await withPrismaStubs(
    {
      'expense.findUnique': async () => expenseDraft(),
      'approvalInstance.findFirst': async () => null,
      'project.findUnique': async () => ({ id: 'proj-002', deletedAt: null }),
      'periodLock.findFirst': async () => {
        throw new Error('unexpected findFirst call');
      },
      'periodLock.findMany': async (args) => {
        periodFindManyCalled += 1;
        assert.deepEqual(args.where.period.in, ['2026-01']);
        assert.deepEqual(args.where.OR, [
          { scope: 'global' },
          { scope: 'project', projectId: { in: ['proj-001', 'proj-002'] } },
        ]);
        return [
          {
            id: 'lock-001',
            scope: 'project',
            projectId: 'proj-002',
            period: '2026-01',
          },
        ];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/expenses/exp-001/reassign',
          headers: adminHeaders(),
          payload: {
            toProjectId: 'proj-002',
            reasonCode: 'project_misassignment',
            reasonText: 'move to correct project',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'PERIOD_LOCKED');
        assert.equal(periodFindManyCalled, 1);
      });
    },
  );
});

test('POST /expenses/:id/reassign updates project and writes logs when guards pass', async () => {
  const auditActions = [];
  const reassignmentEntries = [];
  let updateCalled = 0;
  await withPrismaStubs(
    {
      'expense.findUnique': async () => expenseDraft(),
      'approvalInstance.findFirst': async () => null,
      'project.findUnique': async () => ({ id: 'proj-002', deletedAt: null }),
      'periodLock.findMany': async () => [],
      'expense.update': async ({ where, data }) => {
        updateCalled += 1;
        return {
          ...expenseDraft(),
          id: where.id,
          projectId: data.projectId,
        };
      },
      'auditLog.create': async ({ data }) => {
        auditActions.push(data.action);
        return { id: `audit-${auditActions.length}` };
      },
      'reassignmentLog.create': async ({ data }) => {
        reassignmentEntries.push(data);
        return { id: `reassignment-${reassignmentEntries.length}` };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/expenses/exp-001/reassign',
          headers: adminHeaders(),
          payload: {
            toProjectId: 'proj-002',
            reasonCode: 'project_misassignment',
            reasonText: 'move to correct project',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.id, 'exp-001');
        assert.equal(body?.projectId, 'proj-002');
        assert.equal(updateCalled, 1);
        assert.deepEqual(auditActions, ['reassignment']);
        assert.equal(reassignmentEntries.length, 1);
        assert.equal(reassignmentEntries[0]?.fromProjectId, 'proj-001');
        assert.equal(reassignmentEntries[0]?.toProjectId, 'proj-002');
      });
    },
  );
});
