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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function timeEntryForSubmit() {
  return {
    id: 'time-001',
    status: 'submitted',
    projectId: 'proj-001',
    workDate: new Date('2026-01-15T00:00:00.000Z'),
  };
}

function timeEntryForEdit() {
  return {
    id: 'time-001',
    status: 'submitted',
    projectId: 'proj-001',
    taskId: 'task-001',
    userId: 'user-001',
    minutes: 60,
    workDate: new Date('2026-01-15T00:00:00.000Z'),
    billedInvoiceId: null,
  };
}

function withTimePolicyEnv(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: 'time:submit,time:edit',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

test('POST /time-entries/:id/submit: phase2_core required action denies when policy is missing', async () => {
  await withTimePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'timeEntry.findUnique': async () => timeEntryForSubmit(),
        'actionPolicy.findMany': async () => [],
        'timeEntry.update': async () => {
          updateCalled += 1;
          return { id: 'time-001', status: 'submitted' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/time-entries/time-001/submit',
            headers: adminHeaders(),
          });
          assert.equal(res.statusCode, 403, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(updateCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /time-entries/:id/submit: policy allow reaches downstream processing (not ACTION_POLICY_DENIED)', async () => {
  await withTimePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'timeEntry.findUnique': async () => timeEntryForSubmit(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-time-submit-allow',
            flowType: 'time',
            actionKey: 'submit',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            guards: null,
            requireReason: false,
          },
        ],
        'timeEntry.update': async ({ where, data }) => {
          updateCalled += 1;
          return {
            id: where.id,
            status: data.status,
          };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/time-entries/time-001/submit',
            headers: adminHeaders(),
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'time-001');
          assert.equal(payload?.status, 'submitted');
          assert.equal(updateCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('PATCH /time-entries/:id: phase2_core required action denies when policy is missing', async () => {
  await withTimePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'timeEntry.findFirst': async () => timeEntryForEdit(),
        'actionPolicy.findMany': async () => [],
        'project.findMany': async () => [],
        'worklogSetting.findUnique': async () => ({ editableDays: 30 }),
        'timeEntry.update': async () => {
          updateCalled += 1;
          return { id: 'time-001' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PATCH',
            url: '/time-entries/time-001',
            headers: adminHeaders(),
            payload: {},
          });
          assert.equal(res.statusCode, 403, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          assert.equal(updateCalled, 0);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('PATCH /time-entries/:id: policy allow reaches downstream update (not ACTION_POLICY_DENIED)', async () => {
  await withTimePolicyEnv(async () => {
    let updateCalled = 0;
    await withPrismaStubs(
      {
        'timeEntry.findFirst': async () => timeEntryForEdit(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-time-edit-allow',
            flowType: 'time',
            actionKey: 'edit',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            guards: null,
            requireReason: false,
          },
        ],
        'project.findMany': async () => [],
        'worklogSetting.findUnique': async () => ({ editableDays: 30 }),
        'timeEntry.update': async ({ where }) => {
          updateCalled += 1;
          return { id: where.id, status: 'submitted' };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'PATCH',
            url: '/time-entries/time-001',
            headers: adminHeaders(),
            payload: {},
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'time-001');
          assert.equal(payload?.status, 'submitted');
          assert.equal(updateCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});
