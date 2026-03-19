import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';

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

test('GET /integrations/hr/exports/users supports updatedSince and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'userAccount.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'user-001',
            employeeCode: 'E-001',
            userName: 'alice',
            displayName: 'Alice',
            employmentType: 'full_time',
            joinedAt: new Date('2024-04-01T00:00:00.000Z'),
            leftAt: null,
            payrollProfile: {
              payrollType: 'monthly',
              closingType: 'end_of_month',
              paymentType: 'bank_transfer',
              titleCode: 'TL01',
              departmentCode: 'D001',
            },
            updatedAt: new Date('2026-02-23T00:00:00.000Z'),
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/users?updatedSince=2026-02-20T00:00:00.000Z&limit=10&offset=2',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 2);
        assert.equal(Array.isArray(body.items), true);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].employeeCode, 'E-001');
        assert.equal(body.items[0].employmentType, 'full_time');
        assert.equal(body.items[0].payrollProfile?.departmentCode, 'D001');
        assert.equal(body.items[0].payrollProfile?.bankInfo, undefined);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(
    capturedFindMany?.include?.payrollProfile?.select?.departmentCode,
    true,
  );
  assert.equal(
    capturedFindMany?.include?.payrollProfile?.select?.bankInfo,
    undefined,
  );
  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 2);
  assert.deepEqual(capturedFindMany?.orderBy, { createdAt: 'desc' });
  assert.equal(Array.isArray(capturedFindMany?.where?.OR), true);
  assert.equal(
    capturedFindMany?.where?.OR?.[0]?.updatedAt?.gt instanceof Date,
    true,
  );
  assert.equal(
    capturedFindMany?.where?.OR?.[1]?.payrollProfile?.is?.updatedAt
      ?.gt instanceof Date,
    true,
  );
});

test('GET /integrations/hr/exports/users returns 400 for invalid updatedSince', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/integrations/hr/exports/users?updatedSince=invalid',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      const errorCode =
        typeof body.error === 'string' ? body.error : body?.error?.code;
      assert.equal(errorCode, 'invalid_updatedSince');
    } finally {
      await server.close();
    }
  });
});

test('GET /integrations/hr/exports/users/employee-master returns canonical payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const capturedFindManyCalls = [];
  await withPrismaStubs(
    {
      'userAccount.findMany': async (args) => {
        capturedFindManyCalls.push(args);
        if (args?.where?.id?.in) {
          return [
            {
              id: 'manager-001',
              employeeCode: 'M-001',
            },
          ];
        }
        return [
          {
            id: 'user-001',
            employeeCode: 'E-001',
            externalId: 'ext-001',
            userName: 'alice',
            displayName: null,
            familyName: '田中',
            givenName: '花子',
            active: true,
            employmentType: 'full_time',
            joinedAt: new Date('2024-04-01T00:00:00.000Z'),
            leftAt: null,
            department: '営業',
            organization: '本社',
            managerUserId: 'manager-001',
            emails: [{ value: 'alice@example.com', primary: true }],
            phoneNumbers: ['03-0000-0000'],
            payrollProfile: {
              payrollType: 'monthly',
              closingType: 'end_of_month',
              paymentType: 'bank_transfer',
              titleCode: 'TL01',
              departmentCode: 'D001',
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
          url: '/integrations/hr/exports/users/employee-master?updatedSince=2026-02-20T00:00:00.000Z&limit=10&offset=2',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.schemaVersion, 'rakuda_employee_master_v1');
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 2);
        assert.equal(body.exportedCount, 1);
        assert.equal(body.headers[0], 'employeeCode');
        assert.equal(body.items[0].employeeCode, 'E-001');
        assert.equal(body.items[0].displayName, '田中 花子');
        assert.equal(body.items[0].managerEmployeeCode, 'M-001');
        assert.equal(body.items[0].departmentCode, 'D001');
        assert.equal(body.items[0].email, 'alice@example.com');
        assert.equal(body.items[0].phone, '03-0000-0000');
      } finally {
        await server.close();
      }
    },
  );

  const capturedFindMany = capturedFindManyCalls.find(
    (args) => Array.isArray(args?.orderBy) && args.orderBy[0]?.employeeCode === 'asc',
  );
  assert.deepEqual(capturedFindMany?.orderBy, [
    { employeeCode: 'asc' },
    { id: 'asc' },
  ]);
  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 2);
  assert.equal(
    capturedFindMany?.where?.OR?.[1]?.payrollProfile?.is?.updatedAt
      ?.gt instanceof Date,
    true,
  );
});

