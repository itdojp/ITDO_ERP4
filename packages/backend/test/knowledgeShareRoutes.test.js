import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

import {
  knowledgeShareCardResponse,
  knowledgeShareChatActorFromRequest,
  knowledgeShareCommitResponse,
  knowledgeSharePreviewResponse,
  knowledgeShareRoomCardResponse,
  knowledgeShareStatusResponse,
  registerKnowledgeShareRoutes,
} from '../dist/routes/knowledgeShares.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const date = new Date('2026-08-10T00:00:00.000Z');

function requestUser(overrides = {}) {
  return {
    userId: 'owner-1',
    roles: ['user', 'user', '  mgmt  ', ''],
    orgId: 'org-1',
    projectIds: ['project-1', ' project-1 ', ''],
    groupIds: ['Knowledge', 'Knowledge'],
    groupAccountIds: ['group-1', ' group-1 '],
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

function selection(overrides = {}) {
  return {
    includeTitle: true,
    includeSourceType: true,
    includeCanonicalUrl: false,
    snapshot: {
      snapshotId: 'snapshot-private-id',
      includeProvenance: true,
      includeExcerpt: true,
    },
    labelAssignmentIds: ['label-assignment-private-id'],
    annotations: [{ annotationId: 'annotation-private-id', revision: 2 }],
    conversationTurnIds: ['turn-private-id'],
    syntheses: [{ synthesisId: 'synthesis-private-id', version: 3 }],
    sharerNote: 'Selected note',
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    schemaVersion: 1,
    title: 'Selected title',
    sourceType: 'manual',
    snapshot: {
      sourceSnapshotId: 'snapshot-private-id',
      version: 4,
      sha256: 'a'.repeat(64),
      excerpt: 'Selected excerpt',
    },
    sharerNote: 'Selected note',
    labels: [
      {
        sourceAssignmentId: 'label-assignment-private-id',
        sourceLabelId: 'label-private-id',
        sourceLabelVersion: 9,
        displayName: 'Selected label',
        ordinal: 0,
        contentHash: 'b'.repeat(64),
      },
    ],
    annotations: [
      {
        sourceAnnotationId: 'annotation-private-id',
        sourceRevisionId: 'revision-private-id',
        revision: 2,
        kind: 'quote',
        origin: 'user',
        content: 'Selected quote',
        ordinal: 0,
        contentHash: 'c'.repeat(64),
      },
    ],
    turns: [
      {
        sourceConversationId: 'conversation-private-id',
        sourceConversationVersion: 5,
        sourceTurnId: 'turn-private-id',
        role: 'assistant',
        origin: 'ai',
        content: 'Selected assistant turn',
        name: null,
        occurredAt: date,
        ordinal: 0,
        contentHash: 'd'.repeat(64),
      },
    ],
    syntheses: [
      {
        sourceSynthesisId: 'synthesis-private-id',
        sourceSynthesisVersionId: 'synthesis-version-private-id',
        version: 3,
        title: 'Selected synthesis',
        content: 'Selected conclusion',
        confidenceBasisPoints: 8000,
        unresolvedQuestions: ['Selected unresolved question'],
        ordinal: 0,
        contentHash: 'e'.repeat(64),
      },
    ],
    selectedCategories: [
      'title',
      'source_type',
      'snapshot_provenance',
      'snapshot_excerpt',
      'label',
      'annotation',
      'conversation_turn',
      'synthesis',
      'sharer_note',
    ],
    omittedCategories: ['canonical_url'],
    contentHash: 'f'.repeat(64),
    providerKey: 'provider-private-key',
    ...overrides,
  };
}

function previewValue(overrides = {}) {
  return {
    destinationRoom: { name: 'Synthetic room', type: 'private_group' },
    card: card(),
    previewToken: 'opaque.preview.token',
    expiresAt: new Date('2026-08-10T00:10:00.000Z'),
    requiresConfirmation: true,
    sourceItemId: 'item-private-id',
    sourceOwnerUserId: 'owner-private-id',
    destinationRoomId: 'room-private-id',
    bindingHash: '2'.repeat(64),
    requestKey: 'request-key-must-not-leak',
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    shareId: 'share-1',
    status: 'posted',
    version: 2,
    chatMessageId: 'message-1',
    failureCode: null,
    createdAt: date,
    postedAt: date,
    failedAt: null,
    revokedAt: null,
    sourceItemId: 'item-private-id',
    requestKeyHash: '3'.repeat(64),
    ...overrides,
  };
}

function service(overrides = {}) {
  return {
    async preview() {
      return { ok: true, value: previewValue() };
    },
    async commit() {
      return {
        ok: true,
        statusCode: 201,
        value: {
          ...status(),
          created: true,
          reused: false,
          resultUnknown: false,
        },
      };
    },
    async status() {
      return { ok: true, value: status() };
    },
    async reconcile() {
      return { ok: true, value: status() };
    },
    async revoke() {
      return {
        ok: true,
        value: status({
          status: 'revoked',
          revokedAt: new Date('2026-08-10T00:01:00.000Z'),
        }),
      };
    },
    async openSource() {
      return {
        ok: true,
        value: {
          knowledgeItemId: 'item-1',
          sourceOwnerUserId: 'must-not-leak',
          providerKey: 'must-not-leak',
        },
      };
    },
    async roomCard() {
      return {
        ok: true,
        value: {
          shareId: 'share-1',
          status: 'posted',
          version: 2,
          schemaVersion: 1,
          card: card(),
          canOpenSource: false,
          sourceKnowledgeItemId: 'must-not-leak',
          providerKey: 'must-not-leak',
        },
      };
    },
    ...overrides,
  };
}

async function build(routeService, user = requestUser()) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = user;
    request.agentRun = {
      runId: 'run-1',
      stepId: 'step-1',
      decisionRequestId: 'decision-1',
    };
  });
  await registerKnowledgeShareRoutes(app, { service: routeService });
  await app.ready();
  return app;
}

