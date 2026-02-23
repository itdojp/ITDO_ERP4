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
    status: 'completed',
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
        assert.equal(Array.isArray(body.steps), true);
        assert.equal(body.steps.length, 1);
        assert.equal(body.steps[0].decisions.length, 1);
      } finally {
        await server.close();
      }
    },
  );
});
