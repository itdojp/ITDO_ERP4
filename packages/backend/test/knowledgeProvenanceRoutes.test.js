import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeAnnotationRoutes } from '../dist/routes/knowledgeAnnotations.js';
import { registerKnowledgeConversationRoutes } from '../dist/routes/knowledgeConversations.js';
import { registerKnowledgeSynthesisRoutes } from '../dist/routes/knowledgeSyntheses.js';
import { createKnowledgeSynthesisService } from '../dist/application/knowledge/knowledgeSynthesisUseCases.js';
import { KnowledgeSynthesisAccessBudgetError } from '../dist/application/knowledge/knowledgeSynthesisAccessContext.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const date = new Date('2026-08-06T00:00:00.000Z');

function annotationRevision(overrides = {}) {
  return {
    id: 'revision-1',
    annotationId: 'annotation-1',
    revision: 1,
    kind: 'note',
    origin: 'user',
    content: 'Synthetic annotation',
    createdAt: date,
    createdBy: 'owner-1',
    ...overrides,
  };
}

function annotation(overrides = {}) {
  return {
    id: 'annotation-1',
    knowledgeItemId: 'item-1',
    ownerUserId: 'owner-1',
    authorUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    kind: 'note',
    origin: 'user',
    currentRevision: 1,
    deletedAt: null,
    createdAt: date,
    createdBy: 'owner-1',
    updatedAt: date,
    updatedBy: 'owner-1',
    revision: annotationRevision(),
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    id: 'conversation-1',
    ownerUserId: 'owner-1',
    title: 'Synthetic conversation',
    sourceType: 'manual',
    provider: null,
    model: null,
    capturedAt: date,
    importedAt: null,
    contentHash: 'a'.repeat(64),
    version: 1,
    deletedAt: null,
    createdAt: date,
    createdBy: 'owner-1',
    updatedAt: date,
    updatedBy: 'owner-1',
    items: [],
    ...overrides,
  };
}

function turn(overrides = {}) {
  return {
    id: 'turn-1',
    conversationId: 'conversation-1',
    sequence: 1,
    role: 'assistant',
    origin: 'ai',
    content: 'Synthetic answer',
    name: null,
    occurredAt: null,
    contentHash: 'b'.repeat(64),
    createdAt: date,
    createdBy: 'owner-1',
    ...overrides,
  };
}

function synthesisDetail(overrides = {}) {
  return {
    synthesis: {
      id: 'synthesis-1',
      ownerUserId: 'owner-1',
      scope: 'personal',
      organizationId: null,
      title: 'Synthetic conclusion',
      currentVersion: 1,
      deletedAt: null,
      createdAt: date,
      createdBy: 'owner-1',
      updatedAt: date,
      updatedBy: 'owner-1',
    },
    currentVersion: {
      id: 'version-1',
      synthesisId: 'synthesis-1',
      version: 1,
      content: 'Synthetic conclusion body',
      unresolvedQuestions: ['What remains?'],
      confidenceBasisPoints: 8000,
      createdAt: date,
      createdBy: 'owner-1',
      sources: [
        {
          id: null,
          synthesisVersionId: 'version-1',
          kind: 'item',
          sourceId: null,
          relationType: 'supporting',
          ordinal: 0,
          accessible: false,
          createdAt: null,
          createdBy: null,
        },
      ],
    },
    ...overrides,
  };
}

function user(overrides = {}) {
  return {
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
      providerType: 'header',
    },
    ...overrides,
  };
}

async function build(
  register,
  dependencies,
  requestUser = user(),
  errorEnv = 'test',
) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: errorEnv });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = requestUser;
  });
  await register(app, dependencies);
  await app.ready();
  return app;
}

function notFound() {
  return {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  };
}

