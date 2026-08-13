import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerKnowledgeCaptureRoutes } from '../../dist/routes/knowledgeCaptures.js';
import { mapErrorToResponse } from '../../dist/services/errors.js';

let serviceCalls = 0;
const unused = async () => {
  serviceCalls += 1;
  throw new Error('capture service must not run before CSRF validation');
};
const app = Fastify();
app.setErrorHandler((error, _request, reply) => {
  const mapped = mapErrorToResponse(error, { env: 'test' });
  return reply.status(mapped.statusCode).send(mapped.body);
});
app.addHook('onRequest', async (request) => {
  request.user = {
    userId: 'synthetic-owner',
    roles: ['user'],
    orgId: 'synthetic-org',
    groupAccountIds: [],
    auth: {
      providerType: 'google',
      identityId: 'synthetic-identity',
      userAccountId: 'synthetic-owner',
    },
  };
});
await registerKnowledgeCaptureRoutes(app, {
  service: {
    preview: unused,
    commit: unused,
    detail: unused,
    reconcile: unused,
  },
});

const payload = {
  requestKey: 'synthetic-csrf-request',
  draft: {
    schemaVersion: 1,
    channel: 'browser_extension',
    title: 'Synthetic',
    url: null,
    selectedText: null,
    description: null,
    author: null,
    publishedAt: null,
    capturedAt: '2026-08-14T00:00:00.000Z',
  },
  selectedFields: ['title'],
  scope: 'personal',
  organizationGroupAccountIds: [],
};

try {
  const missing = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    payload,
  });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.json().error.code, 'invalid_csrf_token');
  assert.equal(serviceCalls, 0);

  const valid = await app.inject({
    method: 'POST',
    url: '/knowledge/captures/preview',
    headers: {
      cookie: 'erp4_csrf=synthetic-csrf',
      'x-csrf-token': 'synthetic-csrf',
    },
    payload,
  });
  assert.notEqual(valid.statusCode, 403);
  assert.equal(serviceCalls, 1);
} finally {
  await app.close();
}
