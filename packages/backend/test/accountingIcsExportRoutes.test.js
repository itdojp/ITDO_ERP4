import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import iconv from 'iconv-lite';
import { Prisma } from '@prisma/client';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function buildRequestHash(input) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

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

test('GET /integrations/accounting/exports/journals returns canonical payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCount = null;
  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async (args) => {
        capturedCount = args;
        return 0;
      },
      'accountingJournalStaging.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'stg-001',
            eventId: 'evt-001',
            lineNo: 1,
            entryDate: new Date('2026-02-14T00:00:00.000Z'),
            amount: '12000',
            description: '交通費精算',
            debitAccountCode: '6001',
            debitSubaccountCode: '001',
            creditAccountCode: '1110',
            creditSubaccountCode: '000',
            departmentCode: 'D001',
            taxCode: 'T10',
            event: {
              id: 'evt-001',
              sourceTable: 'expenses',
              sourceId: 'exp-001',
              periodKey: '2026-02',
              externalRef: 'EXP-202602-001',
              description: '交通費',
            },
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02&limit=10&offset=2',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-02');
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 2);
        assert.equal(body.exportedCount, 1);
        assert.equal(body.items[0].voucherNo, 'EXP-202602-001');
        assert.equal(body.items[0].entryDate, '2026/02/14');
        assert.equal(body.items[0].debitAccountName, '6001');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(
    capturedCount?.where?.status?.in?.includes('pending_mapping'),
    true,
  );
  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 2);
  assert.equal(capturedFindMany?.where?.status, 'ready');
  assert.equal(capturedFindMany?.where?.entryDate?.gte instanceof Date, true);
});

test('GET /integrations/accounting/exports/journals returns CP932 csv', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-002',
          eventId: 'evt-002',
          lineNo: 1,
          entryDate: new Date('2026-02-28T00:00:00.000Z'),
          amount: '33000',
          description: '交通費',
          debitAccountCode: '6001',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: '',
          taxCode: 'T10',
          event: {
            id: 'evt-002',
            sourceTable: 'expenses',
            sourceId: 'exp-002',
            periodKey: '2026-02',
            externalRef: 'EXP-002',
            description: null,
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02&format=csv',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200);
        assert.match(
          res.headers['content-disposition'] ?? '',
          /ics-journals-2026-02\.csv/,
        );
        assert.equal(
          res.headers['content-type'],
          'text/csv; charset=shift_jis',
        );
        const raw = res.rawPayload ?? Buffer.from(res.body, 'binary');
        const decoded = iconv.decode(raw, 'cp932');
        assert.match(decoded, /^日付,決修,伝票番号,部門ｺｰﾄﾞ/m);
        assert.match(decoded, /2026\/02\/28/);
        assert.match(decoded, /EXP-002/);
        assert.match(decoded, /\r\n/);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals returns ICS template csv with preamble', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-002b',
          eventId: 'evt-002b',
          lineNo: 1,
          entryDate: new Date('2026-02-28T00:00:00.000Z'),
          amount: '33000',
          description: '交通費',
          debitAccountCode: '6001',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: '',
          taxCode: 'T10',
          event: {
            id: 'evt-002b',
            sourceTable: 'expenses',
            sourceId: 'exp-002b',
            periodKey: '2026-02',
            externalRef: 'EXP-002B',
            description: null,
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02&format=ics_template&companyCode=%3D00000080&companyName=%40%E6%A0%AA%E5%BC%8F%E4%BC%9A%E7%A4%BE%E3%80%80%E3%82%A2%E3%82%A4%E3%83%86%E3%82%A3%E3%83%BC%E3%83%89%E3%82%A5&fiscalYearStartMonth=10',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          res.headers['content-disposition'] ?? '',
          /ics-journals-template-2026-02\.csv/,
        );
        const raw = res.rawPayload ?? Buffer.from(res.body, 'binary');
        const decoded = iconv.decode(raw, 'cp932');
        const lines = decoded.split('\r\n');
        assert.equal(lines[0], '法人');
        assert.equal(lines[1], '仕訳日記帳');
        assert.equal(lines[2], "'=00000080,'@株式会社　アイティードゥ");
        assert.equal(lines[3], '自 7年10月1日,至 8年9月30日,月分');
        assert.match(lines[4] ?? '', /^日付,決修,伝票番号,部門ｺｰﾄﾞ/);
        assert.match(decoded, /EXP-002B/);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals returns 400 for invalid periodKey', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/integrations/accounting/exports/journals?periodKey=2026-13',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(JSON.parse(res.body).error, 'invalid_period_key');
    } finally {
      await server.close();
    }
  });
});