test('GET /integrations/hr/exports/users/employee-master returns csv when format=csv', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userAccount.findMany': async (args) => {
        if (args?.where?.id?.in) {
          return [
            {
              id: 'manager-001',
              employeeCode: 'M-001',
            },
          ];
        }
        return [
          {
            id: 'user-001',
            employeeCode: 'E-001',
            externalId: 'ext-001',
            userName: 'alice',
            displayName: 'Alice',
            familyName: '田中',
            givenName: '花子',
            active: true,
            employmentType: 'full_time',
            joinedAt: new Date('2024-04-01T00:00:00.000Z'),
            leftAt: null,
            department: '営業',
            organization: '本社',
            managerUserId: 'manager-001',
            emails: [{ value: 'alice@example.com', primary: true }],
            phoneNumbers: ['03-0000-0000'],
            payrollProfile: {
              payrollType: 'monthly',
              closingType: 'end_of_month',
              paymentType: 'bank_transfer',
              titleCode: 'TL01',
              departmentCode: 'D001',
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
          url: '/integrations/hr/exports/users/employee-master?format=csv',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          res.headers['content-type'] ?? '',
          /text\/csv/i,
          'content-type should be csv',
        );
        assert.match(
          res.headers['content-disposition'] ?? '',
          /rakuda-employee-master-/,
        );
        assert.match(res.body, /^employeeCode,loginId,externalIdentityId,/);
        assert.match(res.body, /E-001,alice,ext-001,Alice,田中,花子,1,full_time,2024-04-01,,営業,本社,M-001,/);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/users/employee-master returns 409 when employeeCode is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: null,
          externalId: null,
          userName: 'alice',
          displayName: 'Alice',
          familyName: null,
          givenName: null,
          active: true,
          employmentType: null,
          joinedAt: null,
          leftAt: null,
          department: null,
          organization: null,
          emails: null,
          phoneNumbers: null,
          payrollProfile: null,
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/users/employee-master',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'employee_master_employee_code_missing');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/users/employee-master returns 409 when managerEmployeeCode cannot be resolved', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userAccount.findMany': async (args) => {
        if (args?.where?.id?.in) {
          return [];
        }
        return [
          {
            id: 'user-001',
            employeeCode: 'E-001',
            externalId: null,
            userName: 'alice',
            displayName: 'Alice',
            familyName: null,
            givenName: null,
            active: true,
            employmentType: 'full_time',
            joinedAt: null,
            leftAt: null,
            department: null,
            organization: null,
            managerUserId: 'manager-404',
            emails: null,
            phoneNumbers: null,
            payrollProfile: null,
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/users/employee-master',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'employee_master_manager_employee_code_missing');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/hr/exports/users/employee-master/dispatch creates export log and persists payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let createCall = null;
  let updateCall = null;
  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async () => null,
      'hrEmployeeMasterExportLog.create': async (args) => {
        createCall = args;
        return {
          id: 'emp-export-log-001',
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          updatedSince: args.data.updatedSince,
          exportedUntil: args.data.exportedUntil,
          status: args.data.status,
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: args.data.startedAt,
          finishedAt: null,
        };
      },
      'hrEmployeeMasterExportLog.update': async (args) => {
        updateCall = args;
        return {
          id: 'emp-export-log-001',
          idempotencyKey: 'emp-export-key-001',
          status: args.data.status,
          updatedSince: new Date('2026-02-20T00:00:00.000Z'),
          exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
          exportedCount: args.data.exportedCount,
          startedAt: new Date('2026-03-15T00:00:00.000Z'),
          finishedAt: args.data.finishedAt,
          message: args.data.message,
          payload: args.data.payload,
        };
      },
      'userAccount.findMany': async (args) => {
        if (args?.where?.id?.in) {
          return [
            {
              id: 'manager-001',
              employeeCode: 'M-001',
            },
          ];
        }
        return [
          {
            id: 'user-001',
            employeeCode: 'E-001',
            externalId: 'ext-001',
            userName: 'alice',
            displayName: 'Alice',
            familyName: '田中',
            givenName: '花子',
            active: true,
            employmentType: 'full_time',
            joinedAt: new Date('2024-04-01T00:00:00.000Z'),
            leftAt: null,
            department: '営業',
            organization: '本社',
            managerUserId: 'manager-001',
            emails: [{ value: 'alice@example.com', primary: true }],
            phoneNumbers: ['03-0000-0000'],
            payrollProfile: {
              payrollType: 'monthly',
              closingType: 'end_of_month',
              paymentType: 'bank_transfer',
              titleCode: 'TL01',
              departmentCode: 'D001',
            },
          },
        ];
      },
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/users/employee-master/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'emp-export-key-001',
            updatedSince: '2026-02-20T00:00:00.000Z',
            limit: 20,
            offset: 1,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.payload.schemaVersion, 'rakuda_employee_master_v1');
        assert.equal(body.payload.exportedCount, 1);
        assert.equal(body.log.idempotencyKey, 'emp-export-key-001');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCall?.data?.idempotencyKey, 'emp-export-key-001');
  assert.equal(updateCall?.data?.exportedCount, 1);
  assert.equal(
    updateCall?.data?.payload?.schemaVersion,
    'rakuda_employee_master_v1',
  );
});

test('POST /integrations/hr/exports/users/employee-master/dispatch replays previous success with same idempotency key', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async () => ({
        id: 'emp-export-log-002',
        idempotencyKey: 'emp-export-key-002',
        requestHash: createHash('sha256')
          .update(
            JSON.stringify({
              updatedSince: '2026-02-20T00:00:00.000Z',
              limit: 20,
              offset: 0,
              format: 'csv',
            }),
            'utf8',
          )
          .digest('hex'),
        updatedSince: new Date('2026-02-20T00:00:00.000Z'),
        exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
        status: 'success',
        exportedCount: 1,
        payload: { schemaVersion: 'rakuda_employee_master_v1' },
        message: 'exported',
        startedAt: new Date('2026-03-15T00:00:00.000Z'),
        finishedAt: new Date('2026-03-15T00:01:00.000Z'),
      }),
      'auditLog.create': async () => ({ id: 'audit-002' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/users/employee-master/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'emp-export-key-002',
            updatedSince: '2026-02-20T00:00:00.000Z',
            limit: 20,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, true);
        assert.equal(body.log.id, 'emp-export-log-002');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/hr/exports/users/employee-master/dispatch returns 409 while same request is running', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        updatedSince: null,
        limit: 5,
        offset: 0,
        format: 'csv',
      }),
      'utf8',
    )
    .digest('hex');
  let createCalled = false;
  let auditCreateCount = 0;
  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async () => ({
        id: 'emp-export-log-002-running',
        idempotencyKey: 'emp-export-key-002-running',
        requestHash,
        updatedSince: null,
        exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
        status: 'running',
        exportedCount: 0,
        payload: null,
        message: null,
        startedAt: new Date('2026-03-15T00:00:00.000Z'),
        finishedAt: null,
      }),
      'hrEmployeeMasterExportLog.create': async () => {
        createCalled = true;
        return { id: 'unexpected' };
      },
      'auditLog.create': async () => {
        auditCreateCount += 1;
        return { id: 'audit-running' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/users/employee-master/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'emp-export-key-002-running',
            limit: 5,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'dispatch_in_progress');
        assert.equal(body.logId, 'emp-export-log-002-running');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCalled, false);
  assert.equal(auditCreateCount, 0);
});

