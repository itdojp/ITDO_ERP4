import assert from 'node:assert/strict';
import test from 'node:test';

import { createKnowledgeAnnotationService } from '../dist/application/knowledge/knowledgeAnnotationUseCases.js';
import { createKnowledgeConversationService } from '../dist/application/knowledge/knowledgeConversationUseCases.js';
import { KnowledgeProvenanceConflictError } from '../dist/application/knowledge/knowledgeProvenancePorts.js';
import { KnowledgeSynthesisAccessBudgetError } from '../dist/application/knowledge/knowledgeSynthesisAccessContext.js';
import { createKnowledgeSynthesisService } from '../dist/application/knowledge/knowledgeSynthesisUseCases.js';

const now = new Date('2026-08-06T00:00:00.000Z');
const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};
const auditActor = { requestId: 'request-1', source: 'api' };

function item(overrides = {}) {
  return {
    id: 'item-1',
    ownerUserId: 'owner-1',
    scope: 'personal',
    organizationId: null,
    ...overrides,
  };
}

function revision(overrides = {}) {
  return {
    id: 'revision-1',
    annotationId: 'annotation-1',
    revision: 1,
    kind: 'note',
    origin: 'user',
    content: 'private annotation body',
    createdAt: now,
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
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
    revision: revision(),
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
    capturedAt: now,
    importedAt: null,
    contentHash: 'a'.repeat(64),
    version: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
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
    role: 'user',
    origin: 'user',
    content: 'Synthetic question',
    name: null,
    occurredAt: null,
    contentHash: 'b'.repeat(64),
    createdAt: now,
    createdBy: 'owner-1',
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    id: 'source-1',
    synthesisVersionId: 'synthesis-version-1',
    kind: 'item',
    sourceId: 'item-1',
    relationType: 'primary',
    ordinal: 0,
    accessible: true,
    createdAt: now,
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
      createdAt: now,
      createdBy: 'owner-1',
      updatedAt: now,
      updatedBy: 'owner-1',
    },
    currentVersion: {
      id: 'synthesis-version-1',
      synthesisId: 'synthesis-1',
      version: 1,
      content: 'Private conclusion body',
      unresolvedQuestions: [],
      confidenceBasisPoints: 7500,
      createdAt: now,
      createdBy: 'owner-1',
      sources: [source()],
    },
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    access: {
      findOwnedItem: async () => item(),
      findVisibleItem: async () => item(),
    },
    annotations: {},
    conversations: {},
    syntheses: {},
    audit: { write: async () => {} },
    ...overrides,
  };
}

function unitOfWork(tx, options = {}) {
  return {
    run: async (work) => {
      const snapshot = options.snapshot?.();
      try {
        return await work(tx);
      } catch (error) {
        options.restore?.(snapshot);
        throw error;
      }
    },
  };
}

function consistentSynthesisReader(overrides = {}) {
  const reader = { ...overrides };
  reader.withConsistentSnapshot = async (read) => read(reader);
  return reader;
}

test('annotation and conversation reads always use a consistent snapshot', async () => {
  const annotationSnapshotCalls = [];
  const annotationReader = {
    listVisible: async () => null,
    findVisible: async () => null,
    listRevisionsVisible: async () => null,
  };
  annotationReader.withConsistentSnapshot = async (read) => {
    annotationSnapshotCalls.push('snapshot');
    return read(annotationReader);
  };
  const annotationService = createKnowledgeAnnotationService({
    reader: annotationReader,
    unitOfWork: unitOfWork(transaction()),
  });
  await annotationService.list({ actor, itemId: 'item-1', limit: 20 });
  await annotationService.detail({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
  });
  await annotationService.history({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    limit: 20,
  });
  assert.equal(annotationSnapshotCalls.length, 3);

  const conversationSnapshotCalls = [];
  const conversationReader = {
    listVisible: async () => ({ items: [], nextBoundary: null }),
    findVisible: async () => null,
    listTurnsVisible: async () => null,
  };
  conversationReader.withConsistentSnapshot = async (read) => {
    conversationSnapshotCalls.push('snapshot');
    return read(conversationReader);
  };
  const conversationService = createKnowledgeConversationService({
    reader: conversationReader,
    unitOfWork: unitOfWork(transaction()),
  });
  await conversationService.list({ actor, limit: 20 });
  await conversationService.detail({
    actor,
    conversationId: 'conversation-1',
  });
  await conversationService.listTurns({
    actor,
    conversationId: 'conversation-1',
    limit: 20,
  });
  assert.equal(conversationSnapshotCalls.length, 3);
});

