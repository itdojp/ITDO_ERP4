import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { mapErrorToResponse } from '../dist/services/errors.js';

process.env.DATABASE_URL ??=
  'postgresql://test:test@127.0.0.1:5432/test?schema=public';
const { registerKnowledgeCaptureRoutes } =
  await import('../dist/routes/knowledgeCaptures.js');

const draft = {
  schemaVersion: 1,
  channel: 'browser_extension',
  title: 'Synthetic title',
  url: null,
  selectedText: 'Synthetic body',
  description: null,
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

async function build(service) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = {
      userId: 'owner-1',
      roles: ['user'],
      orgId: 'org-1',
      groupAccountIds: ['group-1'],
      auth: {
        providerType: 'header',
        identityId: 'identity-1',
        userAccountId: 'owner-1',
      },
    };
  });
  await registerKnowledgeCaptureRoutes(app, { service });
  await app.ready();
  return app;
}

test('capture routes expose allowlisted preview and pending state only', async (t) => {
  const calls = [];
  const service = {
    async preview(input) {
      calls.push(['preview', input]);
      return {
        ok: true,
        value: {
          captureId: 'capture-1',
          normalizedDraft: { ...draft, providerKey: 'must-not-leak' },
          selectedFields: ['title', 'selectedText'],
          omittedFields: [],
          scope: 'personal',
          sourceType: 'manual',
          fieldCount: 2,
          byteCount: 100,
          duplicateCandidate: { detected: false, status: null },
          requiresOrganizationConfirmation: false,
          previewToken: 'opaque-preview-token',
          expiresAt: new Date('2026-08-14T00:10:00.000Z'),
          requestKey: 'must-not-leak',
        },
      };
    },
    async commit(input) {
      calls.push(['commit', input]);
      return {
        ok: true,
        value: {
          captureId: 'capture-1',
          requestCaptureId: 'capture-1',
          itemId: 'item-1',
          snapshotId: 'snapshot-1',
          status: 'pending',
          failureCode: null,
          reused: false,
          createdAt: new Date('2026-08-14T00:00:00.000Z'),
          committedAt: null,
          failedAt: null,
          providerKey: 'must-not-leak',
        },
      };
    },
    async detail() {
      throw new Error('unused');
    },
    async reconcile() {
      throw new Error('unused');
    },
  };
  const app = await build(service);
  t.after(() => app.close());
  const base = {
    draft,
    selectedFields: ['title', 'selectedText'],
    scope: 'personal',
    organizationGroupAccountIds: [],
    sourceType: 'manual',
  };
  const preview = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    payload: base,
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(JSON.stringify(preview.json()).includes('must-not-leak'), false);

  const commit = await app.inject({
    method: 'POST',
    url: '/knowledge/captures',
    payload: {
      ...base,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: 'opaque-preview-token',
      requestKey: 'private-request-key',
    },
  });
  assert.equal(commit.statusCode, 202);
  assert.equal(commit.json().status, 'pending');
  assert.equal(JSON.stringify(commit.json()).includes('providerKey'), false);
  assert.equal(calls[0][1].actor.userId, 'owner-1');
});

test('capture HTTP parser allows bounded escaped envelopes above the canonical draft limit', async (t) => {
  let previewCalls = 0;
  const service = {
    preview: async () => {
      previewCalls += 1;
      return {
        ok: true,
        value: {
          captureId: 'capture-large',
          normalizedDraft: { ...draft, selectedText: 'accepted' },
          selectedFields: ['selectedText'],
          omittedFields: [],
          scope: 'personal',
          sourceType: 'manual',
          fieldCount: 1,
          byteCount: 1,
          duplicateCandidate: { detected: false, status: null },
          requiresOrganizationConfirmation: false,
          previewToken: 'opaque-preview-token',
          expiresAt: new Date('2026-08-14T00:10:00.000Z'),
        },
      };
    },
    commit: async () => {
      throw new Error('unused');
    },
    detail: async () => {
      throw new Error('unused');
    },
    reconcile: async () => {
      throw new Error('unused');
    },
  };
  const app = await build(service);
  t.after(() => app.close());
  const escaped = '\\'.repeat(64 * 1024);
  const payload = {
    draft: { ...draft, title: null, selectedText: escaped },
    selectedFields: ['selectedText'],
    scope: 'personal',
    organizationGroupAccountIds: [],
    sourceType: 'manual',
  };
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  assert.ok(raw.length > 128 * 1024);
  assert.ok(raw.length < 288 * 1024);
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    headers: { 'content-type': 'application/json' },
    payload: raw,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(previewCalls, 1);
});

test('capture routes reject unsupported top-level fields before the service', async (t) => {
  const service = {
    preview: async () => {
      throw new Error('must-not-run');
    },
    commit: async () => {
      throw new Error('unused');
    },
    detail: async () => {
      throw new Error('unused');
    },
    reconcile: async () => {
      throw new Error('unused');
    },
  };
  const app = await build(service);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    payload: {
      draft,
      selectedFields: ['title'],
      scope: 'personal',
      organizationGroupAccountIds: [],
      rawHtml: '<script>private</script>',
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.stringify(response.json()).includes('private'), false);
});

test('capture HTTP routes reject malformed UTF-8 before schema normalization', async (t) => {
  let previewCalls = 0;
  const service = {
    preview: async () => {
      previewCalls += 1;
      throw new Error('must-not-run');
    },
    commit: async () => {
      throw new Error('unused');
    },
    detail: async () => {
      throw new Error('unused');
    },
    reconcile: async () => {
      throw new Error('unused');
    },
  };
  const app = await build(service);
  t.after(() => app.close());
  const raw = Buffer.from(
    JSON.stringify({
      draft: { ...draft, BADKEY: 'must-not-leak' },
      selectedFields: ['title'],
      scope: 'personal',
      organizationGroupAccountIds: [],
      sourceType: 'manual',
    }),
    'utf8',
  );
  const marker = raw.indexOf(Buffer.from('BADKEY', 'ascii'));
  assert.notEqual(marker, -1);
  raw[marker] = 0xc3;
  raw[marker + 1] = 0x28;

  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    headers: { 'content-type': 'application/json' },
    payload: raw,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(previewCalls, 0);
  assert.equal(response.body.includes('must-not-leak'), false);
  assert.equal(response.body.includes('\ufffd'), false);
});
