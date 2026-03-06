import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
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

function estimateDraft() {
  return {
    id: 'est-001',
    status: 'draft',
    projectId: 'proj-001',
  };
}

test('POST /estimates/:id/submit: phase2_core required action denies when policy is missing', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    async () => {
      let transactionCalled = 0;
      await withPrismaStubs(
        {
          'estimate.findUnique': async () => estimateDraft(),
          'actionPolicy.findMany': async () => [],
          $transaction: async () => {
            transactionCalled += 1;
            throw new Error('unexpected transaction in deny path');
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/estimates/est-001/submit',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(transactionCalled, 0);
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
