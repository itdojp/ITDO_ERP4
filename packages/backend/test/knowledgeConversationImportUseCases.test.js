import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeConversationImportTokenCodec } from '../dist/application/knowledge/knowledgeConversationImportToken.js';
import { createKnowledgeConversationImportUseCases } from '../dist/application/knowledge/knowledgeConversationImportUseCases.js';
import { encodeKnowledgeConversationImportInput } from '../dist/application/knowledge/knowledgeConversationImportParser.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};
const auditActor = {
  requestId: 'request-1',
  source: 'agent',
  principalUserId: 'principal-1',
  actorUserId: 'owner-1',
  authScopes: ['knowledge:write'],
  authTokenId: 'token-1',
  authAudience: ['erp4-agent'],
  authExpiresAt: 1_900_000_000,
  agentRunId: 'run-1',
  decisionRequestId: 'decision-1',
};

function body(overrides = {}) {
  const conversation = overrides.conversation ?? {
    title: 'Synthetic import',
    turns: [
      { role: 'user', origin: 'user', content: 'Private question' },
      { role: 'assistant', origin: 'ai', content: 'Synthetic answer' },
    ],
  };
  const { conversation: _conversation, ...envelope } = overrides;
  return {
    format: 'manual',
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(conversation),
    ),
    linkedItems: [
      { itemId: 'item-2', relationType: 'supporting' },
      { itemId: 'item-1', relationType: 'primary' },
    ],
    ...envelope,
  };
}

function stringLeaves(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

function createHarness() {
  const state = {
    accessible: true,
    checked: [],
    locked: [],
    requests: new Map(),
    conversations: new Map(),
    audits: [],
    creates: [],
    binds: [],
    failAuditAction: null,
  };
  const imports = {
    async checkOwnedItems(input) {
      state.checked.push([...input.itemIds]);
      return state.accessible;
    },
    async lockOwnedItems(input) {
      state.locked.push([...input.itemIds]);
      return state.accessible;
    },
    async findRequest(input) {
      return state.requests.get(input.requestKeyHash) ?? null;
    },
    async findConversationByPayload(input) {
      return state.conversations.get(input.canonicalPayloadHash) ?? null;
    },
    async createImportedConversation(input) {
      state.creates.push(input);
      const record = {
        id: input.ledgerId,
        ownerUserId: input.actor.userId,
        requestKeyHash: input.requestKeyHash,
        canonicalPayloadHash: input.canonical.canonicalPayloadHash,
        sourceType: input.canonical.format,
        conversationId: input.conversationId,
        turnCount: input.canonical.turns.length,
        linkedItemCount: input.canonical.linkedItems.length,
        conversationDeleted: false,
      };
      state.requests.set(input.requestKeyHash, record);
      state.conversations.set(input.canonical.canonicalPayloadHash, record);
      return record;
    },
    async bindRequestToConversation(input) {
      state.binds.push(input);
      const existing = state.conversations.get(
        input.canonical.canonicalPayloadHash,
      );
      const record = {
        ...existing,
        id: input.ledgerId,
        requestKeyHash: input.requestKeyHash,
        conversationId: input.conversationId,
      };
      state.requests.set(input.requestKeyHash, record);
      return record;
    },
  };
  const audit = {
    async write(entry) {
      if (state.failAuditAction === entry.action) {
        throw new Error('synthetic mandatory audit failure');
      }
      state.audits.push(structuredClone(entry));
    },
  };
  const unitOfWork = {
    async run(work) {
      const snapshot = {
        requests: new Map(state.requests),
        conversations: new Map(state.conversations),
        audits: state.audits.length,
        creates: state.creates.length,
        binds: state.binds.length,
      };
      try {
        return await work({ imports, audit });
      } catch (error) {
        state.requests = snapshot.requests;
        state.conversations = snapshot.conversations;
        state.audits.length = snapshot.audits;
        state.creates.length = snapshot.creates;
        state.binds.length = snapshot.binds;
        throw error;
      }
    },
  };
  let id = 0;
  const now = new Date('2026-08-08T00:00:00.000Z');
  const tokenCodec = createKnowledgeConversationImportTokenCodec({
    env: {
      NODE_ENV: 'test',
      KNOWLEDGE_CURSOR_SIGNING_SECRET:
        'knowledge-import-use-case-test-secret-0001',
    },
    now: () => now,
    randomId: () => '11111111-1111-4111-8111-111111111111',
  });
  const service = createKnowledgeConversationImportUseCases({
    unitOfWork,
    tokenCodec,
    now: () => now,
    randomId: () => `entity-${++id}`,
  });
  return { state, service, now };
}

async function preview(harness, payload = body()) {
  const result = await harness.service.preview({
    actor,
    auditActor,
    body: payload,
  });
  assert.equal(result.ok, true);
  return result.value;
}

function commitBody(
  previewValue,
  payload = body(),
  requestKey = 'request-key-1',
) {
  return {
    ...payload,
    previewToken: previewValue.previewToken,
    requestKey,
  };
}

test('preview is mutation-free, ACL checked without lock, and redacted', async () => {
  const harness = createHarness();
  const value = await preview(harness);
  assert.deepEqual(harness.state.checked, [['item-1', 'item-2']]);
  assert.deepEqual(harness.state.locked, []);
  assert.equal(harness.state.creates.length, 0);
  assert.equal(value.summary.turnCount, 2);
  assert.deepEqual(value.summary.roles, ['user', 'assistant']);
  assert.equal(JSON.stringify(value).includes('Private question'), false);
  assert.equal(JSON.stringify(value).includes('item-1'), false);
  assert.equal(harness.state.audits[0].action, 'knowledge_import_previewed');
  assert.deepEqual(harness.state.audits[0].metadata, {
    format: 'manual',
    turnCount: 2,
    itemCount: 2,
    duplicate: false,
  });
});

test('commit creates conversation, turns, links, ledger and mandatory audits atomically', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const result = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(previewValue),
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      conversationId: 'entity-4',
      created: true,
      reused: false,
      turnCount: 2,
      linkedItemCount: 2,
    },
  });
  assert.deepEqual(harness.state.locked, [['item-1', 'item-2']]);
  assert.equal(harness.state.creates.length, 1);
  assert.equal(
    harness.state.creates[0].importedAt.toISOString(),
    '2026-08-08T00:00:00.000Z',
  );
  assert.equal(harness.state.creates[0].itemIds.length, 2);
  assert.equal(harness.state.creates[0].turnIds.length, 2);
  assert.deepEqual(
    harness.state.audits.slice(-2).map((entry) => entry.action),
    ['knowledge_conversation_imported', 'knowledge_import_committed'],
  );
  const serializedAudit = JSON.stringify(harness.state.audits);
  assert.equal(serializedAudit.includes('Private question'), false);
  assert.equal(serializedAudit.includes('request-key-1'), false);
  assert.equal(serializedAudit.includes('item-1'), false);
});