test('preview and commit use canonical actors and return explicit allowlisted responses', async (t) => {
  const calls = [];
  const app = await build(
    service({
      async preview(input) {
        calls.push(['preview', input]);
        return { ok: true, value: previewValue() };
      },
      async commit(input) {
        calls.push(['commit', input]);
        return {
          ok: true,
          statusCode: 202,
          value: {
            ...status({
              status: 'pending',
              version: 1,
              chatMessageId: null,
              postedAt: null,
            }),
            created: true,
            reused: false,
            resultUnknown: true,
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const preview = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/shares/preview',
    payload: {
      destinationRoomId: 'room-1',
      selection: selection(),
    },
  });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(
    preview.json(),
    knowledgeSharePreviewResponse(previewValue()),
  );
  const previewJson = JSON.stringify(preview.json());
  for (const forbidden of [
    'item-private-id',
    'room-private-id',
    'owner-private-id',
    'snapshot-private-id',
    'annotation-private-id',
    'turn-private-id',
    'synthesis-private-id',
    'provider-private-key',
    'request-key-must-not-leak',
    'bbbbbbbbbbbbbbbb',
    'cccccccccccccccc',
    'dddddddddddddddd',
    'eeeeeeeeeeeeeeee',
    'ffffffffffffffff',
  ]) {
    assert.equal(previewJson.includes(forbidden), false, forbidden);
  }

  const commit = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/shares',
    payload: {
      destinationRoomId: 'room-1',
      selection: selection(),
      confirmed: true,
      previewToken: 'opaque.preview.token',
      requestKey: 'raw-request-key',
    },
  });
  assert.equal(commit.statusCode, 202);
  assert.deepEqual(commit.json(), {
    ...knowledgeShareStatusResponse(
      status({
        status: 'pending',
        version: 1,
        chatMessageId: null,
        postedAt: null,
      }),
    ),
    created: true,
    reused: false,
    resultUnknown: true,
  });
  assert.equal(
    JSON.stringify(commit.json()).includes('raw-request-key'),
    false,
  );

  assert.equal(calls[0][1].actor.userId, 'owner-1');
  assert.equal(calls[0][1].chatActor.userId, 'owner-1');
  assert.equal(calls[0][1].chatActor.canonicalUserId, 'owner-1');
  assert.deepEqual(calls[0][1].chatActor.roles, ['user', 'mgmt']);
  assert.deepEqual(calls[0][1].chatActor.projectIds, ['project-1']);
  assert.deepEqual(calls[0][1].chatActor.groupIds, ['Knowledge']);
  assert.deepEqual(calls[0][1].chatActor.groupAccountIds, ['group-1']);
  assert.equal(calls[0][1].auditActor.requestId.length > 0, true);
  assert.equal(calls[1][1].body.confirmed, true);
});

test('response mappers discard source identities, internal hashes, provider fields, and request fields', () => {
  const cardResponse = knowledgeShareCardResponse(card());
  const serializedCard = JSON.stringify(cardResponse);
  assert.equal(serializedCard.includes('private-id'), false);
  assert.equal(serializedCard.includes('provider-private-key'), false);
  assert.equal(serializedCard.includes('bbbbbbbbbbbbbbbb'), false);
  assert.equal(cardResponse.snapshot.version, 4);
  assert.equal(cardResponse.snapshot.sha256, 'a'.repeat(64));

  assert.deepEqual(
    knowledgeShareCommitResponse({
      ...status(),
      created: false,
      reused: true,
      resultUnknown: false,
    }),
    {
      ...knowledgeShareStatusResponse(status()),
      created: false,
      reused: true,
      resultUnknown: false,
    },
  );

  const roomCard = knowledgeShareRoomCardResponse({
    shareId: 'share-1',
    status: 'posted',
    version: 2,
    schemaVersion: 1,
    card: card(),
    canOpenSource: true,
    sourceKnowledgeItemId: 'must-not-leak',
    providerKey: 'must-not-leak',
  });
  const serializedRoomCard = JSON.stringify(roomCard);
  assert.equal(serializedRoomCard.includes('sourceKnowledgeItemId'), false);
  assert.equal(serializedRoomCard.includes('providerKey'), false);
  assert.equal(roomCard.canOpenSource, true);

  assert.deepEqual(
    knowledgeShareRoomCardResponse({
      shareId: 'share-1',
      status: 'revoked',
      version: 3,
      schemaVersion: 1,
      card: card(),
      canOpenSource: true,
    }),
    {
      shareId: 'share-1',
      status: 'revoked',
      version: 3,
      schemaVersion: 1,
      card: null,
      canOpenSource: false,
    },
  );
});

test('room card endpoint uses current canonical actors and an allowlisted response', async (t) => {
  const calls = [];
  const app = await build(
    service({
      async roomCard(input) {
        calls.push(input);
        return {
          ok: true,
          value: {
            shareId: 'share-1',
            status: 'posted',
            version: 2,
            schemaVersion: 1,
            card: card(),
            canOpenSource: false,
            sourceKnowledgeItemId: 'must-not-leak',
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/chat-messages/message-1/knowledge-share',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.shareId, 'share-1');
  assert.equal(body.status, 'posted');
  assert.equal(body.version, 2);
  assert.equal(body.card.title, 'Selected title');
  assert.equal(body.canOpenSource, false);
  assert.equal(response.body.includes('sourceKnowledgeItemId'), false);
  assert.equal(response.body.includes('providerKey'), false);
  assert.equal(calls[0].actor.userId, 'owner-1');
  assert.equal(calls[0].chatActor.canonicalUserId, 'owner-1');
  assert.equal(calls[0].messageId, 'message-1');
});

for (const role of ['hr', 'external_chat']) {
  test(`Chat viewer role ${role} reaches room card and source-open services`, async (t) => {
    const calls = [];
    const app = await build(
      service({
        async roomCard(input) {
          calls.push(['roomCard', input]);
          return {
            ok: true,
            value: {
              shareId: 'share-1',
              status: 'posted',
              version: 2,
              schemaVersion: 1,
              card: card(),
              canOpenSource: true,
            },
          };
        },
        async openSource(input) {
          calls.push(['openSource', input]);
          return { ok: true, value: { knowledgeItemId: 'item-1' } };
        },
      }),
      requestUser({ roles: [role] }),
    );
    t.after(() => app.close());

    const roomCard = await app.inject({
      method: 'GET',
      url: '/chat-messages/message-1/knowledge-share',
    });
    const source = await app.inject({
      method: 'GET',
      url: '/knowledge/shares/share-1/source',
    });

    assert.equal(roomCard.statusCode, 200);
    assert.equal(source.statusCode, 200);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['roomCard', 'openSource'],
    );
    assert.deepEqual(calls[0][1].chatActor.roles, [role]);
    assert.equal(calls[0][1].actor.userId, 'owner-1');
  });
}

test('snapshot preview serializes only the explicitly selected provenance or excerpt fields', async (t) => {
  let previewCount = 0;
  const app = await build(
    service({
      async preview() {
        previewCount += 1;
        return {
          ok: true,
          value: previewValue({
            card: card({
              snapshot:
                previewCount === 1
                  ? { version: 4, sha256: 'a'.repeat(64) }
                  : { excerpt: 'Excerpt only' },
            }),
          }),
        };
      },
    }),
  );
  t.after(() => app.close());

  const responses = [];
  for (const shareSelection of [
    selection({
      snapshot: {
        snapshotId: 'snapshot-1',
        includeProvenance: true,
        includeExcerpt: false,
      },
    }),
    selection({
      snapshot: {
        snapshotId: 'snapshot-1',
        includeProvenance: false,
        includeExcerpt: true,
      },
    }),
  ]) {
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/knowledge/items/item-1/shares/preview',
        payload: {
          destinationRoomId: 'room-1',
          selection: shareSelection,
        },
      }),
    );
  }
  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [200, 200],
  );
  assert.deepEqual(responses[0].json().card.snapshot, {
    version: 4,
    sha256: 'a'.repeat(64),
  });
  assert.deepEqual(responses[1].json().card.snapshot, {
    excerpt: 'Excerpt only',
  });
});

test('all lifecycle routes use allowlisted status/source responses', async (t) => {
  const calls = [];
  const app = await build(
    service({
      async status(input) {
        calls.push(['status', input]);
        return { ok: true, value: status() };
      },
      async reconcile(input) {
        calls.push(['reconcile', input]);
        return {
          ok: true,
          statusCode: 202,
          value: status({ status: 'pending' }),
        };
      },
      async revoke(input) {
        calls.push(['revoke', input]);
        return {
          ok: true,
          value: status({ status: 'revoked', revokedAt: date }),
        };
      },
      async openSource(input) {
        calls.push(['source', input]);
        return {
          ok: true,
          value: {
            knowledgeItemId: 'item-1',
            sourceOwnerUserId: 'must-not-leak',
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const responses = await Promise.all([
    app.inject({ method: 'GET', url: '/knowledge/shares/share-1' }),
    app.inject({
      method: 'POST',
      url: '/knowledge/shares/share-1/reconcile',
    }),
    app.inject({
      method: 'POST',
      url: '/knowledge/shares/share-1/revoke',
    }),
    app.inject({
      method: 'GET',
      url: '/knowledge/shares/share-1/source',
    }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [200, 202, 200, 200],
  );
  assert.deepEqual(responses[3].json(), { knowledgeItemId: 'item-1' });
  assert.equal(
    responses.some((response) => response.body.includes('sourceOwnerUserId')),
    false,
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ['status', 'reconcile', 'revoke', 'source'],
  );
  assert.equal(calls[1][1].auditActor.requestId.length > 0, true);
  assert.equal(calls[2][1].auditActor.requestId.length > 0, true);
});

test('strict request schemas reject unknown fields and require explicit confirmation', async (t) => {
  const calls = [];
  const app = await build(
    service({
      async preview(input) {
        calls.push(input);
        return { ok: true, value: previewValue() };
      },
      async commit(input) {
        calls.push(input);
        return {
          ok: true,
          value: {
            ...status(),
            created: true,
            reused: false,
            resultUnknown: false,
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const payloads = [
    {
      destinationRoomId: 'room-1',
      selection: selection(),
      providerKey: 'unsupported',
    },
    {
      destinationRoomId: 'room-1',
      selection: selection({ providerKey: 'unsupported' }),
    },
    {
      destinationRoomId: 'room-1',
      selection: selection({
        snapshot: {
          snapshotId: 'snapshot-1',
          includeProvenance: true,
          includeExcerpt: true,
          providerUrl: 'unsupported',
        },
      }),
    },
    {
      destinationRoomId: 'room-1',
      selection: selection({
        annotations: [
          { annotationId: 'annotation-1', revision: 1, content: 'unsupported' },
        ],
      }),
    },
    {
      destinationRoomId: 'room-1',
      selection: selection({
        syntheses: [
          { synthesisId: 'synthesis-1', version: 1, content: 'unsupported' },
        ],
      }),
    },
  ];
  for (const payload of payloads) {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/items/item-1/shares/preview',
      payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
  }

  for (const confirmed of [undefined, false]) {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/items/item-1/shares',
      payload: {
        destinationRoomId: 'room-1',
        selection: selection(),
        ...(confirmed === undefined ? {} : { confirmed }),
        previewToken: 'opaque.preview.token',
        requestKey: 'request-key',
      },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test('service failures are normalized without internal details', async (t) => {
  const app = await build(
    service({
      async status() {
        return {
          ok: false,
          error: {
            status: 404,
            code: 'not_found',
            message: 'Not found',
            sourceItemId: 'must-not-leak',
            rawError: 'must-not-leak',
          },
        };
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/shares/share-1',
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: {
      code: 'not_found',
      message: 'Not found',
      category: 'not_found',
    },
  });
  assert.equal(
    JSON.stringify(response.json()).includes('must-not-leak'),
    false,
  );
});

test('canonical account is required before the service is called', async (t) => {
  let called = false;
  const app = await build(
    service({
      async status() {
        called = true;
        return { ok: true, value: status() };
      },
    }),
    requestUser({
      auth: {
        principalUserId: 'raw-subject',
        actorUserId: 'raw-subject',
        scopes: [],
        delegated: false,
        providerType: 'google_oidc',
      },
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/shares/share-1',
  });
  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
});

test('chat actor helper keeps canonical Knowledge and server-resolved legacy Chat identities distinct', () => {
  const actor = knowledgeShareChatActorFromRequest({
    user: requestUser({
      userId: 'legacy-chat-user',
      auth: {
        principalUserId: 'raw-token-subject',
        actorUserId: 'raw-token-subject',
        scopes: ['knowledge:write'],
        delegated: false,
        providerType: 'google_oidc',
        userAccountId: 'canonical-user-account',
        identityId: 'canonical-identity',
      },
    }),
  });
  assert.equal(actor.canonicalUserId, 'canonical-user-account');
  assert.equal(actor.userId, 'legacy-chat-user');
  assert.deepEqual(actor.projectIds, ['project-1']);
});
