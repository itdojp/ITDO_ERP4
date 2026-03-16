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
        {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Project 1',
          currency: 'JPY',
        },
        {
          id: 'project-2',
          code: 'PRJ-002',
          name: 'Project 2',
          currency: 'JPY',
        },
      ],
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 10000 },
        },
        { projectId: 'project-2', currency: 'JPY', _sum: { totalAmount: 500 } },
      ],
      'vendorInvoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 3000 },
        },
      ],
      'expense.groupBy': async () => [
        { projectId: 'project-1', currency: 'JPY', _sum: { amount: 500 } },
        { projectId: 'project-2', currency: 'JPY', _sum: { amount: 700 } },
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
      'rateCard.findMany': async () => [
        {
          id: 'rate-1',
          projectId: 'project-1',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 100,
          currency: 'JPY',
        },
        {
          id: 'rate-2',
          projectId: 'project-2',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 50,
          currency: 'JPY',
        },
      ],
      'projectMilestone.findMany': async () => [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: '請求待ち',
          amount: 2000,
          dueDate: new Date('2026-03-20T00:00:00.000Z'),
          project: { code: 'PRJ-001', name: 'Project 1', currency: 'JPY' },
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
        assert.equal(body.currency, 'JPY');
        assert.equal(body.mixedCurrency, false);
        assert.equal(body.currencyBreakdown.length, 1);
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

test('GET /reports/management-accounting/summary returns csv export', async () => {
  await withPrismaStubs(
    {
      'project.findMany': async () => [
        {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Project 1',
          currency: 'JPY',
        },
        {
          id: 'project-2',
          code: 'PRJ-002',
          name: 'Project 2',
          currency: 'JPY',
        },
      ],
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 10000 },
        },
        { projectId: 'project-2', currency: 'JPY', _sum: { totalAmount: 500 } },
      ],
      'vendorInvoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 3000 },
        },
      ],
      'expense.groupBy': async () => [
        { projectId: 'project-1', currency: 'JPY', _sum: { amount: 500 } },
        { projectId: 'project-2', currency: 'JPY', _sum: { amount: 700 } },
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
      'rateCard.findMany': async () => [
        {
          id: 'rate-1',
          projectId: 'project-1',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 100,
          currency: 'JPY',
        },
        {
          id: 'rate-2',
          projectId: 'project-2',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 50,
          currency: 'JPY',
        },
      ],
      'projectMilestone.findMany': async () => [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: '請求待ち',
          amount: 2000,
          dueDate: new Date('2026-03-20T00:00:00.000Z'),
          project: { code: 'PRJ-001', name: 'Project 1', currency: 'JPY' },
          invoices: [],
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/reports/management-accounting/summary?from=2026-03-01&to=2026-03-31&format=csv',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          res.headers['content-disposition'],
          /management-accounting-summary-2026-03-01-to-2026-03-31\.csv/,
        );
        assert.match(
          res.body,
          /^section,currency,projectId,projectCode,projectName,projectCount,revenue,directCost,laborCost,vendorCost,expenseCost,grossProfit,grossMargin,totalMinutes,overtimeTotalMinutes,deliveryDueCount,deliveryDueAmount,redProjectCount/m,
        );
        assert.match(res.body, /summary,JPY,,,/, res.body);
        assert.match(
          res.body,
          /top_red_project,JPY,project-2,PRJ-002,Project 2/,
        );
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /reports/management-accounting/summary returns currency breakdown when multiple currencies exist', async () => {
  await withPrismaStubs(
    {
      'project.findMany': async () => [
        {
          id: 'project-jpy',
          code: 'PRJ-JPY',
          name: 'Project JPY',
          currency: 'JPY',
        },
        {
          id: 'project-usd',
          code: 'PRJ-USD',
          name: 'Project USD',
          currency: 'USD',
        },
      ],
      'invoice.groupBy': async () => [
        {
          projectId: 'project-jpy',
          currency: 'JPY',
          _sum: { totalAmount: 12000 },
        },
        {
          projectId: 'project-usd',
          currency: 'USD',
          _sum: { totalAmount: 1000 },
        },
      ],
      'vendorInvoice.groupBy': async () => [
        {
          projectId: 'project-jpy',
          currency: 'JPY',
          _sum: { totalAmount: 4000 },
        },
      ],
      'expense.groupBy': async () => [
        {
          projectId: 'project-usd',
          currency: 'USD',
          _sum: { amount: 1200 },
        },
      ],
      'timeEntry.findMany': async () => [
        {
          projectId: 'project-jpy',
          userId: 'user-1',
          workDate: new Date('2026-03-10T00:00:00.000Z'),
          workType: null,
          minutes: 480,
        },
        {
          projectId: 'project-usd',
          userId: 'user-2',
          workDate: new Date('2026-03-11T00:00:00.000Z'),
          workType: null,
          minutes: 600,
        },
      ],
      'rateCard.findMany': async () => [
        {
          id: 'rate-jpy',
          projectId: 'project-jpy',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 100,
          currency: 'JPY',
        },
        {
          id: 'rate-usd',
          projectId: 'project-usd',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 2,
          currency: 'USD',
        },
      ],
      'projectMilestone.findMany': async () => [
        {
          id: 'milestone-usd',
          projectId: 'project-usd',
          name: '請求待ち',
          amount: 300,
          dueDate: new Date('2026-03-20T00:00:00.000Z'),
          project: { code: 'PRJ-USD', name: 'Project USD', currency: 'USD' },
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
        assert.equal(body.mixedCurrency, true);
        assert.equal(body.currency, null);
        assert.equal(body.revenue, null);
        assert.equal(body.directCost, null);
        assert.equal(body.grossProfit, null);
        assert.equal(body.deliveryDueAmount, null);
        assert.equal(body.topRedProjects.length, 0);
        assert.equal(body.currencyBreakdown.length, 2);
        const jpy = body.currencyBreakdown.find(
          (item) => item.currency === 'JPY',
        );
        const usd = body.currencyBreakdown.find(
          (item) => item.currency === 'USD',
        );
        assert.ok(jpy);
        assert.ok(usd);
        assert.equal(jpy.revenue, 12000);
        assert.equal(jpy.directCost, 4800);
        assert.equal(usd.revenue, 1000);
        assert.equal(usd.deliveryDueAmount, 300);
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
    assert.equal(
      body.error?.message,
      'from/to must be valid dates (YYYY-MM-DD)',
    );
  } finally {
    await server.close();
  }
});

test('GET /reports/management-accounting/summary returns 400 when from is after to', async () => {
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/reports/management-accounting/summary?from=2026-03-31&to=2026-03-01',
      headers: {
        'x-user-id': 'admin-user',
        'x-roles': 'admin',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.error?.code, 'INVALID_DATE_RANGE');
  } finally {
    await server.close();
  }
});
