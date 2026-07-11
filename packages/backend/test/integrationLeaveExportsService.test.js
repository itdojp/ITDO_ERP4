import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const {
  buildHrLeaveExportPayload,
  buildLeaveExportRequestHash,
  dispatchHrLeaveExport,
  listHrLeaveExportLogs,
  parseHrLeaveExportQuery,
} = await import('../dist/services/integrationLeaveExports.js');

function buildAuditContext() {
  return {
    actorUserId: 'admin-user',
    ipAddress: '127.0.0.1',
    userAgent: 'node:test',
  };
}

test('parseHrLeaveExportQuery normalizes target, dates, and bounded pagination', () => {
  const parsed = parseHrLeaveExportQuery({
    target: 'payroll',
    updatedSince: '2026-02-01T00:00:00.000Z',
    limit: '99999',
    offset: '-20',
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.target, 'payroll');
  assert.equal(parsed.updatedSince.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(parsed.limit, 2000);
  assert.equal(parsed.offset, 0);
  assert.deepEqual(parseHrLeaveExportQuery({ updatedSince: 'bad-date' }), {
    ok: false,
    code: 'invalid_updatedSince',
  });
});

test('buildHrLeaveExportPayload returns approved leave rows with leave type metadata', async () => {
  let capturedLeaveFindMany = null;
  let capturedLeaveTypeFindMany = null;
  const client = {
    leaveRequest: {
      findMany: async (args) => {
        capturedLeaveFindMany = args;
        return [
          {
            id: 'leave-001',
            userId: 'user-001',
            leaveType: ' paid ',
            startDate: new Date('2026-02-20T00:00:00.000Z'),
            endDate: new Date('2026-02-20T00:00:00.000Z'),
            hours: null,
            minutes: 120,
            startTimeMinutes: 540,
            endTimeMinutes: 660,
            notes: '午後休',
            createdAt: new Date('2026-02-19T12:00:00.000Z'),
            updatedAt: new Date('2026-02-20T12:00:00.000Z'),
          },
        ];
      },
    },
    leaveType: {
      findMany: async (args) => {
        capturedLeaveTypeFindMany = args;
        return [
          {
            code: 'paid',
            name: '年次有給休暇',
            unit: 'mixed',
            isPaid: true,
          },
        ];
      },
    },
  };

  const payload = await buildHrLeaveExportPayload(
    {
      target: 'payroll',
      updatedSince: new Date('2026-02-01T00:00:00.000Z'),
      exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
      limit: 10,
      offset: 3,
      actorId: 'admin-user',
    },
    {
      client,
      ensureLeaveSetting: async (args) => {
        assert.equal(args.actorId, 'admin-user');
        assert.equal(args.client, client);
        return { id: 'default', defaultWorkdayMinutes: 480 };
      },
      now: () => new Date('2026-02-22T10:01:00.000Z'),
    },
  );

  assert.equal(payload.target, 'payroll');
  assert.equal(payload.exportedAt, '2026-02-22T10:01:00.000Z');
  assert.equal(payload.exportedUntil, '2026-02-22T10:00:00.000Z');
  assert.equal(payload.updatedSince, '2026-02-01T00:00:00.000Z');
  assert.equal(payload.limit, 10);
  assert.equal(payload.offset, 3);
  assert.equal(payload.exportedCount, 1);
  assert.equal(payload.items[0].leaveType, 'paid');
  assert.equal(payload.items[0].leaveTypeName, '年次有給休暇');
  assert.equal(payload.items[0].requestedMinutes, 120);
  assert.equal(capturedLeaveFindMany.take, 10);
  assert.equal(capturedLeaveFindMany.skip, 3);
  assert.equal(capturedLeaveFindMany.where.updatedAt.gt instanceof Date, true);
  assert.equal(capturedLeaveFindMany.where.updatedAt.lte instanceof Date, true);
  assert.deepEqual(capturedLeaveTypeFindMany.where, {
    code: { in: ['paid'] },
  });
});

test('buildHrLeaveExportPayload propagates injected client to settings and workday resolution', async () => {
  let ensureClient = null;
  let holidayQueryCount = 0;
  let overrideQueryCount = 0;
  const client = {
    leaveRequest: {
      findMany: async () => [
        {
          id: 'leave-implicit-001',
          userId: 'user-implicit',
          leaveType: 'paid',
          startDate: new Date('2026-02-23T00:00:00.000Z'),
          endDate: new Date('2026-02-23T00:00:00.000Z'),
          hours: null,
          minutes: null,
          startTimeMinutes: null,
          endTimeMinutes: null,
          notes: null,
          createdAt: new Date('2026-02-22T12:00:00.000Z'),
          updatedAt: new Date('2026-02-23T12:00:00.000Z'),
        },
      ],
    },
    leaveType: {
      findMany: async () => [
        {
          code: 'paid',
          name: '年次有給休暇',
          unit: 'day',
          isPaid: true,
        },
      ],
    },
    leaveCompanyHoliday: {
      findMany: async () => {
        holidayQueryCount += 1;
        return [];
      },
    },
    leaveWorkdayOverride: {
      findMany: async () => {
        overrideQueryCount += 1;
        return [
          {
            workDate: new Date('2026-02-23T00:00:00.000Z'),
            workMinutes: 360,
          },
        ];
      },
    },
  };

  const payload = await buildHrLeaveExportPayload(
    {
      target: 'attendance',
      exportedUntil: new Date('2026-02-24T00:00:00.000Z'),
      limit: 10,
      offset: 0,
      actorId: 'admin-user',
    },
    {
      client,
      ensureLeaveSetting: async (args) => {
        ensureClient = args.client;
        return { id: 'default', defaultWorkdayMinutes: 480 };
      },
    },
  );

  assert.equal(ensureClient, client);
  assert.equal(holidayQueryCount, 1);
  assert.equal(overrideQueryCount, 1);
  assert.equal(payload.items[0].requestedMinutes, 360);
});

test('dispatchHrLeaveExport creates a running log, persists success payload, and audits', async () => {
  const auditCalls = [];
  const startedAt = new Date('2026-02-22T10:00:00.000Z');
  const finishedAt = new Date('2026-02-22T10:00:05.000Z');
  const payload = {
    target: 'attendance',
    exportedAt: '2026-02-22T10:00:05.000Z',
    exportedUntil: startedAt.toISOString(),
    updatedSince: '2026-02-01T00:00:00.000Z',
    limit: 10,
    offset: 2,
    exportedCount: 1,
    items: [{ id: 'leave-002' }],
  };
  let createCall = null;
  let updateCall = null;
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => null,
      create: async (args) => {
        createCall = args;
        return {
          id: 'export-log-001',
          target: args.data.target,
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          updatedSince: args.data.updatedSince,
          exportedUntil: args.data.exportedUntil,
          status: args.data.status,
          exportedCount: 0,
          payload: null,
          reexportOfId: null,
          startedAt: args.data.startedAt,
          finishedAt: null,
          message: null,
        };
      },
      update: async (args) => {
        updateCall = args;
        return {
          id: 'export-log-001',
          target: 'attendance',
          idempotencyKey: 'export-key-001',
          reexportOfId: null,
          status: args.data.status,
          updatedSince: new Date('2026-02-01T00:00:00.000Z'),
          exportedUntil: startedAt,
          exportedCount: args.data.exportedCount,
          startedAt,
          finishedAt: args.data.finishedAt,
          message: args.data.message,
        };
      },
    },
  };
  let nowCalls = 0;

  const result = await dispatchHrLeaveExport(
    {
      query: {
        target: 'attendance',
        updatedSince: '2026-02-01T00:00:00.000Z',
        limit: 10,
        offset: 2,
      },
      idempotencyKey: ' export-key-001 ',
      actorUserId: 'admin-user',
      auditContext: buildAuditContext(),
    },
    {
      client,
      buildPayload: async (args) => {
        assert.equal(args.target, 'attendance');
        assert.equal(
          args.updatedSince.toISOString(),
          '2026-02-01T00:00:00.000Z',
        );
        assert.equal(args.exportedUntil, startedAt);
        assert.equal(args.limit, 10);
        assert.equal(args.offset, 2);
        assert.equal(args.actorId, 'admin-user');
        return payload;
      },
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
      now: () => {
        nowCalls += 1;
        return nowCalls === 1 ? startedAt : finishedAt;
      },
    },
  );

  assert.equal(result.replayed, false);
  assert.equal(result.payload, payload);
  assert.equal(result.log.status, 'success');
  assert.equal(createCall.data.idempotencyKey, 'export-key-001');
  assert.equal(createCall.data.status, 'running');
  assert.equal(createCall.data.createdBy, 'admin-user');
  assert.equal(updateCall.data.status, 'success');
  assert.equal(updateCall.data.exportedCount, 1);
  assert.equal(updateCall.data.message, 'exported');
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, 'integration_hr_leave_export_dispatched');
  assert.equal(auditCalls[0].metadata.exportedCount, 1);
});