test('GET /integrations/accounting/exports/journals returns 400 when ICS template metadata is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/integrations/accounting/exports/journals?periodKey=2026-02&format=ics_template',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(
        JSON.parse(res.body).error,
        'accounting_ics_template_metadata_required',
      );
    } finally {
      await server.close();
    }
  });
});

test('GET /integrations/accounting/exports/journals returns 409 when mappings are incomplete', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 2,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'accounting_journal_mapping_incomplete');
        assert.equal(body.details.incompleteCount, 2);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals returns 409 for description control characters', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-004',
          eventId: 'evt-004',
          lineNo: 1,
          entryDate: new Date('2026-02-28T00:00:00.000Z'),
          amount: '33000',
          description: '改行あり\n摘要',
          debitAccountCode: '6001',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: 'D001',
          taxCode: 'T10',
          event: {
            id: 'evt-004',
            sourceTable: 'expenses',
            sourceId: 'exp-004',
            periodKey: '2026-02',
            externalRef: 'EXP-004',
            description: null,
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'accounting_journal_description_invalid');
        assert.equal(body.details.reason, 'control_characters');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals returns 409 for CP932-unencodable description', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-005',
          eventId: 'evt-005',
          lineNo: 1,
          entryDate: new Date('2026-02-28T00:00:00.000Z'),
          amount: '33000',
          description: 'emoji😀摘要',
          debitAccountCode: '6001',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: 'D001',
          taxCode: 'T10',
          event: {
            id: 'evt-005',
            sourceTable: 'expenses',
            sourceId: 'exp-005',
            periodKey: '2026-02',
            externalRef: 'EXP-005',
            description: null,
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'accounting_journal_description_invalid');
        assert.equal(body.details.reason, 'cp932_unencodable');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals returns 409 for description byte limit', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-006',
          eventId: 'evt-006',
          lineNo: 1,
          entryDate: new Date('2026-02-28T00:00:00.000Z'),
          amount: '33000',
          description: '摘要'.repeat(40),
          debitAccountCode: '6001',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: 'D001',
          taxCode: 'T10',
          event: {
            id: 'evt-006',
            sourceTable: 'expenses',
            sourceId: 'exp-006',
            periodKey: '2026-02',
            externalRef: 'EXP-006',
            description: null,
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals?periodKey=2026-02',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'accounting_journal_description_invalid');
        assert.equal(body.details.reason, 'cp932_byte_limit_exceeded');
        assert.equal(body.details.maxBytes, 120);
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/accounting/exports/journals/dispatch creates export log and persists payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let createCall = null;
  let updateCall = null;
  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async () => null,
      'accountingIcsExportLog.create': async (args) => {
        createCall = args;
        return {
          id: 'ics-log-001',
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          periodKey: args.data.periodKey ?? null,
          exportedUntil: args.data.exportedUntil,
          status: 'running',
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: args.data.startedAt,
          finishedAt: null,
        };
      },
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-003',
          eventId: 'evt-003',
          lineNo: 1,
          entryDate: new Date('2026-02-20T00:00:00.000Z'),
          amount: '5000',
          description: '会議費',
          debitAccountCode: '6100',
          debitSubaccountCode: '',
          creditAccountCode: '1110',
          creditSubaccountCode: '',
          departmentCode: 'D002',
          taxCode: 'T10',
          event: {
            id: 'evt-003',
            sourceTable: 'expenses',
            sourceId: 'exp-003',
            periodKey: '2026-02',
            externalRef: 'EXP-003',
            description: '会議費',
          },
        },
      ],
      'accountingIcsExportLog.update': async (args) => {
        updateCall = args;
        return {
          id: 'ics-log-001',
          idempotencyKey: 'ics-export-key-001',
          periodKey: '2026-02',
          status: args.data.status,
          exportedUntil: new Date('2026-03-16T10:00:00.000Z'),
          exportedCount: args.data.exportedCount ?? 0,
          startedAt: new Date('2026-03-16T10:00:00.000Z'),
          finishedAt: args.data.finishedAt ?? null,
          message: args.data.message ?? null,
        };
      },
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-001',
            limit: 10,
            offset: 2,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.payload.periodKey, '2026-02');
        assert.equal(body.log.status, 'success');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCall?.data?.idempotencyKey, 'ics-export-key-001');
  assert.equal(createCall?.data?.periodKey, '2026-02');
  assert.equal(updateCall?.data?.status, 'success');
  assert.equal(updateCall?.data?.payload?.exportedCount, 1);
});

