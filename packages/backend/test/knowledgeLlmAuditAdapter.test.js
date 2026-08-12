import assert from 'node:assert/strict';
import test from 'node:test';

test('Knowledge LLM preview audit stores only bounded source counts', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  let created;
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        created = input.data;
        return input.data;
      },
    },
  });
  await writer.write({
    action: 'knowledge_llm_previewed',
    actor: {
      userId: 'canonical-user',
      requestId: 'synthetic-preview-request',
      source: 'api',
    },
    targetTable: 'knowledge_llm_runs',
    targetId: 'synthetic-preview-run',
    metadata: {
      provider: 'stub',
      model: 'stub-v1',
      scope: 'personal',
      catalogVersion: 1,
      estimatedInputTokens: 40,
      maxOutputTokens: 20,
      reservedCostMicros: '1',
      currency: 'JPY',
      sourceCounts: {
        snapshots: 1,
        annotationRevisions: 1,
        conversationTurns: 0,
        synthesisVersions: 0,
        threadPromotionMessages: 0,
      },
      resultCode: 'previewed',
      policyCount: 0,
      softLimitWarning: false,
    },
  });
  assert.deepEqual(created.metadata.sourceCounts, {
    snapshots: 1,
    annotationRevisions: 1,
    conversationTurns: 0,
    synthesisVersions: 0,
    threadPromotionMessages: 0,
  });
  assert.equal(JSON.stringify(created.metadata).includes('source-id'), false);
});

test('Knowledge LLM audit keeps canonical user attribution and omits caller auth identifiers', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  let created;
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        created = input.data;
        return input.data;
      },
    },
  });

  await writer.write({
    action: 'knowledge_llm_budget_reserved',
    actor: {
      userId: 'canonical-user',
      requestId: 'synthetic-request',
      source: 'api',
      principalUserId: 'spoofed-principal',
      actorUserId: 'spoofed-actor',
      authScopes: ['spoofed-scope'],
    },
    targetTable: 'knowledge_llm_runs',
    targetId: 'synthetic-run',
    metadata: {
      provider: 'stub',
      model: 'stub-v1',
      scope: 'personal',
      catalogVersion: 1,
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      reservedCostMicros: '0',
      currency: 'JPY',
      resultCode: 'reserved',
      policyCount: 1,
      softLimitWarning: false,
    },
  });

  assert.equal(created.userId, 'canonical-user');
  assert.equal('_auth' in created.metadata, false);
  const serialized = JSON.stringify(created.metadata);
  assert.equal(serialized.includes('spoofed-principal'), false);
  assert.equal(serialized.includes('spoofed-actor'), false);
  assert.equal(serialized.includes('spoofed-scope'), false);
});

test('Knowledge LLM audit rejects non-canonical actor identifiers', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  let writes = 0;
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        writes += 1;
        return input.data;
      },
    },
  });

  await assert.rejects(
    writer.write({
      action: 'knowledge_llm_budget_reserved',
      actor: {
        userId: 'canonical-user\u200b',
        requestId: 'synthetic-request',
        source: 'api',
      },
      targetTable: 'knowledge_llm_runs',
      targetId: 'synthetic-run',
      metadata: {
        provider: 'stub',
        model: 'stub-v1',
        scope: 'personal',
        catalogVersion: 1,
        estimatedInputTokens: 10,
        maxOutputTokens: 20,
        reservedCostMicros: '0',
        currency: 'JPY',
        resultCode: 'reserved',
        policyCount: 1,
        softLimitWarning: false,
      },
    }),
    /knowledge_llm_audit_invalid/,
  );
  assert.equal(writes, 0);
});

test('Knowledge LLM audit measures model bounds by Unicode code points', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        return input.data;
      },
    },
  });
  const entry = {
    action: 'knowledge_llm_budget_reserved',
    actor: {
      userId: 'canonical-user',
      requestId: 'synthetic-request',
      source: 'api',
    },
    targetTable: 'knowledge_llm_runs',
    targetId: 'synthetic-run',
    metadata: {
      provider: 'stub',
      model: '😀'.repeat(200),
      scope: 'personal',
      catalogVersion: 1,
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      reservedCostMicros: '0',
      currency: 'JPY',
      resultCode: 'reserved',
      policyCount: 1,
      softLimitWarning: false,
    },
  };
  await writer.write(entry);
  await assert.rejects(
    writer.write({
      ...entry,
      metadata: { ...entry.metadata, model: '😀'.repeat(201) },
    }),
    /knowledge_llm_audit_invalid/,
  );
  for (const model of [
    '\u00a0stub-default',
    'stub-default\u2003',
    '\ufeffstub-default',
    'stub\u00admodel',
    'stub\u200bmodel',
    'stub\u202emodel',
    `stub${String.fromCodePoint(0xe0001)}model`,
    `stub${String.fromCodePoint(0x110bd)}model`,
    `stub${String.fromCodePoint(0x85)}model`,
  ]) {
    await assert.rejects(
      writer.write({
        ...entry,
        metadata: { ...entry.metadata, model },
      }),
      /knowledge_llm_audit_invalid/,
    );
  }
});

test('Knowledge LLM operator billing reconciliation is distinctly attributable', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  let created;
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        created = input.data;
        return input.data;
      },
    },
  });

  await writer.write({
    action: 'knowledge_llm_reconciled',
    actor: {
      userId: 'synthetic-billing-operator',
      requestId: 'synthetic-operator-request',
      source: 'api',
    },
    targetTable: 'knowledge_llm_runs',
    targetId: 'synthetic-run',
    metadata: {
      provider: 'stub',
      model: 'stub-v1',
      scope: 'personal',
      catalogVersion: 1,
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      reservedCostMicros: '10',
      currency: 'JPY',
      resultCode: 'reconciled',
      policyCount: 1,
      actualInputTokens: 8,
      actualOutputTokens: 2,
      actualCostMicros: '7',
      operatorIntervention: 'billing_evidence',
    },
  });

  assert.equal(created.actorRole, 'knowledge_billing_operator');
  assert.equal(created.reasonCode, 'knowledge_llm_operator_reconciled');
  assert.equal(created.metadata.operatorIntervention, 'billing_evidence');
});

test('Knowledge LLM saved failure reconciliation records only allowlisted terminal metadata', async () => {
  const { PrismaKnowledgeLlmAuditWriter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmAuditAdapter.js');
  let created;
  const writer = new PrismaKnowledgeLlmAuditWriter({
    auditLog: {
      async create(input) {
        created = input.data;
        return input.data;
      },
    },
  });

  await writer.write({
    action: 'knowledge_llm_reconciled',
    actor: {
      userId: 'canonical-user',
      requestId: 'synthetic-reconcile-request',
      source: 'api',
    },
    targetTable: 'knowledge_llm_runs',
    targetId: 'synthetic-run',
    metadata: {
      provider: 'openai',
      model: 'allowlisted-model',
      scope: 'personal',
      catalogVersion: 1,
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      reservedCostMicros: '10',
      currency: 'JPY',
      resultCode: 'reconciled',
      failureCode: 'provider_5xx',
      policyCount: 1,
    },
  });

  assert.equal(created.metadata.resultCode, 'reconciled');
  assert.equal(created.metadata.failureCode, 'provider_5xx');
  assert.equal('actualInputTokens' in created.metadata, false);
  assert.equal('actualOutputTokens' in created.metadata, false);
  assert.equal('actualCostMicros' in created.metadata, false);
  assert.equal(
    JSON.stringify(created.metadata).includes('provider body'),
    false,
  );
});
