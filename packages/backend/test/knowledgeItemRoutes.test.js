import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeItemRoutes } from '../dist/routes/knowledgeItems.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

function item(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    sourceType: 'manual',
    canonicalUrl: null,
    title: 'Knowledge item',
    sourceAuthor: null,
    publishedAt: null,
    capturedAt: new Date('2026-08-04T09:00:00.000Z'),
    saveReason: null,
    shortNote: null,
    unresolvedQuestion: null,
    status: 'inbox',
    version: 1,
    deletedAt: null,
    deletedReason: null,
    createdAt: new Date('2026-08-04T09:00:00.000Z'),
    createdBy: 'owner-1',
    updatedAt: new Date('2026-08-04T09:00:00.000Z'),
    updatedBy: 'owner-1',
    ...overrides,
  };
}

async function buildRouteServer(service, user = {}) {
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
      groupIds: ['Knowledge'],
      groupAccountIds: ['group-1'],
      auth: {
        principalUserId: 'principal-1',
        actorUserId: 'owner-1',
        scopes: ['knowledge:write'],
        delegated: true,
      },
      ...user,
    };
  });
  await registerKnowledgeItemRoutes(app, { service });
  await app.ready();
  return app;
}

function serviceStub(overrides = {}) {
  return {
    list: async () => [],
    count: async () => 0,
    detail: async () => ({
      ok: false,
      statusCode: 404,
      code: 'not_found',
      message: 'Not found',
    }),
    create: async () => ({ ok: true, value: item() }),
    update: async () => ({ ok: true, value: item({ version: 2 }) }),
    remove: async () => ({
      ok: true,
      value: item({ version: 2, deletedAt: new Date() }),
    }),
    restore: async () => ({ ok: true, value: item({ version: 3 }) }),
    ...overrides,
  };
}

