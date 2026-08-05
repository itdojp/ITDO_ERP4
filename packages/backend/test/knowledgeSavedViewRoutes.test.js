import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeSavedViewRoutes } from '../dist/routes/knowledgeSavedViews.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const now = new Date('2026-08-05T03:00:00.000Z');

function view(overrides = {}) {
  return {
    id: 'view-1',
    ownerUserId: 'owner-1',
    name: 'Architecture inbox',
    filter: {
      labels: {
        any: [{ id: 'label-1', includeDescendants: true }],
        all: [],
        not: [],
      },
      status: 'inbox',
    },
    schemaVersion: 1,
    version: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
    ...overrides,
  };
}

function serviceStub(overrides = {}) {
  return {
    list: async () => ({ ok: true, value: [view()] }),
    listRecoveryMetadata: async () => ({
      ok: true,
      value: [
        {
          id: 'view-1',
          name: 'Architecture inbox',
          version: 1,
          updatedAt: now,
        },
      ],
    }),
    detail: async () => ({ ok: true, value: view() }),
    create: async () => ({ ok: true, value: view() }),
    update: async () => ({ ok: true, value: view({ version: 2 }) }),
    remove: async () => ({
      ok: true,
      value: view({ version: 2, deletedAt: now }),
    }),
    execute: async () => ({
      ok: true,
      value: { items: [], total: 0, facets: {}, nextCursor: null },
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
        scopes: ['knowledge:write'],
        delegated: false,
        providerType: 'header',
      },
      ...user,
    };
  });
  await registerKnowledgeSavedViewRoutes(app, { service });
  await app.ready();
  return app;
}

test('saved-view execute registers the dedicated search rate limit', async (t) => {
  const app = Fastify();
  const rateLimits = new Map();
  app.addHook('onRoute', (options) => {
    if (options.method === 'POST') {
      rateLimits.set(options.url, options.config?.rateLimit);
    }
  });
  await registerKnowledgeSavedViewRoutes(app, { service: serviceStub() });
  t.after(() => app.close());

  assert.deepEqual(rateLimits.get('/knowledge/saved-views/:id/execute'), {
    max: 60,
    timeWindow: '1 minute',
  });
});

test('saved-view list/detail responses expose canonical filters only', async (t) => {
  const app = await buildServer(serviceStub());
  t.after(() => app.close());
  const list = await app.inject({
    method: 'GET',
    url: '/knowledge/saved-views?limit=10&offset=0',
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json().items[0].filter.labels.any, [
    { id: 'label-1', includeDescendants: true },
  ]);
  assert.equal(list.json().items[0].updatedAt, now.toISOString());

  const detail = await app.inject({
    method: 'GET',
    url: '/knowledge/saved-views/view-1',
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().id, 'view-1');
});

test('saved-view recovery route exposes owner metadata without filter contents', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      listRecoveryMetadata: async (input) => {
        captured = input;
        return {
          ok: true,
          value: [
            {
              id: 'stale-view',
              name: 'Stale view',
              version: 4,
              updatedAt: now,
            },
          ],
        };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/saved-views/recovery?limit=20&offset=0',
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    items: [
      {
        id: 'stale-view',
        name: 'Stale view',
        version: 4,
        updatedAt: now.toISOString(),
      },
    ],
  });
  assert.equal('filter' in response.json().items[0], false);
  assert.equal(captured.actor.userId, 'owner-1');
});

test('saved-view mutations map canonical actor, audit context and full replacement body', async (t) => {
  const captured = [];
  const app = await buildServer(
    serviceStub({
      create: async (input) => {
        captured.push(['create', input]);
        return { ok: true, value: view() };
      },
      update: async (input) => {
        captured.push(['update', input]);
        return { ok: true, value: view({ version: 2 }) };
      },
      remove: async (input) => {
        captured.push(['remove', input]);
        return {
          ok: true,
          value: view({ version: 2, deletedAt: now }),
        };
      },
    }),
  );
  t.after(() => app.close());
  const filter = {
    labels: { any: [{ reference: 'Architecture' }] },
    status: 'inbox',
  };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/knowledge/saved-views',
        payload: { name: 'Architecture inbox', filter },
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/knowledge/saved-views/view-1',
        payload: {
          expectedVersion: 1,
          name: 'Updated',
          filter,
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/knowledge/saved-views/view-1',
        payload: { expectedVersion: 1 },
      })
    ).statusCode,
    200,
  );
  assert.equal(captured.length, 3);
  assert.equal(captured[0][1].actor.userId, 'owner-1');
  assert.equal(captured[0][1].auditActor.source, 'api');
  assert.equal(captured[1][1].filter.status, 'inbox');
  assert.equal(captured[2][1].expectedVersion, 1);
});

test('saved-view execute maps paging input and preserves invalid cursor code', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      execute: async (input) => {
        captured = input;
        return {
          ok: false,
          statusCode: 400,
          code: 'invalid_cursor',
          message: 'Invalid cursor',
        };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/saved-views/view-1/execute',
    payload: { facets: ['label'], limit: 20, cursor: 'opaque' },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, 'invalid_cursor');
  assert.equal(captured.savedViewId, 'view-1');
  assert.deepEqual(captured.facets, ['label']);
});

test('saved-view routes reject unknown fields and noncanonical actors before service calls', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: view() };
  };
  const app = await buildServer(
    serviceStub({ create: called, detail: called }),
  );
  t.after(() => app.close());
  const unknown = await app.inject({
    method: 'POST',
    url: '/knowledge/saved-views',
    payload: { name: 'View', filter: {}, rawLabelName: 'private' },
  });
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(calls, 0);

  const noncanonical = await buildServer(serviceStub({ detail: called }), {
    userId: 'raw-subject',
    auth: {
      principalUserId: 'raw-subject',
      actorUserId: 'raw-subject',
      scopes: ['knowledge:read'],
      delegated: false,
      providerType: 'google_oidc',
    },
  });
  t.after(() => noncanonical.close());
  const response = await noncanonical.inject({
    method: 'GET',
    url: '/knowledge/saved-views/view-1',
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(calls, 0);
});
