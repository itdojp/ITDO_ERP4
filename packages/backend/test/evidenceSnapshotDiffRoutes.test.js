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

test('GET /approval-instances/:id/evidence-snapshot/diff returns latest version diff', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const approval = {
    id: 'approval-001',
    projectId: 'project-001',
    createdBy: 'owner-001',
  };
  const snapshotV1 = {
    id: 'snapshot-001',
    approvalInstanceId: approval.id,
    version: 1,
    capturedAt: new Date('2026-02-23T10:00:00.000Z'),
    sourceAnnotationUpdatedAt: new Date('2026-02-23T09:50:00.000Z'),
    items: {
      notes: 'before',
      externalUrls: ['https://example.com/a'],
      internalRefs: [],
    },
  };
  const snapshotV2 = {
    id: 'snapshot-002',
    approvalInstanceId: approval.id,
    version: 2,
    capturedAt: new Date('2026-02-23T11:00:00.000Z'),
    sourceAnnotationUpdatedAt: new Date('2026-02-23T10:50:00.000Z'),
    items: {
      notes: 'after',
      externalUrls: ['https://example.com/a'],
      internalRefs: [],
    },
  };

  let capturedAuditArgs = null;
  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => approval,
      'evidenceSnapshot.findMany': async () => [snapshotV2, snapshotV1],
      'auditLog.create': async (args) => {
        capturedAuditArgs = args;
        return { id: 'audit-001' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: `/approval-instances/${approval.id}/evidence-snapshot/diff`,
          headers: {
            'x-user-id': 'project-user',
            'x-roles': 'user',
            'x-project-ids': approval.projectId,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.fromSnapshot.version, 1);
        assert.equal(body.toSnapshot.version, 2);
        assert.equal(body.hasChanges, true);
        assert.equal(body.changeCount, 1);
        assert.deepEqual(body.changedKeys, ['notes']);
        assert.equal(body.changes[0].before, 'before');
        assert.equal(body.changes[0].after, 'after');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedAuditArgs?.data?.action, 'evidence_snapshot_diff_viewed');
  assert.equal(capturedAuditArgs?.data?.targetTable, 'evidence_snapshots');
  assert.equal(capturedAuditArgs?.data?.targetId, 'snapshot-002');
  assert.equal(capturedAuditArgs?.data?.metadata?.fromVersion, 1);
  assert.equal(capturedAuditArgs?.data?.metadata?.toVersion, 2);
  assert.equal(capturedAuditArgs?.data?.metadata?.changeCount, 1);
});

test('GET /approval-instances/:id/evidence-snapshot/diff requires version pair when only one query is provided', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => ({
        id: 'approval-002',
        projectId: 'project-002',
        createdBy: 'owner-002',
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/approval-instances/approval-002/evidence-snapshot/diff?fromVersion=1',
          headers: {
            'x-user-id': 'owner-002',
            'x-roles': 'user',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'SNAPSHOT_VERSION_PAIR_REQUIRED');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /approval-instances/:id/evidence-snapshot/diff returns 404 when requested snapshot version is missing', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => ({
        id: 'approval-003',
        projectId: 'project-003',
        createdBy: 'owner-003',
      }),
      'evidenceSnapshot.findUnique': async (args) => {
        const version = Number(
          args?.where?.approvalInstanceId_version?.version ?? 0,
        );
        if (version === 1) {
          return {
            id: 'snapshot-003-v1',
            approvalInstanceId: 'approval-003',
            version: 1,
            capturedAt: new Date('2026-02-23T10:00:00.000Z'),
            sourceAnnotationUpdatedAt: null,
            items: { notes: 'v1' },
          };
        }
        return null;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/approval-instances/approval-003/evidence-snapshot/diff?fromVersion=1&toVersion=2',
          headers: {
            'x-user-id': 'owner-003',
            'x-roles': 'user',
          },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'SNAPSHOT_NOT_FOUND');
      } finally {
        await server.close();
      }
    },
  );
});
