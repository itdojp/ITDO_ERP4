import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  IntegrationExportJobServiceError,
  listIntegrationExportJobs,
  redispatchIntegrationExportJob,
} from '../dist/services/integrationExportJobs.js';

function integrationExportJobClient(overrides = {}) {
  return {
    leaveIntegrationExportLog: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args) => ({ id: 'leave-created', ...args.data }),
      ...(overrides.leaveIntegrationExportLog ?? {}),
    },
    hrEmployeeMasterExportLog: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args) => ({ id: 'employee-created', ...args.data }),
      ...(overrides.hrEmployeeMasterExportLog ?? {}),
    },
    hrAttendanceExportLog: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args) => ({ id: 'attendance-created', ...args.data }),
      ...(overrides.hrAttendanceExportLog ?? {}),
    },
    accountingIcsExportLog: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args) => ({ id: 'accounting-created', ...args.data }),
      ...(overrides.accountingIcsExportLog ?? {}),
    },
  };
}

test('listIntegrationExportJobs merges adapters with stable desc pagination and response scopes', async () => {
  const response = await listIntegrationExportJobs(
    { query: { limit: 10, offset: 0 } },
    {
      client: integrationExportJobClient({
        leaveIntegrationExportLog: {
          findMany: async () => [
            {
              id: 'leave-log-001',
              target: 'payroll',
              idempotencyKey: 'leave-key-001',
              reexportOfId: null,
              status: 'success',
              updatedSince: new Date('2026-03-01T00:00:00.000Z'),
              exportedUntil: new Date('2026-03-14T00:00:00.000Z'),
              exportedCount: 3,
              startedAt: new Date('2026-03-14T09:00:00.000Z'),
              finishedAt: new Date('2026-03-14T09:01:00.000Z'),
              message: 'exported',
            },
          ],
        },
        hrEmployeeMasterExportLog: {
          findMany: async () => [
            {
              id: 'employee-log-001',
              idempotencyKey: 'employee-key-001',
              reexportOfId: 'employee-log-000',
              status: 'failed',
              updatedSince: null,
              exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
              exportedCount: 0,
              startedAt: new Date('2026-03-15T10:00:00.000Z'),
              finishedAt: new Date('2026-03-15T10:02:00.000Z'),
              message: 'employee_master_employee_code_missing',
            },
          ],
        },
        hrAttendanceExportLog: {
          findMany: async () => [
            {
              id: 'attendance-log-001',
              idempotencyKey: 'attendance-key-001',
              reexportOfId: null,
              periodKey: '2026-03',
              closingPeriodId: 'attendance-close-001',
              closingVersion: 4,
              status: 'success',
              exportedUntil: new Date('2026-03-15T11:00:00.000Z'),
              exportedCount: 8,
              startedAt: new Date('2026-03-15T11:00:00.000Z'),
              finishedAt: new Date('2026-03-15T11:01:00.000Z'),
              message: 'exported',
            },
          ],
        },
        accountingIcsExportLog: {
          findMany: async () => [
            {
              id: 'accounting-log-001',
              idempotencyKey: 'accounting-key-001',
              reexportOfId: null,
              periodKey: '2026-03',
              status: 'running',
              exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
              exportedCount: 1,
              startedAt: new Date('2026-03-16T11:00:00.000Z'),
              finishedAt: null,
              message: null,
            },
          ],
        },
      }),
    },
  );

  assert.equal(response.limit, 10);
  assert.deepEqual(
    response.items.map((item) => item.kind),
    [
      'accounting_ics_export',
      'hr_attendance_export',
      'hr_employee_master_export',
      'hr_leave_export_payroll',
    ],
  );
  assert.equal(response.items[0].scope.periodKey, '2026-03');
  assert.equal(response.items[1].scope.closingVersion, 4);
  assert.equal(response.items[2].scope.updatedSince, null);
  assert.equal(response.items[3].scope.target, 'payroll');
});

