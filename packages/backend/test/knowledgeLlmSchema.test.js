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
const reconciliationMigration = await readFile(
  new URL(
    '../prisma/migrations/20260812130000_add_knowledge_llm_outcome_reconciliation/migration.sql',
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
    'KnowledgeLlmUsageEvidence',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
  }
  const run = block('model', 'KnowledgeLlmRun');
  assert.match(run, /executionStatus\s+KnowledgeLlmExecutionStatus/);
  assert.match(run, /settlementStatus\s+KnowledgeLlmSettlementStatus/);
  assert.match(run, /maximumCostMicros\s+BigInt/);
  assert.match(run, /softLimitWarning\s+Boolean\s+@default\(false\)/);
  assert.match(run, /inputCostMicrosPerMillion\s+BigInt/);
  assert.match(run, /outputCostMicrosPerMillion\s+BigInt/);
  assert.match(run, /providerRequestHash\s+String/);
  assert.match(migration, /"providerRequestHash" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /KnowledgeLlmRun_state_shape_check/);
  assert.match(
    migration,
    /"maximumCostMicros"::NUMERIC\s*=\s*CEIL\([\s\S]*?"estimatedInputTokens"::NUMERIC[\s\S]*?"inputCostMicrosPerMillion"::NUMERIC[\s\S]*?\+\s*CEIL\([\s\S]*?"maxOutputTokens"::NUMERIC[\s\S]*?"outputCostMicrosPerMillion"::NUMERIC/,
  );
  assert.match(
    migration,
    /KnowledgeLlmBudgetPeriod_boundary_guard[\s\S]*?BEFORE INSERT OR UPDATE/,
  );
  assert.match(
    migration,
    /local_period_start[\s\S]*?DATE_TRUNC\('month',[\s\S]*?expected_period_end_utc/,
  );
  assert.match(migration, /erp4_knowledge_llm_auth_identifier_valid/);
  assert.match(migration, /erp4_knowledge_llm_timezone_valid/);
  assert.match(
    migration,
    /KnowledgeLlmRun_identity_check[\s\S]*?auth_identifier_valid"\("actorUserId", 200\)/,
  );
  assert.match(
    migration,
    /erp4_knowledge_llm_model_valid[\s\S]*?LENGTH\(value\) BETWEEN 1 AND 200[\s\S]*?BTRIM\([\s\S]*?U&'[\s\S]*?\\00A0[\s\S]*?\\2003[\s\S]*?\\FEFF/,
  );
  assert.match(
    migration,
    /erp4_knowledge_llm_model_valid[\s\S]*?GENERATE_SERIES\(1, LEAST\(LENGTH\(value\), 201\)\)[\s\S]*?BETWEEN 1 AND 31[\s\S]*?BETWEEN 127 AND 159[\s\S]*?ERP4_UNICODE_15_CF_RANGES_BEGIN[\s\S]*?ERP4_UNICODE_15_CF_RANGES_END/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun_identity_check[\s\S]*?erp4_knowledge_llm_model_valid"\("model"\)/,
  );
  assert.match(
    migration,
    /KnowledgeLlmBudgetPolicy_identity_check[\s\S]*?auth_identifier_valid"\("subjectId", 200\)[\s\S]*?timezone_valid"\("timezone"\)/,
  );
  assert.match(
    migration,
    /KnowledgeLlmUsageEvidence_shape_check[\s\S]*?auth_identifier_valid"\("createdBy", 200\)/,
  );
  assert.match(
    migration,
    /"executionStatus" = 'reserved'[\s\S]*?"conversationId" IS NULL[\s\S]*?"assistantTurnId" IS NULL/,
  );
  assert.match(
    migration,
    /"executionStatus" = 'result_ready'[\s\S]*?"conversationId" IS NOT NULL[\s\S]*?"assistantTurnId" IS NOT NULL/,
  );
  assert.match(
    migration,
    /"executionStatus" = 'dispatched'\s+AND "settlementStatus" = 'reserved'/,
  );
  assert.doesNotMatch(
    migration,
    /"executionStatus" = 'dispatched'\s+AND "settlementStatus" IN \('reserved', 'held_maximum'\)/,
  );
  assert.match(migration, /KnowledgeLlmRun_transition_guard/);
  assert.match(
    migration,
    /KnowledgeLlmRun settlement requires a valid provider outcome or usage evidence/,
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
  assert.match(migration, /OLD\."softLimitWarning" <> NEW\."softLimitWarning"/);
  assert.match(migration, /KnowledgeLlmRun dispatch timestamp is immutable/);
  assert.match(
    migration,
    /KnowledgeLlmRun provenance updates require a state transition/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun conversation requires result transition/,
  );
  assert.match(
    migration,
    /OLD\."executionStatus" = 'result_unknown'[\s\S]*?NEW\."executionStatus" = 'result_ready'/,
  );
  assert.match(
    migration,
    /OLD\."settlementStatus" = 'held_maximum'[\s\S]*?NEW\."settlementStatus" = 'settled_actual'/,
  );
  const failedHeldShape = migration.match(
    /"executionStatus" = 'failed'[\s\S]*?"settlementStatus" = 'held_maximum'[\s\S]*?"failureCode" IN \(([\s\S]*?)\)\n\s+AND "dispatchedAt"/,
  );
  assert.ok(failedHeldShape);
  assert.match(failedHeldShape[1], /provider_4xx/);
  assert.doesNotMatch(
    migration,
    /"settlementStatus" = 'released'\s+AND "failureCode" = 'provider_4xx'/,
  );
  assert.doesNotMatch(
    failedHeldShape[1],
    /timeout_outcome_unknown|connection_outcome_unknown|finalization_failed|usage_missing|usage_invalid/,
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
  assert.match(
    block('model', 'KnowledgeLlmBudgetPeriod'),
    /releasedMicros\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(38, 0\)/,
  );
  assert.match(migration, /"releasedMicros" NUMERIC\(38,0\)/);
  assert.match(
    migration,
    /KnowledgeLlmBudgetPeriod counters may change only through reservation transitions/,
  );
  assert.match(migration, /erp4_knowledge_llm_assert_period_accounting/);
  assert.doesNotMatch(
    migration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeLlm(BudgetPeriod_accounting|Reservation_period)_consistency"/,
  );
  assert.match(migration, /KnowledgeLlmBudgetPeriod_boundary_guard/);
  assert.match(
    migration,
    /IF TG_OP = 'UPDATE' THEN[\s\S]*?RETURN NEW;[\s\S]*?FOR SHARE;/,
  );
  assert.match(migration, /NEW\."periodStartUtc" <> expected_period_start_utc/);
});

test('run settlement recomputes actual cost from immutable usage and price snapshots', () => {
  assert.match(
    migration,
    /NEW\."actualInputTokens" > OLD\."estimatedInputTokens"[\s\S]*?NEW\."actualOutputTokens" > OLD\."maxOutputTokens"[\s\S]*?actual usage exceeds reserved token ceiling/,
  );
  assert.match(
    migration,
    /erp4_knowledge_llm_run_transition_guard[\s\S]*?expected_actual_cost\s*:=\s*[\s\S]*?CEIL\([\s\S]*?NEW\."actualInputTokens"::NUMERIC[\s\S]*?OLD\."inputCostMicrosPerMillion"::NUMERIC[\s\S]*?\/ 1000000[\s\S]*?\+ CEIL\([\s\S]*?NEW\."actualOutputTokens"::NUMERIC[\s\S]*?OLD\."outputCostMicrosPerMillion"::NUMERIC[\s\S]*?\/ 1000000/,
  );
  assert.match(
    migration,
    /NEW\."actualCostMicros"::NUMERIC <> expected_actual_cost/,
  );
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
  assert.match(migration, /erp4_knowledge_llm_validate_context/);
  assert.match(migration, /erp4_knowledge_llm_context_fingerprint/);
  assert.match(migration, /context provenance is stale or invalid/);
  assert.match(migration, /context bounds exceeded/);
  assert.match(migration, /selected item bound exceeded/);
  assert.match(migration, /context provenance depth exceeded/);
  assert.match(
    migration,
    /KnowledgeLlmRun dispatch requires contiguous context sources/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun dispatch requires matching request ledger/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun_assistantTurnId_conversationId_fkey/,
  );
  assert.doesNotMatch(source, /sourceId\s+String/);
});

test('reservation accounting timestamp and terminal values are immutable', () => {
  const reservation = block('model', 'KnowledgeLlmReservation');
  const reservationGuard = migration.slice(
    migration.indexOf(
      'CREATE FUNCTION "erp4_knowledge_llm_reservation_transition_guard"()',
    ),
    migration.indexOf(
      'CREATE TRIGGER "KnowledgeLlmReservation_transition_guard"',
    ),
  );
  assert.match(reservation, /accountedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(
    reservation,
    /@@index\(\[budgetPeriodId, status, accountedAt, id\]\)/,
  );
  assert.match(migration, /KnowledgeLlmReservation_timestamp_check/);
  assert.match(
    migration,
    /terminal KnowledgeLlmReservation accounting is immutable/,
  );
  assert.match(
    migration,
    /OLD\."actualCostMicros" IS DISTINCT FROM NEW\."actualCostMicros"/,
  );
  assert.match(migration, /OLD\."settledAt" IS DISTINCT FROM NEW\."settledAt"/);
  assert.match(migration, /KnowledgeLlmReservation cannot be deleted/);
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE OR DELETE ON "KnowledgeLlmReservation"/,
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation must be created with its initial run and matching budget subject/,
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation budget subject already reserved/,
  );
  assert.match(
    migration,
    /NEW\."accountedAt" :=\s+\(clock_timestamp\(\) AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\)/,
  );
  assert.ok(
    reservationGuard.indexOf('FOR UPDATE OF period;') <
      reservationGuard.indexOf('NEW."accountedAt" :='),
    'the database accounting clock must be sampled after admission locks',
  );
  assert.match(
    reservationGuard,
    /period\."periodEndUtc" > admission_started_at - INTERVAL '1 hour'/,
  );
  assert.match(
    reservationGuard,
    /ORDER BY policy\."subjectType", policy\."subjectId", policy\.id\s+FOR UPDATE OF policy/,
  );
  assert.match(
    reservationGuard,
    /run_scope = 'organization'[\s\S]*?policy\."subjectType" = 'organization'[\s\S]*?policy\."subjectId" = run_organization/,
  );
  assert.ok(
    reservationGuard.indexOf(
      'ORDER BY policy."subjectType", policy."subjectId", policy.id',
    ) < reservationGuard.indexOf('ORDER BY period.id'),
    'all required policies must be locked before the global period union',
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation must use the current trusted accounting period/,
  );
  assert.match(
    migration,
    /CONSTRAINT = 'KnowledgeLlmReservation_current_accounting_period'/,
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation exceeds the locked hard budget limit/,
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation exceeds the locked request rate limit/,
  );
  assert.match(
    migration,
    /"activeReservedMicros" = "activeReservedMicros" \+ NEW\."maximumCostMicros"/,
  );
  assert.match(
    migration,
    /KnowledgeLlmReservation settlement must match its terminal run/,
  );
  assert.match(
    migration,
    /KnowledgeLlmRun and reservations must settle atomically/,
  );
  assert.match(
    migration,
    /KnowledgeLlmBudgetPeriod counters may change only through reservation transitions/,
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeLlmRun_reservation_consistency"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(migration, /erp4_knowledge_llm_assert_period_accounting/);
  assert.doesNotMatch(
    migration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeLlm(BudgetPeriod_accounting|Reservation_period)_consistency"/,
  );
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
  assert.match(
    migration,
    /KnowledgeLlmProviderOutcome usage exceeds run token ceiling/,
  );
  assert.match(migration, /NEW\."capturedAt" < run_dispatched_at/);
  assert.match(
    migration,
    /OCTET_LENGTH\("normalizedContent"\) BETWEEN 1 AND 262144/,
  );
  const evidence = block('model', 'KnowledgeLlmUsageEvidence');
  assert.match(evidence, /runId\s+String\s+@unique/);
  assert.match(evidence, /source\s+KnowledgeLlmUsageEvidenceSource/);
  assert.match(evidence, /actualCostMicros\s+BigInt/);
  assert.match(evidence, /evidenceHash\s+String/);
  assert.doesNotMatch(evidence, /rawResponse|providerRequestId|apiKey|headers/);
  assert.match(migration, /KnowledgeLlmUsageEvidence_shape_check/);
  assert.match(
    migration,
    /KnowledgeLlmUsageEvidence requires a verified held usage-unknown result/,
  );
  const evidenceGuard = migration.match(
    /CREATE FUNCTION "erp4_knowledge_llm_usage_evidence_insert_guard"\(\)[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(evidenceGuard);
  assert.match(evidenceGuard, /NEW\."createdBy" <> BTRIM\(NEW\."createdBy"\)/);
  assert.match(evidenceGuard, /NEW\."createdBy" = run_actor/);
  assert.match(migration, /KnowledgeLlmUsageEvidence_immutable/);
});

test('prompt snapshot is additive, one-to-one, bounded, and finalize-only', () => {
  const run = block('model', 'KnowledgeLlmRun');
  const prompt = block('model', 'KnowledgeLlmPromptSnapshot');
  assert.match(run, /promptSnapshot\s+KnowledgeLlmPromptSnapshot\?/);
  assert.match(
    prompt,
    /run\s+KnowledgeLlmRun\s+@relation\(fields: \[runId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/,
  );
  assert.match(prompt, /runId\s+String\s+@unique/);
  assert.match(prompt, /normalizedPrompt\s+String\?\s+@db\.Text/);
  assert.match(prompt, /promptHash\s+String/);
  assert.match(prompt, /capturedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(prompt, /finalizedAt\s+DateTime\?/);
  assert.match(prompt, /createdBy\s+String/);

  assert.match(
    reconciliationMigration,
    /CREATE TABLE "KnowledgeLlmPromptSnapshot"/,
  );
  assert.match(
    reconciliationMigration,
    /KnowledgeLlmPromptSnapshot_runId_fkey[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    reconciliationMigration,
    /KnowledgeLlmPromptSnapshot_shape_check[\s\S]*?OCTET_LENGTH\("normalizedPrompt"\) BETWEEN 1 AND 16384/,
  );
  assert.match(
    reconciliationMigration,
    /NEW\."createdBy" <> run_actor[\s\S]*?exact reserved run prompt and canonical actor/,
  );
  assert.match(
    reconciliationMigration,
    /KnowledgeLlmPromptSnapshot_finalize_only/,
  );
  assert.match(reconciliationMigration, /KnowledgeLlmPromptSnapshot_no_delete/);
});

test('prompt hash matches the application domain-separated SHA-256 contract', () => {
  const hashFunction = reconciliationMigration.match(
    /CREATE FUNCTION "erp4_knowledge_llm_prompt_hash"\(content TEXT\)[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(hashFunction);
  assert.match(
    hashFunction,
    /convert_to\('erp4:knowledge:llm-user-prompt:v1', 'UTF8'\)/,
  );
  assert.match(hashFunction, /\|\| decode\('00', 'hex'\)/);
  assert.match(hashFunction, /\|\| convert_to\(content, 'UTF8'\)/);
});

test('saved outcomes alone expand terminal recovery without weakening existing transitions', () => {
  assert.match(
    reconciliationMigration,
    /CREATE OR REPLACE FUNCTION "erp4_knowledge_llm_run_transition_guard"\(\)/,
  );
  for (const preservedContract of [
    'dispatch requires matching request ledger',
    'dispatch requires contiguous context sources',
    'actual settlement cost mismatch',
    'result requires an assistant AI turn',
    'request boundary is immutable',
    'dispatch timestamp is immutable',
    'provenance updates require a state transition',
  ]) {
    assert.match(reconciliationMigration, new RegExp(preservedContract));
  }
  assert.match(
    reconciliationMigration,
    /OLD\."executionStatus" = 'result_unknown'[\s\S]*?NEW\."executionStatus" IN \('result_ready', 'failed'\)/,
  );
  assert.match(
    reconciliationMigration,
    /OLD\."failureCode" = 'finalization_failed'[\s\S]*?outcome\.status = 'usage_unknown'[\s\S]*?outcome\."failureCode" = NEW\."failureCode"/,
  );
  assert.match(
    reconciliationMigration,
    /OLD\."failureCode" = 'finalization_failed'[\s\S]*?NEW\."executionStatus" = 'failed'[\s\S]*?outcome\.status = 'invalid'[\s\S]*?outcome\."failureCode" = NEW\."failureCode"/,
  );
  assert.doesNotMatch(
    reconciliationMigration,
    /DROP TABLE|DROP COLUMN|ALTER COLUMN|RENAME (?:TABLE|COLUMN)/,
  );
});

test('finalized prompt and outcomes use deferred reverse commit consistency guards', () => {
  assert.match(
    reconciliationMigration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeLlmProviderOutcome_finalized_consistency"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(
    reconciliationMigration,
    /finalized KnowledgeLlmProviderOutcome requires exact conversation and actual settlement/,
  );
  assert.match(
    reconciliationMigration,
    /CREATE CONSTRAINT TRIGGER "KnowledgeLlmPromptSnapshot_finalized_consistency"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(
    reconciliationMigration,
    /prompt\."promptHash" =\s*"erp4_knowledge_llm_prompt_hash"\(user_turn\.content\)/,
  );
  assert.match(
    reconciliationMigration,
    /user_turn\.sequence \+ 1 = assistant\.sequence/,
  );
  assert.match(
    reconciliationMigration,
    /conversation\."contentHash" = encode\([\s\S]*?llm-conversation:v1/,
  );
});

test('new capture triggers do not invert outcome-run-reservation-period lock order', () => {
  const promptInsertGuard = reconciliationMigration.match(
    /CREATE FUNCTION "erp4_knowledge_llm_prompt_snapshot_insert_guard"\(\)[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(promptInsertGuard);
  assert.match(promptInsertGuard, /FROM "KnowledgeLlmRun"[\s\S]*?FOR UPDATE/);
  assert.doesNotMatch(
    promptInsertGuard,
    /FROM "KnowledgeLlmProviderOutcome"|FROM "KnowledgeLlmReservation"|FROM "KnowledgeLlmBudgetPeriod"/,
  );
  assert.doesNotMatch(
    reconciliationMigration,
    /CREATE TRIGGER "KnowledgeLlmProviderOutcome_[^"]+"[\s\S]*?KnowledgeLlmReservation/,
  );
});