test('history cursors accept the PostgreSQL integer maximum sequence', async () => {
  let annotationBoundary;
  const annotationReader = {
    withConsistentSnapshot: async (read) => read(annotationReader),
    listRevisionsVisible: async (input) => {
      annotationBoundary = input.beforeRevision;
      return { items: [], nextBoundary: null };
    },
  };
  const annotationService = createKnowledgeAnnotationService({
    reader: annotationReader,
    unitOfWork: unitOfWork(transaction()),
  });
  const annotationResult = await annotationService.history({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    limit: 20,
    beforeRevision: 2_147_483_647,
  });
  assert.equal(annotationResult.ok, true);
  assert.equal(annotationBoundary, 2_147_483_647);

  let turnBoundary;
  const conversationReader = {
    withConsistentSnapshot: async (read) => read(conversationReader),
    listTurnsVisible: async (input) => {
      turnBoundary = input.boundary;
      return { items: [], nextBoundary: null };
    },
  };
  const conversationService = createKnowledgeConversationService({
    reader: conversationReader,
    unitOfWork: unitOfWork(transaction()),
  });
  const conversationResult = await conversationService.listTurns({
    actor,
    conversationId: 'conversation-1',
    limit: 20,
    boundary: { sequence: 2_147_483_647, id: 'turn-maximum' },
  });
  assert.equal(conversationResult.ok, true);
  assert.deepEqual(turnBoundary, {
    sequence: 2_147_483_647,
    id: 'turn-maximum',
  });

  let synthesisBoundary;
  const synthesisReader = consistentSynthesisReader({
    listVersionsVisible: async (input) => {
      synthesisBoundary = input.beforeVersion;
      return { items: [], nextBoundary: null };
    },
  });
  const synthesisService = createKnowledgeSynthesisService({
    reader: synthesisReader,
    unitOfWork: unitOfWork(transaction()),
  });
  const synthesisResult = await synthesisService.history({
    actor,
    synthesisId: 'synthesis-1',
    limit: 20,
    beforeVersion: 2_147_483_647,
  });
  assert.equal(synthesisResult.ok, true);
  assert.equal(synthesisBoundary, 2_147_483_647);
});

test('annotation create is owner-only, transactionally audited, and audit metadata excludes body', async () => {
  const audit = [];
  let createdInput;
  const tx = transaction({
    annotations: {
      create: async (input) => {
        createdInput = input;
        return annotation({
          kind: input.kind,
          origin: input.origin,
          revision: revision({
            kind: input.kind,
            origin: input.origin,
            content: input.content,
          }),
        });
      },
    },
    audit: { write: async (entry) => audit.push(entry) },
  });
  const service = createKnowledgeAnnotationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
    now: () => now,
  });
  const result = await service.create({
    actor,
    auditActor,
    itemId: 'item-1',
    body: {
      kind: 'hypothesis',
      origin: 'user',
      content: ' private annotation body ',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(createdInput.content, 'private annotation body');
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].metadata, {
    annotationKind: 'hypothesis',
    origin: 'user',
    revision: 1,
    scope: 'personal',
  });
  assert.equal(
    JSON.stringify(audit).includes('private annotation body'),
    false,
  );

  tx.access.findOwnedItem = async () => null;
  const outsider = await service.create({
    actor: { ...actor, userId: 'outsider-1' },
    auditActor,
    itemId: 'item-1',
    body: { kind: 'note', origin: 'user', content: 'hidden' },
  });
  assert.equal(outsider.statusCode, 404);
  assert.equal(audit.length, 1);
});