test('annotation routes map canonical actor, serialize history, and issue actor-bound cursors', async (t) => {
  let createInput;
  const service = {
    list: async () => ({
      ok: true,
      value: {
        items: [annotation()],
        nextBoundary: { updatedAt: date, id: 'annotation-1' },
      },
    }),
    detail: async () => ({ ok: true, value: annotation() }),
    history: async () => ({
      ok: true,
      value: {
        items: [annotationRevision()],
        nextBoundary: { sequence: 1, id: 'revision-1' },
      },
    }),
    create: async (input) => {
      createInput = input;
      return { ok: true, value: annotation() };
    },
    revise: async () => ({
      ok: true,
      value: annotation({ currentRevision: 2 }),
    }),
    remove: async () => ({
      ok: true,
      value: annotation({ deletedAt: date }),
    }),
  };
  const app = await build(registerKnowledgeAnnotationRoutes, { service });
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/annotations',
    payload: { kind: 'note', origin: 'user', content: 'Synthetic annotation' },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(createInput.actor, {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.equal(created.json().revision.content, 'Synthetic annotation');

  const listed = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/annotations?limit=1',
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(typeof listed.json().nextCursor, 'string');
  assert.equal(listed.json().nextCursor.includes('annotation-1'), false);

  const history = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/annotations/annotation-1/revisions',
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().items[0].revision, 1);
  assert.equal(typeof history.json().nextCursor, 'string');

  const invalid = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/annotations?cursor=invalid',
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.deepEqual(Object.keys(invalid.json().error).sort(), [
    'category',
    'code',
    'message',
  ]);
});

test('annotation routes reject unknown fields before service invocation', async (t) => {
  let calls = 0;
  const service = {
    list: async () => notFound(),
    detail: async () => notFound(),
    history: async () => notFound(),
    create: async () => {
      calls += 1;
      return { ok: true, value: annotation() };
    },
    revise: async () => notFound(),
    remove: async () => notFound(),
  };
  const app = await build(registerKnowledgeAnnotationRoutes, { service });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/annotations',
    payload: {
      kind: 'note',
      origin: 'user',
      content: 'Synthetic annotation',
      providerKey: 'must-not-pass',
    },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(calls, 0);
  assert.equal(response.body.includes('must-not-pass'), false);
});

test('annotation routes permit terminal revision deletion but reject revision increment overflow', async (t) => {
  const terminalRevision = 2_147_483_647;
  let removedRevision;
  let reviseCalls = 0;
  const service = {
    list: async () => notFound(),
    detail: async () => notFound(),
    history: async () => notFound(),
    create: async () => notFound(),
    revise: async () => {
      reviseCalls += 1;
      return notFound();
    },
    remove: async (input) => {
      removedRevision = input.expectedRevision;
      return {
        ok: true,
        value: annotation({
          currentRevision: terminalRevision,
          deletedAt: date,
        }),
      };
    },
  };
  const app = await build(registerKnowledgeAnnotationRoutes, { service });
  t.after(() => app.close());

  const removed = await app.inject({
    method: 'DELETE',
    url: '/knowledge/items/item-1/annotations/annotation-1',
    payload: { expectedRevision: terminalRevision },
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removedRevision, terminalRevision);

  const revise = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/annotations/annotation-1/revisions',
    payload: {
      expectedRevision: terminalRevision,
      kind: 'question',
      origin: 'user',
      content: 'Must not overflow the revision',
    },
  });
  assert.equal(revise.statusCode, 400, revise.body);
  assert.equal(reviseCalls, 0);

  const deleteOverflow = await app.inject({
    method: 'DELETE',
    url: '/knowledge/items/item-1/annotations/annotation-1',
    payload: { expectedRevision: terminalRevision + 1 },
  });
  assert.equal(deleteOverflow.statusCode, 400, deleteOverflow.body);
});

test('conversation routes preserve role/origin and return only allowlisted fields', async (t) => {
  let createCalls = 0;
  let appendCalls = 0;
  const service = {
    list: async () => ({
      ok: true,
      value: {
        items: [
          conversation({
            provider: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
            model: 'synthetic-credential-marker',
          }),
        ],
        nextBoundary: null,
      },
    }),
    detail: async () => ({ ok: true, value: conversation() }),
    create: async () => {
      createCalls += 1;
      return { ok: true, value: conversation() };
    },
    addItem: async () => ({ ok: true, value: conversation({ version: 2 }) }),
    removeItem: async () => ({ ok: true, value: conversation({ version: 2 }) }),
    listTurns: async () => ({
      ok: true,
      value: { items: [turn()], nextBoundary: null },
    }),
    appendTurn: async () => {
      appendCalls += 1;
      return {
        ok: true,
        value: {
          conversation: conversation({ version: 2 }),
          turn: turn({ name: 'AIzaSyntheticNotASecret' }),
        },
      };
    },
  };
  const app = await build(registerKnowledgeConversationRoutes, { service });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/conversation-1/turns',
    payload: {
      expectedVersion: 1,
      role: 'assistant',
      origin: 'ai',
      content: 'Synthetic answer',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().turn.role, 'assistant');
  assert.equal(response.json().turn.origin, 'ai');
  assert.equal(response.json().turn.name, null);
  assert.equal(response.json().turn.providerKey, undefined);
  assert.equal(response.json().conversation.idempotencyHash, undefined);

  const unknownRole = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/conversation-1/turns',
    payload: {
      expectedVersion: 1,
      role: 'developer',
      origin: 'system',
      content: 'must reject',
    },
  });
  assert.equal(unknownRole.statusCode, 400, unknownRole.body);

  const listed = await app.inject({
    method: 'GET',
    url: '/knowledge/conversations',
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().items[0].provider, null);
  assert.equal(listed.json().items[0].model, null);
  assert.equal(listed.body.includes('sk-proj-'), false);
  assert.equal(listed.body.includes('AKIA'), false);

  const providerRejected = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations',
    payload: {
      title: 'Synthetic conversation',
      provider: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    },
  });
  assert.equal(providerRejected.statusCode, 400, providerRejected.body);
  assert.equal(createCalls, 0);

  const nameRejected = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/conversation-1/turns',
    payload: {
      expectedVersion: 1,
      role: 'tool',
      origin: 'tool',
      content: 'Synthetic tool output',
      name: 'synthetic-credential-marker',
    },
  });
  assert.equal(nameRejected.statusCode, 400, nameRejected.body);
  assert.equal(appendCalls, 1);
});

