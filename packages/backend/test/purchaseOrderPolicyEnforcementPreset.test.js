import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const parts = path.split('.');
    let target;
    let method;
    if (parts.length === 1) {
      const rootMethod = parts[0];
      if (!rootMethod || !rootMethod.startsWith('$')) {
        throw new Error(`invalid stub path: ${path}`);
      }
      target = prisma;
      method = rootMethod;
    } else if (parts.length === 2) {
      const [model, member] = parts;
      target = prisma[model];
      method = member;
    } else {
      throw new Error(`invalid stub path: ${path}`);
    }
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

function purchaseOrderForSubmit() {
  return {
    status: 'approved',
    projectId: 'proj-001',
  };
}

function withPurchaseOrderPolicyEnv(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

test('POST /purchase-orders/:id/submit: phase2_core preset denies when policy is missing', async () => {
  await withPurchaseOrderPolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'purchaseOrder.findUnique': async () => purchaseOrderForSubmit(),
        'actionPolicy.findMany': async () => [],
        $transaction: async () => {
          transactionCalled += 1;
          return {
            updated: { id: 'po-001', status: 'pending_qa' },
            approval: { id: 'approval-001', currentStep: null, steps: [] },
          };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/purchase-orders/po-001/submit',
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
  });
});

test('POST /purchase-orders/:id/submit: policy allow reaches downstream processing (not ACTION_POLICY_DENIED)', async () => {
  await withPurchaseOrderPolicyEnv(async () => {
    let transactionCalled = 0;
    await withPrismaStubs(
      {
        'purchaseOrder.findUnique': async () => purchaseOrderForSubmit(),
        'actionPolicy.findMany': async () => [
          {
            id: 'policy-po-submit-allow',
            flowType: 'purchase_order',
            actionKey: 'submit',
            priority: 100,
            isEnabled: true,
            subjects: null,
            stateConstraints: null,
            guards: null,
            requireReason: false,
          },
        ],
        $transaction: async () => {
          transactionCalled += 1;
          return {
            updated: { id: 'po-001', status: 'pending_qa' },
            approval: {
              id: 'approval-001',
              projectId: 'proj-001',
              flowType: 'purchase_order',
              targetTable: 'purchase_orders',
              targetId: 'po-001',
              currentStep: null,
              steps: [],
            },
          };
        },
      },
      async () => {
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/purchase-orders/po-001/submit',
            headers: adminHeaders(),
            payload: {},
          });
          assert.equal(res.statusCode, 200, res.body);
          const payload = JSON.parse(res.body);
          assert.equal(payload?.id, 'po-001');
          assert.equal(payload?.status, 'pending_qa');
          assert.equal(transactionCalled, 1);
        } finally {
          await server.close();
        }
      },
    );
  });
});
