import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeSearchRoutes } from '../dist/routes/knowledgeSearch.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const now = new Date('2026-08-05T03:00:00.000Z');

function item() {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    sourceType: 'web',
    canonicalUrl: 'https://example.invalid/article',
    title: 'Article',
    sourceAuthor: null,
    publishedAt: null,
    capturedAt: now,
    saveReason: null,
    shortNote: null,
    unresolvedQuestion: null,
    status: 'inbox',
    version: 1,
    deletedAt: null,
    deletedReason: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
  };
}

function serviceStub(overrides = {}) {
  return {
    resolveFilter: async () => ({ ok: false }),
    validateCanonicalFilter: async () => ({ ok: false }),
    executeCanonical: async () => ({ ok: false }),
    search: async () => ({
      ok: true,
      value: { items: [item()], total: 1, facets: {}, nextCursor: null },
    }),
    suggest: async () => ({
      ok: true,
      value: [
        {
          id: 'label-1',
          displayName: 'Architecture',
          slug: 'architecture',
          usageCount: 1,
        },
      ],
    }),
    ...overrides,
  };
}

async function buildServer(service, user = {}) {
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
        principalUserId: 'principal-1',
        actorUserId: 'owner-1',
        scopes: ['knowledge:read'],
        delegated: false,
        providerType: 'header',
      },
      ...user,
    };
  });
  await registerKnowledgeSearchRoutes(app, { service });
  await app.ready();
  return app;
}

test('search and suggestion routes register the dedicated search rate limit', async (t) => {
  const app = Fastify();
  const rateLimits = new Map();
  app.addHook('onRoute', (options) => {
    if (options.method === 'POST') {
      rateLimits.set(options.url, options.config?.rateLimit);
    }
  });
  await registerKnowledgeSearchRoutes(app, { service: serviceStub() });
  t.after(() => app.close());

  assert.deepEqual(rateLimits.get('/knowledge/search'), {
    max: 60,
    timeWindow: '1 minute',
  });
  assert.deepEqual(rateLimits.get('/knowledge/labels/suggestions'), {
    max: 60,
    timeWindow: '1 minute',
  });
});

test('typed search route maps canonical actor/body and serializes item dates', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      search: async (input) => {
        captured = input;
        return {
          ok: true,
          value: {
            items: [item()],
            total: 1,
            facets: { status: [{ value: 'inbox', count: 1 }] },
            nextCursor: 'opaque-cursor',
          },
        };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/search',
    payload: {
      labels: {
        all: [{ reference: 'Architecture', includeDescendants: true }],
      },
      status: 'inbox',
      facets: ['status'],
      limit: 25,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(captured.actor, {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.equal(captured.body.limit, 25);
  assert.equal(response.json().items[0].updatedAt, now.toISOString());
  assert.equal(response.json().nextCursor, 'opaque-cursor');
});

test('suggestion route is POST body-based and maps bounded input', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      suggest: async (input) => {
        captured = input;
        return { ok: true, value: [] };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/labels/suggestions',
    payload: { query: 'arch', limit: 5 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(captured.query, 'arch');
  assert.equal(captured.limit, 5);
  assert.deepEqual(response.json(), { items: [] });

  const tooShort = await app.inject({
    method: 'POST',
    url: '/knowledge/labels/suggestions',
    payload: { query: 'a' },
  });
  assert.equal(tooShort.statusCode, 400, tooShort.body);
});

test('search routes preserve application error codes and reject unknown body fields', async (t) => {
  let calls = 0;
  const app = await buildServer(
    serviceStub({
      search: async () => {
        calls += 1;
        return {
          ok: false,
          statusCode: 400,
          code: 'query_too_complex',
          message: 'Knowledge search query is too complex',
        };
      },
    }),
  );
  t.after(() => app.close());
  const rejected = await app.inject({
    method: 'POST',
    url: '/knowledge/search',
    payload: { unsupported: 'private-filter' },
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().error.code, 'invalid_request');
  assert.equal(calls, 0);

  const complex = await app.inject({
    method: 'POST',
    url: '/knowledge/search',
    payload: {},
  });
  assert.equal(complex.statusCode, 400, complex.body);
  assert.equal(complex.json().error.code, 'query_too_complex');
  assert.equal(calls, 1);
});

test('search and suggestion reject non-header actors without canonical account resolution', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: [] };
  };
  const app = await buildServer(
    serviceStub({ search: called, suggest: called }),
    {
      userId: 'raw-subject',
      auth: {
        principalUserId: 'raw-subject',
        actorUserId: 'raw-subject',
        scopes: ['knowledge:read'],
        delegated: false,
        providerType: 'google_oidc',
      },
    },
  );
  t.after(() => app.close());
  for (const request of [
    { url: '/knowledge/search', payload: {} },
    {
      url: '/knowledge/labels/suggestions',
      payload: { query: 'arch' },
    },
  ]) {
    const response = await app.inject({ method: 'POST', ...request });
    assert.equal(response.statusCode, 403, response.body);
  }
  assert.equal(calls, 0);
});