test('same request key and payload reuses one result without turn growth', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const input = commitBody(previewValue);
  const first = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  const second = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(second, {
    ok: true,
    value: {
      conversationId: first.value.conversationId,
      created: false,
      reused: true,
      turnCount: 2,
      linkedItemCount: 2,
    },
  });
  assert.equal(harness.state.creates.length, 1);
  assert.equal(
    harness.state.audits.at(-1).action,
    'knowledge_import_duplicate_detected',
  );
});

test('replay returns current bounded counts without appending imported content again', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const input = commitBody(previewValue);
  const first = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  assert.equal(first.ok, true);
  const stored = [...harness.state.requests.values()][0];
  stored.turnCount = 3;
  stored.linkedItemCount = 1;
  const replayed = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  assert.deepEqual(replayed, {
    ok: true,
    value: {
      conversationId: first.value.conversationId,
      created: false,
      reused: true,
      turnCount: 3,
      linkedItemCount: 1,
    },
  });
  assert.equal(harness.state.creates.length, 1);
});

test('replay of a tombstoned imported conversation fails with no recreation', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const input = commitBody(previewValue);
  const first = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  assert.equal(first.ok, true);
  const stored = [...harness.state.requests.values()][0];
  stored.conversationDeleted = true;
  const replayed = await harness.service.commit({
    actor,
    auditActor,
    body: input,
  });
  assert.deepEqual(replayed, {
    ok: false,
    statusCode: 409,
    code: 'idempotency_conflict',
    message: 'Idempotency conflict',
  });
  assert.equal(harness.state.creates.length, 1);
});

test('same key with different payload conflicts without mutation', async () => {
  const harness = createHarness();
  const firstPayload = body();
  const firstPreview = await preview(harness, firstPayload);
  await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(firstPreview, firstPayload),
  });
  const changed = body({
    conversation: {
      title: 'Changed import',
      turns: [{ role: 'user', origin: 'user', content: 'Different' }],
    },
  });
  const changedPreview = await preview(harness, changed);
  const result = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(changedPreview, changed),
  });
  assert.deepEqual(result, {
    ok: false,
    statusCode: 409,
    code: 'idempotency_conflict',
    message: 'Idempotency conflict',
  });
  assert.equal(harness.state.creates.length, 1);
  assert.equal(harness.state.audits.at(-1).action, 'knowledge_import_rejected');
});

