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
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
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

function sampleCurrentRule(overrides = {}) {
  return {
    id: 'rule-v1',
    ruleKey: 'rule-series-1',
    version: 1,
    flowType: 'invoice',
    conditions: {},
    steps: [{ stepOrder: 1, approverGroupId: 'mgmt' }],
    isActive: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    ...overrides,
  };
}

test('PATCH /approval-rules/:id rejects version in payload', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/approval-rules/rule-v1',
      headers: adminHeaders(),
      payload: { version: 2 },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error, 'invalid_version');
  });
});

test(
  'PATCH /approval-rules/:id rejects supersedesRuleId in payload',
  async () => {
    await withServer(async (server) => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/approval-rules/rule-v1',
        headers: adminHeaders(),
        payload: { supersedesRuleId: 'rule-v0' },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error, 'invalid_supersedesRuleId');
    });
  },
);

test('PATCH /approval-rules/:id rejects flowType change', async () => {
  await withPrismaStubs(
    {
      'approvalRule.findUnique': async () => sampleCurrentRule(),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/approval-rules/rule-v1',
          headers: adminHeaders(),
          payload: { flowType: 'expense' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error, 'flow_type_immutable');
      });
    },
  );
});

test('PATCH /approval-rules/:id rejects non-latest version patch', async () => {
  await withPrismaStubs(
    {
      'approvalRule.findUnique': async () => sampleCurrentRule(),
      'approvalRule.findFirst': async () => ({
        id: 'rule-v2',
        version: 2,
      }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/approval-rules/rule-v1',
          headers: adminHeaders(),
          payload: { isActive: false },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error, 'stale_rule_version');
      });
    },
  );
});