test('POST /integrations/hr/exports/users/employee-master/dispatch returns 409 on idempotency conflict', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async () => ({
        id: 'emp-export-log-003',
        idempotencyKey: 'emp-export-key-003',
        requestHash: 'different-hash',
        updatedSince: null,
        exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
        status: 'success',
        exportedCount: 0,
        payload: null,
        message: null,
        startedAt: new Date('2026-03-15T00:00:00.000Z'),
        finishedAt: new Date('2026-03-15T00:01:00.000Z'),
      }),
      'auditLog.create': async () => ({ id: 'audit-003' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/users/employee-master/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'emp-export-key-003',
            limit: 5,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'idempotency_conflict');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/hr/exports/users/employee-master/dispatch handles concurrent create race as in-progress replay', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        updatedSince: null,
        limit: 5,
        offset: 0,
        format: 'csv',
      }),
      'utf8',
    )
    .digest('hex');
  let findUniqueCalls = 0;
  let createCalls = 0;
  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async () => {
        findUniqueCalls += 1;
        if (findUniqueCalls === 1) {
          return null;
        }
        return {
          id: 'emp-export-log-race',
          idempotencyKey: 'emp-export-key-race',
          requestHash,
          updatedSince: null,
          exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
          status: 'running',
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: new Date('2026-03-15T00:00:00.000Z'),
          finishedAt: null,
        };
      },
      'hrEmployeeMasterExportLog.create': async () => {
        createCalls += 1;
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`idempotencyKey`)',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        );
      },
      'auditLog.create': async () => ({ id: 'audit-race' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/users/employee-master/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'emp-export-key-race',
            limit: 5,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'dispatch_in_progress');
        assert.equal(body.logId, 'emp-export-log-race');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCalls, 1);
  assert.equal(findUniqueCalls, 2);
});