test('annotation revision preserves prior content, rejects no-op and stale revisions, and deletion is logical', async () => {
  let current = annotation();
  const revisions = [current.revision];
  const tx = transaction({
    annotations: {
      findOwned: async () => current,
      revise: async (input) => {
        const next = revision({
          id: 'revision-2',
          revision: 2,
          kind: input.kind,
          origin: input.origin,
          content: input.content,
        });
        revisions.push(next);
        current = annotation({
          kind: input.kind,
          origin: input.origin,
          currentRevision: 2,
          revision: next,
        });
        return current;
      },
      logicallyDelete: async () => {
        current = annotation({ ...current, deletedAt: now });
        return current;
      },
    },
  });
  const service = createKnowledgeAnnotationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
    now: () => now,
  });
  const noOp = await service.revise({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    body: {
      expectedRevision: 1,
      kind: 'note',
      origin: 'user',
      content: 'private annotation body',
    },
  });
  assert.equal(noOp.statusCode, 400);

  const revised = await service.revise({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    body: {
      expectedRevision: 1,
      kind: 'question',
      origin: 'user',
      content: 'Revised question',
    },
  });
  assert.equal(revised.ok, true);
  assert.deepEqual(
    revisions.map((entry) => entry.content),
    ['private annotation body', 'Revised question'],
  );

  const stale = await service.remove({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    expectedRevision: 1,
  });
  assert.equal(stale.statusCode, 409);
  const removed = await service.remove({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    expectedRevision: 2,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.value.deletedAt.toISOString(), now.toISOString());
  assert.equal(revisions.length, 2);
});

test('annotation deletion accepts the terminal stored revision while mutation rejects overflow', async () => {
  const terminalRevision = 2_147_483_647;
  let deleted = false;
  const current = annotation({
    currentRevision: terminalRevision,
    revision: revision({ revision: terminalRevision }),
  });
  const tx = transaction({
    annotations: {
      findOwned: async () => current,
      revise: async () => {
        throw new Error('revision must be rejected before persistence');
      },
      logicallyDelete: async ({ expectedRevision }) => {
        assert.equal(expectedRevision, terminalRevision);
        deleted = true;
        return annotation({ ...current, deletedAt: now });
      },
    },
  });
  const service = createKnowledgeAnnotationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
    now: () => now,
  });

  const removed = await service.remove({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    expectedRevision: terminalRevision,
  });
  assert.equal(removed.ok, true);
  assert.equal(deleted, true);

  const reviseOverflow = await service.revise({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    body: {
      expectedRevision: terminalRevision,
      kind: 'question',
      origin: 'user',
      content: 'Must not overflow the PostgreSQL integer revision',
    },
  });
  assert.equal(reviseOverflow.statusCode, 400);

  const deleteOverflow = await service.remove({
    actor,
    auditActor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    expectedRevision: terminalRevision + 1,
  });
  assert.equal(deleteOverflow.statusCode, 400);
});

test('mandatory annotation audit failure rolls the mutation back', async () => {
  const state = [];
  const tx = transaction({
    annotations: {
      create: async () => {
        state.push('annotation-created');
        return annotation();
      },
    },
    audit: {
      write: async () => {
        throw new Error('audit unavailable');
      },
    },
  });
  const service = createKnowledgeAnnotationService({
    reader: {},
    unitOfWork: unitOfWork(tx, {
      snapshot: () => [...state],
      restore: (snapshot) => state.splice(0, state.length, ...snapshot),
    }),
  });
  await assert.rejects(
    () =>
      service.create({
        actor,
        auditActor,
        itemId: 'item-1',
        body: { kind: 'note', origin: 'user', content: 'secret body' },
      }),
    /audit unavailable/,
  );
  assert.deepEqual(state, []);
});

test('conversation links reject cross-owner items without revealing existence', async () => {
  let addCalls = 0;
  const tx = transaction({
    access: {
      findOwnedItem: async () => item({ ownerUserId: 'different-owner' }),
    },
    conversations: {
      findOwned: async () => conversation(),
      addItem: async () => {
        addCalls += 1;
        return conversation();
      },
    },
  });
  const service = createKnowledgeConversationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  const result = await service.addItem({
    actor,
    auditActor,
    conversationId: 'conversation-1',
    body: {
      itemId: 'item-other-owner',
      relationType: 'supporting',
      ordinal: 0,
      expectedVersion: 1,
    },
  });
  assert.deepEqual(
    {
      statusCode: result.statusCode,
      code: result.code,
      message: result.message,
    },
    { statusCode: 404, code: 'not_found', message: 'Not found' },
  );
  assert.equal(addCalls, 0);
});

