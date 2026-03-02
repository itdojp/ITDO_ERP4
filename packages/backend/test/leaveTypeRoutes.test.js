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

function withEnv(overrides, fn) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withServer(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    },
  );
}

function userHeaders(userId = 'normal-user', options = {}) {
  const headers = {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
  headers['x-user-id'] = userId;
  if (
    Array.isArray(options.groupAccountIds) &&
    options.groupAccountIds.length > 0
  ) {
    headers['x-group-account-ids'] = options.groupAccountIds.join(',');
  }
  return headers;
}

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

test('GET /leave-types returns leave type list', async () => {
  const createdCodes = [];
  await withPrismaStubs(
    {
      'leaveType.findMany': async (args) => {
        if (args?.select?.code === true) {
          return [];
        }
        return [
          {
            code: 'paid',
            name: '年次有給休暇',
            description: null,
            isPaid: true,
            unit: 'mixed',
            requiresApproval: true,
            attachmentPolicy: 'optional',
            active: true,
            displayOrder: 10,
            effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
          },
        ];
      },
      'leaveType.create': async (args) => {
        createdCodes.push(args?.data?.code);
        return { id: `lt-${args?.data?.code}`, ...args?.data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/leave-types',
          headers: userHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(Array.isArray(body?.items), true);
        assert.equal(body.items[0]?.code, 'paid');
      });
    },
  );
  assert.equal(createdCodes.includes('paid'), true);
});

test('POST /leave-requests rejects unknown leave type', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveType.findFirst': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests',
          headers: userHeaders(),
          payload: {
            userId: 'normal-user',
            leaveType: 'unknown',
            startDate: '2026-03-01',
            endDate: '2026-03-01',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_LEAVE_TYPE');
      });
    },
  );
});

test('POST /leave-requests rejects unit mismatch for leave type', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveType.findFirst': async () => ({
        code: 'special',
        unit: 'daily',
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests',
          headers: userHeaders(),
          payload: {
            userId: 'normal-user',
            leaveType: 'special',
            leaveUnit: 'hourly',
            startDate: '2026-03-01',
            endDate: '2026-03-01',
            startTime: '09:00',
            endTime: '10:00',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_TYPE_UNIT_MISMATCH');
      });
    },
  );
});

test('POST /leave-requests rejects leave type not applicable for user groups', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveType.findFirst': async () => ({
        code: 'special',
        unit: 'daily',
        active: true,
        applicableGroupIds: ['employment-fulltime'],
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests',
          headers: userHeaders('normal-user', {
            groupAccountIds: ['employment-contract'],
          }),
          payload: {
            userId: 'normal-user',
            leaveType: 'special',
            leaveUnit: 'daily',
            startDate: '2026-03-01',
            endDate: '2026-03-01',
          },
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_TYPE_NOT_APPLICABLE');
      });
    },
  );
});

test('POST /leave-requests rejects non-string leaveUnit payload', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests',
          headers: userHeaders(),
          payload: {
            userId: 'normal-user',
            leaveType: 'special',
            leaveUnit: { invalid: true },
            startDate: '2026-03-01',
            endDate: '2026-03-01',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_LEAVE_UNIT');
      });
    },
  );
});

test('POST /leave-types creates a leave type as admin', async () => {
  let created = null;
  await withPrismaStubs(
    {
      'leaveType.create': async (args) => {
        created = args.data;
        return { id: 'lt-1', ...args.data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-types',
          headers: adminHeaders(),
          payload: {
            code: 'special_bereavement',
            name: '慶弔休暇',
            isPaid: true,
            unit: 'daily',
            requiresApproval: true,
            attachmentPolicy: 'required',
            displayOrder: 25,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );
  assert.equal(created?.code, 'special_bereavement');
  assert.equal(created?.name, '慶弔休暇');
});

test('POST /leave-types rejects blank name', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/leave-types',
      headers: adminHeaders(),
      payload: {
        code: 'invalid_name',
        name: '   ',
        isPaid: true,
        unit: 'daily',
        requiresApproval: true,
        attachmentPolicy: 'optional',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_LEAVE_TYPE_NAME');
  });
});

test('PATCH /leave-types normalizes blank description to null', async () => {
  let updatePayload = null;
  await withPrismaStubs(
    {
      'leaveType.update': async (args) => {
        updatePayload = args?.data;
        return { id: 'lt-1', code: 'paid', ...args?.data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/leave-types/paid',
          headers: adminHeaders(),
          payload: {
            description: '   ',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );
  assert.equal(updatePayload?.description, null);
});

test('POST /leave-requests/:id/submit rejects required attachment when missing evidence', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveRequest.findUnique': async () => ({
        id: 'leave-1',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-01T00:00:00.000Z'),
        startTimeMinutes: null,
        endTimeMinutes: null,
        minutes: null,
        hours: 8,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'timeEntry.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'required',
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-1/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'ATTACHMENT_EVIDENCE_REQUIRED');
      });
    },
  );
});

test('POST /leave-requests/:id/submit proceeds past attachment check when evidence exists', async () => {
  await withPrismaStubs(
    {
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveRequest.findUnique': async () => ({
        id: 'leave-2',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-01T00:00:00.000Z'),
        startTimeMinutes: null,
        endTimeMinutes: null,
        minutes: null,
        hours: 8,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'timeEntry.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: ['https://example.com/evidence'],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'required',
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-2/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NO_CONSULTATION_REASON_REQUIRED');
      });
    },
  );
});
