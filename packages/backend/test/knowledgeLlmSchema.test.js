import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schema = await readFile(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = await readFile(
  new URL(
    '../prisma/migrations/20260811100000_add_knowledge_llm_budget_foundation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

function block(kind, name) {
  const match = schema.match(
    new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1];
}

test('LLM foundation is additive and separates execution from settlement', () => {
  for (const name of [
    'KnowledgeLlmBudgetPolicy',
    'KnowledgeLlmBudgetPeriod',
    'KnowledgeLlmRun',
    'KnowledgeLlmRequest',
    'KnowledgeLlmReservation',
    'KnowledgeLlmContextSource',
    'KnowledgeLlmProviderOutcome',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
  }
  const run = block('model', 'KnowledgeLlmRun');
  assert.match(run, /executionStatus\s+KnowledgeLlmExecutionStatus/);
  assert.match(run, /settlementStatus\s+KnowledgeLlmSettlementStatus/);
  assert.match(run, /maximumCostMicros\s+BigInt/);
  assert.match(run, /inputCostMicrosPerMillion\s+BigInt/);
  assert.match(run, /outputCostMicrosPerMillion\s+BigInt/);
  assert.match(migration, /KnowledgeLlmRun_state_shape_check/);
  assert.match(migration, /KnowledgeLlmRun_transition_guard/);
  assert.match(
    migration,
    /KnowledgeLlmRun settlement requires a valid provider outcome/,
  );
  assert.match(migration, /outcome\."contentHash" = turn\."contentHash"/);
  assert.match(
    migration,
    /outcome\."contentHash" =\s*"erp4_knowledge_llm_content_hash"\(turn\.content\)/,
  );
  assert.match(migration, /turn\.role = 'assistant'/);
  assert.match(migration, /turn\.origin = 'ai'/);
  assert.match(
    migration,
    /KnowledgeLlmProviderOutcome requires provider dispatch and must capture content before finalization/,
  );
  assert.match(migration, /erp4_knowledge_llm_content_hash/);
  assert.match(migration, /sha256\([\s\S]*?conversation-turn:v1/);
  assert.match(
    migration,
    /KnowledgeLlmRun held result requires a usage-unknown provider outcome/,
  );
  assert.match(
    migration,
    /OLD\."inputCostMicrosPerMillion" <> NEW\."inputCostMicrosPerMillion"/,
  );
  assert.match(
    migration,
    /OLD\."executionStatus" = 'result_unknown'[\s\S]*?NEW\."executionStatus" = 'result_ready'/,
  );
  assert.match(
    migration,
    /OLD\."settlementStatus" = 'held_maximum'[\s\S]*?NEW\."settlementStatus" = 'settled_actual'/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER COLUMN/);
});

test('budget policy and periods enforce explicit subject, timezone and integer limits', () => {
  const policy = block('model', 'KnowledgeLlmBudgetPolicy');
  assert.match(policy, /subjectType\s+KnowledgeLlmBudgetSubjectType/);
  assert.match(policy, /timezone\s+String/);
  assert.match(policy, /softLimitMicros\s+BigInt/);
  assert.match(policy, /hardLimitMicros\s+BigInt/);
  assert.match(migration, /KnowledgeLlmBudgetPolicy_one_active_subject_key/);
  assert.match(migration, /KnowledgeLlmBudgetPolicy_version_guard/);
  assert.match(migration, /"softLimitMicros" <= "hardLimitMicros"/);
  assert.match(migration, /KnowledgeLlmBudgetPeriod_counters_check/);
  assert.match(migration, /KnowledgeLlmBudgetPeriod_boundary_guard/);
});

test('request and selected context are immutable and exactly-one typed', () => {
  const request = block('model', 'KnowledgeLlmRequest');
  assert.match(request, /@@unique\(\[actorUserId, requestKeyHash\]\)/);
  const source = block('model', 'KnowledgeLlmContextSource');
  for (const field of [
    'sourceSnapshotId',
    'sourceAnnotationRevisionId',
    'sourceConversationTurnId',
    'sourceSynthesisVersionId',
    'sourceThreadPromotionMessageId',
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\s+String\\?`));
  }
  assert.match(migration, /KnowledgeLlmContextSource_exactly_one_check/);
  assert.match(migration, /NUM_NONNULLS\([\s\S]*?\) = 1/);
  assert.match(migration, /KnowledgeLlmContextSource_type_check/);
  assert.match(migration, /KnowledgeLlmRequest_immutable/);
  assert.match(migration, /KnowledgeLlmContextSource_immutable/);
  assert.match(migration, /KnowledgeLlmContextSource_before_dispatch_only/);
  assert.match(
    migration,
    /KnowledgeLlmRun dispatch requires contiguous context sources/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun_assistantTurnId_conversationId_fkey/,
  );
  assert.doesNotMatch(source, /sourceId\s+String/);
});

test('provider outcome retains only normalized bounded state for reconciliation', () => {
  const outcome = block('model', 'KnowledgeLlmProviderOutcome');
  assert.match(outcome, /normalizedContent\s+String\?\s+@db.Text/);
  assert.match(outcome, /contentHash\s+String\?/);
  assert.doesNotMatch(outcome, /rawResponse|providerRequestId|apiKey|headers/);
  assert.match(migration, /KnowledgeLlmProviderOutcome_shape_check/);
  assert.match(migration, /KnowledgeLlmProviderOutcome_finalize_only/);
  assert.match(
    migration,
    /KnowledgeLlmProviderOutcome requires provider dispatch/,
  );
  assert.match(migration, /NEW\."capturedAt" < run_dispatched_at/);
  assert.match(
    migration,
    /OCTET_LENGTH\("normalizedContent"\) BETWEEN 1 AND 262144/,
  );
});
