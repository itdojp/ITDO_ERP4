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
          'referenceLink.deleteMany': async () => ({ count: 0 }),
          'referenceLink.createMany': async () => ({ count: 1 }),
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

test('PATCH /annotations/:kind/:id dual-writes normalized links into reference_links', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const referenceDeletes = [];
      const referenceCreates = [];
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-010',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotationSetting.findUnique': async () => null,
          'annotation.findUnique': async () => ({
            id: 'annotation-10',
            targetKind: 'invoice',
            targetId: 'inv-010',
            notes: 'before',
            externalUrls: ['https://before.example.com'],
            internalRefs: [
              { kind: 'project', id: 'proj-001', label: 'Before' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'annotation.upsert': async ({ create, update }) => ({
            id: 'annotation-10',
            targetKind: 'invoice',
            targetId: 'inv-010',
            notes: update.notes ?? create.notes ?? null,
            externalUrls: update.externalUrls ?? create.externalUrls ?? [],
            internalRefs: update.internalRefs ?? create.internalRefs ?? [],
            updatedAt: new Date('2026-03-07T00:00:00Z'),
            updatedBy: 'admin-user',
          }),
          'annotationLog.create': async () => ({ id: 'annotation-log-1' }),
          'referenceLink.deleteMany': async ({ where }) => {
            referenceDeletes.push(where);
            return { count: 2 };
          },
          'referenceLink.createMany': async ({ data }) => {
            referenceCreates.push(...data);
            return { count: data.length };
          },
          'auditLog.create': async () => ({ id: 'audit-1' }),
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PATCH',
              url: '/annotations/invoice/inv-010',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
                'content-type': 'application/json',
              },
              payload: {
                notes: 'after',
                externalUrls: [
                  'https://example.com/a',
                  'https://example.com/a',
                  'https://example.com/b',
                ],
                internalRefs: [
                  {
                    kind: 'project_chat',
                    id: 'room-010',
                    label: 'Legacy room',
                  },
                  { kind: 'chat_message', id: 'msg-010', label: 'Message 10' },
                ],
              },
            });
            assert.equal(res.statusCode, 200, res.body);
          } finally {
            await server.close();
          }
        },
      );

      assert.deepEqual(referenceDeletes, [
        {
          targetKind: 'invoice',
          targetId: 'inv-010',
          linkKind: { in: ['external_url', 'internal_ref'] },
        },
      ]);
      assert.deepEqual(referenceCreates, [
        {
          targetKind: 'invoice',
          targetId: 'inv-010',
          linkKind: 'external_url',
          refKind: '',
          value: 'https://example.com/a',
          label: null,
          sortOrder: 0,
          createdBy: 'admin-user',
          updatedBy: 'admin-user',
        },
        {
          targetKind: 'invoice',
          targetId: 'inv-010',
          linkKind: 'external_url',
          refKind: '',
          value: 'https://example.com/b',
          label: null,
          sortOrder: 1,
          createdBy: 'admin-user',
          updatedBy: 'admin-user',
        },
        {
          targetKind: 'invoice',
          targetId: 'inv-010',
          linkKind: 'internal_ref',
          refKind: 'room_chat',
          value: 'room-010',
          label: 'Legacy room',
          sortOrder: 0,
          createdBy: 'admin-user',
          updatedBy: 'admin-user',
        },
        {
          targetKind: 'invoice',
          targetId: 'inv-010',
          linkKind: 'internal_ref',
          refKind: 'chat_message',
          value: 'msg-010',
          label: 'Message 10',
          sortOrder: 1,
          createdBy: 'admin-user',
          updatedBy: 'admin-user',
        },
      ]);
    },
  );
});

test('PATCH /annotations/:kind/:id continues when ReferenceLink table is not available yet', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      let createManyCalled = false;
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-011',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotationSetting.findUnique': async () => null,
          'annotation.findUnique': async () => null,
          'annotation.upsert': async ({ create }) => ({
            id: 'annotation-11',
            targetKind: 'invoice',
            targetId: 'inv-011',
            notes: create.notes ?? null,
            externalUrls: create.externalUrls ?? [],
            internalRefs: create.internalRefs ?? [],
            updatedAt: new Date('2026-03-07T00:00:00Z'),
            updatedBy: 'admin-user',
          }),
          'annotationLog.create': async () => ({ id: 'annotation-log-1' }),
          'referenceLink.deleteMany': async () => {
            const error = new Error('relation "ReferenceLink" does not exist');
            error.code = 'P2021';
            throw error;
          },
          'referenceLink.createMany': async () => {
            createManyCalled = true;
            return { count: 0 };
          },
          'auditLog.create': async () => ({ id: 'audit-1' }),
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PATCH',
              url: '/annotations/invoice/inv-011',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
                'content-type': 'application/json',
              },
              payload: {
                notes: null,
                externalUrls: ['https://example.com/a'],
                internalRefs: [{ kind: 'project', id: 'proj-001' }],
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.deepEqual(payload.externalUrls, ['https://example.com/a']);
            assert.deepEqual(payload.internalRefs, [
              { kind: 'project', id: 'proj-001' },
            ]);
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(createManyCalled, false);
    },
  );
});