test('new key with the same payload adds one ledger binding and reuses conversation', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const first = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(previewValue),
  });
  const second = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(previewValue, body(), 'request-key-2'),
  });
  assert.equal(first.ok, true);
  assert.deepEqual(second.value, {
    conversationId: first.value.conversationId,
    created: false,
    reused: true,
    turnCount: 2,
    linkedItemCount: 2,
  });
  assert.equal(harness.state.creates.length, 1);
  assert.equal(harness.state.binds.length, 1);
  assert.notEqual(
    harness.state.binds[0].ledgerId,
    harness.state.creates[0].ledgerId,
  );
});

test('ACL loss after preview fails closed before ledger lookup', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  harness.state.accessible = false;
  const result = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody(previewValue),
  });
  assert.deepEqual(result, {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  });
  assert.equal(harness.state.creates.length, 0);
  assert.equal(harness.state.audits.at(-1).action, 'knowledge_import_rejected');
});

test('tampered token and malformed input return sanitized errors with mandatory rejection audit', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  const tampered = await harness.service.commit({
    actor,
    auditActor,
    body: commitBody({
      ...previewValue,
      previewToken: `${previewValue.previewToken.slice(0, -1)}x`,
    }),
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'preview_token_invalid');
  const malformed = await harness.service.preview({
    actor,
    auditActor,
    body: { format: 'json', inputBase64: 'e2JhZA', linkedItems: [] },
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'invalid_import');
  assert.deepEqual(
    harness.state.audits.slice(-2).map((entry) => entry.action),
    ['knowledge_import_rejected', 'knowledge_import_rejected'],
  );
});

test('request key enforces the application-owned 200-code-point boundary and redacts rejection audits', async () => {
  const acceptedHarness = createHarness();
  const acceptedPreview = await preview(acceptedHarness);
  const acceptedKey = 'k'.repeat(200);
  const accepted = await acceptedHarness.service.commit({
    actor,
    auditActor,
    body: commitBody(acceptedPreview, body(), acceptedKey),
  });
  assert.equal(accepted.ok, true);
  assert.equal(
    stringLeaves(acceptedHarness.state.audits).includes(acceptedKey),
    false,
  );

  for (const requestKey of [
    'k'.repeat(201),
    ' leading-space',
    'trailing-space ',
    'control\u0001key',
    'bidi\u202ekey',
    'lone-surrogate\ud800',
  ]) {
    const harness = createHarness();
    const previewValue = await preview(harness);
    const result = await harness.service.commit({
      actor,
      auditActor,
      body: commitBody(previewValue, body(), requestKey),
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 400,
      code: 'invalid_import',
      message: 'Invalid import',
    });
    assert.equal(
      harness.state.audits.at(-1).action,
      'knowledge_import_rejected',
    );
    assert.equal(
      stringLeaves(harness.state.audits).includes(requestKey),
      false,
    );
  }
});

test('unknown envelope fields reach strict application validation and mandatory audit', async () => {
  const harness = createHarness();
  const result = await harness.service.preview({
    actor,
    auditActor,
    body: { ...body(), unknown: 'must-not-be-normalized-away' },
  });
  assert.deepEqual(result, {
    ok: false,
    statusCode: 400,
    code: 'invalid_import',
    message: 'Invalid import',
  });
  assert.equal(harness.state.audits.at(-1).action, 'knowledge_import_rejected');
  assert.equal(
    JSON.stringify(harness.state.audits).includes(
      'must-not-be-normalized-away',
    ),
    false,
  );
});

test('mandatory audit failure rolls back conversation and ledger', async () => {
  const harness = createHarness();
  const previewValue = await preview(harness);
  harness.state.failAuditAction = 'knowledge_import_committed';
  await assert.rejects(
    () =>
      harness.service.commit({
        actor,
        auditActor,
        body: commitBody(previewValue),
      }),
    /synthetic mandatory audit failure/,
  );
  assert.equal(harness.state.creates.length, 0);
  assert.equal(harness.state.requests.size, 0);
  assert.equal(harness.state.conversations.size, 0);
  assert.equal(
    harness.state.audits.filter((entry) =>
      entry.action.startsWith('knowledge_conversation_imported'),
    ).length,
    0,
  );
});
