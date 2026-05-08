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
          orgUnitId: 'D001',
        },
        {
          id: 'project-2',
          code: '=PRJ-002',
          name: '@Project 2',
          currency: 'JPY',
          orgUnitId: 'D002',
        },
        {
          id: 'project-3',
          code: 'PRJ-003',
          name: 'Project 3',
          currency: 'JPY',
          orgUnitId: null,
        },
      ],
      'departmentMaster.findMany': async (args) => {
        assert.equal(Object.hasOwn(args.where, 'active'), false);
        assert.ok(args.where.OR.some((condition) => condition.externalCode));
        return [
          {
            id: 'department-master-collision',
            code: 'A001',
            name: '外部コード衝突部',
            externalCode: 'D001',
          },
          {
            id: 'department-master-1',
            code: 'D001',
            name: '営業部',
            externalCode: 'OU-D001',
          },
        ];
      },
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 10000 },
        },
        { projectId: 'project-2', currency: 'JPY', _sum: { totalAmount: 500 } },
        { projectId: 'project-3', currency: 'JPY', _sum: { totalAmount: 250 } },
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
      'payrollConfirmedLaborCost.findMany': async (args) => {
        assert.deepEqual(args.where.periodKey.in, ['2026-03']);
        assert.deepEqual(args.where.projectId.in, [
          'project-1',
          'project-2',
          'project-3',
        ]);
        return [
          {
            periodKey: '2026-03',
            projectId: 'project-1',
            currency: 'JPY',
            amount: 1300,
          },
          {
            periodKey: '2026-03',
            projectId: 'project-2',
            currency: 'JPY',
            amount: 900,
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
        assert.equal(body.projectCount, 3);
        assert.equal(body.currency, 'JPY');
        assert.equal(body.mixedCurrency, false);
        assert.equal(body.currencyBreakdown.length, 1);
        assert.equal(body.revenue, 10750);
        assert.equal(body.directCost, 6050);
        assert.equal(body.laborCost, 1850);
        assert.equal(body.payrollConfirmedLaborCost, 2200);
        assert.equal(body.laborCostVariance, 350);
        assert.equal(body.payrollConfirmedStatus, 'confirmed');
        assert.deepEqual(body.payrollConfirmedPeriodKeys, ['2026-03']);
        assert.deepEqual(body.payrollMissingPeriodKeys, []);
        assert.equal(body.vendorCost, 3000);
        assert.equal(body.expenseCost, 1200);
        assert.equal(body.grossProfit, 4700);
        assert.equal(body.totalMinutes, 1620);
        assert.equal(body.overtimeTotalMinutes, 660);
        assert.equal(body.deliveryDueCount, 1);
        assert.equal(body.deliveryDueAmount, 2000);
        assert.equal(body.redProjectCount, 1);
        assert.equal(body.topRedProjects.length, 1);
        assert.equal(body.topRedProjects[0].projectId, 'project-2');
        assert.equal(body.topRedProjects[0].grossProfit, -1050);
        assert.equal(body.topRedProjects[0].payrollConfirmedLaborCost, 900);
        assert.equal(body.topRedProjects[0].laborCostVariance, 50);
        assert.equal(body.departmentBreakdown.length, 3);
        const departmentD001 = body.departmentBreakdown.find(
          (item) => item.departmentKey === 'D001',
        );
        const departmentD002 = body.departmentBreakdown.find(
          (item) => item.departmentKey === 'D002',
        );
        const departmentUnassigned = body.departmentBreakdown.find(
          (item) => item.departmentSource === 'unassigned',
        );
        assert.ok(departmentD001);
        assert.ok(departmentD002);
        assert.ok(departmentUnassigned);
        assert.equal(departmentD001.departmentName, '営業部');
        assert.equal(departmentD001.departmentExternalCode, 'OU-D001');
        assert.equal(departmentD001.departmentSource, 'department_master');
        assert.equal(departmentD001.revenue, 10000);
        assert.equal(departmentD001.directCost, 4500);
        assert.equal(departmentD001.payrollConfirmedLaborCost, 1300);
        assert.equal(departmentD001.laborCostVariance, 300);
        assert.equal(departmentD001.grossProfit, 5500);
        assert.equal(departmentD002.departmentName, null);
        assert.equal(departmentD002.departmentExternalCode, null);
        assert.equal(departmentD002.departmentSource, 'legacy_org_unit');
        assert.equal(departmentD002.payrollConfirmedLaborCost, 900);
        assert.equal(departmentD002.laborCostVariance, 50);
        assert.equal(departmentD002.redProjectCount, 1);
        assert.equal(departmentUnassigned.departmentKey, null);
        assert.equal(departmentUnassigned.departmentName, null);
        assert.equal(departmentUnassigned.departmentExternalCode, null);
        assert.equal(departmentUnassigned.revenue, 250);
        assert.equal(departmentUnassigned.payrollConfirmedLaborCost, null);
        assert.equal(departmentUnassigned.laborCostVariance, null);
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
          currency: '=JPY',
          orgUnitId: 'D001',
        },
        {
          id: 'project-2',
          code: '=PRJ-002',
          name: '@Project 2',
          currency: '=JPY',
          orgUnitId: 'D002',
        },
        {
          id: 'project-3',
          code: 'PRJ-003',
          name: 'Project 3',
          currency: '=JPY',
          orgUnitId: null,
        },
      ],
      'departmentMaster.findMany': async (args) => {
        assert.equal(Object.hasOwn(args.where, 'active'), false);
        assert.ok(args.where.OR.some((condition) => condition.externalCode));
        return [
          {
            id: 'department-master-collision',
            code: 'A001',
            name: '外部コード衝突部',
            externalCode: 'D001',
          },
          {
            id: 'department-master-1',
            code: 'D001',
            name: '営業部',
            externalCode: 'OU-D001',
          },
        ];
      },
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: '=JPY',
          _sum: { totalAmount: 10000 },
        },
        {
          projectId: 'project-2',
          currency: '=JPY',
          _sum: { totalAmount: 500 },
        },
        {
          projectId: 'project-3',
          currency: '=JPY',
          _sum: { totalAmount: 250 },
        },
      ],
      'vendorInvoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: '=JPY',
          _sum: { totalAmount: 3000 },
        },
      ],
      'expense.groupBy': async () => [
        { projectId: 'project-1', currency: '=JPY', _sum: { amount: 500 } },
        { projectId: 'project-2', currency: '=JPY', _sum: { amount: 700 } },
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
          currency: '=JPY',
        },
        {
          id: 'rate-2',
          projectId: 'project-2',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 50,
          currency: '=JPY',
        },
      ],
      'payrollConfirmedLaborCost.findMany': async () => [
        {
          periodKey: '2026-03',
          projectId: 'project-1',
          currency: '=JPY',
          amount: 1300,
        },
        {
          periodKey: '2026-03',
          projectId: 'project-2',
          currency: '=JPY',
          amount: 900,
        },
      ],
      'projectMilestone.findMany': async () => [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: '請求待ち',
          amount: 2000,
          dueDate: new Date('2026-03-20T00:00:00.000Z'),
          project: { code: 'PRJ-001', name: 'Project 1', currency: '=JPY' },
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
          /^section,currency,departmentKey,departmentName,departmentExternalCode,departmentSource,projectId,projectCode,projectName,projectCount,revenue,directCost,laborCost,payrollConfirmedLaborCost,laborCostVariance,payrollConfirmedStatus,vendorCost,expenseCost,grossProfit,grossMargin,totalMinutes,overtimeTotalMinutes,deliveryDueCount,deliveryDueAmount,redProjectCount/m,
        );
        assert.match(
          res.body,
          /summary,'=JPY,,,,,,,,3,10750,6050,1850,2200,350,confirmed,3000/,
          res.body,
        );
        assert.match(
          res.body,
          /currency_breakdown,'=JPY,,,,,,,,3,10750,6050,1850,2200,350,,3000/,
        );
        assert.match(
          res.body,
          /department_breakdown,'=JPY,,,,unassigned,,,,1,250,0,0,,,,0/,
        );
        assert.match(
          res.body,
          /department_breakdown,'=JPY,D001,営業部,OU-D001,department_master,,,,1,10000,4500,1000,1300,300,,3000/,
        );
        assert.match(
          res.body,
          /top_red_project,'=JPY,D002,,,legacy_org_unit,project-2,'=PRJ-002,'@Project 2,,500,1550,850,900,50,/,
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
      'payrollConfirmedLaborCost.findMany': async () => [],
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

test('GET /reports/management-accounting/summary reports missing payroll confirmed periods', async () => {
  await withPrismaStubs(
    {
      'project.findMany': async () => [
        {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Project 1',
          currency: 'JPY',
          orgUnitId: null,
        },
      ],
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 1000 },
        },
      ],
      'vendorInvoice.groupBy': async () => [],
      'expense.groupBy': async () => [],
      'timeEntry.findMany': async () => [
        {
          projectId: 'project-1',
          userId: 'user-1',
          workDate: new Date('2026-03-10T00:00:00.000Z'),
          workType: null,
          minutes: 60,
        },
      ],
      'rateCard.findMany': async () => [
        {
          id: 'rate-1',
          projectId: 'project-1',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 60,
          currency: 'JPY',
        },
      ],
      'payrollConfirmedLaborCost.findMany': async (args) => {
        assert.deepEqual(args.where.periodKey.in, ['2026-03']);
        return [];
      },
      'projectMilestone.findMany': async () => [],
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
        assert.equal(body.payrollConfirmedStatus, 'missing');
        assert.deepEqual(body.payrollConfirmedPeriodKeys, []);
        assert.deepEqual(body.payrollMissingPeriodKeys, ['2026-03']);
        assert.equal(body.payrollConfirmedLaborCost, null);
        assert.equal(body.laborCostVariance, null);
        assert.equal(body.currencyBreakdown[0].payrollConfirmedLaborCost, null);
        assert.equal(body.currencyBreakdown[0].laborCostVariance, null);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /reports/management-accounting/summary excludes partial-month payroll confirmed amounts', async () => {
  let payrollFindManyCalled = false;
  await withPrismaStubs(
    {
      'project.findMany': async () => [
        {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Project 1',
          currency: 'JPY',
          orgUnitId: null,
        },
      ],
      'invoice.groupBy': async () => [
        {
          projectId: 'project-1',
          currency: 'JPY',
          _sum: { totalAmount: 1000 },
        },
      ],
      'vendorInvoice.groupBy': async () => [],
      'expense.groupBy': async () => [],
      'timeEntry.findMany': async () => [
        {
          projectId: 'project-1',
          userId: 'user-1',
          workDate: new Date('2026-03-20T00:00:00.000Z'),
          workType: null,
          minutes: 60,
        },
      ],
      'rateCard.findMany': async () => [
        {
          id: 'rate-1',
          projectId: 'project-1',
          workType: null,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: null,
          unitPrice: 60,
          currency: 'JPY',
        },
      ],
      'payrollConfirmedLaborCost.findMany': async () => {
        payrollFindManyCalled = true;
        return [
          {
            periodKey: '2026-03',
            projectId: 'project-1',
            currency: 'JPY',
            amount: 3000,
          },
        ];
      },
      'projectMilestone.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/reports/management-accounting/summary?from=2026-03-15&to=2026-04-14',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(payrollFindManyCalled, false);
        assert.equal(body.payrollConfirmedStatus, 'missing');
        assert.deepEqual(body.payrollConfirmedPeriodKeys, []);
        assert.deepEqual(body.payrollMissingPeriodKeys, ['2026-03', '2026-04']);
        assert.equal(body.payrollConfirmedLaborCost, null);
        assert.equal(body.laborCostVariance, null);
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
    const whitespaceRes = await server.inject({
      method: 'GET',
      url: '/reports/management-accounting/summary?from=%202026-03-01%20&to=2026-03-31',
      headers: {
        'x-user-id': 'admin-user',
        'x-roles': 'admin',
      },
    });
    assert.equal(whitespaceRes.statusCode, 400, whitespaceRes.body);
    const whitespaceBody = JSON.parse(whitespaceRes.body);
    assert.equal(whitespaceBody.error?.code, 'INVALID_DATE');
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
