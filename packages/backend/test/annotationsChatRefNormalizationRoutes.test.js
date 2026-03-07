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
      if (!model || !member) {
        throw new Error(`invalid stub path: ${path}`);
      }
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

function createTransactionStub() {
  return async (callback) => callback(prisma);
}

test('PATCH /annotations/:kind/:id normalizes project_chat refs into room_chat', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const upserts = [];
      const annotationLogs = [];
      const auditEntries = [];
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-001',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotationSetting.findUnique': async () => null,
          'annotation.findUnique': async () => null,
          'annotation.upsert': async ({ create, update }) => {
            upserts.push({ create, update });
            return {
              id: 'annotation-1',
              targetKind: 'invoice',
              targetId: 'inv-001',
              notes: null,
              externalUrls: [],
              internalRefs: create.internalRefs,
              updatedAt: new Date('2026-03-06T00:00:00Z'),
              updatedBy: 'admin-user',
            };
          },
          'annotationLog.create': async ({ data }) => {
            annotationLogs.push(data);
            return { id: `annotation-log-${annotationLogs.length}` };
          },
          'auditLog.create': async ({ data }) => {
            auditEntries.push(data);
            return { id: `audit-${auditEntries.length}` };
          },
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PATCH',
              url: '/annotations/invoice/inv-001',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
                'content-type': 'application/json',
              },
              payload: {
                notes: null,
                externalUrls: [],
                internalRefs: [
                  {
                    kind: 'project_chat',
                    id: 'room-001',
                    label: 'Legacy project room',
                  },
                  {
                    kind: 'room_chat',
                    id: 'room-001',
                    label: 'Canonical room',
                  },
                ],
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.deepEqual(payload.internalRefs, [
              {
                kind: 'room_chat',
                id: 'room-001',
                label: 'Legacy project room',
              },
            ]);
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(upserts.length, 1);
      assert.deepEqual(upserts[0]?.create?.internalRefs, [
        {
          kind: 'room_chat',
          id: 'room-001',
          label: 'Legacy project room',
        },
      ]);
      assert.equal(annotationLogs.length, 1);
      assert.deepEqual(annotationLogs[0]?.internalRefs, [
        {
          kind: 'room_chat',
          id: 'room-001',
          label: 'Legacy project room',
        },
      ]);
      assert.equal(auditEntries.length, 1);
      assert.equal(auditEntries[0]?.action, 'annotations_updated');
    },
  );
});

test('GET /annotations/:kind/:id merges reference_links into normalized payload', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-002',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotation.findUnique': async () => ({
            notes: 'existing note',
            externalUrls: ['https://example.com/a'],
            internalRefs: [
              { kind: 'project', id: 'proj-001', label: 'Project A' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'referenceLink.findMany': async () => [
            {
              linkKind: 'external_url',
              refKind: null,
              value: 'https://example.com/a',
              label: null,
              updatedAt: new Date('2026-03-07T00:00:00Z'),
              updatedBy: 'author-2',
            },
            {
              linkKind: 'external_url',
              refKind: null,
              value: 'https://example.com/b',
              label: null,
              updatedAt: new Date('2026-03-07T00:00:00Z'),
              updatedBy: 'author-2',
            },
            {
              linkKind: 'internal_ref',
              refKind: 'project_chat',
              value: 'room-001',
              label: 'Legacy room',
              updatedAt: new Date('2026-03-07T00:00:00Z'),
              updatedBy: 'author-2',
            },
            {
              linkKind: 'internal_ref',
              refKind: 'chat_message',
              value: 'msg-001',
              label: 'Message A',
              updatedAt: new Date('2026-03-07T00:00:00Z'),
              updatedBy: 'author-2',
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'GET',
              url: '/annotations/invoice/inv-002',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload.notes, 'existing note');
            assert.deepEqual(payload.externalUrls, [
              'https://example.com/a',
              'https://example.com/b',
            ]);
            assert.deepEqual(payload.internalRefs, [
              { kind: 'project', id: 'proj-001', label: 'Project A' },
              { kind: 'room_chat', id: 'room-001', label: 'Legacy room' },
              { kind: 'chat_message', id: 'msg-001', label: 'Message A' },
            ]);
            assert.equal(payload.updatedBy, 'author-2');
            assert.equal(payload.updatedAt, '2026-03-07T00:00:00.000Z');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