test('dispatchHrLeaveExport replays existing success and audits replay metadata', async () => {
  const auditCalls = [];
  const requestHash = buildLeaveExportRequestHash({
    target: 'attendance',
    updatedSince: '2026-02-01T00:00:00.000Z',
    limit: 10,
    offset: 2,
  });
  const existingPayload = {
    target: 'attendance',
    exportedCount: 1,
    items: [{ id: 'leave-replay-001' }],
  };
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => ({
        id: 'export-log-replay',
        target: 'attendance',
        idempotencyKey: 'export-key-replay',
        requestHash,
        updatedSince: new Date('2026-02-01T00:00:00.000Z'),
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'success',
        exportedCount: 1,
        payload: existingPayload,
        reexportOfId: null,
        startedAt: new Date('2026-02-22T10:00:00.000Z'),
        finishedAt: new Date('2026-02-22T10:00:05.000Z'),
        message: 'exported',
      }),
    },
  };

  const result = await dispatchHrLeaveExport(
    {
      query: {
        target: 'attendance',
        updatedSince: '2026-02-01T00:00:00.000Z',
        limit: 10,
        offset: 2,
      },
      idempotencyKey: 'export-key-replay',
      auditContext: buildAuditContext(),
    },
    {
      client,
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.equal(result.replayed, true);
  assert.equal(result.payload, existingPayload);
  assert.equal(result.log.id, 'export-log-replay');
  assert.equal(auditCalls.length, 1);
  assert.equal(
    auditCalls[0].action,
    'integration_hr_leave_export_dispatch_replayed',
  );
  assert.equal(auditCalls[0].metadata.status, 'success');
  assert.equal(auditCalls[0].metadata.exportedCount, 1);
});

