import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
const STUB_CATALOG = JSON.stringify({
  version: 1,
  models: [
    {
      provider: 'stub',
      model: 'stub-v1',
      enabled: true,
      maxInputTokens: 1024,
      maxOutputTokens: 128,
      inputCostMicrosPerMillion: '1',
      outputCostMicrosPerMillion: '1',
      currency: 'JPY',
      capabilities: ['text'],
    },
  ],
});

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = method ? prisma[model] : prisma;
    const targetMethod = method || model;
    if (!target || typeof target[targetMethod] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[targetMethod];
    target[targetMethod] = stub;
    restores.push(() => {
      target[targetMethod] = original;
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

test('test hook routes are disabled outside NODE_ENV=test', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'development',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/knowledge-llm/configure',
          headers: adminHeaders(),
          payload: {
            softLimitMicros: '0',
            hardLimitMicros: '1',
            requestsPerHour: 1,
          },
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
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
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

test('knowledge LLM test hook requires admin or mgmt role', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/knowledge-llm/configure',
          headers: userHeaders(),
          payload: {
            softLimitMicros: '1',
            hardLimitMicros: '2',
            requestsPerHour: 10,
          },
        });
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(JSON.parse(res.body)?.error?.code, 'forbidden');
      } finally {
        await server.close();
      }
    },
  );
});

test('knowledge LLM test hook validates a bounded allowlisted configuration', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        for (const payload of [
          {
            unexpected: 'field',
            softLimitMicros: '1',
            hardLimitMicros: '2',
            requestsPerHour: 10,
          },
          {
            softLimitMicros: '3',
            hardLimitMicros: '2',
            requestsPerHour: 10,
          },
          {
            softLimitMicros: '1',
            hardLimitMicros: '9223372036854775808',
            requestsPerHour: 10,
          },
          {
            softLimitMicros: '1',
            hardLimitMicros: '2',
            requestsPerHour: 0,
          },
        ]) {
          const res = await server.inject({
            method: 'POST',
            url: '/__test__/knowledge-llm/configure',
            headers: adminHeaders(),
            payload,
          });
          assert.equal(res.statusCode, 400, res.body);
          assert.equal(
            JSON.parse(res.body)?.error?.code,
            'INVALID_KNOWLEDGE_LLM_TEST_CONFIG',
          );
        }
      } finally {
        await server.close();
      }
    },
  );
});

test('knowledge LLM test hook refuses to replace a non-test budget policy', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
    },
    async () => {
      await withPrismaStubs(
        {
          'knowledgeLlmBudgetPolicy.findMany': async () => [
            {
              id: 'policy-existing',
              version: 4,
              active: true,
              createdBy: 'canonical-actor',
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/__test__/knowledge-llm/configure',
              headers: adminHeaders(),
              payload: {
                softLimitMicros: '1',
                hardLimitMicros: '2',
                requestsPerHour: 10,
              },
            });
            assert.equal(res.statusCode, 409, res.body);
            assert.equal(
              JSON.parse(res.body)?.error?.code,
              'KNOWLEDGE_LLM_TEST_POLICY_CONFLICT',
            );
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('knowledge LLM test hook replaces only marked test policy and returns no subject identifier', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'stub',
      KNOWLEDGE_LLM_MODEL_CATALOG_JSON: STUB_CATALOG,
    },
    async () => {
      let updateInput = null;
      let createInput = null;
      await withPrismaStubs(
        {
          'knowledgeLlmBudgetPolicy.findMany': async () => [
            {
              id: 'policy-test',
              version: 2,
              active: true,
              createdBy: '__erp4_e2e_knowledge_llm__',
            },
          ],
          $transaction: async (operation) => operation(prisma),
          'knowledgeLlmBudgetPolicy.updateMany': async (input) => {
            updateInput = input;
            return { count: 1 };
          },
          'knowledgeLlmBudgetPolicy.create': async (input) => {
            createInput = input;
            return { id: 'policy-new' };
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/__test__/knowledge-llm/configure',
              headers: adminHeaders(),
              payload: {
                softLimitMicros: '10',
                hardLimitMicros: '20',
                requestsPerHour: 25,
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            assert.deepEqual(JSON.parse(res.body), {
              budgetConfigured: true,
              policyVersion: 3,
            });
          } finally {
            await server.close();
          }
        },
      );
      assert.deepEqual(updateInput?.where, {
        subjectType: 'user',
        subjectId: 'admin-user',
        active: true,
        createdBy: '__erp4_e2e_knowledge_llm__',
      });
      assert.equal(createInput?.data.subjectId, 'admin-user');
      assert.equal(createInput?.data.softLimitMicros, 10n);
      assert.equal(createInput?.data.hardLimitMicros, 20n);
      assert.equal(createInput?.data.requestsPerHour, 25);
      assert.equal(createInput?.data.version, 3);
    },
  );
});

test('knowledge LLM test hook is not registered unless the explicit stub provider is active', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      NODE_ENV: 'test',
      E2E_ENABLE_TEST_HOOKS: '1',
      KNOWLEDGE_EXTERNAL_LLM_PROVIDER: 'disabled',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/knowledge-llm/configure',
          headers: adminHeaders(),
          payload: {
            softLimitMicros: '1',
            hardLimitMicros: '2',
            requestsPerHour: 10,
          },
        });
        assert.equal(res.statusCode, 404, res.body);
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
      AUTH_MODE: 'jwt_bff',
      NODE_ENV: 'production',
      JWT_ISSUER: 'https://accounts.google.com',
      JWT_AUDIENCE: 'client-id.apps.googleusercontent.com',
      JWT_JWKS_URL: 'https://www.googleapis.com/oauth2/v3/certs',
      GOOGLE_OIDC_CLIENT_SECRET: 'client-secret',
      GOOGLE_OIDC_REDIRECT_URI: 'https://app.example.com/auth/google/callback',
      AUTH_FRONTEND_ORIGIN: 'https://app.example.com',
      AUTH_COOKIE_SECRET: '0123456789abcdef0123456789abcdef',
      KNOWLEDGE_CURSOR_SIGNING_SECRET: '0123456789abcdef0123456789abcdef',
      E2E_ENABLE_TEST_HOOKS: '1',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/__test__/evidence-snapshots/reset',
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