test('manual turns enforce role-origin allowlist, append ordering, and deterministic conflict', async () => {
  const appended = [];
  const tx = transaction({
    conversations: {
      findOwned: async () => conversation(),
      nextTurnSequence: async () => 1,
      appendTurn: async (input) => {
        appended.push(input);
        return { conversation: conversation({ version: 2 }), turn: turn() };
      },
    },
  });
  const service = createKnowledgeConversationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  const incompatible = await service.appendTurn({
    actor,
    auditActor,
    conversationId: 'conversation-1',
    body: {
      expectedVersion: 1,
      role: 'system',
      origin: 'ai',
      content: 'must reject',
    },
  });
  assert.equal(incompatible.statusCode, 400);

  const success = await service.appendTurn({
    actor,
    auditActor,
    conversationId: 'conversation-1',
    body: {
      expectedVersion: 1,
      role: 'user',
      origin: 'user',
      content: 'Synthetic question',
    },
  });
  assert.equal(success.ok, true);
  assert.equal(appended[0].sequence, 1);
  assert.match(appended[0].contentHash, /^[a-f0-9]{64}$/);
  assert.match(appended[0].aggregateContentHash, /^[a-f0-9]{64}$/);

  tx.conversations.appendTurn = async () => null;
  const race = await service.appendTurn({
    actor,
    auditActor,
    conversationId: 'conversation-1',
    body: {
      expectedVersion: 1,
      role: 'assistant',
      origin: 'ai',
      content: 'Synthetic answer',
    },
  });
  assert.equal(race.statusCode, 409);
});

