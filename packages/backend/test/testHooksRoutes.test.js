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

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
}

test('test hook route is disabled unless E2E_ENABLE_TEST_HOOKS=1', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '0',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 404);
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route requires admin or mgmt role', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: userHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 403, res.body);
        const payload = JSON.parse(res.body);
        assert.equal(payload?.error?.code, 'forbidden');
      } finally {
        await server.close();
      }
    },
  );
});

test('agent run seed test hook route requires admin or mgmt role', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/agent-runs/seed-audit-log',
          headers: userHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 403, res.body);
        const payload = JSON.parse(res.body);
        assert.equal(payload?.error?.code, 'forbidden');
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route is disabled in production even when E2E_ENABLE_TEST_HOOKS=1', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      AUTH_ALLOW_HEADER_FALLBACK_IN_PROD: 'true',
      NODE_ENV: 'production',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: 'approval-001' },
        });
        assert.equal(res.statusCode, 404);
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route validates approvalInstanceId', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
          headers: adminHeaders(),
          payload: { approvalInstanceId: '   ' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const payload = JSON.parse(res.body);
        assert.equal(payload?.error?.code, 'INVALID_APPROVAL_INSTANCE_ID');
      } finally {
        await server.close();
      }
    },
  );
});

test('test hook route deletes evidence snapshots for an approval instance', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      let capturedWhere = null;
      await withPrismaStubs(
        {
          'evidenceSnapshot.deleteMany': async ({ where }) => {
            capturedWhere = where;
            return { count: 2 };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/__test__/evidence-snapshots/reset',
              headers: adminHeaders(),
              payload: { approvalInstanceId: 'approval-002' },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.deletedCount, 2);
            assert.deepEqual(capturedWhere, {
              approvalInstanceId: 'approval-002',
            });
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('agent run seed test hook route creates run/step/decision and audit log', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      let capturedRunCreate = null;
      let capturedStepCreate = null;
      let capturedDecisionCreate = null;
      let capturedRunUpdate = null;
      let capturedAuditCreate = null;

      await withPrismaStubs(
        {
          'agentRun.create': async ({ data }) => {
            capturedRunCreate = data;
            return { id: 'run-123' };
          },
          'agentStep.create': async ({ data }) => {
            capturedStepCreate = data;
            return { id: 'step-123' };
          },
          'decisionRequest.create': async ({ data }) => {
            capturedDecisionCreate = data;
            return { id: 'decision-123' };
          },
          'agentRun.update': async ({ data }) => {
            capturedRunUpdate = data;
            return { id: 'run-123' };
          },
          'auditLog.create': async ({ data }) => {
            capturedAuditCreate = data;
            return { id: 'audit-123' };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/__test__/agent-runs/seed-audit-log',
              headers: adminHeaders(),
              payload: {
                action: 'agent_run_seeded_test',
                targetTable: 'invoices',
                targetId: 'inv-123',
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.runId, 'run-123');
            assert.equal(payload?.stepId, 'step-123');
            assert.equal(payload?.decisionRequestId, 'decision-123');
            assert.equal(payload?.auditLogId, 'audit-123');
            assert.equal(payload?.action, 'agent_run_seeded_test');
            assert.equal(payload?.targetTable, 'invoices');
            assert.equal(payload?.targetId, 'inv-123');
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(capturedRunCreate?.status, 'failed');
      assert.equal(capturedRunCreate?.errorCode, 'policy_denied');
      assert.equal(capturedStepCreate?.status, 'failed');
      assert.equal(capturedStepCreate?.errorCode, 'policy_denied');
      assert.equal(capturedDecisionCreate?.decisionType, 'policy_override');
      assert.equal(capturedDecisionCreate?.targetId, 'inv-123');
      assert.equal(
        capturedRunUpdate?.metadata?.decisionRequestId,
        'decision-123',
      );
      assert.equal(capturedAuditCreate?.action, 'agent_run_seeded_test');
      assert.equal(capturedAuditCreate?.metadata?._agent?.runId, 'run-123');
      assert.equal(
        capturedAuditCreate?.metadata?._agent?.decisionRequestId,
        'decision-123',
      );
    },
  );
});
