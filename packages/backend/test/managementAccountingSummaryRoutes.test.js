import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
process.env.AUTH_MODE = 'header';

const { buildServer } = await import('../dist/server.js');
const { prisma } = await import('../dist/services/db.js');

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

test('GET /reports/management-accounting/summary returns aggregate management accounting metrics', async () => {
  await withPrismaStubs(
    {
      'project.findMany': async () => [
        { id: 'project-1', code: 'PRJ-001', name: 'Project 1' },
        { id: 'project-2', code: 'PRJ-002', name: 'Project 2' },
      ],
      'invoice.groupBy': async () => [
        { projectId: 'project-1', _sum: { totalAmount: 10000 } },
        { projectId: 'project-2', _sum: { totalAmount: 500 } },
      ],
      'vendorInvoice.groupBy': async () => [
        { projectId: 'project-1', _sum: { totalAmount: 3000 } },
      ],
      'expense.groupBy': async () => [
        { projectId: 'project-1', _sum: { amount: 500 } },
        { projectId: 'project-2', _sum: { amount: 700 } },
      ],
      'timeEntry.findMany': async () => [
        {
          projectId: 'project-1',
          userId: 'user-1',
          workDate: new Date('2026-03-10T00:00:00.000Z'),
          workType: null,
          minutes: 600,
        },
        {
          projectId: 'project-2',
          userId: 'user-1',
          workDate: new Date('2026-03-10T00:00:00.000Z'),
          workType: null,
          minutes: 540,
        },
        {
          projectId: 'project-2',
          userId: 'user-2',
          workDate: new Date('2026-03-11T00:00:00.000Z'),
          workType: null,
          minutes: 480,
        },
      ],
      'rateCard.findMany': async (args) => {
        const projectIds = new Set(
          (args?.where?.AND?.[1]?.OR ?? []).map((item) => item.projectId),
        );
        if (projectIds.has('project-1')) {
          return [
            {
              id: 'rate-1',
              projectId: 'project-1',
              workType: null,
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              validTo: null,
              unitPrice: 100,
            },
          ];
        }
        return [
          {
            id: 'rate-2',
            projectId: 'project-2',
            workType: null,
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validTo: null,
            unitPrice: 50,
          },
        ];
      },
      'projectMilestone.findMany': async () => [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: '請求待ち',
          amount: 2000,
          dueDate: new Date('2026-03-20T00:00:00.000Z'),
          project: { code: 'PRJ-001', name: 'Project 1' },
          invoices: [],
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/reports/management-accounting/summary?from=2026-03-01&to=2026-03-31',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.projectCount, 2);
        assert.equal(body.revenue, 10500);
        assert.equal(body.directCost, 6050);
        assert.equal(body.laborCost, 1850);
        assert.equal(body.vendorCost, 3000);
        assert.equal(body.expenseCost, 1200);
        assert.equal(body.grossProfit, 4450);
        assert.equal(body.totalMinutes, 1620);
        assert.equal(body.overtimeTotalMinutes, 660);
        assert.equal(body.deliveryDueCount, 1);
        assert.equal(body.deliveryDueAmount, 2000);
        assert.equal(body.redProjectCount, 1);
        assert.equal(body.topRedProjects.length, 1);
        assert.equal(body.topRedProjects[0].projectId, 'project-2');
        assert.equal(body.topRedProjects[0].grossProfit, -1050);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /reports/management-accounting/summary returns 400 when from/to are invalid', async () => {
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/reports/management-accounting/summary?from=2026-03-40&to=2026-03-31',
      headers: {
        'x-user-id': 'admin-user',
        'x-roles': 'admin',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.error?.code, 'INVALID_DATE');
  } finally {
    await server.close();
  }
});