test('dispatchHrLeaveExport rejects duplicate running dispatch without audit mutation', async () => {
  const auditCalls = [];
  const requestHash = buildLeaveExportRequestHash({
    target: 'attendance',
    updatedSince: null,
    limit: 5,
    offset: 0,
  });
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => ({
        id: 'export-log-running',
        target: 'attendance',
        idempotencyKey: 'export-key-running',
        requestHash,
        updatedSince: null,
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'running',
        exportedCount: 0,
        payload: null,
        reexportOfId: null,
        startedAt: new Date('2026-02-22T10:00:00.000Z'),
        finishedAt: null,
        message: null,
      }),
    },
  };

  await assert.rejects(
    () =>
      dispatchHrLeaveExport(
        {
          query: { target: 'attendance', limit: 5, offset: 0 },
          idempotencyKey: 'export-key-running',
          auditContext: buildAuditContext(),
        },
        {
          client,
          logAudit: async (entry) => {
            auditCalls.push(entry);
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'dispatch_in_progress');
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.responseBody, {
        error: 'dispatch_in_progress',
        logId: 'export-log-running',
      });
      return true;
    },
  );

  assert.equal(auditCalls.length, 0);
});

test('dispatchHrLeaveExport replays concurrent create via P2002 re-fetch', async () => {
  const auditCalls = [];
  const requestHash = buildLeaveExportRequestHash({
    target: 'attendance',
    updatedSince: null,
    limit: 5,
    offset: 0,
  });
  const existingPayload = { target: 'attendance', exportedCount: 2, items: [] };
  const concurrentRecord = {
    id: 'export-log-concurrent',
    target: 'attendance',
    idempotencyKey: 'export-key-concurrent',
    requestHash,
    updatedSince: null,
    exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
    status: 'success',
    exportedCount: 2,
    payload: existingPayload,
    reexportOfId: null,
    startedAt: new Date('2026-02-22T10:00:00.000Z'),
    finishedAt: new Date('2026-02-22T10:00:05.000Z'),
    message: 'exported',
  };
  let findUniqueCalls = 0;
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => {
        findUniqueCalls += 1;
        // Simulates a race: no record on first lookup, then a concurrent
        // insert completes before the second lookup after the P2002 error.
        return findUniqueCalls === 1 ? null : concurrentRecord;
      },
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: '5.0.0' },
        );
      },
    },
  };

  const result = await dispatchHrLeaveExport(
    {
      query: { target: 'attendance', limit: 5, offset: 0 },
      idempotencyKey: 'export-key-concurrent',
      auditContext: buildAuditContext(),
    },
    {
      client,
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.equal(result.replayed, true);
  assert.equal(result.payload, existingPayload);
  assert.equal(result.log.id, 'export-log-concurrent');
  assert.equal(findUniqueCalls, 2);
  assert.equal(auditCalls.length, 1);
  assert.equal(
    auditCalls[0].action,
    'integration_hr_leave_export_dispatch_replayed',
  );
});