test('synthesis route keeps conclusion visible while fully redacting later-inaccessible provenance identity', async (t) => {
  let createCalls = 0;
  const service = {
    list: async () => ({
      ok: true,
      value: {
        items: [synthesisDetail().synthesis],
        nextBoundary: null,
      },
    }),
    detail: async () => ({ ok: true, value: synthesisDetail() }),
    history: async () => ({
      ok: true,
      value: {
        items: [synthesisDetail().currentVersion],
        nextBoundary: null,
      },
    }),
    create: async () => {
      createCalls += 1;
      return { ok: true, value: synthesisDetail() };
    },
    appendVersion: async () => ({ ok: true, value: synthesisDetail() }),
  };
  const app = await build(registerKnowledgeSynthesisRoutes, { service });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/syntheses/synthesis-1',
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.currentVersion.content, 'Synthetic conclusion body');
  assert.deepEqual(body.currentVersion.sources[0], {
    id: null,
    kind: 'item',
    sourceId: null,
    relationType: 'supporting',
    ordinal: 0,
    accessible: false,
    createdAt: null,
    createdBy: null,
  });
  assert.equal(JSON.stringify(body).includes('not-returned'), false);

  const unsupportedSource = await app.inject({
    method: 'POST',
    url: '/knowledge/syntheses',
    payload: {
      scope: 'personal',
      title: 'Synthetic conclusion',
      content: 'Synthetic conclusion body',
      sources: [
        {
          kind: 'item',
          sourceId: 'item-1',
          relationType: 'primary',
          providerKey: 'must-not-pass',
        },
      ],
    },
  });
  assert.equal(unsupportedSource.statusCode, 400, unsupportedSource.body);
  assert.equal(createCalls, 0);
  assert.equal(unsupportedSource.body.includes('must-not-pass'), false);
});

test('synthesis access-budget exhaustion does not disclose list or ID existence', async (t) => {
  const reader = {
    listVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
    findVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
    listVersionsVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
  };
  reader.withConsistentSnapshot = async (read) => read(reader);
  const service = createKnowledgeSynthesisService({
    reader,
    unitOfWork: { run: async () => notFound() },
  });
  const app = await build(
    registerKnowledgeSynthesisRoutes,
    { service },
    user(),
    'production',
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/syntheses?limit=1',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { items: [], nextCursor: null });
  for (const url of [
    '/knowledge/syntheses/synthesis-1',
    '/knowledge/syntheses/synthesis-1/versions?limit=1',
  ]) {
    const idResponse = await app.inject({ method: 'GET', url });
    assert.equal(idResponse.statusCode, 404, idResponse.body);
    assert.equal(idResponse.json().error.code, 'not_found');
    assert.equal(idResponse.body.includes('budget'), false);
  }
});

test('all provenance routes require a canonical account and normalize unauthorized IDs as not found', async (t) => {
  const service = {
    list: async () => ({ ok: true, value: { items: [], nextBoundary: null } }),
    detail: async () => notFound(),
    history: async () => notFound(),
    create: async () => notFound(),
    revise: async () => notFound(),
    remove: async () => notFound(),
  };
  const app = await build(
    registerKnowledgeAnnotationRoutes,
    { service },
    user({
      auth: {
        providerType: 'google_oidc',
        actorUserId: 'legacy-id',
        principalUserId: 'principal-1',
      },
    }),
  );
  t.after(() => app.close());
  const forbidden = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/annotations',
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  assert.deepEqual(forbidden.json(), {
    error: {
      code: 'forbidden',
      message: 'Forbidden',
      category: 'permission',
    },
  });
  assert.equal(forbidden.body.includes('canonical_account_required'), false);

  const ownerApp = await build(registerKnowledgeAnnotationRoutes, { service });
  t.after(() => ownerApp.close());
  const missing = await ownerApp.inject({
    method: 'GET',
    url: '/knowledge/items/hidden-item/annotations/hidden-annotation',
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(missing.json().error.message, 'Not found');
});
