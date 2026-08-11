import assert from 'node:assert/strict';
import test from 'node:test';

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