test('GET /integrations/hr/exports/users/employee-master/dispatch-logs supports filters and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'emp-export-log-004',
            idempotencyKey: 'emp-export-key-004',
            status: 'success',
            updatedSince: new Date('2026-02-20T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
            exportedCount: 3,
            startedAt: new Date('2026-03-15T00:00:00.000Z'),
            finishedAt: new Date('2026-03-15T00:01:00.000Z'),
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
          url: '/integrations/hr/exports/users/employee-master/dispatch-logs?idempotencyKey=emp-export-key-004&limit=5&offset=4',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(body.offset, 4);
        assert.equal(body.items[0].idempotencyKey, 'emp-export-key-004');
      } finally {
        await server.close();
      }
    },
  );

  assert.deepEqual(capturedFindMany?.where, {
    idempotencyKey: 'emp-export-key-004',
  });
  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.skip, 4);
});

test('GET /integrations/hr/exports/attendance returns latest closing payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'attendance-close-001',
        periodKey: '2026-03',
        version: 2,
        closedAt: new Date('2026-03-31T15:00:00.000Z'),
      }),
      'attendanceMonthlySummary.findMany': async () => [
        {
          employeeCode: 'EMP-001',
          workedDayCount: 20,
          scheduledWorkMinutes: 9600,
          approvedWorkMinutes: 9780,
          overtimeTotalMinutes: 180,
          overtimeWithinStatutoryMinutes: 60,
          overtimeOverStatutoryMinutes: 120,
          holidayWorkMinutes: 0,
          paidLeaveMinutes: 120,
          unpaidLeaveMinutes: 0,
          totalLeaveMinutes: 120,
          sourceTimeEntryCount: 22,
          sourceLeaveRequestCount: 1,
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/attendance?periodKey=2026-03',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-03');
        assert.equal(body.closingId, 'attendance-close-001');
        assert.equal(body.closingVersion, 2);
        assert.equal(body.exportedCount, 1);
        assert.equal(body.items[0].employeeCode, 'EMP-001');
        assert.equal(body.items[0].overtimeTotalMinutes, '180');
        assert.equal(body.items[0].overtimeWithinStatutoryMinutes, '60');
        assert.equal(body.items[0].overtimeOverStatutoryMinutes, '120');
        assert.equal(body.items[0].holidayWorkMinutes, '0');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/attendance returns csv when format=csv', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'attendance-close-002',
        periodKey: '2026-03',
        version: 1,
        closedAt: new Date('2026-03-31T15:00:00.000Z'),
      }),
      'attendanceMonthlySummary.findMany': async () => [
        {
          employeeCode: 'EMP-002',
          workedDayCount: 19,
          scheduledWorkMinutes: 9120,
          approvedWorkMinutes: 9300,
          overtimeTotalMinutes: 180,
          overtimeWithinStatutoryMinutes: 0,
          overtimeOverStatutoryMinutes: 120,
          holidayWorkMinutes: 60,
          paidLeaveMinutes: 0,
          unpaidLeaveMinutes: 60,
          totalLeaveMinutes: 60,
          sourceTimeEntryCount: 21,
          sourceLeaveRequestCount: 1,
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/attendance?periodKey=2026-03&format=csv',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          res.headers['content-disposition'],
          /rakuda-attendance-2026-03-v1-/,
        );
        assert.match(
          res.body,
          /employeeCode,closingMonth,closingVersion,workedDayCount,scheduledWorkMinutes,approvedWorkMinutes,overtimeTotalMinutes,overtimeWithinStatutoryMinutes,overtimeOverStatutoryMinutes,holidayWorkMinutes/,
        );
        assert.match(res.body, /EMP-002,2026-03,1/);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/attendance returns 404 when no closed snapshot exists', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/attendance?periodKey=2026-03',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_closing_not_found');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/hr/exports/attendance/dispatch creates export log and persists payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCreate = null;
  let capturedUpdate = null;
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'attendance-close-003',
        periodKey: '2026-03',
        version: 3,
        closedAt: new Date('2026-03-31T15:00:00.000Z'),
      }),
      'attendanceMonthlySummary.findMany': async () => [
        {
          employeeCode: 'EMP-003',
          workedDayCount: 20,
          scheduledWorkMinutes: 9600,
          approvedWorkMinutes: 9600,
          overtimeTotalMinutes: 0,
          overtimeWithinStatutoryMinutes: 0,
          overtimeOverStatutoryMinutes: 0,
          holidayWorkMinutes: 0,
          paidLeaveMinutes: 0,
          unpaidLeaveMinutes: 0,
          totalLeaveMinutes: 0,
          sourceTimeEntryCount: 20,
          sourceLeaveRequestCount: 0,
        },
      ],
      'hrAttendanceExportLog.findUnique': async () => null,
      'hrAttendanceExportLog.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'attendance-export-log-001',
          ...args.data,
        };
      },
      'hrAttendanceExportLog.update': async (args) => {
        capturedUpdate = args;
        return {
          id: 'attendance-export-log-001',
          ...args.data,
        };
      },
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/attendance/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            periodKey: '2026-03',
            idempotencyKey: 'attendance-export-key-001',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.log.id, 'attendance-export-log-001');
        assert.equal(body.log.periodKey, '2026-03');
        assert.equal(body.log.closingVersion, 3);
        assert.equal(body.payload.exportedCount, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedCreate?.data?.periodKey, '2026-03');
  assert.equal(capturedCreate?.data?.closingPeriodId, 'attendance-close-003');
  assert.equal(capturedUpdate?.data?.exportedCount, 1);
  assert.equal(
    capturedUpdate?.data?.payload?.exportedUntil,
    capturedCreate?.data?.exportedUntil?.toISOString(),
  );
});

