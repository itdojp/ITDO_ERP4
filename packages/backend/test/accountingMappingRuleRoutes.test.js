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

test('GET /integrations/accounting/mapping-rules supports filters and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'accountingMappingRule.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'rule-001',
            mappingKey: 'invoice_approved:default',
            debitAccountCode: '1110',
            debitSubaccountCode: null,
            creditAccountCode: '4110',
            creditSubaccountCode: null,
            departmentCode: null,
            taxCode: 'TAX-001',
            isActive: true,
            createdAt: new Date('2026-03-17T00:00:00.000Z'),
            updatedAt: new Date('2026-03-17T00:00:00.000Z'),
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/mapping-rules?mappingKey=invoice&isActive=true&limit=10&offset=2',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 2);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].mappingKey, 'invoice_approved:default');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 2);
  assert.equal(capturedFindMany?.where?.isActive, true);
  assert.equal(capturedFindMany?.where?.mappingKey?.contains, 'invoice');
});

test('POST /integrations/accounting/mapping-rules creates rule', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCreate = null;
  await withPrismaStubs(
    {
      'accountingMappingRule.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'rule-001',
          ...args.data,
          createdAt: new Date('2026-03-17T00:00:00.000Z'),
          updatedAt: new Date('2026-03-17T00:00:00.000Z'),
        };
      },
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/mapping-rules',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            mappingKey: 'expense_approved:交通費',
            debitAccountCode: '7110',
            creditAccountCode: '1110',
            taxCode: 'TAX-EXP',
            departmentCode: 'DEPT-001',
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.mappingKey, 'expense_approved:交通費');
        assert.equal(body.debitAccountCode, '7110');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedCreate?.data?.mappingKey, 'expense_approved:交通費');
  assert.equal(capturedCreate?.data?.createdBy, 'admin-user');
});

test('POST /integrations/accounting/mapping-rules rejects whitespace-only required fields', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/integrations/accounting/mapping-rules',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
        payload: {
          mappingKey: '   ',
          debitAccountCode: '1110',
          creditAccountCode: '4110',
          taxCode: 'TAX-001',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'invalid_accounting_mapping_rule_payload');
      assert.deepEqual(body.invalidFields, ['mappingKey']);
    } finally {
      await server.close();
    }
  });
});

test('PATCH /integrations/accounting/mapping-rules/:id updates rule', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedUpdate = null;
  await withPrismaStubs(
    {
      'accountingMappingRule.findUnique': async () => ({
        id: 'rule-001',
        mappingKey: 'invoice_approved:default',
        debitAccountCode: '1110',
        debitSubaccountCode: null,
        creditAccountCode: '4110',
        creditSubaccountCode: null,
        departmentCode: null,
        taxCode: 'TAX-001',
        isActive: true,
        createdAt: new Date('2026-03-17T00:00:00.000Z'),
        updatedAt: new Date('2026-03-17T00:00:00.000Z'),
      }),
      'accountingMappingRule.update': async (args) => {
        capturedUpdate = args;
        return {
          id: 'rule-001',
          mappingKey: 'invoice_approved:default',
          debitAccountCode: '1111',
          debitSubaccountCode: null,
          creditAccountCode: '4110',
          creditSubaccountCode: null,
          departmentCode: 'D001',
          taxCode: 'TAX-001',
          isActive: false,
          createdAt: new Date('2026-03-17T00:00:00.000Z'),
          updatedAt: new Date('2026-03-17T01:00:00.000Z'),
        };
      },
      'auditLog.create': async () => ({ id: 'audit-002' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/integrations/accounting/mapping-rules/rule-001',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            debitAccountCode: '1111',
            departmentCode: 'D001',
            isActive: false,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.debitAccountCode, '1111');
        assert.equal(body.departmentCode, 'D001');
        assert.equal(body.isActive, false);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedUpdate?.where?.id, 'rule-001');
  assert.equal(capturedUpdate?.data?.updatedBy, 'admin-user');
});

test('POST /integrations/accounting/mapping-rules/reapply reapplies pending rows', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const updateCalls = [];
  await withPrismaStubs(
    {
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-001',
          mappingKey: 'invoice_approved:default',
          departmentCode: 'OLD-DEPT',
          validationErrors: [{ code: 'mapping_pending' }],
        },
      ],
      'accountingMappingRule.findMany': async () => [
        {
          id: 'rule-001',
          mappingKey: 'invoice_approved:default',
          debitAccountCode: '1110',
          debitSubaccountCode: null,
          creditAccountCode: '4110',
          creditSubaccountCode: null,
          departmentCode: 'D001',
          taxCode: 'TAX-001',
          isActive: true,
        },
      ],
      'accountingJournalStaging.update': async (args) => {
        updateCalls.push(args);
        return { id: 'stg-001' };
      },
      'auditLog.create': async () => ({ id: 'audit-003' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/mapping-rules/reapply',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            periodKey: '2026-03',
            limit: 50,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.processedCount, 1);
        assert.equal(body.readyCount, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data?.status, 'ready');
  assert.equal(updateCalls[0]?.data?.departmentCode, 'D001');
});
