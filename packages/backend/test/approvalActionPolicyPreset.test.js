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

function approvalInstanceDraft() {
  return {
    id: 'approval-001',
    flowType: 'invoice',
    status: 'pending_qa',
    projectId: 'proj-001',
    steps: [],
  };
}

test('POST /approval-instances/:id/act approve: phase2_core preset denies when policy is missing', async () => {
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
          'approvalInstance.findUnique': async () => approvalInstanceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/approval-instances/approval-001/act',
              headers: adminHeaders(),
              payload: { action: 'approve' },
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

test('POST /approval-instances/:id/act reject: phase2_core preset denies when policy is missing', async () => {
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
          'approvalInstance.findUnique': async () => approvalInstanceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/approval-instances/approval-001/act',
              headers: adminHeaders(),
              payload: { action: 'reject' },
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

test('POST /approval-instances/:id/act approve: policy allow reaches act path (not ACTION_POLICY_DENIED)', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      const originalTransaction = prisma.$transaction;
      prisma.$transaction = async () => {
        throw new Error('mock-act-failure');
      };
      try {
        await withPrismaStubs(
          {
            'approvalInstance.findUnique': async () => approvalInstanceDraft(),
            'actionPolicy.findMany': async () => [
              {
                id: 'policy-approval-allow',
                flowType: 'invoice',
                actionKey: 'approve',
                priority: 100,
                isEnabled: true,
                subjects: null,
                stateConstraints: null,
                guards: null,
                requireReason: false,
              },
            ],
          },
          async () => {
            const server = await buildServer({ logger: false });
            try {
              const res = await server.inject({
                method: 'POST',
                url: '/approval-instances/approval-001/act',
                headers: adminHeaders(),
                payload: { action: 'approve' },
              });
              assert.equal(res.statusCode, 400, res.body);
              const payload = JSON.parse(res.body);
              assert.equal(payload?.error, 'approval_action_failed');
              assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
            } finally {
              await server.close();
            }
          },
        );
      } finally {
        prisma.$transaction = originalTransaction;
      }
    },
  );
});

test('POST /approval-instances/:id/act reject: policy allow reaches act path (not ACTION_POLICY_DENIED)', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      const originalTransaction = prisma.$transaction;
      prisma.$transaction = async () => {
        throw new Error('mock-act-failure');
      };
      try {
        await withPrismaStubs(
          {
            'approvalInstance.findUnique': async () => approvalInstanceDraft(),
            'actionPolicy.findMany': async () => [
              {
                id: 'policy-reject-allow',
                flowType: 'invoice',
                actionKey: 'reject',
                priority: 100,
                isEnabled: true,
                subjects: null,
                stateConstraints: null,
                guards: null,
                requireReason: false,
              },
            ],
          },
          async () => {
            const server = await buildServer({ logger: false });
            try {
              const res = await server.inject({
                method: 'POST',
                url: '/approval-instances/approval-001/act',
                headers: adminHeaders(),
                payload: { action: 'reject' },
              });
              assert.equal(res.statusCode, 400, res.body);
              const payload = JSON.parse(res.body);
              assert.equal(payload?.error, 'approval_action_failed');
              assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
            } finally {
              await server.close();
            }
          },
        );
      } finally {
        prisma.$transaction = originalTransaction;
      }
    },
  );
});

test('POST /approval-instances/:id/act approve: reason required policy returns REASON_REQUIRED', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'off',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'approvalInstance.findUnique': async () => approvalInstanceDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-approval-reason-required',
              flowType: 'invoice',
              actionKey: 'approve',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              guards: null,
              requireReason: true,
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/approval-instances/approval-001/act',
              headers: adminHeaders(),
              payload: { action: 'approve' },
            });
            assert.equal(res.statusCode, 400, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'REASON_REQUIRED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
