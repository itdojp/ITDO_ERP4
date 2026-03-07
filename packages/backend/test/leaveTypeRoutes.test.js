import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  const mergedStubs = {
    'referenceLink.findMany': async () => [],
    ...stubs,
  };
  for (const [path, stub] of Object.entries(mergedStubs)) {
    const [model, method] = path.split('.');
    if (!method) {
      if (typeof prisma[model] !== 'function') {
        throw new Error(`invalid stub target: ${path}`);
      }
      const original = prisma[model];
      prisma[model] = stub;
      restores.push(() => {
        prisma[model] = original;
      });
      continue;
    }
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

function dateAtUtcDayOffset(offsetDays) {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offsetDays,
    ),
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
      'leaveRequest.count': async () => 0,
      'leaveRequest.findMany': async () => [],
      'annotation.findUnique': async () => ({
        internalRefs: [{ kind: 'project', id: 'proj-legacy' }],
        externalUrls: ['https://legacy.example.com/only-json'],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'required',
        active: true,
      }),
      'referenceLink.findMany': async () => [],
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
      'leaveRequest.count': async () => 0,
      'leaveRequest.findMany': async () => [],
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: ['https://example.com/evidence'],
      }),
      'referenceLink.findMany': async () => [
        {
          linkKind: 'external_url',
          refKind: '',
          value: 'https://example.com/evidence',
          label: null,
          updatedAt: new Date('2026-03-07T00:00:00.000Z'),
          updatedBy: 'user-1',
        },
      ],
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

test('POST /leave-requests/:id/submit accepts attachment evidence from reference_links', async () => {
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
        id: 'leave-2b',
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
      'leaveRequest.count': async () => 0,
      'leaveRequest.findMany': async () => [],
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'referenceLink.findMany': async () => [
        {
          linkKind: 'external_url',
          refKind: null,
          value: 'https://example.com/evidence-from-table',
          label: null,
          updatedAt: new Date('2026-03-07T00:00:00.000Z'),
          updatedBy: 'user-1',
        },
      ],
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
          url: '/leave-requests/leave-2b/submit',
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

test('POST /leave-requests/:id/submit rejects when lead days requirement is not met', async () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
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
        id: 'leave-lead-days',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: tomorrow,
        endDate: tomorrow,
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
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: true,
        submitLeadDays: 2,
        allowRetroactiveSubmit: true,
        retroactiveLimitDays: null,
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-lead-days/submit',
          headers: userHeaders(),
          payload: {
            noConsultationConfirmed: true,
            noConsultationReason: 'lead-days',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_SUBMIT_LEAD_DAYS_REQUIRED');
      });
    },
  );
});

test('POST /leave-requests/:id/submit allows submit when lead days requirement is exactly met', async () => {
  const boundaryDate = dateAtUtcDayOffset(2);
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
        id: 'leave-lead-days-boundary',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: boundaryDate,
        endDate: boundaryDate,
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
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: true,
        submitLeadDays: 2,
        allowRetroactiveSubmit: true,
        retroactiveLimitDays: null,
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-lead-days-boundary/submit',
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

test('POST /leave-requests/:id/submit rejects retroactive submit when disabled', async () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
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
        id: 'leave-retro-disabled',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: yesterday,
        endDate: yesterday,
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
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: true,
        submitLeadDays: 0,
        allowRetroactiveSubmit: false,
        retroactiveLimitDays: null,
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-retro-disabled/submit',
          headers: userHeaders(),
          payload: {
            noConsultationConfirmed: true,
            noConsultationReason: 'retro-disabled',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_RETROACTIVE_SUBMIT_FORBIDDEN');
      });
    },
  );
});

test('POST /leave-requests/:id/submit allows retroactive submit at limit boundary', async () => {
  const boundaryDate = dateAtUtcDayOffset(-3);
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
        id: 'leave-retro-limit-boundary',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: boundaryDate,
        endDate: boundaryDate,
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
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: true,
        submitLeadDays: 0,
        allowRetroactiveSubmit: true,
        retroactiveLimitDays: 3,
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-retro-limit-boundary/submit',
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

test('POST /leave-requests/:id/submit rejects when retroactive limit is exceeded', async () => {
  const now = new Date();
  const fiveDaysAgo = new Date(now);
  fiveDaysAgo.setDate(now.getDate() - 5);
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
        id: 'leave-retro-limit',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: fiveDaysAgo,
        endDate: fiveDaysAgo,
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
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: true,
        submitLeadDays: 0,
        allowRetroactiveSubmit: true,
        retroactiveLimitDays: 3,
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-retro-limit/submit',
          headers: userHeaders(),
          payload: {
            noConsultationConfirmed: true,
            noConsultationReason: 'retro-limit',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_RETROACTIVE_LIMIT_EXCEEDED');
      });
    },
  );
});

