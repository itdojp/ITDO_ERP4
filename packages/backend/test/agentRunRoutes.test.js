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

test('GET /agent-runs/:id returns run details for admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const run = {
    id: 'run-001',
    status: 'failed',
    requestId: 'req-001',
    source: 'agent',
    principalUserId: 'principal-user',
    actorUserId: 'agent-bot',
    method: 'POST',
    path: '/invoices/1/submit',
    httpStatus: 403,
    errorCode: 'policy_denied',
    metadata: { routePath: '/invoices/:id/submit' },
    startedAt: new Date('2026-02-23T10:00:00.000Z'),
    finishedAt: new Date('2026-02-23T10:00:03.000Z'),
    createdAt: new Date('2026-02-23T10:00:00.000Z'),
    steps: [
      {
        id: 'step-001',
        runId: 'run-001',
        stepOrder: 1,
        kind: 'api_request',
        status: 'failed',
        requestedAt: new Date('2026-02-23T10:00:03.000Z'),
        createdAt: new Date('2026-02-23T10:00:00.000Z'),
        decisions: [
          {
            id: 'decision-001',
            runId: 'run-001',
            stepId: 'step-001',
            decisionType: 'policy_override',
            status: 'open',
            requestedAt: new Date('2026-02-23T10:00:03.000Z'),
            createdAt: new Date('2026-02-23T10:00:03.000Z'),
          },
        ],
      },
    ],
    decisionRequests: [],
  };

  await withPrismaStubs(
    {
      'agentRun.findUnique': async () => run,
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/agent-runs/run-001',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });

        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.id, 'run-001');
        assert.equal(body.method, 'POST');
        assert.equal(body.path, '/invoices/1/submit');
        assert.equal(body.httpStatus, 403);
        assert.equal(body.status, 'failed');
        assert.equal(body.errorCode, 'policy_denied');
        assert.equal(Array.isArray(body.steps), true);
        assert.equal(body.steps.length, 1);
        assert.equal(body.steps[0].id, 'step-001');
        assert.equal(body.steps[0].status, 'failed');
        assert.equal(body.steps[0].kind, 'api_request');
        assert.equal(body.steps[0].decisions.length, 1);
        assert.equal(body.steps[0].decisions[0].id, 'decision-001');
        assert.equal(
          body.steps[0].decisions[0].decisionType,
          'policy_override',
        );
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /agent-runs/:id returns 404 when run is not found', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'agentRun.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/agent-runs/run-missing',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 404, res.body);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /agent-runs/:id returns 400 when id is whitespace-only', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/agent-runs/%20%20',
      headers: {
        'x-user-id': 'admin-user',
        'x-roles': 'admin',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
  } finally {
    await server.close();
  }
});

test('GET /agent-runs/:id denies non privileged role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/agent-runs/run-001',
      headers: {
        'x-user-id': 'normal-user',
        'x-roles': 'user',
      },
    });
    assert.equal(res.statusCode, 403, res.body);
  } finally {
    await server.close();
  }
});

test('GET /agent-runs/:id writes structured audit metadata', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const run = {
    id: 'run-audit-001',
    status: 'completed',
    requestId: 'req-audit-001',
    source: 'agent',
    principalUserId: 'principal-user',
    actorUserId: 'agent-bot',
    method: 'GET',
    path: '/project-360',
    httpStatus: 200,
    errorCode: null,
    metadata: { routePath: '/project-360' },
    startedAt: new Date('2026-02-23T13:00:00.000Z'),
    finishedAt: new Date('2026-02-23T13:00:01.000Z'),
    createdAt: new Date('2026-02-23T13:00:00.000Z'),
    steps: [
      {
        id: 'step-audit-001',
        runId: 'run-audit-001',
        stepOrder: 1,
        kind: 'api_request',
        status: 'completed',
        decisions: [],
      },
    ],
    decisionRequests: [],
  };

  let capturedAuditArgs = null;
  await withPrismaStubs(
    {
      'agentRun.findUnique': async () => run,
      'auditLog.create': async (args) => {
        capturedAuditArgs = args;
        return { id: 'audit-captured-001' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/agent-runs/run-audit-001',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(typeof capturedAuditArgs, 'object');
  assert.equal(capturedAuditArgs?.data?.action, 'agent_run_viewed');
  assert.equal(capturedAuditArgs?.data?.targetTable, 'agent_runs');
  assert.equal(capturedAuditArgs?.data?.targetId, 'run-audit-001');
  assert.equal(capturedAuditArgs?.data?.metadata?.stepCount, 1);
  assert.equal(capturedAuditArgs?.data?.metadata?.decisionCount, 0);
});
