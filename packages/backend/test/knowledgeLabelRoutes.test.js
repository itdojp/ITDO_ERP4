import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeLabelRoutes } from '../dist/routes/knowledgeLabels.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const now = new Date('2026-08-05T00:00:00.000Z');

function label(overrides = {}) {
  return {
    id: 'label-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    displayName: 'Architecture',
    slug: 'architecture',
    parentId: null,
    version: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
    ...overrides,
  };
}

function alias() {
  return {
    id: 'alias-1',
    labelId: 'label-1',
    alias: 'Arch',
    normalizedAlias: 'arch',
    createdAt: now,
    createdBy: 'owner-1',
  };
}

function grant() {
  return {
    id: 'grant-1',
    labelId: 'label-1',
    groupAccountId: 'group-1',
    capability: 'manage',
    active: true,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
  };
}

function assignment() {
  return {
    itemId: 'item-1',
    labelId: 'label-1',
    assignmentSource: 'manual',
    assignedBy: 'owner-1',
    confidenceBasisPoints: null,
    createdAt: now,
    updatedAt: now,
  };
}

function serviceStub(overrides = {}) {
  return {
    list: async () => [],
    detail: async () => ({ ok: true, value: label() }),
    aliases: async () => ({ ok: true, value: [] }),
    grants: async () => ({ ok: true, value: [] }),
    create: async () => ({ ok: true, value: label() }),
    update: async () => ({ ok: true, value: label({ version: 2 }) }),
    remove: async () => ({
      ok: true,
      value: label({ version: 2, deletedAt: now }),
    }),
    addAlias: async () => ({
      ok: true,
      value: { alias: alias(), labelVersion: 2 },
    }),
    removeAlias: async () => ({
      ok: true,
      value: { alias: alias(), labelVersion: 2 },
    }),
    replaceGrants: async () => ({
      ok: true,
      value: { grants: [grant()], labelVersion: 2 },
    }),
    attach: async () => ({
      ok: true,
      value: { assignment: assignment(), itemVersion: 2 },
    }),
    detach: async () => ({
      ok: true,
      value: { assignment: assignment(), itemVersion: 2 },
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
  await registerKnowledgeLabelRoutes(app, { service });
  await app.ready();
  return app;
}

test('label create route maps canonical actor/audit and serializes the response', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      create: async (input) => {
        captured = input;
        return { ok: true, value: label() };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/labels',
    payload: {
      scope: 'personal',
      displayName: 'Architecture',
      slug: 'architecture',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(captured.actor, {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.equal(captured.auditActor.source, 'api');
  assert.match(captured.auditActor.requestId, /^[A-Za-z0-9._-]{1,128}$/);
  assert.equal(response.json().createdAt, '2026-08-05T00:00:00.000Z');
  assert.equal(response.json().deletedAt, null);
});

test('label routes preserve organization grants and keep public assignment provenance manual-only', async (t) => {
  const captured = [];
  const app = await buildServer(
    serviceStub({
      create: async (input) => {
        captured.push(input.body);
        return {
          ok: false,
          statusCode: 400,
          code: 'invalid_request',
          message: 'group grant is not active',
        };
      },
    }),
  );
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/knowledge/labels',
        payload: {
          scope: 'organization',
          displayName: 'Org',
          slug: 'org',
          groupGrants: [{ groupAccountId: 'group-1', capability: 'manage' }],
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(captured[0].groupGrants[0].capability, 'manage');

  for (const forbidden of [
    { assignmentSource: 'ai_suggestion' },
    { confidenceBasisPoints: 8000 },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/items/item-1/labels',
      payload: {
        expectedVersion: 1,
        labelId: 'label-1',
        ...forbidden,
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error?.code, 'invalid_request');
  }
});

test('all label surfaces reject a non-header actor without canonical account resolution', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: label() };
  };
  const app = await buildServer(
    serviceStub({
      list: async () => {
        calls += 1;
        return [];
      },
      detail: called,
      aliases: async () => {
        calls += 1;
        return { ok: true, value: [] };
      },
      grants: async () => {
        calls += 1;
        return { ok: true, value: [] };
      },
      create: called,
      update: called,
      remove: called,
      addAlias: called,
      removeAlias: called,
      replaceGrants: called,
      attach: called,
      detach: called,
    }),
    {
      userId: 'raw-jwt-subject',
      auth: {
        principalUserId: 'raw-jwt-subject',
        actorUserId: 'raw-jwt-subject',
        scopes: ['knowledge:write'],
        delegated: false,
        providerType: 'google_oidc',
      },
    },
  );
  t.after(() => app.close());
  const requests = [
    { method: 'GET', url: '/knowledge/labels' },
    { method: 'GET', url: '/knowledge/labels/label-1' },
    { method: 'GET', url: '/knowledge/labels/label-1/aliases' },
    { method: 'GET', url: '/knowledge/labels/label-1/group-grants' },
    {
      method: 'POST',
      url: '/knowledge/labels',
      payload: {
        scope: 'personal',
        displayName: 'A',
        slug: 'a',
      },
    },
    {
      method: 'PATCH',
      url: '/knowledge/labels/label-1',
      payload: { expectedVersion: 1, displayName: 'B' },
    },
    {
      method: 'DELETE',
      url: '/knowledge/labels/label-1',
      payload: { expectedVersion: 1 },
    },
    {
      method: 'POST',
      url: '/knowledge/labels/label-1/aliases',
      payload: { expectedVersion: 1, alias: 'A' },
    },
    {
      method: 'DELETE',
      url: '/knowledge/labels/label-1/aliases/alias-1',
      payload: { expectedVersion: 1 },
    },
    {
      method: 'PUT',
      url: '/knowledge/labels/label-1/group-grants',
      payload: { expectedVersion: 1, groupGrants: [] },
    },
    {
      method: 'POST',
      url: '/knowledge/items/item-1/labels',
      payload: { expectedVersion: 1, labelId: 'label-1' },
    },
    {
      method: 'DELETE',
      url: '/knowledge/items/item-1/labels/label-1',
      payload: { expectedVersion: 1 },
    },
  ];
  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403, `${request.method} ${request.url}`);
    assert.equal(response.json().error?.code, 'forbidden');
    assert.equal(
      response.json().error?.details?.reason,
      'canonical_account_required',
    );
  }
  assert.equal(calls, 0);
});

test('mutation routes reject raw unknown fields before Fastify removes them', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: label() };
  };
  const app = await buildServer(
    serviceStub({
      create: called,
      update: called,
      remove: called,
      addAlias: called,
      removeAlias: called,
      replaceGrants: called,
      attach: called,
      detach: called,
    }),
  );
  t.after(() => app.close());
  const requests = [
    {
      method: 'POST',
      url: '/knowledge/labels',
      payload: {
        scope: 'personal',
        displayName: 'A',
        slug: 'a',
        ownerUserId: 'spoofed',
      },
    },
    {
      method: 'PATCH',
      url: '/knowledge/labels/label-1',
      payload: { expectedVersion: 1, displayName: 'B', scope: 'organization' },
    },
    {
      method: 'POST',
      url: '/knowledge/items/item-1/labels',
      payload: {
        expectedVersion: 1,
        labelId: 'label-1',
        assignedBy: 'spoofed',
      },
    },
  ];
  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 400, `${request.method} ${request.url}`);
    assert.equal(response.json().error?.code, 'invalid_request');
  }
  assert.equal(calls, 0);
});