test('POST /integrations/hr/exports/attendance/dispatch replays previous success with same idempotency key', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        periodKey: '2026-03',
        format: 'csv',
      }),
      'utf8',
    )
    .digest('hex');
  const payload = {
    schemaVersion: 'rakuda_attendance_v1',
    exportedAt: '2026-03-17T00:00:00.000Z',
    exportedUntil: '2026-03-17T00:00:00.000Z',
    periodKey: '2026-03',
    closingId: 'attendance-close-004',
    closingVersion: 4,
    closedAt: '2026-03-31T15:00:00.000Z',
    exportedCount: 1,
    headers: ['employeeCode'],
    items: [{ employeeCode: 'EMP-004' }],
  };
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'attendance-close-004',
        periodKey: '2026-03',
        version: 4,
        closedAt: new Date('2026-03-31T15:00:00.000Z'),
      }),
      'attendanceMonthlySummary.findMany': async () => [
        {
          employeeCode: 'EMP-004',
          workedDayCount: 20,
          scheduledWorkMinutes: 9600,
          approvedWorkMinutes: 9600,
          overtimeTotalMinutes: 0,
          overtimeWithinStatutoryMinutes: 0,
          overtimeOverStatutoryMinutes: 0,
          holidayWorkMinutes: 0,
          paidLeaveMinutes: 0,
          unpaidLeaveMinutes: 0,
          totalLeaveMinutes: 0,
          sourceTimeEntryCount: 20,
          sourceLeaveRequestCount: 0,
        },
      ],
      'hrAttendanceExportLog.findUnique': async () => ({
        id: 'attendance-export-log-002',
        idempotencyKey: 'attendance-export-key-002',
        requestHash,
        reexportOfId: null,
        periodKey: '2026-03',
        closingPeriodId: 'attendance-close-004',
        closingVersion: 4,
        exportedUntil: new Date('2026-03-17T00:00:00.000Z'),
        status: 'success',
        exportedCount: 1,
        payload,
        message: 'exported',
        startedAt: new Date('2026-03-17T00:00:00.000Z'),
        finishedAt: new Date('2026-03-17T00:00:10.000Z'),
      }),
      'auditLog.create': async () => ({ id: 'audit-002' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/attendance/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            periodKey: '2026-03',
            idempotencyKey: 'attendance-export-key-002',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, true);
        assert.equal(body.log.id, 'attendance-export-log-002');
        assert.deepEqual(body.payload, payload);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/attendance/dispatch-logs supports filters and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'hrAttendanceExportLog.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'attendance-export-log-003',
            idempotencyKey: 'attendance-export-key-003',
            reexportOfId: null,
            periodKey: '2026-03',
            closingPeriodId: 'attendance-close-005',
            closingVersion: 1,
            status: 'success',
            exportedUntil: new Date('2026-03-17T00:00:00.000Z'),
            exportedCount: 12,
            startedAt: new Date('2026-03-17T00:00:00.000Z'),
            finishedAt: new Date('2026-03-17T00:01:00.000Z'),
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
          url: '/integrations/hr/exports/attendance/dispatch-logs?periodKey=2026-03&idempotencyKey=attendance-export-key-003&limit=5&offset=4',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(body.offset, 4);
        assert.equal(body.items[0].idempotencyKey, 'attendance-export-key-003');
        assert.equal(body.items[0].closingVersion, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.deepEqual(capturedFindMany?.where, {
    periodKey: '2026-03',
    idempotencyKey: 'attendance-export-key-003',
  });
  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.skip, 4);
});

