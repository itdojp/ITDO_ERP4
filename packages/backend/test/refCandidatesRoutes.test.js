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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin',
  };
}

function userHeaders(projectIds) {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
    'x-project-ids': projectIds,
  };
}

test('GET /ref-candidates requires projectId', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/ref-candidates?q=INV',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'projectId_required');
  } finally {
    await server.close();
  }
});

test('GET /ref-candidates rejects too short query', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/ref-candidates?projectId=proj-1&q=a',
      headers: adminHeaders(),
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'query_too_short');
  } finally {
    await server.close();
  }
});

test('GET /ref-candidates rejects project outside user scope', async () => {
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
          url: '/ref-candidates?projectId=proj-other&q=INV',
          headers: userHeaders('proj-allowed'),
        });
        assert.equal(res.statusCode, 403, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'forbidden_project');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /ref-candidates returns project_not_found when root project is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'project.findUnique': async () => null,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/ref-candidates?projectId=proj-1&q=INV',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'project_not_found');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /ref-candidates hides customer/vendor types for non-admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let customerQueryCalled = false;
  let vendorQueryCalled = false;
  let auditCalled = false;
  await withPrismaStubs(
    {
      'project.findUnique': async ({ where }) => ({
        id: where.id,
        parentId: null,
        deletedAt: null,
      }),
      'project.findMany': async () => [],
      'projectMember.findMany': async () => [],
      'customer.findMany': async () => {
        customerQueryCalled = true;
        return [];
      },
      'vendor.findMany': async () => {
        vendorQueryCalled = true;
        return [];
      },
      'auditLog.create': async () => {
        auditCalled = true;
        return { id: 'audit-1' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/ref-candidates?projectId=proj-1&q=VEN&types=customer,vendor',
          headers: userHeaders('proj-1'),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.deepEqual(body?.items, []);
        assert.equal(customerQueryCalled, false);
        assert.equal(vendorQueryCalled, false);
        assert.equal(auditCalled, false);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /ref-candidates normalizes types, clamps limit and writes audit metadata', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  let invoiceArgs = null;
  const auditEntries = [];
  await withPrismaStubs(
    {
      'project.findUnique': async ({ where }) => ({
        id: where.id,
        parentId: null,
        deletedAt: null,
      }),
      'project.findMany': async () => [],
      'invoice.findMany': async (args) => {
        invoiceArgs = args;
        return [
          {
            id: 'inv-1',
            projectId: 'proj-1',
            invoiceNo: 'INV-2026-001',
            status: 'draft',
            project: { code: 'P001', name: 'Alpha' },
          },
        ];
      },
      'auditLog.create': async ({ data }) => {
        auditEntries.push(data);
        return { id: `audit-${auditEntries.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/ref-candidates?projectId=proj-1&q=INV&types=invoice,invoice,unknown&limit=999',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
        assert.equal(body.items[0]?.kind, 'invoice');
        assert.equal(body.items[0]?.url, '#/open?kind=invoice&id=inv-1');
        assert.equal(invoiceArgs?.where?.invoiceNo?.contains, 'INV');
        assert.deepEqual(invoiceArgs?.where?.projectId, { in: ['proj-1'] });
        assert.equal(invoiceArgs?.take, 50);
      } finally {
        await server.close();
      }
    },
  );
  const lastAudit = auditEntries.at(-1);
  assert.equal(lastAudit?.action, 'ref_candidates_search');
  assert.equal(lastAudit?.targetTable, 'ref_candidates');
  assert.equal(lastAudit?.metadata?.projectId, 'proj-1');
  assert.equal(lastAudit?.metadata?.limit, 50);
  assert.deepEqual(lastAudit?.metadata?.types, ['invoice']);
  assert.equal(lastAudit?.metadata?.scopeProjectCount, 1);
  assert.equal(lastAudit?.metadata?.canSeeAllProjects, true);
  assert.equal(lastAudit?.metadata?.canAccessMaster, true);
});

test('GET /ref-candidates narrows project scope for non-admin before querying documents', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const projectGraph = {
    'proj-root': { id: 'proj-root', parentId: 'proj-parent', deletedAt: null },
    'proj-parent': { id: 'proj-parent', parentId: null, deletedAt: null },
    'proj-child-a': {
      id: 'proj-child-a',
      parentId: 'proj-root',
      deletedAt: null,
    },
    'proj-child-b': {
      id: 'proj-child-b',
      parentId: 'proj-root',
      deletedAt: null,
    },
    'proj-grandchild': {
      id: 'proj-grandchild',
      parentId: 'proj-child-a',
      deletedAt: null,
    },
  };
  let invoiceArgs = null;
  const auditEntries = [];
  await withPrismaStubs(
    {
      'project.findUnique': async ({ where }) => projectGraph[where.id] ?? null,
      'project.findMany': async ({ where }) => {
        const parentIds = where?.parentId?.in || [];
        return Object.values(projectGraph)
          .filter(
            (project) =>
              project.deletedAt === null && parentIds.includes(project.parentId),
          )
          .map((project) => ({ id: project.id }));
      },
      'projectMember.findMany': async () => [],
      'invoice.findMany': async (args) => {
        invoiceArgs = args;
        return [];
      },
      'auditLog.create': async ({ data }) => {
        auditEntries.push(data);
        return { id: `audit-${auditEntries.length}` };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/ref-candidates?projectId=proj-root&q=INV&types=invoice',
          headers: userHeaders('proj-root,proj-child-a'),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.deepEqual(body?.items, []);
      } finally {
        await server.close();
      }
    },
  );

  assert.deepEqual(invoiceArgs?.where?.projectId, {
    in: ['proj-root', 'proj-child-a'],
  });
  const lastAudit = auditEntries.at(-1);
  assert.equal(lastAudit?.metadata?.scopeProjectCount, 2);
  assert.equal(lastAudit?.metadata?.canSeeAllProjects, false);
  assert.equal(lastAudit?.metadata?.canAccessMaster, false);
});
