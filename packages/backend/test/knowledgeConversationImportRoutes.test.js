import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import { registerKnowledgeConversationImportRoutes } from '../dist/routes/knowledgeConversationImports.js';
import { mapErrorToResponse } from '../dist/services/errors.js';
import { encodeKnowledgeConversationImportInput } from '../dist/application/knowledge/knowledgeConversationImportParser.js';

function user(overrides = {}) {
  return {
    userId: 'owner-1',
    roles: ['user'],
    orgId: 'org-1',
    groupAccountIds: ['group-1'],
    auth: {
      principalUserId: 'principal-1',
      actorUserId: 'owner-1',
      scopes: ['knowledge:write'],
      tokenId: 'token-1',
      audience: ['erp4-agent'],
      expiresAt: 1_900_000_000,
      delegated: true,
      providerType: 'header',
    },
    ...overrides,
  };
}

function manual(overrides = {}) {
  const conversation = overrides.conversation ?? {
    title: 'Synthetic import',
    provider: 'openai',
    model: 'gpt',
    turns: [{ role: 'user', origin: 'user', content: 'Private body' }],
  };
  const { conversation: _conversation, ...envelope } = overrides;
  return {
    format: 'manual',
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(conversation),
    ),
    linkedItems: [],
    ...envelope,
  };
}

async function build(service, requestUser = user()) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = requestUser;
    request.agentRun = {
      runId: 'run-1',
      stepId: 'step-1',
      decisionRequestId: 'decision-1',
    };
  });
  await registerKnowledgeConversationImportRoutes(app, { service });
  await app.ready();
  return app;
}

test('preview and commit routes return explicit allowlisted responses', async (t) => {
  const calls = [];
  const app = await build({
    async preview(input) {
      calls.push(['preview', input]);
      return {
        ok: true,
        value: {
          summary: {
            format: 'manual',
            title: 'Synthetic import',
            provider: 'openai',
            model: 'gpt',
            roles: ['user'],
            origins: ['user'],
            turnCount: 1,
            linkedItemCount: 0,
          },
          warnings: [],
          rejectedFields: [],
          previewToken: 'opaque.preview.token',
          expiresAt: '2026-08-08T00:10:00.000Z',
          payloadHash: 'must-not-leak',
        },
      };
    },
    async commit(input) {
      calls.push(['commit', input]);
      return {
        ok: true,
        value: {
          conversationId: 'conversation-1',
          created: true,
          reused: false,
          turnCount: 1,
          linkedItemCount: 0,
          requestKey: 'must-not-leak',
        },
      };
    },
  });
  t.after(() => app.close());
  const previewResponse = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/import/preview',
    payload: manual(),
  });
  assert.equal(previewResponse.statusCode, 200);
  const previewBody = previewResponse.json();
  assert.equal(previewBody.payloadHash, undefined);
  assert.equal(JSON.stringify(previewBody).includes('Private body'), false);

  const commitResponse = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/import/commit',
    payload: {
      ...manual(),
      previewToken: 'opaque.preview.token',
      requestKey: 'request-key-private',
    },
  });
  assert.equal(commitResponse.statusCode, 200);
  assert.deepEqual(commitResponse.json(), {
    conversationId: 'conversation-1',
    created: true,
    reused: false,
    turnCount: 1,
    linkedItemCount: 0,
    result: 'created',
  });
  assert.equal(calls[0][1].actor.userId, 'owner-1');
  assert.equal(calls[0][1].auditActor.requestId.length > 0, true);
});

test('route preserves invalid fields for application-owned rejection auditing', async (t) => {
  const calls = [];
  const service = {
    async preview(input) {
      calls.push(input.body);
      return {
        ok: false,
        statusCode: 400,
        code: 'invalid_import',
        message: 'Invalid import',
      };
    },
    async commit(input) {
      calls.push(input.body);
      return {
        ok: false,
        statusCode: 400,
        code: 'invalid_import',
        message: 'Invalid import',
      };
    },
  };
  const app = await build(service);
  t.after(() => app.close());
  const validConversation = JSON.parse(
    Buffer.from(manual().inputBase64, 'base64url').toString('utf8'),
  );
  for (const payload of [
    { ...manual(), unknown: true },
    manual({
      conversation: { ...validConversation, provider: 'private-provider' },
    }),
    manual({
      conversation: {
        ...validConversation,
        turns: [{ ...validConversation.turns[0], unknown: true }],
      },
    }),
    { format: 'json', linkedItems: [] },
    { format: 'markdown', conversation: validConversation, linkedItems: [] },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/conversations/import/preview',
      payload,
    });
    assert.equal(response.statusCode, 400);
    const error = response.json().error;
    assert.equal(typeof error.code, 'string');
    assert.equal(error.details, undefined);
  }
  assert.equal(calls.length, 5);
  assert.equal(calls[0].unknown, true);
  const decodedUnknownTurn = JSON.parse(
    Buffer.from(calls[2].inputBase64, 'base64url').toString('utf8'),
  );
  assert.equal(decodedUnknownTurn.turns[0].unknown, true);
});

test('sanitized use-case failures expose no parser stack, raw input, request key, or item detail', async (t) => {
  const app = await build({
    async preview() {
      return {
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      };
    },
    async commit() {
      return {
        ok: false,
        statusCode: 409,
        code: 'idempotency_conflict',
        message: 'Idempotency conflict',
      };
    },
  });
  t.after(() => app.close());
  const notFound = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/import/preview',
    payload: manual({
      linkedItems: [{ itemId: 'private-item', relationType: 'primary' }],
    }),
  });
  assert.equal(notFound.statusCode, 404);
  assert.deepEqual(notFound.json(), {
    error: { code: 'not_found', message: 'Not found', category: 'not_found' },
  });
  const conflict = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/import/commit',
    payload: {
      ...manual(),
      previewToken: 'opaque.preview.token',
      requestKey: 'private-request-key',
    },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(
    JSON.stringify(conflict.json()).includes('private-request-key'),
    false,
  );
  assert.equal(JSON.stringify(conflict.json()).includes('Private body'), false);
});

test('canonical account gate rejects noncanonical BFF identity before service', async (t) => {
  let called = false;
  const app = await build(
    {
      async preview() {
        called = true;
        return { ok: true, value: {} };
      },
      async commit() {
        called = true;
        return { ok: true, value: {} };
      },
    },
    user({
      auth: {
        providerType: 'google_oidc_bff',
        principalUserId: 'provider-subject',
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/conversations/import/preview',
    payload: manual(),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
  assert.equal(response.json().error.details, undefined);
});