test('GET /integrations/hr/exports/wellbeing returns data and enforces role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'wellbeingEntry.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'well-001',
            userId: 'user-001',
            status: 'good',
            entryDate: new Date('2026-02-23T00:00:00.000Z'),
            updatedAt: new Date('2026-02-23T00:00:00.000Z'),
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const forbidden = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/wellbeing',
          headers: {
            'x-user-id': 'normal-user',
            'x-roles': 'user',
          },
        });
        assert.equal(forbidden.statusCode, 403, forbidden.body);

        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/wellbeing?limit=5',
          headers: {
            'x-user-id': 'mgmt-user',
            'x-roles': 'mgmt',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(Array.isArray(body.items), true);
        assert.equal(body.items.length, 1);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.orderBy?.entryDate, 'desc');
});

test('GET /integrations/hr/exports/leaves returns approved leave exports with leave type metadata', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedLeaveFindMany = null;
  let capturedLeaveTypeFindMany = null;
  await withPrismaStubs(
    {
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveRequest.findMany': async (args) => {
        capturedLeaveFindMany = args;
        return [
          {
            id: 'leave-001',
            userId: 'user-001',
            leaveType: 'paid',
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
      'leaveType.findMany': async (args) => {
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
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/leaves?target=payroll&updatedSince=2026-02-01T00:00:00.000Z&limit=10&offset=3',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.target, 'payroll');
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 3);
        assert.equal(typeof body.exportedUntil, 'string');
        assert.equal(body.exportedCount, 1);
        assert.equal(body.items[0].id, 'leave-001');
        assert.equal(body.items[0].requestedMinutes, 120);
        assert.equal(body.items[0].leaveTypeName, '年次有給休暇');
        assert.equal(body.items[0].leaveTypeUnit, 'mixed');
        assert.equal(body.items[0].leaveTypeIsPaid, true);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedLeaveFindMany?.take, 10);
  assert.equal(capturedLeaveFindMany?.skip, 3);
  assert.equal(capturedLeaveFindMany?.where?.status, 'approved');
  assert.equal(
    capturedLeaveFindMany?.where?.updatedAt?.gt instanceof Date,
    true,
  );
  assert.equal(
    capturedLeaveFindMany?.where?.updatedAt?.lte instanceof Date,
    true,
  );
  assert.deepEqual(capturedLeaveTypeFindMany?.where, {
    code: { in: ['paid'] },
  });
});

test('POST /integrations/hr/exports/leaves/dispatch creates export log and persists payload', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let createCall = null;
  let updateCall = null;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async () => null,
      'leaveIntegrationExportLog.create': async (args) => {
        createCall = args;
        return {
          id: 'export-log-001',
          target: args.data.target,
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          updatedSince: args.data.updatedSince ?? null,
          exportedUntil: args.data.exportedUntil,
          status: 'running',
          exportedCount: 0,
          payload: null,
          message: null,
          startedAt: args.data.startedAt,
          finishedAt: null,
        };
      },
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-002',
          userId: 'user-002',
          leaveType: 'paid',
          startDate: new Date('2026-02-21T00:00:00.000Z'),
          endDate: new Date('2026-02-21T00:00:00.000Z'),
          hours: null,
          minutes: 60,
          startTimeMinutes: 600,
          endTimeMinutes: 660,
          notes: null,
          createdAt: new Date('2026-02-20T12:00:00.000Z'),
          updatedAt: new Date('2026-02-21T12:00:00.000Z'),
        },
      ],
      'leaveType.findMany': async () => [
        {
          code: 'paid',
          name: '年次有給休暇',
          unit: 'mixed',
          isPaid: true,
        },
      ],
      'leaveIntegrationExportLog.update': async (args) => {
        updateCall = args;
        return {
          id: 'export-log-001',
          target: 'attendance',
          idempotencyKey: 'export-key-001',
          status: args.data.status,
          updatedSince: new Date('2026-02-01T00:00:00.000Z'),
          exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
          exportedCount: args.data.exportedCount ?? 0,
          startedAt: new Date('2026-02-22T10:00:00.000Z'),
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
          url: '/integrations/hr/exports/leaves/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            target: 'attendance',
            idempotencyKey: 'export-key-001',
            updatedSince: '2026-02-01T00:00:00.000Z',
            limit: 10,
            offset: 2,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.payload.target, 'attendance');
        assert.equal(body.payload.exportedCount, 1);
        assert.equal(body.log.status, 'success');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCall?.data?.target, 'attendance');
  assert.equal(createCall?.data?.idempotencyKey, 'export-key-001');
  assert.equal(typeof createCall?.data?.requestHash, 'string');
  assert.equal(updateCall?.data?.status, 'success');
  assert.equal(updateCall?.data?.exportedCount, 1);
  assert.equal(updateCall?.data?.exportedUntil, undefined);
});