test('listIntegrationExportJobs applies kind/status filters only to the selected adapter', async () => {
  let employeeArgs = null;
  let leaveCalled = false;
  let attendanceCalled = false;
  let accountingCalled = false;
  const response = await listIntegrationExportJobs(
    {
      query: {
        kind: 'hr_employee_master_export',
        status: 'success',
        limit: '5',
        offset: '2',
      },
    },
    {
      client: integrationExportJobClient({
        leaveIntegrationExportLog: {
          findMany: async () => {
            leaveCalled = true;
            return [];
          },
        },
        hrAttendanceExportLog: {
          findMany: async () => {
            attendanceCalled = true;
            return [];
          },
        },
        accountingIcsExportLog: {
          findMany: async () => {
            accountingCalled = true;
            return [];
          },
        },
        hrEmployeeMasterExportLog: {
          findMany: async (args) => {
            employeeArgs = args;
            return [];
          },
        },
      }),
    },
  );

  assert.deepEqual(response, { items: [], limit: 5, offset: 2 });
  assert.equal(leaveCalled, false);
  assert.equal(attendanceCalled, false);
  assert.equal(accountingCalled, false);
  assert.deepEqual(employeeArgs.where, { status: 'success' });
  assert.equal(employeeArgs.take, 7);
});

test('redispatchIntegrationExportJob creates linked HR attendance rerun and writes audit metadata', async () => {
  const payload = { exportedCount: 1, items: [{ employeeCode: 'EMP-001' }] };
  const createCalls = [];
  const auditEntries = [];
  const client = integrationExportJobClient({
    hrAttendanceExportLog: {
      findUnique: async (args) => {
        if (args?.where?.id === 'attendance-log-source') {
          return {
            id: 'attendance-log-source',
            idempotencyKey: 'attendance-source-key',
            requestHash: 'attendance-request-hash',
            reexportOfId: null,
            periodKey: '2026-03',
            closingPeriodId: 'attendance-close-source',
            closingVersion: 4,
            exportedUntil: new Date('2026-03-17T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload,
            message: 'exported',
            startedAt: new Date('2026-03-17T00:00:00.000Z'),
            finishedAt: new Date('2026-03-17T00:00:05.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'attendance-redispatch-key') {
          return null;
        }
        return null;
      },
      create: async (args) => {
        createCalls.push(args);
        return { id: 'attendance-log-rerun', ...args.data };
      },
    },
  });

  const result = await redispatchIntegrationExportJob(
    {
      kind: 'hr_attendance_export',
      id: 'attendance-log-source',
      idempotencyKey: 'attendance-redispatch-key',
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-redispatch' },
    },
    {
      client,
      now: () => new Date('2026-03-18T00:00:00.000Z'),
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.replayed, false);
  assert.equal(result.log.id, 'attendance-log-rerun');
  assert.equal(result.log.reexportOfId, 'attendance-log-source');
  assert.deepEqual(result.payload, payload);
  assert.equal(createCalls[0].data.reexportOfId, 'attendance-log-source');
  assert.equal(createCalls[0].data.periodKey, '2026-03');
  assert.equal(createCalls[0].data.closingVersion, 4);
  assert.equal(createCalls[0].data.createdBy, 'admin-user');
  assert.equal(
    createCalls[0].data.startedAt.toISOString(),
    '2026-03-18T00:00:00.000Z',
  );
  assert.equal(auditEntries.length, 1);
  assert.equal(
    auditEntries[0].action,
    'integration_hr_attendance_export_redispatched',
  );
  assert.equal(auditEntries[0].targetTable, 'HrAttendanceExportLog');
  assert.equal(auditEntries[0].metadata.sourceLogId, 'attendance-log-source');
  assert.equal(
    auditEntries[0].metadata.idempotencyKey,
    'attendance-redispatch-key',
  );
});

test('redispatchIntegrationExportJob maps existing mismatched idempotency key to conflict with audit', async () => {
  const auditEntries = [];
  const client = integrationExportJobClient({
    accountingIcsExportLog: {
      findUnique: async (args) => {
        if (args?.where?.id === 'accounting-log-source') {
          return {
            id: 'accounting-log-source',
            idempotencyKey: 'accounting-source-key',
            requestHash: 'source-request-hash',
            reexportOfId: null,
            periodKey: '2026-03',
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 2,
            payload: { exportedCount: 2, rows: [] },
            message: 'exported',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:02.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'accounting-redispatch-key') {
          return {
            id: 'accounting-log-existing',
            idempotencyKey: 'accounting-redispatch-key',
            requestHash: 'different-request-hash',
            reexportOfId: 'other-source',
            periodKey: '2026-03',
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload: { exportedCount: 1, rows: [] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:03.000Z'),
            finishedAt: new Date('2026-03-16T00:00:04.000Z'),
          };
        }
        return null;
      },
    },
  });

  await assert.rejects(
    () =>
      redispatchIntegrationExportJob(
        {
          kind: 'accounting_ics_export',
          id: 'accounting-log-source',
          idempotencyKey: 'accounting-redispatch-key',
          auditContext: { userId: 'admin-user' },
        },
        { client, logAudit: async (entry) => auditEntries.push(entry) },
      ),
    (error) => {
      assert.ok(error instanceof IntegrationExportJobServiceError);
      assert.equal(error.code, 'idempotency_conflict');
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.responseBody, { error: 'idempotency_conflict' });
      return true;
    },
  );

  assert.equal(auditEntries.length, 1);
  assert.equal(
    auditEntries[0].action,
    'integration_accounting_ics_export_redispatch_conflict',
  );
  assert.equal(auditEntries[0].metadata.sourceLogId, 'accounting-log-source');
  assert.equal(
    auditEntries[0].metadata.existingRequestHash,
    'different-request-hash',
  );
});

test('redispatchIntegrationExportJob handles blank idempotency and concurrent create replay errors', async () => {
  await assert.rejects(
    () =>
      redispatchIntegrationExportJob(
        {
          kind: 'hr_employee_master_export',
          id: 'employee-log-source',
          idempotencyKey: '   ',
        },
        { client: integrationExportJobClient() },
      ),
    (error) => {
      assert.ok(error instanceof IntegrationExportJobServiceError);
      assert.equal(error.code, 'invalid_idempotencyKey');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );

  let existingLookupCount = 0;
  const client = integrationExportJobClient({
    hrEmployeeMasterExportLog: {
      findUnique: async (args) => {
        if (args?.where?.id === 'employee-log-source') {
          return {
            id: 'employee-log-source',
            idempotencyKey: 'employee-source-key',
            requestHash: 'employee-request-hash',
            reexportOfId: null,
            updatedSince: null,
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload: { exportedCount: 1, items: [] },
            message: 'exported',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:05.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'employee-race-key') {
          existingLookupCount += 1;
          if (existingLookupCount === 1) return null;
          return {
            id: 'employee-log-rerun',
            idempotencyKey: 'employee-race-key',
            requestHash: 'employee-request-hash',
            reexportOfId: 'employee-log-source',
            updatedSince: null,
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'running',
            exportedCount: 1,
            payload: { exportedCount: 1, items: [] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:06.000Z'),
            finishedAt: null,
          };
        }
        return null;
      },
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`idempotencyKey`)',
          { code: 'P2002', clientVersion: 'test' },
        );
      },
    },
  });

  await assert.rejects(
    () =>
      redispatchIntegrationExportJob(
        {
          kind: 'hr_employee_master_export',
          id: 'employee-log-source',
          idempotencyKey: 'employee-race-key',
        },
        { client },
      ),
    (error) => {
      assert.ok(error instanceof IntegrationExportJobServiceError);
      assert.equal(error.code, 'dispatch_in_progress');
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.responseBody, {
        error: 'dispatch_in_progress',
        logId: 'employee-log-rerun',
      });
      return true;
    },
  );
});