test('POST /leave-requests/:id/submit treats hourly boundary where existing leave ends at start as non-overlap', async () => {
  let capturedConflictWhere = null;
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
        id: 'leave-hourly-start-boundary-target',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-04-11T00:00:00.000Z'),
        endDate: new Date('2026-04-11T00:00:00.000Z'),
        startTimeMinutes: 540,
        endTimeMinutes: 600,
        minutes: 60,
        hours: null,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 0 } }),
      'timeEntry.count': async () => 0,
      'leaveRequest.count': async (args) => {
        capturedConflictWhere = args?.where ?? null;
        return 0;
      },
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-hourly-start-boundary-target/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NO_CONSULTATION_REASON_REQUIRED');
      });
    },
  );
  assert.equal(capturedConflictWhere?.OR?.[1]?.startTimeMinutes?.lt, 600);
  assert.equal(capturedConflictWhere?.OR?.[1]?.endTimeMinutes?.gt, 540);
});

test('POST /leave-requests/:id/submit auto-approves leave type without approval', async () => {
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
        id: 'leave-auto-approve',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-03-03T00:00:00.000Z'),
        endDate: new Date('2026-03-03T00:00:00.000Z'),
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
      'leaveRequest.count': async () => 0,
      'leaveRequest.findMany': async () => [],
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        requiresApproval: false,
        active: true,
      }),
      'leaveRequest.update': async () => ({
        id: 'leave-auto-approve',
        userId: 'normal-user',
        status: 'approved',
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-auto-approve/submit',
          headers: userHeaders(),
          payload: {
            noConsultationConfirmed: true,
            noConsultationReason: 'e2e-auto-approve',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.status, 'approved');
      });
    },
  );
});

test('POST /leave-requests/:id/submit auto-approves compensatory leave and consumes grant', async () => {
  let transactionCount = 0;
  let consumedMinutes = 0;
  await withPrismaStubs(
    {
      $transaction: async (fn) => {
        transactionCount += 1;
        return fn(prisma);
      },
      'leaveType.findMany': async () => [
        { code: 'paid' },
        { code: 'special' },
        { code: 'substitute' },
        { code: 'compensatory' },
        { code: 'unpaid' },
      ],
      'leaveRequest.findUnique': async () => ({
        id: 'leave-auto-approve-comp',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'compensatory',
        startDate: new Date('2026-03-11T00:00:00.000Z'),
        endDate: new Date('2026-03-11T00:00:00.000Z'),
        startTimeMinutes: 540,
        endTimeMinutes: 660,
        minutes: 120,
        hours: null,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
        paidLeaveAdvanceMaxMinutes: 480,
        paidLeaveAdvanceRequireNextGrantWithinDays: 60,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 0 } }),
      'timeEntry.count': async () => 0,
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'compensatory',
        attachmentPolicy: 'none',
        requiresApproval: false,
        active: true,
      }),
      'leaveCompGrant.updateMany': async (args) => {
        const decrement = args?.data?.remainingMinutes?.decrement;
        if (typeof decrement === 'number') {
          return { count: 1 };
        }
        return { count: 0 };
      },
      'leaveCompGrant.findMany': async () => [
        {
          id: 'grant-comp-1',
          remainingMinutes: 240,
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          sourceDate: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      'leaveCompGrant.findUnique': async () => ({ remainingMinutes: 0 }),
      'leaveCompGrant.update': async () => ({
        id: 'grant-comp-1',
        status: 'consumed',
      }),
      'leaveCompConsumption.findMany': async () => [],
      'leaveCompConsumption.create': async (args) => {
        consumedMinutes += Number(args?.data?.consumedMinutes ?? 0);
        return { id: 'comp-consume-1', ...args?.data };
      },
      'leaveRequest.findMany': async () => [],
      'leaveRequest.update': async () => ({
        id: 'leave-auto-approve-comp',
        userId: 'normal-user',
        status: 'approved',
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-auto-approve-comp/submit',
          headers: userHeaders(),
          payload: {
            noConsultationConfirmed: true,
            noConsultationReason: 'auto-approve-comp',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.status, 'approved');
      });
    },
  );
  assert.equal(transactionCount, 1);
  assert.equal(consumedMinutes, 120);
});

test('POST /leave-requests/:id/submit rejects compensatory leave when balance is insufficient', async () => {
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
        id: 'leave-comp-1',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'compensatory',
        startDate: new Date('2026-03-11T00:00:00.000Z'),
        endDate: new Date('2026-03-11T00:00:00.000Z'),
        startTimeMinutes: 540,
        endTimeMinutes: 660,
        minutes: 120,
        hours: null,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 0 } }),
      'timeEntry.count': async () => 0,
      'leaveRequest.count': async () => 0,
      'annotation.findUnique': async () => ({
        internalRefs: [{ kind: 'chat_message', id: 'chat-msg-1' }],
        externalUrls: [],
      }),
      'referenceLink.findMany': async () => [
        {
          linkKind: 'internal_ref',
          refKind: 'chat_message',
          value: 'chat-msg-1',
          label: 'Consultation thread',
          updatedAt: new Date('2026-03-11T00:00:00.000Z'),
          updatedBy: 'normal-user',
        },
      ],
      'leaveType.findFirst': async () => ({
        code: 'compensatory',
        attachmentPolicy: 'none',
        active: true,
      }),
      'leaveCompGrant.updateMany': async () => ({ count: 0 }),
      'leaveCompGrant.findMany': async () => [],
      'leaveRequest.findMany': async () => [],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-comp-1/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_COMP_BALANCE_SHORTAGE');
      });
    },
  );
});