test('dispatchHrLeaveExport marks failed logs and truncates failure audit message', async () => {
  const auditCalls = [];
  const startedAt = new Date('2026-02-22T10:00:00.000Z');
  const finishedAt = new Date('2026-02-22T10:00:05.000Z');
  const longMessage = 'x'.repeat(520);
  const updateCalls = [];
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => null,
      create: async (args) => ({
        id: 'export-log-failed',
        target: args.data.target,
        idempotencyKey: args.data.idempotencyKey,
        requestHash: args.data.requestHash,
        updatedSince: args.data.updatedSince,
        exportedUntil: args.data.exportedUntil,
        status: args.data.status,
        exportedCount: 0,
        payload: null,
        reexportOfId: null,
        startedAt: args.data.startedAt,
        finishedAt: null,
        message: null,
      }),
      update: async (args) => {
        updateCalls.push(args);
        return {
          id: 'export-log-failed',
          target: 'attendance',
          idempotencyKey: 'export-key-failed',
          reexportOfId: null,
          status: args.data.status,
          updatedSince: null,
          exportedUntil: startedAt,
          exportedCount: 0,
          startedAt,
          finishedAt: args.data.finishedAt,
          message: args.data.message,
        };
      },
    },
  };
  let nowCalls = 0;

  await assert.rejects(
    () =>
      dispatchHrLeaveExport(
        {
          query: { target: 'attendance', limit: 5, offset: 0 },
          idempotencyKey: 'export-key-failed',
          auditContext: buildAuditContext(),
        },
        {
          client,
          buildPayload: async () => {
            throw new Error(longMessage);
          },
          logAudit: async (entry) => {
            auditCalls.push(entry);
          },
          now: () => {
            nowCalls += 1;
            return nowCalls === 1 ? startedAt : finishedAt;
          },
        },
      ),
    /x{520}/,
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].data.status, 'failed');
  assert.equal(updateCalls[0].data.message, longMessage);
  assert.equal(auditCalls.length, 1);
  assert.equal(
    auditCalls[0].action,
    'integration_hr_leave_export_dispatch_failed',
  );
  assert.equal(auditCalls[0].metadata.message.length, 500);
  assert.equal(auditCalls[0].metadata.message.endsWith('...'), true);
});

test('dispatchHrLeaveExport rejects mismatched idempotency keys with audit metadata', async () => {
  const auditCalls = [];
  const requestHash = buildLeaveExportRequestHash({
    target: 'attendance',
    updatedSince: null,
    limit: 5,
    offset: 0,
  });
  const client = {
    leaveIntegrationExportLog: {
      findUnique: async () => ({
        id: 'export-log-conflict',
        target: 'attendance',
        idempotencyKey: 'export-key-conflict',
        requestHash: `${requestHash}-mismatch`,
        updatedSince: null,
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'success',
        exportedCount: 0,
        payload: null,
        reexportOfId: null,
        startedAt: new Date('2026-02-22T10:00:00.000Z'),
        finishedAt: new Date('2026-02-22T10:00:05.000Z'),
        message: null,
      }),
    },
  };

  await assert.rejects(
    () =>
      dispatchHrLeaveExport(
        {
          query: {
            target: 'attendance',
            limit: 5,
            offset: 0,
          },
          idempotencyKey: 'export-key-conflict',
          auditContext: buildAuditContext(),
        },
        {
          client,
          logAudit: async (entry) => {
            auditCalls.push(entry);
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'idempotency_conflict');
      assert.equal(error.statusCode, 409);
      return true;
    },
  );

  assert.equal(auditCalls.length, 1);
  assert.equal(
    auditCalls[0].action,
    'integration_hr_leave_export_dispatch_conflict',
  );
  assert.equal(auditCalls[0].metadata.requestHash, requestHash);
});

test('listHrLeaveExportLogs applies filters and hides request internals', async () => {
  let capturedFindMany = null;
  const client = {
    leaveIntegrationExportLog: {
      findMany: async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'export-log-004',
            target: 'attendance',
            idempotencyKey: 'export-key-004',
            reexportOfId: null,
            status: 'success',
            updatedSince: new Date('2026-02-01T00:00:00.000Z'),
            exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
            exportedCount: 3,
            startedAt: new Date('2026-02-22T10:00:00.000Z'),
            finishedAt: new Date('2026-02-22T10:00:10.000Z'),
            message: 'exported',
          },
        ];
      },
    },
  };

  const result = await listHrLeaveExportLogs(
    {
      target: 'attendance',
      idempotencyKey: ' export-key-004 ',
      limit: '5',
      offset: '4',
    },
    { client },
  );

  assert.equal(result.limit, 5);
  assert.equal(result.offset, 4);
  assert.deepEqual(capturedFindMany.where, {
    target: 'attendance',
    idempotencyKey: 'export-key-004',
  });
  assert.deepEqual(capturedFindMany.orderBy, [
    { startedAt: 'desc' },
    { id: 'desc' },
  ]);
  assert.equal(capturedFindMany.take, 5);
  assert.equal(capturedFindMany.skip, 4);
  assert.equal(result.items[0].id, 'export-log-004');
  assert.equal(result.items[0].requestHash, undefined);
  assert.equal(result.items[0].payload, undefined);
});
