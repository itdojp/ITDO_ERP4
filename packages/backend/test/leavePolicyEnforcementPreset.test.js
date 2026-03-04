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
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
}

function seededLeaveTypes() {
  return [
    { code: 'paid' },
    { code: 'special' },
    { code: 'substitute' },
    { code: 'compensatory' },
    { code: 'unpaid' },
  ];
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

function leaveDraft(overrides = {}) {
  const startDate = dateAtUtcDayOffset(14);
  return {
    id: 'leave-001',
    userId: 'normal-user',
    status: 'draft',
    leaveType: 'paid',
    startDate,
    endDate: startDate,
    startTimeMinutes: null,
    endTimeMinutes: null,
    minutes: null,
    hours: 8,
    ...overrides,
  };
}

test('POST /leave-requests/:id/submit: phase2_core + required actions denies when policy is missing', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'leaveType.findMany': async () => seededLeaveTypes(),
          'leaveRequest.findUnique': async () => leaveDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/leave-requests/leave-001/submit',
              headers: userHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /leave-requests/:id/submit: policy allow reaches downstream validation (not ACTION_POLICY_DENIED)', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'leaveType.findMany': async () => seededLeaveTypes(),
          'leaveRequest.findUnique': async () => leaveDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-leave-submit-allow',
              flowType: 'leave',
              actionKey: 'submit',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
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
            code: 'paid',
            attachmentPolicy: 'optional',
            requiresApproval: true,
            active: true,
          }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/leave-requests/leave-001/submit',
              headers: userHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 400, res.body);
            const payload = JSON.parse(res.body);
            assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(payload?.error?.code, 'NO_CONSULTATION_REASON_REQUIRED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