test('POST /leave-requests/:id/submit rejects overlapping leave requests', async () => {
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
        id: 'leave-overlap-target',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-04-10T00:00:00.000Z'),
        endDate: new Date('2026-04-10T00:00:00.000Z'),
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
      'leaveRequest.count': async () => 1,
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-overlap-existing',
          status: 'pending_manager',
          leaveType: 'special',
          startDate: new Date('2026-04-10T00:00:00.000Z'),
          endDate: new Date('2026-04-10T00:00:00.000Z'),
          startTimeMinutes: null,
          endTimeMinutes: null,
        },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-overlap-target/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_REQUEST_CONFLICT');
        assert.equal(body?.error?.conflictCount, 1);
      });
    },
  );
});

test('POST /leave-requests/:id/submit rejects overlapping hourly leave requests', async () => {
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
        id: 'leave-hourly-overlap-target',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-04-11T00:00:00.000Z'),
        endDate: new Date('2026-04-11T00:00:00.000Z'),
        startTimeMinutes: 540,
        endTimeMinutes: 600,
        minutes: 60,
        hours: null,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 0 } }),
      'leaveRequest.count': async () => 1,
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-hourly-overlap-existing',
          status: 'pending_manager',
          leaveType: 'special',
          startDate: new Date('2026-04-11T00:00:00.000Z'),
          endDate: new Date('2026-04-11T00:00:00.000Z'),
          startTimeMinutes: 570,
          endTimeMinutes: 630,
        },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-hourly-overlap-target/submit',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'LEAVE_REQUEST_CONFLICT');
        assert.equal(body?.error?.conflictCount, 1);
      });
    },
  );
});

test('POST /leave-requests/:id/submit allows non-overlapping hourly leave requests', async () => {
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
        id: 'leave-hourly-target',
        userId: 'normal-user',
        status: 'draft',
        leaveType: 'special',
        startDate: new Date('2026-04-11T00:00:00.000Z'),
        endDate: new Date('2026-04-11T00:00:00.000Z'),
        startTimeMinutes: 540,
        endTimeMinutes: 600,
        minutes: 60,
        hours: null,
      }),
      'actionPolicy.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        timeUnitMinutes: 10,
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'timeEntry.aggregate': async () => ({ _sum: { minutes: 0 } }),
      'timeEntry.count': async () => 0,
      'leaveRequest.count': async () => 0,
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-hourly-existing',
          status: 'pending_manager',
          leaveType: 'special',
          startDate: new Date('2026-04-11T00:00:00.000Z'),
          endDate: new Date('2026-04-11T00:00:00.000Z'),
          startTimeMinutes: 600,
          endTimeMinutes: 660,
        },
      ],
      'annotation.findUnique': async () => ({
        internalRefs: [],
        externalUrls: [],
      }),
      'leaveType.findFirst': async () => ({
        code: 'special',
        attachmentPolicy: 'none',
        active: true,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-requests/leave-hourly-target/submit',
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

test('POST /leave-entitlements/comp-grants requires general_affairs group', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/leave-entitlements/comp-grants',
      headers: userHeaders('normal-user'),
      payload: {
        userId: 'normal-user',
        leaveType: 'compensatory',
        sourceDate: '2026-03-01',
        expiresAt: '2026-04-30',
        grantedMinutes: 480,
        reasonText: '休日出勤の代休付与',
      },
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'GENERAL_AFFAIRS_REQUIRED');
  });
});

test('POST /leave-entitlements/comp-grants creates grant for general_affairs member', async () => {
  let created = null;
  await withPrismaStubs(
    {
      'leaveCompGrant.create': async (args) => {
        created = args?.data;
        return { id: 'cg-1', ...args?.data };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-entitlements/comp-grants',
          headers: userHeaders('ga-user', {
            groupAccountIds: ['general_affairs'],
          }),
          payload: {
            userId: 'employee-1',
            leaveType: 'substitute',
            sourceDate: '2026-03-01',
            grantDate: '2026-03-02',
            expiresAt: '2026-08-31',
            grantedMinutes: 480,
            reasonText: '休日勤務による振替休日',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );
  assert.equal(created?.userId, 'employee-1');
  assert.equal(created?.leaveType, 'substitute');
  assert.equal(created?.remainingMinutes, 480);
});

test('POST /leave-entitlements/comp-grants rejects when grantDate is before sourceDate', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/leave-entitlements/comp-grants',
      headers: userHeaders('ga-user', {
        groupAccountIds: ['general_affairs'],
      }),
      payload: {
        userId: 'employee-1',
        leaveType: 'compensatory',
        sourceDate: '2026-03-10',
        grantDate: '2026-03-09',
        expiresAt: '2026-03-20',
        grantedMinutes: 120,
        reasonText: '日付整合テスト',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'INVALID_DATE_RANGE');
  });
});