test('POST /integrations/accounting/exports/journals/dispatch includes ICS template metadata in request hash', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let createCall = null;
  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async () => null,
      'accountingIcsExportLog.create': async (args) => {
        createCall = args;
        return {
          id: 'ics-log-template-001',
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          periodKey: args.data.periodKey ?? null,
          exportedUntil: args.data.exportedUntil,
          status: 'running',
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: args.data.startedAt,
          finishedAt: null,
        };
      },
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [],
      'accountingIcsExportLog.update': async (args) => ({
        id: 'ics-log-template-001',
        idempotencyKey: 'ics-template-export-key-001',
        periodKey: '2026-02',
        status: args.data.status,
        exportedUntil: new Date('2026-03-18T10:00:00.000Z'),
        exportedCount: args.data.exportedCount ?? 0,
        startedAt: new Date('2026-03-18T10:00:00.000Z'),
        finishedAt: args.data.finishedAt ?? null,
        message: args.data.message ?? null,
      }),
      'auditLog.create': async () => ({ id: 'audit-template-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            format: 'ics_template',
            periodKey: '2026-02',
            companyCode: '00000080',
            companyName: '株式会社 アイティードゥ',
            fiscalYearStartMonth: 10,
            idempotencyKey: 'ics-template-export-key-001',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(
    createCall?.data?.requestHash,
    buildRequestHash({
      periodKey: '2026-02',
      limit: 500,
      offset: 0,
      format: 'ics_template',
      companyCode: '00000080',
      companyName: '株式会社 アイティードゥ',
      fiscalYearStartMonth: 10,
    }),
  );
});

test('POST /integrations/accounting/exports/journals/dispatch handles replay, in-progress, and conflict', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const sharedHash = buildRequestHash({
    periodKey: '2026-02',
    limit: 500,
    offset: 0,
    format: 'csv',
  });

  const server = await buildServer({ logger: false });
  try {
    await withPrismaStubs(
      {
        'accountingIcsExportLog.findUnique': async () => ({
          id: 'ics-log-002',
          idempotencyKey: 'ics-export-key-002',
          requestHash: sharedHash,
          periodKey: '2026-02',
          status: 'success',
          exportedUntil: new Date('2026-03-16T11:00:00.000Z'),
          exportedCount: 3,
          payload: { exportedCount: 3 },
          message: 'exported',
          startedAt: new Date('2026-03-16T11:00:00.000Z'),
          finishedAt: new Date('2026-03-16T11:01:00.000Z'),
        }),
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-002',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(JSON.parse(res.body).replayed, true);
      },
    );

    await withPrismaStubs(
      {
        'accountingIcsExportLog.findUnique': async () => ({
          id: 'ics-log-002b',
          idempotencyKey: 'ics-export-key-002b',
          requestHash: sharedHash,
          periodKey: '2026-02',
          status: 'failed',
          exportedUntil: new Date('2026-03-16T11:00:00.000Z'),
          exportedCount: 0,
          payload: null,
          message: 'journal staging rows are not ready for export',
          startedAt: new Date('2026-03-16T11:00:00.000Z'),
          finishedAt: new Date('2026-03-16T11:01:00.000Z'),
        }),
        'auditLog.create': async () => ({ id: 'audit-001b' }),
      },
      async () => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-002b',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'dispatch_failed');
        assert.equal(body.logId, 'ics-log-002b');
      },
    );

    await withPrismaStubs(
      {
        'accountingIcsExportLog.findUnique': async () => ({
          id: 'ics-log-003',
          idempotencyKey: 'ics-export-key-003',
          requestHash: sharedHash,
          periodKey: '2026-02',
          status: 'running',
          exportedUntil: new Date('2026-03-16T11:00:00.000Z'),
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: new Date('2026-03-16T11:00:00.000Z'),
          finishedAt: null,
        }),
      },
      async () => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-003',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.equal(JSON.parse(res.body).error, 'dispatch_in_progress');
      },
    );

    await withPrismaStubs(
      {
        'accountingIcsExportLog.findUnique': async () => ({
          id: 'ics-log-004',
          idempotencyKey: 'ics-export-key-004',
          requestHash: 'other-hash',
          periodKey: '2026-02',
          status: 'success',
          exportedUntil: new Date('2026-03-16T11:00:00.000Z'),
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: new Date('2026-03-16T11:00:00.000Z'),
          finishedAt: new Date('2026-03-16T11:01:00.000Z'),
        }),
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-004',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error?.code ?? body.error, 'idempotency_conflict');
      },
    );
  } finally {
    await server.close();
  }
});

