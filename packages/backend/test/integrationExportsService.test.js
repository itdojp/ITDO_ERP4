import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationRunStatus } from '@prisma/client';

import {
  IntegrationExportDispatchError,
  buildHrEmployeeMasterCsv,
  buildHrEmployeeMasterCsvFilename,
  buildHrEmployeeMasterExportRequestHash,
  dispatchHrEmployeeMasterExport,
  parseAccountingIcsExportQuery,
  resolveAccountingIcsTemplateOptions,
} from '../dist/services/integrationExports.js';

test('integration export service keeps employee-master CSV order and escaping stable', () => {
  const payload = {
    schemaVersion: 'rakuda_employee_master_v1',
    exportedAt: '2026-03-01T00:00:00.000Z',
    exportedUntil: '2026-03-01T00:00:00.000Z',
    updatedSince: null,
    limit: 500,
    offset: 0,
    exportedCount: 1,
    headers: [
      'employeeCode',
      'loginId',
      'externalIdentityId',
      'displayName',
      'familyName',
      'givenName',
      'activeFlag',
      'employmentType',
      'joinDate',
      'leaveDate',
      'departmentName',
      'organizationName',
      'managerEmployeeCode',
      'departmentCode',
      'payrollType',
      'closingType',
      'paymentType',
      'titleCode',
      'email',
      'phone',
    ],
    items: [
      {
        employeeCode: 'E-001',
        loginId: 'alice',
        externalIdentityId: 'ext-001',
        displayName: '田中, 花子',
        familyName: '田中',
        givenName: '花子',
        activeFlag: '1',
        employmentType: 'full_time',
        joinDate: '2024-04-01',
        leaveDate: '',
        departmentName: '営業"第一"',
        organizationName: '本社',
        managerEmployeeCode: 'M-001',
        departmentCode: 'D001',
        payrollType: 'monthly',
        closingType: 'end_of_month',
        paymentType: 'bank_transfer',
        titleCode: 'TL01',
        email: 'alice@example.com',
        phone: '03-0000-0000',
      },
    ],
  };

  const csv = buildHrEmployeeMasterCsv(payload);
  assert.equal(
    csv.split('\n')[0],
    'employeeCode,loginId,externalIdentityId,displayName,familyName,givenName,activeFlag,employmentType,joinDate,leaveDate,departmentName,organizationName,managerEmployeeCode,departmentCode,payrollType,closingType,paymentType,titleCode,email,phone',
  );
  assert.match(csv, /"田中, 花子"/);
  assert.match(csv, /"営業""第一"""/);
  assert.equal(
    buildHrEmployeeMasterCsvFilename(payload.exportedUntil),
    'rakuda-employee-master-2026-03-01T000000Z.csv',
  );
});

test('integration export service replays matching employee-master dispatch without DB side effects', async () => {
  const idempotencyKey = 'emp-export-key-001';
  const requestHash = buildHrEmployeeMasterExportRequestHash({
    updatedSince: null,
    limit: 500,
    offset: 0,
    format: 'csv',
  });
  const existing = {
    id: 'log-001',
    idempotencyKey,
    requestHash,
    reexportOfId: null,
    status: IntegrationRunStatus.success,
    updatedSince: null,
    exportedUntil: new Date('2026-03-01T00:00:00.000Z'),
    exportedCount: 2,
    startedAt: new Date('2026-03-01T00:00:00.000Z'),
    finishedAt: new Date('2026-03-01T00:00:01.000Z'),
    message: 'exported',
    payload: { exportedCount: 2 },
  };
  const auditEntries = [];
  const result = await dispatchHrEmployeeMasterExport(
    {
      idempotencyKey,
      limit: 500,
      offset: 0,
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user' },
    },
    {
      prisma: {
        hrEmployeeMasterExportLog: {
          findUnique: async () => existing,
        },
      },
      logAudit: async (entry) => {
        auditEntries.push(entry);
      },
    },
  );

  assert.equal(result.replayed, true);
  assert.deepEqual(result.payload, { exportedCount: 2 });
  assert.equal(result.log.id, 'log-001');
  assert.equal(
    auditEntries[0].action,
    'integration_hr_employee_master_export_dispatch_replayed',
  );
});

test('integration export service rejects employee-master idempotency conflicts', async () => {
  const idempotencyKey = 'emp-export-key-002';
  const existing = {
    id: 'log-002',
    idempotencyKey,
    requestHash: 'different-request',
    reexportOfId: null,
    status: IntegrationRunStatus.success,
    updatedSince: null,
    exportedUntil: new Date('2026-03-01T00:00:00.000Z'),
    exportedCount: 2,
    startedAt: new Date('2026-03-01T00:00:00.000Z'),
    finishedAt: new Date('2026-03-01T00:00:01.000Z'),
    message: 'exported',
    payload: { exportedCount: 2 },
  };
  const auditEntries = [];
  await assert.rejects(
    () =>
      dispatchHrEmployeeMasterExport(
        {
          idempotencyKey,
          limit: 500,
          offset: 0,
          actorUserId: 'admin-user',
          auditContext: { userId: 'admin-user' },
        },
        {
          prisma: {
            hrEmployeeMasterExportLog: {
              findUnique: async () => existing,
            },
          },
          logAudit: async (entry) => {
            auditEntries.push(entry);
          },
        },
      ),
    (error) => {
      assert.equal(error instanceof IntegrationExportDispatchError, true);
      assert.equal(error.code, 'idempotency_conflict');
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.responseBody, { error: 'idempotency_conflict' });
      return true;
    },
  );
  assert.equal(
    auditEntries[0].action,
    'integration_hr_employee_master_export_dispatch_conflict',
  );
});

test('integration export service validates accounting ICS template DTOs outside Fastify', () => {
  const parsed = parseAccountingIcsExportQuery({
    format: 'ics_template',
    periodKey: '2026-03',
    companyCode: '=00000080',
    companyName: '@株式会社　アイティードゥ',
    fiscalYearStartMonth: '10',
    limit: '20',
    offset: '3',
  });

  assert.equal(parsed.format, 'ics_template');
  assert.equal(parsed.periodKey, '2026-03');
  assert.equal(parsed.fiscalYearStartMonth, 10);
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.offset, 3);
  assert.deepEqual(resolveAccountingIcsTemplateOptions(parsed), {
    periodKey: '2026-03',
    companyCode: '=00000080',
    companyName: '@株式会社　アイティードゥ',
    fiscalYearStartMonth: 10,
  });
});
