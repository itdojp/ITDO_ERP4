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

function userHeaders(projectIds) {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
    'x-project-ids': projectIds,
  };
}

test('GET /purchase-orders denies non admin/mgmt role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'projectMember.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/purchase-orders',
          headers: userHeaders('proj-1'),
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'forbidden');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /purchase-orders applies filters and fixed take limit', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let findManyArgs = null;
  await withPrismaStubs(
    {
      'purchaseOrder.findMany': async (args) => {
        findManyArgs = args;
        return [{ id: 'po-1', status: 'draft' }];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/purchase-orders?projectId=proj-1&vendorId=vendor-1&status=approved',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
      } finally {
        await server.close();
      }
    },
  );
  assert.equal(findManyArgs?.where?.projectId, 'proj-1');
  assert.equal(findManyArgs?.where?.vendorId, 'vendor-1');
  assert.equal(findManyArgs?.where?.status, 'approved');
  assert.equal(findManyArgs?.take, 100);
  assert.deepEqual(findManyArgs?.orderBy, { createdAt: 'desc' });
});

test('GET /purchase-orders/:id returns NOT_FOUND when id does not exist', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'purchaseOrder.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/purchase-orders/po-missing',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /projects/:projectId/purchase-orders returns NOT_FOUND when project is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'project.findUnique': async () => null,
      'vendor.findUnique': async () => ({ id: 'vendor-1' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/proj-missing/purchase-orders',
          headers: adminHeaders(),
          payload: {
            vendorId: 'vendor-1',
            totalAmount: 12345,
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
        assert.equal(body?.error?.message, 'Project not found');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /projects/:projectId/purchase-orders returns NOT_FOUND when vendor is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'project.findUnique': async () => ({ id: 'proj-1' }),
      'vendor.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/projects/proj-1/purchase-orders',
          headers: adminHeaders(),
          payload: {
            vendorId: 'vendor-missing',
            totalAmount: 12345,
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'NOT_FOUND');
        assert.equal(body?.error?.message, 'Vendor not found');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /purchase-orders/:id/submit returns REASON_REQUIRED when policy requires reason', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_REQUIRED_ACTIONS: 'purchase_order:submit',
    },
    async () => {
      await withPrismaStubs(
        {
          'purchaseOrder.findUnique': async () => ({
            status: 'approved',
            projectId: 'proj-1',
          }),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-reason',
              flowType: 'purchase_order',
              actionKey: 'submit',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: true,
              guards: null,
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/purchase-orders/po-1/submit',
              headers: adminHeaders(),
              payload: { reasonText: '   ' },
            });
            assert.equal(res.statusCode, 400, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.error?.code, 'REASON_REQUIRED');
            assert.equal(body?.error?.details?.matchedPolicyId, 'policy-reason');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /purchase-orders/:id/submit resolves approval_open guard to APPROVAL_REQUIRED', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_REQUIRED_ACTIONS: 'purchase_order:submit',
    },
    async () => {
      await withPrismaStubs(
        {
          'purchaseOrder.findUnique': async () => ({
            status: 'approved',
            projectId: 'proj-1',
          }),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-approval-open',
              flowType: 'purchase_order',
              actionKey: 'submit',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: ['approval_open'],
            },
          ],
          'approvalInstance.findFirst': async () => ({
            id: 'approval-1',
            status: 'pending_qa',
          }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/purchase-orders/po-1/submit',
              headers: adminHeaders(),
              payload: { reasonText: 're-submit' },
            });
            assert.equal(res.statusCode, 403, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.error?.code, 'APPROVAL_REQUIRED');
            assert.equal(
              body?.error?.details?.matchedPolicyId,
              'policy-approval-open',
            );
            assert.equal(body?.error?.details?.reason, 'guard_failed');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