test('POST /integrations/accounting/exports/journals/dispatch validates export payload before writing log', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let createCalled = false;
  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async () => null,
      'accountingIcsExportLog.create': async () => {
        createCalled = true;
        throw new Error('create should not be called');
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-13',
            idempotencyKey: 'ics-export-key-invalid-period',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        assert.equal(JSON.parse(res.body).error, 'invalid_period_key');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCalled, false);
});

test('POST /integrations/accounting/exports/journals/dispatch handles concurrent create race', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const sharedHash = buildRequestHash({
    periodKey: '2026-02',
    limit: 500,
    offset: 0,
    format: 'csv',
  });

  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async (args) => {
        if (args.where?.idempotencyKey === 'ics-export-key-race') {
          return {
            id: 'ics-log-race',
            idempotencyKey: 'ics-export-key-race',
            requestHash: sharedHash,
            periodKey: '2026-02',
            status: 'running',
            exportedUntil: new Date('2026-03-16T12:00:00.000Z'),
            exportedCount: 0,
            payload: null,
            message: null,
            startedAt: new Date('2026-03-16T12:00:00.000Z'),
            finishedAt: null,
          };
        }
        return null;
      },
      'accountingIcsExportLog.create': async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`idempotencyKey`)',
          { code: 'P2002', clientVersion: '6.16.1' },
        );
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/exports/journals/dispatch',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
          payload: {
            periodKey: '2026-02',
            idempotencyKey: 'ics-export-key-race',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.equal(JSON.parse(res.body).error, 'dispatch_in_progress');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/accounting/exports/journals/dispatch-logs supports filters and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'accountingIcsExportLog.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'ics-log-005',
            idempotencyKey: 'ics-export-key-005',
            periodKey: '2026-02',
            status: 'success',
            exportedUntil: new Date('2026-03-16T12:00:00.000Z'),
            exportedCount: 4,
            startedAt: new Date('2026-03-16T12:00:00.000Z'),
            finishedAt: new Date('2026-03-16T12:01:00.000Z'),
            message: 'exported',
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/accounting/exports/journals/dispatch-logs?periodKey=2026-02&status=success&idempotencyKey=ics-export-key-005&limit=5&offset=4',
          headers: { 'x-user-id': 'admin-user', 'x-roles': 'admin' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(body.offset, 4);
        assert.equal(body.items[0].idempotencyKey, 'ics-export-key-005');
      } finally {
        await server.close();
      }
    },
  );

  assert.deepEqual(capturedFindMany?.where, {
    periodKey: '2026-02',
    status: 'success',
    idempotencyKey: 'ics-export-key-005',
  });
  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.skip, 4);
});