test('POST /integrations/hr/exports/leaves/dispatch replays previous success with same idempotency key', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const updatedSince = '2026-02-01T00:00:00.000Z';
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        target: 'attendance',
        updatedSince,
        limit: 10,
        offset: 2,
      }),
      'utf8',
    )
    .digest('hex');
  let createCalled = false;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async () => ({
        id: 'export-log-002',
        target: 'attendance',
        idempotencyKey: 'export-key-002',
        requestHash,
        updatedSince: new Date(updatedSince),
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'success',
        exportedCount: 1,
        payload: {
          target: 'attendance',
          exportedAt: '2026-02-22T10:00:00.000Z',
          exportedUntil: '2026-02-22T09:59:00.000Z',
          updatedSince,
          limit: 10,
          offset: 2,
          exportedCount: 1,
          items: [{ id: 'leave-003' }],
        },
        startedAt: new Date('2026-02-22T09:59:00.000Z'),
        finishedAt: new Date('2026-02-22T10:00:00.000Z'),
        message: 'exported',
      }),
      'leaveIntegrationExportLog.create': async () => {
        createCalled = true;
        return { id: 'unexpected' };
      },
      'auditLog.create': async () => ({ id: 'audit-002' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/leaves/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            target: 'attendance',
            idempotencyKey: 'export-key-002',
            updatedSince,
            limit: 10,
            offset: 2,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, true);
        assert.equal(body.payload.exportedCount, 1);
        assert.equal(body.log.id, 'export-log-002');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCalled, false);
});