test('known database uniqueness races are normalized to version conflict', async () => {
  const tx = transaction({
    conversations: {
      create: async () => conversation(),
    },
  });
  const uow = {
    run: async () => {
      throw new KnowledgeProvenanceConflictError();
    },
  };
  const service = createKnowledgeConversationService({
    reader: {},
    unitOfWork: uow,
  });
  const result = await service.create({
    actor,
    auditActor,
    body: { title: 'Synthetic conversation' },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'version_conflict');
  assert.ok(tx);
});

test('manual conversation rejects all provider/model/tool labels and invalid calendar dates', async () => {
  let createCalls = 0;
  const tx = transaction({
    conversations: {
      create: async () => {
        createCalls += 1;
        return conversation();
      },
    },
  });
  const service = createKnowledgeConversationService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  for (const body of [
    { title: 'URL', provider: 'https://provider.invalid/private' },
    { title: 'Credential', model: 'Bearer secret' },
    {
      title: 'OpenAI-like credential',
      provider: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    },
    { title: 'AWS-like credential', model: 'synthetic-credential-marker' },
    { title: 'Google-like credential', provider: 'AIzaSyntheticNotASecret' },
    { title: 'Invalid date', capturedAt: '2026-02-31T00:00:00Z' },
  ]) {
    const result = await service.create({ actor, auditActor, body });
    assert.equal(result.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(createCalls, 0);

  const namedTurn = await service.appendTurn({
    actor,
    auditActor,
    conversationId: 'conversation-1',
    body: {
      expectedVersion: 1,
      role: 'tool',
      origin: 'tool',
      content: 'Synthetic tool result',
      name: 'synthetic-credential-marker',
    },
  });
  assert.equal(namedTurn.statusCode, 400);
});

test('synthesis creation validates all sources and audits only allowlisted provenance metadata', async () => {
  const audit = [];
  let validateInput;
  const tx = transaction({
    syntheses: {
      validateSources: async (input) => {
        validateInput = input;
        return true;
      },
      create: async () => synthesisDetail(),
    },
    audit: { write: async (entry) => audit.push(entry) },
  });
  const service = createKnowledgeSynthesisService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  const result = await service.create({
    actor,
    auditActor,
    body: {
      scope: 'personal',
      title: 'Synthetic conclusion',
      content: 'Private conclusion body',
      unresolvedQuestions: ['What remains?'],
      confidenceBasisPoints: 7500,
      sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(validateInput.sources.length, 1);
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ['knowledge_synthesis_created', 'knowledge_synthesis_source_linked'],
  );
  assert.equal(
    JSON.stringify(audit).includes('Private conclusion body'),
    false,
  );
  assert.equal(JSON.stringify(audit).includes('What remains?'), false);

  tx.syntheses.validateSources = async () => false;
  const inaccessible = await service.create({
    actor,
    auditActor,
    body: {
      scope: 'personal',
      title: 'Hidden source',
      content: 'Conclusion',
      sources: [
        { kind: 'item', sourceId: 'hidden-item', relationType: 'primary' },
      ],
    },
  });
  assert.equal(inaccessible.statusCode, 404);
});

test('synthesis source input is strict and concurrent version append returns conflict', async () => {
  const tx = transaction({
    syntheses: {
      findOwned: async () => synthesisDetail(),
      validateSources: async () => true,
      appendVersion: async () => null,
    },
  });
  const service = createKnowledgeSynthesisService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  const unknown = await service.create({
    actor,
    auditActor,
    body: {
      scope: 'personal',
      title: 'Strict source',
      content: 'Conclusion',
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
  assert.equal(unknown.statusCode, 400);

  const nullQuestionsCreate = await service.create({
    actor,
    auditActor,
    body: {
      scope: 'personal',
      title: 'Strict questions',
      content: 'Conclusion',
      unresolvedQuestions: null,
      sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
    },
  });
  assert.equal(nullQuestionsCreate.statusCode, 400);

  const nullQuestionsAppend = await service.appendVersion({
    actor,
    auditActor,
    synthesisId: 'synthesis-1',
    body: {
      expectedVersion: 1,
      content: 'Version two',
      unresolvedQuestions: null,
      sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
    },
  });
  assert.equal(nullQuestionsAppend.statusCode, 400);

  const conflict = await service.appendVersion({
    actor,
    auditActor,
    synthesisId: 'synthesis-1',
    body: {
      expectedVersion: 1,
      content: 'Version two',
      sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
    },
  });
  assert.equal(conflict.statusCode, 409);
});

test('synthesis service shares one access context per mutation request', async () => {
  const createContexts = [];
  const appendContexts = [];
  const excludedSynthesisIds = [];
  let operation = 'create';
  const tx = transaction({
    syntheses: {
      validateSources: async (input) => {
        (operation === 'create' ? createContexts : appendContexts).push(
          input.accessContext,
        );
        excludedSynthesisIds.push(input.excludedSynthesisId);
        return true;
      },
      create: async (input) => {
        createContexts.push(input.accessContext);
        return synthesisDetail();
      },
      findOwned: async (input) => {
        appendContexts.push(input.accessContext);
        return synthesisDetail();
      },
      appendVersion: async (input) => {
        appendContexts.push(input.accessContext);
        return synthesisDetail({
          synthesis: {
            ...synthesisDetail().synthesis,
            currentVersion: 2,
          },
          currentVersion: {
            ...synthesisDetail().currentVersion,
            version: 2,
          },
        });
      },
    },
  });
  const service = createKnowledgeSynthesisService({
    reader: {},
    unitOfWork: unitOfWork(tx),
  });
  const body = {
    scope: 'personal',
    title: 'Synthetic synthesis',
    content: 'Synthetic conclusion',
    sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
  };
  const created = await service.create({ actor, auditActor, body });
  assert.equal(created.ok, true);
  assert.equal(createContexts.length, 2);
  assert.equal(new Set(createContexts).size, 1);
  assert.equal(excludedSynthesisIds[0], undefined);

  operation = 'append';
  const appended = await service.appendVersion({
    actor,
    auditActor,
    synthesisId: 'synthesis-1',
    body: {
      expectedVersion: 1,
      content: 'Synthetic conclusion version two',
      sources: body.sources,
    },
  });
  assert.equal(appended.ok, true);
  assert.equal(appendContexts.length, 3);
  assert.equal(new Set(appendContexts).size, 1);
  assert.notEqual(createContexts[0], appendContexts[0]);
  assert.equal(excludedSynthesisIds[1], 'synthesis-1');
});

test('synthesis ID reads and mutations normalize access-budget exhaustion as not found', async () => {
  const reader = consistentSynthesisReader({
    listVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
    findVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
    listVersionsVisible: async () => {
      throw new KnowledgeSynthesisAccessBudgetError();
    },
  });
  const tx = transaction({
    syntheses: {
      validateSources: async () => {
        throw new KnowledgeSynthesisAccessBudgetError();
      },
    },
  });
  const service = createKnowledgeSynthesisService({
    reader,
    unitOfWork: unitOfWork(tx),
  });
  const detail = await service.detail({ actor, synthesisId: 'synthesis-1' });
  const list = await service.list({ actor, limit: 20 });
  const history = await service.history({
    actor,
    synthesisId: 'synthesis-1',
    limit: 20,
  });
  const create = await service.create({
    actor,
    auditActor,
    body: {
      scope: 'personal',
      title: 'Synthetic conclusion',
      content: 'Synthetic conclusion body',
      sources: [{ kind: 'item', sourceId: 'item-1', relationType: 'primary' }],
    },
  });
  for (const result of [detail, history, create]) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.code, 'not_found');
  }
  assert.equal(list.ok, true);
  assert.deepEqual(list.value, { items: [], nextBoundary: null });
});