test('knowledge create route maps authenticated org/group context and returns the documented response', async (t) => {
  let captured;
  const app = await buildRouteServer(
    serviceStub({
      create: async (input) => {
        captured = input;
        return { ok: true, value: item() };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items',
    headers: { 'user-agent': 'knowledge-route-test' },
    payload: { scope: 'personal', sourceType: 'manual', title: 'Note' },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(captured.actor, {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.equal(captured.auditActor.userId, 'owner-1');
  assert.equal(captured.auditActor.principalUserId, 'principal-1');
  assert.equal(captured.auditActor.actorUserId, 'owner-1');
  assert.deepEqual(captured.auditActor.authScopes, ['knowledge:write']);
  assert.equal(
    Object.prototype.hasOwnProperty.call(captured.auditActor, 'userAgent'),
    false,
  );
  assert.equal(response.json().version, 1);
  assert.equal(response.json().capturedAt, '2026-08-04T09:00:00.000Z');
});

test('knowledge route normalizes malformed authenticated context to a fail-closed actor', async (t) => {
  let capturedActor;
  const app = await buildRouteServer(
    serviceStub({
      list: async (input) => {
        capturedActor = input.actor;
        return [];
      },
    }),
    {
      userId: 42,
      orgId: 42,
      groupAccountIds: [42, ' group-1 ', null, ''],
    },
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/items',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(capturedActor, {
    userId: '',
    organizationId: undefined,
    groupAccountIds: ['group-1'],
  });
});

test('knowledge route schema rejects scope changes and out-of-range versions before the service', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: item() };
  };
  const app = await buildRouteServer(
    serviceStub({
      update: called,
      remove: called,
      restore: called,
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: '/knowledge/items/item-1',
    payload: {
      expectedVersion: 1,
      scope: 'organization',
      organizationGroupIds: ['group-1'],
    },
  });
  assert.equal(response.statusCode, 400);

  for (const request of [
    {
      method: 'PATCH',
      url: '/knowledge/items/item-1',
      payload: { expectedVersion: 2147483648, title: 'not written' },
    },
    {
      method: 'DELETE',
      url: '/knowledge/items/item-1',
      payload: {
        expectedVersion: 2147483648,
        reasonCode: 'owner_request',
      },
    },
    {
      method: 'POST',
      url: '/knowledge/items/item-1/restore',
      payload: { expectedVersion: 2147483648 },
    },
  ]) {
    const invalidVersion = await app.inject(request);
    assert.equal(invalidVersion.statusCode, 400, invalidVersion.body);
  }
  assert.equal(calls, 0);

  const maximumVersion = await app.inject({
    method: 'PATCH',
    url: '/knowledge/items/item-1',
    payload: { expectedVersion: 2147483647, title: 'bounded' },
  });
  assert.equal(maximumVersion.statusCode, 200, maximumVersion.body);
  assert.equal(calls, 1);
});

test('knowledge delete route rejects arbitrary reason text before the service', async (t) => {
  let calls = 0;
  const app = await buildRouteServer(
    serviceStub({
      remove: async () => {
        calls += 1;
        return { ok: true, value: item() };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'DELETE',
    url: '/knowledge/items/item-1',
    payload: {
      expectedVersion: 1,
      reasonCode: 'pasted credential or free-form explanation',
    },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(calls, 0);
});

test('knowledge routes reject unsupported roles with the documented 403 contract before service calls', async (t) => {
  let calls = 0;
  const denied = async () => {
    calls += 1;
    return { ok: true, value: item() };
  };
  const app = await buildRouteServer(
    serviceStub({
      list: denied,
      count: denied,
      detail: denied,
      create: denied,
      update: denied,
      remove: denied,
      restore: denied,
    }),
    { roles: ['auditor'] },
  );
  t.after(() => app.close());

  const requests = [
    { method: 'GET', url: '/knowledge/items' },
    { method: 'GET', url: '/knowledge/items/count' },
    { method: 'GET', url: '/knowledge/items/item-1' },
    {
      method: 'POST',
      url: '/knowledge/items',
      payload: { scope: 'personal', sourceType: 'manual' },
    },
    {
      method: 'PATCH',
      url: '/knowledge/items/item-1',
      payload: { expectedVersion: 1 },
    },
    {
      method: 'DELETE',
      url: '/knowledge/items/item-1',
      payload: { expectedVersion: 1, reasonCode: 'owner_request' },
    },
    {
      method: 'POST',
      url: '/knowledge/items/item-1/restore',
      payload: { expectedVersion: 1 },
    },
  ];

  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403, `${request.method} ${request.url}`);
    assert.deepEqual(response.json(), {
      error: {
        code: 'forbidden',
        message: 'Forbidden',
        category: 'permission',
      },
    });
  }
  assert.equal(calls, 0);
});

test('knowledge detail returns the same not-found contract for hidden and absent ids', async (t) => {
  const app = await buildRouteServer(serviceStub());
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/items/hidden-item',
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: {
      code: 'not_found',
      message: 'Not found',
      category: 'not_found',
    },
  });
});

test('knowledge list/count pass only server-derived actor context and bounded filters', async (t) => {
  const calls = [];
  const app = await buildRouteServer(
    serviceStub({
      list: async (input) => {
        calls.push(['list', input]);
        return [item()];
      },
      count: async (input) => {
        calls.push(['count', input]);
        return 1;
      },
    }),
  );
  t.after(() => app.close());

  const list = await app.inject({
    method: 'GET',
    url: '/knowledge/items?limit=10&offset=2&scope=personal&status=inbox',
  });
  const count = await app.inject({
    method: 'GET',
    url: '/knowledge/items/count?scope=personal&status=inbox',
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(count.statusCode, 200, count.body);
  assert.deepEqual(calls[0][1].query, {
    limit: 10,
    offset: 2,
    scope: 'personal',
    status: 'inbox',
  });
  assert.equal(calls[1][1].actor.userId, 'owner-1');
  assert.equal(count.json().count, 1);
});

test('knowledge delete and restore routes preserve version/reason wiring and error contracts', async (t) => {
  const calls = [];
  const app = await buildRouteServer(
    serviceStub({
      remove: async (input) => {
        calls.push(['remove', input]);
        if (input.expectedVersion === 1) {
          return {
            ok: true,
            value: item({
              version: 2,
              deletedAt: new Date('2026-08-04T10:00:00.000Z'),
              deletedReason: input.reasonCode,
            }),
          };
        }
        return {
          ok: false,
          statusCode: 409,
          code: 'version_conflict',
          message: 'Knowledge item version conflict',
        };
      },
      restore: async (input) => {
        calls.push(['restore', input]);
        if (input.expectedVersion === 2) {
          return { ok: true, value: item({ version: 3 }) };
        }
        return {
          ok: false,
          statusCode: 404,
          code: 'not_found',
          message: 'Not found',
        };
      },
    }),
  );
  t.after(() => app.close());

  const removed = await app.inject({
    method: 'DELETE',
    url: '/knowledge/items/item-1',
    payload: { expectedVersion: 1, reasonCode: 'owner_request' },
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().deletedReason, 'owner_request');
  assert.equal(calls[0][1].itemId, 'item-1');
  assert.equal(calls[0][1].expectedVersion, 1);
  assert.equal(calls[0][1].reasonCode, 'owner_request');

  const staleDelete = await app.inject({
    method: 'DELETE',
    url: '/knowledge/items/item-1',
    payload: { expectedVersion: 9, reasonCode: 'owner_request' },
  });
  assert.equal(staleDelete.statusCode, 409);
  assert.equal(staleDelete.json().error.code, 'version_conflict');

  const restored = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/restore',
    payload: { expectedVersion: 2 },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().version, 3);
  assert.equal(calls[2][1].expectedVersion, 2);

  const hiddenRestore = await app.inject({
    method: 'POST',
    url: '/knowledge/items/hidden/restore',
    payload: { expectedVersion: 9 },
  });
  assert.equal(hiddenRestore.statusCode, 404);
  assert.equal(hiddenRestore.json().error.code, 'not_found');
});