test('POST /integrations/hr/exports/leaves/dispatch returns 409 while same request is running', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        target: 'attendance',
        updatedSince: null,
        limit: 5,
        offset: 0,
      }),
      'utf8',
    )
    .digest('hex');
  let createCalled = false;
  let auditCreateCount = 0;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async () => ({
        id: 'export-log-002-running',
        target: 'attendance',
        idempotencyKey: 'export-key-002-running',
        requestHash,
        updatedSince: null,
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'running',
        exportedCount: 0,
        payload: null,
        startedAt: new Date('2026-02-22T09:59:00.000Z'),
        finishedAt: null,
        message: null,
      }),
      'leaveIntegrationExportLog.create': async () => {
        createCalled = true;
        return { id: 'unexpected' };
      },
      'auditLog.create': async () => {
        auditCreateCount += 1;
        return { id: 'audit-running' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/leaves/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            target: 'attendance',
            idempotencyKey: 'export-key-002-running',
            limit: 5,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'dispatch_in_progress');
        assert.equal(body.logId, 'export-log-002-running');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createCalled, false);
  assert.equal(auditCreateCount, 0);
});

test('POST /integrations/hr/exports/leaves/dispatch returns 409 on idempotency conflict', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async () => ({
        id: 'export-log-003',
        target: 'payroll',
        idempotencyKey: 'export-key-003',
        requestHash: 'different-hash',
        updatedSince: null,
        exportedUntil: new Date('2026-02-22T10:00:00.000Z'),
        status: 'success',
        exportedCount: 0,
        payload: null,
        startedAt: new Date('2026-02-22T09:59:00.000Z'),
        finishedAt: new Date('2026-02-22T10:00:00.000Z'),
        message: null,
      }),
      'auditLog.create': async () => ({ id: 'audit-003' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/exports/leaves/dispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            target: 'payroll',
            idempotencyKey: 'export-key-003',
            limit: 5,
            offset: 0,
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'idempotency_conflict');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/hr/exports/leaves/dispatch-logs supports filters and pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'export-log-004',
            target: 'attendance',
            idempotencyKey: 'export-key-004',
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
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/hr/exports/leaves/dispatch-logs?target=attendance&idempotencyKey=export-key-004&limit=5&offset=4',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 5);
        assert.equal(body.offset, 4);
        assert.equal(Array.isArray(body.items), true);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].idempotencyKey, 'export-key-004');
        assert.equal(body.items[0].payload, undefined);
        assert.equal(body.items[0].requestHash, undefined);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.take, 5);
  assert.equal(capturedFindMany?.skip, 4);
  assert.deepEqual(capturedFindMany?.where, {
    target: 'attendance',
    idempotencyKey: 'export-key-004',
  });
  assert.deepEqual(capturedFindMany?.select, {
    id: true,
    target: true,
    idempotencyKey: true,
    reexportOfId: true,
    status: true,
    updatedSince: true,
    exportedUntil: true,
    exportedCount: true,
    startedAt: true,
    finishedAt: true,
    message: true,
  });
});