test('hidden/deleted/revoked/absent labels share the generic not_found response', async (t) => {
  const app = await buildServer(
    serviceStub({
      detail: async () => ({
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      }),
      attach: async () => ({
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      }),
      detach: async () => ({
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      }),
    }),
  );
  t.after(() => app.close());
  const bodies = [];
  for (const request of [
    { method: 'GET', url: '/knowledge/labels/hidden' },
    {
      method: 'POST',
      url: '/knowledge/items/item-1/labels',
      payload: { expectedVersion: 1, labelId: 'hidden' },
    },
    {
      method: 'DELETE',
      url: '/knowledge/items/item-1/labels/hidden',
      payload: { expectedVersion: 1 },
    },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 404);
    bodies.push(response.body);
  }
  assert.equal(new Set(bodies).size, 1);
});

test('list/alias/grant/assignment responses use documented ISO and capability contracts', async (t) => {
  const app = await buildServer(
    serviceStub({
      list: async () => [label()],
      aliases: async () => ({ ok: true, value: [alias()] }),
      grants: async () => ({ ok: true, value: [grant()] }),
    }),
  );
  t.after(() => app.close());
  const list = await app.inject({ method: 'GET', url: '/knowledge/labels' });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items[0].updatedAt, now.toISOString());
  const aliases = await app.inject({
    method: 'GET',
    url: '/knowledge/labels/label-1/aliases',
  });
  assert.equal(aliases.json().items[0].createdAt, now.toISOString());
  const grants = await app.inject({
    method: 'GET',
    url: '/knowledge/labels/label-1/group-grants',
  });
  assert.equal(grants.json().items[0].capability, 'manage');

  const attached = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/labels',
    payload: { expectedVersion: 1, labelId: 'label-1' },
  });
  assert.equal(attached.statusCode, 201, attached.body);
  assert.equal(attached.json().assignment.createdAt, now.toISOString());
});
