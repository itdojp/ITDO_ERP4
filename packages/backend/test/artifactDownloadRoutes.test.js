import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import Fastify from 'fastify';

import { registerEvidenceSnapshotRoutes } from '../dist/routes/evidenceSnapshots.js';
import { registerPdfFileRoutes } from '../dist/routes/pdfFiles.js';
import { registerReportSubscriptionRoutes } from '../dist/routes/reportSubscriptions.js';
import { prisma } from '../dist/services/db.js';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
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

async function withApp(register, user, fn) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.user = user;
  });
  await register(app);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

function openedArtifact({
  content = Buffer.from('artifact-placeholder', 'utf8'),
  contentType = 'application/octet-stream',
  originalName = 'artifact.bin',
} = {}) {
  return {
    artifact: {
      artifactId: ARTIFACT_ID,
      contentType,
      createdAt: '2026-07-22T00:00:00.000Z',
      originalName,
      provider: 'gdrive',
      sha256: 'a'.repeat(64),
      sizeBytes: content.length,
    },
    stream: Readable.from(content),
  };
}

test('PDF artifact download is restricted to admin/mgmt before storage access', async () => {
  let openCalls = 0;
  await withApp(
    (app) =>
      registerPdfFileRoutes(app, {
        createStorage: () => ({
          open: async () => {
            openCalls += 1;
            return openedArtifact();
          },
        }),
      }),
    { userId: 'user-placeholder', roles: ['user'] },
    async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: `/pdf-files/artifacts/${ARTIFACT_ID}`,
      });
      assert.equal(response.statusCode, 403, response.body);
    },
  );
  assert.equal(openCalls, 0);
});

test('report artifact download streams content without exposing provider identifiers', async () => {
  const content = Buffer.from('report-placeholder', 'utf8');
  let audit;
  await withPrismaStubs(
    {
      'auditLog.create': async ({ data }) => {
        audit = data;
        return { id: 'audit-placeholder' };
      },
    },
    () =>
      withApp(
        (app) =>
          registerReportSubscriptionRoutes(app, {
            createStorage: () => ({
              open: async (artifactId) => {
                assert.equal(artifactId, ARTIFACT_ID);
                return openedArtifact({
                  content,
                  contentType: 'text/csv; charset=utf-8',
                  originalName: 'report.csv',
                });
              },
            }),
          }),
        { userId: 'admin-placeholder', roles: ['admin'] },
        async (app) => {
          const response = await app.inject({
            method: 'GET',
            url: `/report-outputs/${ARTIFACT_ID}`,
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(response.rawPayload, content);
          assert.equal(
            response.headers['content-disposition'],
            'attachment; filename="report.csv"',
          );
        },
      ),
  );
  assert.equal(audit.action, 'report_output_downloaded');
  for (const forbiddenKey of [
    'folderId',
    'providerKey',
    'providerUrl',
    'sharedDriveId',
    'url',
  ]) {
    assert.equal(Object.hasOwn(audit.metadata, forbiddenKey), false);
  }
});

test('evidence artifact download reapplies approval access and owner scope', async () => {
  const content = Buffer.from('{"evidence":true}\n', 'utf8');
  let receivedScope;
  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => ({
        id: 'approval-placeholder',
        targetTable: 'expenses',
        projectId: 'project-placeholder',
        createdBy: 'creator-placeholder',
      }),
      'auditLog.create': async () => ({ id: 'audit-placeholder' }),
    },
    () =>
      withApp(
        (app) =>
          registerEvidenceSnapshotRoutes(app, {
            createArchiveStorage: () => ({
              open: async (artifactId, scope) => {
                assert.equal(artifactId, ARTIFACT_ID);
                receivedScope = scope;
                return openedArtifact({
                  content,
                  contentType: 'application/json; charset=utf-8',
                  originalName: 'evidence.json',
                });
              },
            }),
          }),
        {
          userId: 'user-placeholder',
          roles: ['user'],
          projectIds: ['project-placeholder'],
        },
        async (app) => {
          const response = await app.inject({
            method: 'GET',
            url: `/approval-instances/approval-placeholder/evidence-pack/archives/${ARTIFACT_ID}`,
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(response.rawPayload, content);
        },
      ),
  );
  assert.deepEqual(receivedScope, {
    ownerId: 'approval-placeholder',
    ownerType: 'approval_instance',
  });
});

test('evidence artifact download rejects non-UUID artifactId with 400', async () => {
  let openCalls = 0;
  await withApp(
    (app) =>
      registerEvidenceSnapshotRoutes(app, {
        createArchiveStorage: () => ({
          open: async () => {
            openCalls += 1;
            return openedArtifact();
          },
        }),
      }),
    { userId: 'admin-placeholder', roles: ['admin'] },
    async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/approval-instances/approval-placeholder/evidence-pack/archives/not-a-uuid',
      });
      assert.equal(response.statusCode, 400, response.body);
      const body = JSON.parse(response.body);
      assert.equal(body.error.code, 'INVALID_ARTIFACT_ID');
    },
  );
  assert.equal(openCalls, 0);
});