test('PATCH /annotations/:kind/:id clears ReferenceLink rows when refs are removed', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const referenceDeletes = [];
      let createManyCalled = false;
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-012',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotationSetting.findUnique': async () => null,
          'annotation.findUnique': async () => ({
            id: 'annotation-12',
            targetKind: 'invoice',
            targetId: 'inv-012',
            notes: 'before',
            externalUrls: ['https://example.com/a'],
            internalRefs: [
              { kind: 'project', id: 'proj-001', label: 'Project A' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'annotation.upsert': async ({ update, create }) => ({
            id: 'annotation-12',
            targetKind: 'invoice',
            targetId: 'inv-012',
            notes: update.notes ?? create.notes ?? null,
            externalUrls: update.externalUrls ?? create.externalUrls ?? [],
            internalRefs: update.internalRefs ?? create.internalRefs ?? [],
            updatedAt: new Date('2026-03-07T00:00:00Z'),
            updatedBy: 'admin-user',
          }),
          'annotationLog.create': async () => ({ id: 'annotation-log-1' }),
          'referenceLink.deleteMany': async ({ where }) => {
            referenceDeletes.push(where);
            return { count: 2 };
          },
          'referenceLink.createMany': async () => {
            createManyCalled = true;
            return { count: 0 };
          },
          'auditLog.create': async () => ({ id: 'audit-1' }),
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PATCH',
              url: '/annotations/invoice/inv-012',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
                'content-type': 'application/json',
              },
              payload: {
                notes: 'after',
                externalUrls: [],
                internalRefs: [],
              },
            });
            assert.equal(res.statusCode, 200, res.body);
          } finally {
            await server.close();
          }
        },
      );

      assert.deepEqual(referenceDeletes, [
        {
          targetKind: 'invoice',
          targetId: 'inv-012',
          linkKind: { in: ['external_url', 'internal_ref'] },
        },
      ]);
      assert.equal(createManyCalled, false);
    },
  );
});

test('PATCH /annotations/:kind/:id skips ReferenceLink sync when there is no effective change', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      let annotationUpsertCalled = false;
      let annotationLogCalled = false;
      let referenceDeleteCalled = false;
      let referenceCreateCalled = false;
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-013',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotationSetting.findUnique': async () => null,
          'annotation.findUnique': async () => ({
            id: 'annotation-13',
            targetKind: 'invoice',
            targetId: 'inv-013',
            notes: 'same',
            externalUrls: ['https://example.com/a'],
            internalRefs: [
              { kind: 'room_chat', id: 'room-013', label: 'Room 13' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'annotation.upsert': async () => {
            annotationUpsertCalled = true;
            throw new Error('annotation.upsert should not be called');
          },
          'annotationLog.create': async () => {
            annotationLogCalled = true;
            throw new Error('annotationLog.create should not be called');
          },
          'referenceLink.deleteMany': async () => {
            referenceDeleteCalled = true;
            return { count: 0 };
          },
          'referenceLink.createMany': async () => {
            referenceCreateCalled = true;
            return { count: 0 };
          },
          'auditLog.create': async () => ({ id: 'audit-1' }),
          $transaction: createTransactionStub(),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PATCH',
              url: '/annotations/invoice/inv-013',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
                'content-type': 'application/json',
              },
              payload: {
                notes: 'same',
                externalUrls: ['https://example.com/a'],
                internalRefs: [
                  { kind: 'project_chat', id: 'room-013', label: 'Room 13' },
                ],
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.deepEqual(payload.externalUrls, ['https://example.com/a']);
            assert.deepEqual(payload.internalRefs, [
              { kind: 'room_chat', id: 'room-013', label: 'Room 13' },
            ]);
          } finally {
            await server.close();
          }
        },
      );

      assert.equal(annotationUpsertCalled, false);
      assert.equal(annotationLogCalled, false);
      assert.equal(referenceDeleteCalled, false);
      assert.equal(referenceCreateCalled, false);
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
              { kind: 'room_chat', id: 'room-001', label: 'Old room label' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'referenceLink.findMany': async () => [
            {
              linkKind: 'external_url',
              refKind: '',
              value: 'https://example.com/a',
              label: null,
              updatedAt: new Date('2026-03-07T00:00:00Z'),
              updatedBy: 'author-2',
            },
            {
              linkKind: 'external_url',
              refKind: '',
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

test('GET /annotations/:kind/:id falls back when ReferenceLink table is not available yet', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => ({
            id: 'inv-003',
            projectId: 'proj-001',
            status: 'draft',
            deletedAt: null,
          }),
          'annotation.findUnique': async () => ({
            notes: 'annotation only',
            externalUrls: ['https://example.com/a'],
            internalRefs: [
              { kind: 'project', id: 'proj-001', label: 'Project A' },
            ],
            updatedAt: new Date('2026-03-06T00:00:00Z'),
            updatedBy: 'author-1',
          }),
          'referenceLink.findMany': async () => {
            const error = new Error('relation "ReferenceLink" does not exist');
            error.code = 'P2021';
            throw error;
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'GET',
              url: '/annotations/invoice/inv-003',
              headers: {
                'x-user-id': 'admin-user',
                'x-roles': 'admin,mgmt',
              },
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload.notes, 'annotation only');
            assert.deepEqual(payload.externalUrls, ['https://example.com/a']);
            assert.deepEqual(payload.internalRefs, [
              { kind: 'project', id: 'proj-001', label: 'Project A' },
            ]);
            assert.equal(payload.updatedBy, 'author-1');
            assert.equal(payload.updatedAt, '2026-03-06T00:00:00.000Z');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
