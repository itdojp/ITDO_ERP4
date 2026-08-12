import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaKnowledgeLlmBudgetAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js';
import { StubExternalLlmTextAdapter } from '../dist/adapters/externalLlm/stubTextAdapter.js';
import {
  markKnowledgeLlmRunDispatched as markKnowledgeLlmRunDispatchedWithClock,
  reconcileKnowledgeLlmHeldBudget as reconcileKnowledgeLlmHeldBudgetWithClock,
  reconcileKnowledgeLlmUsageUnknownBudget as reconcileKnowledgeLlmUsageUnknownBudgetWithClock,
  settleKnowledgeLlmBudget as settleKnowledgeLlmBudgetWithClock,
} from '../dist/adapters/knowledge/prismaKnowledgeLlmSettlementAdapter.js';
import {
  createKnowledgeLlmBudgetUseCases,
  knowledgeLlmMonthlyPeriod,
} from '../dist/application/knowledge/knowledgeLlmBudgetUseCases.js';
import { externalLlmUnicode15FormatCodePointRanges } from '../dist/application/externalLlm/externalLlmPort.js';
import {
  knowledgeLlmContextEstimatedTokens,
  knowledgeLlmContextRepresentationHash,
} from '../dist/application/knowledge/knowledgeLlmContext.js';

const parsed = new URL(process.env.DATABASE_URL || '');
if (
  process.env.KNOWLEDGE_LLM_BUDGET_INTEGRATION_CONFIRM !== '1' ||
  parsed.protocol !== 'postgresql:' ||
  !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
  parsed.pathname !== '/erp4_knowledge_llm_budget' ||
  parsed.hash !== '' ||
  [...parsed.searchParams.keys()].some((key) => key !== 'schema') ||
  parsed.searchParams.getAll('schema').length !== 1 ||
  parsed.searchParams.get('schema') !== 'public'
) {
  throw new Error('Refusing non-ephemeral Knowledge LLM budget database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const catalogModels = [
  ['stub-default', 500_000n, 0n],
  ['stub-result', 250_000n, 350_000n],
  ['stub-settlement', 250_000n, 750_000n],
  ['stub-context', 1n, 0n],
  ['stub-zero-cost', 0n, 0n],
  ['stub-released-counter-boundary', 5_000_000_000_000_000_000n, 0n],
].map(([model, inputCostMicrosPerMillion, outputCostMicrosPerMillion]) => ({
  provider: 'stub',
  model,
  enabled: true,
  maxInputTokens: 2_147_483_647,
  maxOutputTokens: 4096,
  inputCostMicrosPerMillion,
  outputCostMicrosPerMillion,
  currency: 'JPY',
  capabilities: ['text'],
}));
const stubProvider = new StubExternalLlmTextAdapter();
const now = new Date();
const service = createKnowledgeLlmBudgetUseCases(
  new PrismaKnowledgeLlmBudgetAdapter(prisma),
  { version: 1, models: catalogModels },
  stubProvider,
  () => new Date(now.getTime()),
);
const serviceAt = (timestamp) =>
  createKnowledgeLlmBudgetUseCases(
    new PrismaKnowledgeLlmBudgetAdapter(prisma),
    { version: 1, models: catalogModels },
    stubProvider,
    () => new Date(timestamp.getTime()),
  );
const after = (milliseconds) => new Date(now.getTime() + milliseconds);
const untrustedTimestampCanary = new Date('2000-01-01T00:00:00.000Z');
const markKnowledgeLlmRunDispatched = async (transaction, input) => {
  const run = await transaction.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: input.runId },
    select: { providerRequestHash: true },
  });
  return markKnowledgeLlmRunDispatchedWithClock(
    transaction,
    {
      ...input,
      expectedProviderRequestHash:
        input.expectedProviderRequestHash ?? run.providerRequestHash,
      dispatchedAt: untrustedTimestampCanary,
    },
    () => new Date(input.dispatchedAt.getTime()),
  );
};
const settleKnowledgeLlmBudget = (transaction, input) =>
  settleKnowledgeLlmBudgetWithClock(
    transaction,
    { ...input, completedAt: untrustedTimestampCanary },
    () => new Date(input.completedAt.getTime()),
  );
const reconcileKnowledgeLlmHeldBudget = (transaction, input) =>
  reconcileKnowledgeLlmHeldBudgetWithClock(
    transaction,
    { ...input, completedAt: untrustedTimestampCanary },
    () => new Date(input.completedAt.getTime()),
  );
const reconcileKnowledgeLlmUsageUnknownBudget = (transaction, input) =>
  reconcileKnowledgeLlmUsageUnknownBudgetWithClock(
    transaction,
    { ...input, completedAt: untrustedTimestampCanary },
    () => new Date(input.completedAt.getTime()),
  );

async function waitForDatabaseLock(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const activity = await prisma.$queryRaw`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${pid}
    `;
    if (activity[0]?.waitEventType === 'Lock') return;
    await delay(20);
  }
  throw new Error('knowledge_llm_lock_wait_not_observed');
}

async function waitForNamedDatabaseLock(applicationName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const activity = await prisma.$queryRaw`
      SELECT pid
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND wait_event_type = 'Lock'
      ORDER BY pid
      LIMIT 1
    `;
    if (activity[0]?.pid) return activity[0].pid;
    await delay(20);
  }
  throw new Error('knowledge_llm_named_lock_wait_not_observed');
}

async function waitForPolicyLock(excludedPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const activity = await prisma.$queryRaw`
      SELECT pid
      FROM pg_stat_activity
      WHERE pid <> ${excludedPid}
        AND wait_event_type = 'Lock'
        AND query LIKE '%KnowledgeLlmBudgetPolicy%'
      ORDER BY pid
      LIMIT 1
    `;
    if (activity[0]?.pid) return activity[0].pid;
    await delay(20);
  }
  throw new Error('knowledge_llm_policy_lock_wait_not_observed');
}
const hash = (character) => character.repeat(64);
const knowledgeTextHash = (domain, content) =>
  createHash('sha256')
    .update(`erp4:knowledge:${domain}:v1\0`, 'utf8')
    .update(content, 'utf8')
    .digest('hex');
const conversationTurnHash = (content) =>
  knowledgeTextHash('conversation-turn', content);

function contextFromTurn(turn, ordinal, overrides = {}) {
  const byteLength = Buffer.byteLength(turn.content, 'utf8');
  return {
    ordinal,
    sourceType: 'conversation_turn',
    sourceId: turn.id,
    exactSourceVersion: turn.sequence,
    exactSourceHash: turn.contentHash,
    representation: turn.content,
    representationHash: knowledgeLlmContextRepresentationHash(turn.content),
    byteLength,
    estimatedTokens: knowledgeLlmContextEstimatedTokens(byteLength),
    ...overrides,
  };
}

function contextCreateData(runId, source) {
  const sourceField = {
    snapshot: 'sourceSnapshotId',
    annotation_revision: 'sourceAnnotationRevisionId',
    conversation_turn: 'sourceConversationTurnId',
    synthesis_version: 'sourceSynthesisVersionId',
    thread_promotion_message: 'sourceThreadPromotionMessageId',
  }[source.sourceType];
  if (!sourceField) throw new Error('invalid synthetic context source');
  return {
    runId,
    sourceType: source.sourceType,
    ordinal: source.ordinal,
    [sourceField]: source.sourceId,
    exactSourceVersion: source.exactSourceVersion,
    exactSourceHash: source.exactSourceHash,
    representationHash: source.representationHash,
    byteLength: source.byteLength,
    estimatedTokens: source.estimatedTokens,
    createdBy: 'context-guard-user',
  };
}

function auditActor(userId, suffix) {
  return {
    requestId: `knowledge-llm-budget-${suffix}`,
    source: 'api',
    // These deliberately untrusted attribution values must never be copied to
    // mandatory LLM audit metadata. AuditLog.userId is the canonical actor.
    principalUserId: 'audit-principal-canary',
    actorUserId: 'audit-actor-canary',
    authScopes: ['audit-scope-canary'],
  };
}

function terminalAuditActor(userId, suffix) {
  return { userId, ...auditActor(userId, suffix) };
}

function reservation({
  runId,
  userId,
  keyHash,
  maximumCostMicros,
  inputCostMicrosPerMillion,
  outputCostMicrosPerMillion = 0n,
  selectedContextSources = [],
  estimatedInputTokens,
  organizationId = null,
  auditSuffix = runId,
}) {
  const resolvedInputCost = inputCostMicrosPerMillion ?? 500_000n;
  const resolvedEstimatedInputTokens =
    estimatedInputTokens ??
    (inputCostMicrosPerMillion === undefined
      ? Number(maximumCostMicros) * 2
      : 100);
  const model = catalogModels.find(
    (candidate) =>
      candidate.inputCostMicrosPerMillion === resolvedInputCost &&
      candidate.outputCostMicrosPerMillion === outputCostMicrosPerMillion,
  )?.model;
  assert.ok(model, 'synthetic catalog entry must exist');
  return {
    runId,
    actor: {
      userId,
      ...(organizationId ? { organizationId } : {}),
      groupAccountIds: [],
    },
    auditActor: auditActor(userId, auditSuffix),
    scope: organizationId ? 'organization' : 'personal',
    organizationId,
    provider: 'stub',
    model,
    catalogVersion: 1,
    promptTemplateVersion: 1,
    requestKeyHash: keyHash,
    systemPrompt: '',
    userPrompt: '',
    selectedContextSources,
    reservationInputTokenFloor: resolvedEstimatedInputTokens,
    maxOutputTokens: 100,
    // Runtime callers may carry an extra timestamp field. The use case must
    // overwrite it with the trusted server clock dependency.
    now: untrustedTimestampCanary,
  };
}

async function policy({
  id,
  subjectType,
  subjectId,
  soft = 50n,
  hard = 100n,
  rate = 10,
  timezone = 'Asia/Tokyo',
  version = 1,
}) {
  return prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id,
      subjectType,
      subjectId,
      currency: 'JPY',
      timezone,
      softLimitMicros: soft,
      hardLimitMicros: hard,
      requestsPerHour: rate,
      version,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
}

async function exerciseResultUnknownReconciliation({
  runId,
  keyCharacter,
  payloadCharacter,
  failureCode,
}) {
  const reserved = await service.reserve(
    reservation({
      runId,
      userId: 'settlement-user',
      keyHash: hash(keyCharacter),
      maximumCostMicros: 60n,
      inputCostMicrosPerMillion: 250_000n,
      outputCostMicrosPerMillion: 350_000n,
    }),
  );
  assert.equal(reserved.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId,
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', `${runId}-dispatch`),
      dispatchedAt: after(8_100),
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId,
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', `${runId}-unknown`),
      completedAt: after(8_200),
      settlement: {
        type: 'hold',
        executionStatus: 'result_unknown',
        failureCode,
      },
    });
  });

  const resultContent = `Synthetic ${failureCode} reconciled result`;
  await prisma.$transaction(async (transaction) => {
    const conversation = await transaction.knowledgeConversation.create({
      data: {
        id: `${runId}-conversation`,
        ownerUserId: 'settlement-user',
        title: 'Synthetic result-unknown reconciliation',
        sourceType: 'manual',
        provider: 'stub',
        model: 'stub-v1',
        contentHash: hash(keyCharacter),
        createdBy: 'settlement-user',
        updatedBy: 'settlement-user',
      },
    });
    await transaction.knowledgeConversationTurn.create({
      data: {
        conversationId: conversation.id,
        sequence: 1,
        role: 'user',
        origin: 'user',
        content: 'Synthetic prompt',
        contentHash: conversationTurnHash('Synthetic prompt'),
        createdBy: 'settlement-user',
      },
    });
    const assistant = await transaction.knowledgeConversationTurn.create({
      data: {
        conversationId: conversation.id,
        sequence: 2,
        role: 'assistant',
        origin: 'ai',
        content: resultContent,
        contentHash: conversationTurnHash(resultContent),
        createdBy: 'settlement-user',
      },
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId,
        status: 'valid',
        normalizedContent: resultContent,
        contentHash: assistant.contentHash,
        inputTokens: 40,
        outputTokens: 10,
        createdAt: after(8_300),
        capturedAt: after(8_300),
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId },
      data: { normalizedContent: null, finalizedAt: after(8_400) },
    });
    await reconcileKnowledgeLlmHeldBudget(transaction, {
      runId,
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', `${runId}-reconcile`),
      completedAt: after(8_500),
      actualInputTokens: 40,
      actualOutputTokens: 10,
      actualCostMicros: 14n,
      conversationId: conversation.id,
      assistantTurnId: assistant.id,
    });
  });
  const reconciled = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: runId },
    include: { reservations: true },
  });
  assert.equal(reconciled.executionStatus, 'result_ready');
  assert.equal(reconciled.settlementStatus, 'settled_actual');
  assert.equal(reconciled.actualCostMicros, 14n);
  assert.equal(reconciled.reservations[0].status, 'settled_actual');
}

try {
  const [identifierContract] = await prisma.$queryRaw`
    SELECT
      "erp4_knowledge_llm_auth_identifier_valid"('canonical-user', 200) AS valid,
      "erp4_knowledge_llm_auth_identifier_valid"('canonical-user' || CHR(8203), 200) AS "zeroWidthInvalid",
      "erp4_knowledge_llm_auth_identifier_valid"(CHR(8192) || 'canonical-user', 200) AS "unicodeTrimInvalid",
      "erp4_knowledge_llm_auth_identifier_valid"(' canonical-user', 200) AS "leadingSpaceInvalid",
      "erp4_knowledge_llm_timezone_valid"('UTC') AS "timezoneValid",
      "erp4_knowledge_llm_timezone_valid"('UTC ') AS "paddedTimezoneInvalid"
  `;
  assert.equal(identifierContract.valid, true);
  assert.equal(identifierContract.zeroWidthInvalid, false);
  assert.equal(identifierContract.unicodeTrimInvalid, false);
  assert.equal(identifierContract.leadingSpaceInvalid, false);
  assert.equal(identifierContract.timezoneValid, true);
  assert.equal(identifierContract.paddedTimezoneInvalid, false);
  const invalidPolicy = {
    subjectType: 'user',
    currency: 'JPY',
    softLimitMicros: 1n,
    hardLimitMicros: 2n,
    requestsPerHour: 1,
    version: 1,
    createdBy: 'synthetic-admin',
    updatedBy: 'synthetic-admin',
  };
  await assert.rejects(
    prisma.knowledgeLlmBudgetPolicy.create({
      data: {
        ...invalidPolicy,
        id: 'policy-non-canonical-subject',
        subjectId: 'non-canonical-user\u200b',
        timezone: 'UTC',
      },
    }),
    /KnowledgeLlmBudgetPolicy_identity_check/,
  );
  await assert.rejects(
    prisma.knowledgeLlmBudgetPolicy.create({
      data: {
        ...invalidPolicy,
        id: 'policy-invalid-timezone',
        subjectId: 'invalid-timezone-user',
        timezone: 'UTC ',
      },
    }),
    /KnowledgeLlmBudgetPolicy_identity_check/,
  );

  await policy({
    id: 'policy-rendered-prompt',
    subjectType: 'user',
    subjectId: 'rendered-prompt-user',
    soft: 900n,
    hard: 1000n,
  });
  const renderedPromptInput = reservation({
    runId: 'run-rendered-prompt',
    userId: 'rendered-prompt-user',
    keyHash: hash('c'),
    maximumCostMicros: 32n,
  });
  delete renderedPromptInput.reservationInputTokenFloor;
  const renderedPromptReservation = await service.reserve(renderedPromptInput);
  assert.equal(renderedPromptReservation.ok, true);
  const renderedPromptRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-rendered-prompt' },
  });
  const invalidDirectInsertModels = [
    ['ascii-padding', 'stub-default '],
    ['c0-control', 'stub\nmodel'],
    ['c1-control', `stub${String.fromCodePoint(0x85)}model`],
    ['nbsp-padding', '\u00a0stub-default\u00a0'],
    ['em-space-padding', '\u2003stub-default\u2003'],
    ['ideographic-space-padding', '\u3000stub-default\u3000'],
    ['bom-padding', '\ufeffstub-default\ufeff'],
    ['soft-hyphen-format', 'stub\u00admodel'],
    ['zero-width-format', 'stub\u200bmodel'],
    ['bidi-format', 'stub\u202emodel'],
    ['kaithi-number-sign-format', `stub${String.fromCodePoint(0x110bd)}model`],
    ['supplementary-format', `stub${String.fromCodePoint(0xe0001)}model`],
    ['kaithi-number-sign-format', `stub${String.fromCodePoint(0x110bd)}model`],
    ['empty', ''],
    ['over-code-point-limit', '😀'.repeat(201)],
  ];
  for (const [name, model] of invalidDirectInsertModels) {
    await assert.rejects(
      prisma.knowledgeLlmRun.create({
        data: {
          ...renderedPromptRun,
          id: `run-non-canonical-model-${name}`,
          model,
        },
      }),
      /KnowledgeLlmRun_identity_check/,
      `direct INSERT must reject non-canonical model case: ${name}`,
    );
  }
  const modelBoundaries = await prisma.$queryRaw`
    SELECT
      "erp4_knowledge_llm_model_valid"('x') AS "oneCodePoint",
      "erp4_knowledge_llm_model_valid"(${'😀'.repeat(200)}) AS "twoHundredCodePoints",
      "erp4_knowledge_llm_model_valid"(${'😀'.repeat(201)}) AS "twoHundredOneCodePoints"
  `;
  assert.deepEqual(modelBoundaries, [
    {
      oneCodePoint: true,
      twoHundredCodePoints: true,
      twoHundredOneCodePoints: false,
    },
  ]);
  for (const [first, last] of externalLlmUnicode15FormatCodePointRanges) {
    for (const codePoint of new Set([first, last])) {
      const [result] = await prisma.$queryRaw`
        SELECT "erp4_knowledge_llm_model_valid"(
          ${`stub${String.fromCodePoint(codePoint)}model`}
        ) AS valid
      `;
      assert.equal(
        result.valid,
        false,
        `database must reject Unicode 15.0 Cf U+${codePoint
          .toString(16)
          .toUpperCase()}`,
      );
    }
  }
  const renderedPromptRequest = {
    provider: 'stub',
    model: 'stub-default',
    systemPrompt: '',
    userPrompt: '',
    inputTokenCeiling: renderedPromptRun.estimatedInputTokens,
    maxOutputTokens: 100,
    temperatureBasisPoints: 0,
  };
  const renderedPromptPrepared = await stubProvider.prepare(
    renderedPromptRequest,
  );
  assert.equal(
    renderedPromptPrepared.requestFingerprint,
    renderedPromptRun.providerRequestHash,
  );
  const renderedPromptResult = await renderedPromptPrepared.dispatch();
  assert.equal(renderedPromptRun.estimatedInputTokens, 64);
  assert.equal(renderedPromptResult.usageStatus, 'reported');
  assert.equal(
    renderedPromptResult.usage.inputTokens,
    renderedPromptRun.estimatedInputTokens,
  );
  assert.ok(
    (BigInt(renderedPromptResult.usage.inputTokens) * 500_000n + 999_999n) /
      1_000_000n <=
      renderedPromptRun.maximumCostMicros,
  );

  const missingPolicy = await service.reserve(
    reservation({
      runId: 'run-missing-policy',
      userId: 'missing-policy-user',
      keyHash: hash('4'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(missingPolicy.ok, false);
  assert.equal(missingPolicy.error.code, 'policy_not_found');
  assert.equal(
    (
      await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'knowledge_llm_budget_blocked',
          targetId: 'run-missing-policy',
        },
      })
    ).metadata.resultCode,
    'configuration_blocked',
  );

  await prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id: 'policy-currency-mismatch',
      subjectType: 'user',
      subjectId: 'currency-mismatch-user',
      currency: 'USD',
      timezone: 'UTC',
      softLimitMicros: 900n,
      hardLimitMicros: 1000n,
      requestsPerHour: 10,
      version: 1,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
  const currencyMismatch = await service.reserve(
    reservation({
      runId: 'run-currency-mismatch',
      userId: 'currency-mismatch-user',
      keyHash: hash('6'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(currencyMismatch.ok, false);
  assert.equal(currencyMismatch.error.code, 'policy_mismatch');
  assert.equal(
    (
      await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'knowledge_llm_budget_blocked',
          targetId: 'run-currency-mismatch',
        },
      })
    ).metadata.resultCode,
    'configuration_blocked',
  );
  await policy({
    id: 'policy-personal',
    subjectType: 'user',
    subjectId: 'budget-user',
  });
  const firstInput = reservation({
    runId: 'run-first',
    userId: 'budget-user',
    keyHash: hash('a'),
    maximumCostMicros: 40n,
  });
  const first = await service.reserve(firstInput);
  assert.equal(first.ok, true);
  assert.equal(first.value.created, true);
  assert.equal(first.value.softLimitWarning, false);
  const firstReservationTimestamp =
    await prisma.knowledgeLlmReservation.findFirstOrThrow({
      where: { runId: 'run-first' },
      select: { createdAt: true, accountedAt: true },
    });
  assert.equal(
    firstReservationTimestamp.createdAt.toISOString(),
    now.toISOString(),
  );
  assert.equal(firstReservationTimestamp.accountedAt >= now, true);
  assert.equal(
    firstReservationTimestamp.accountedAt.getTime() <= Date.now() + 1_000,
    true,
  );
  const firstRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-first' },
  });
  assert.equal(firstRun.maximumCostMicros > 0n, true);
  await assert.rejects(
    prisma.knowledgeLlmRun.create({
      data: {
        ...firstRun,
        id: 'run-invalid-underreserved-maximum',
        maximumCostMicros: firstRun.maximumCostMicros - 1n,
      },
    }),
    /KnowledgeLlmRun_request_check/,
  );

  const replay = await service.reserve(firstInput);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.created, false);
  assert.equal(
    await prisma.knowledgeLlmReservation.count({
      where: { runId: 'run-first' },
    }),
    1,
  );

  await policy({
    id: 'policy-stale-accounting-period',
    subjectType: 'user',
    subjectId: 'stale-accounting-period-user',
  });
  const staleAccountingTimestamp = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0),
  );
  const staleAccountingPeriodResult = await serviceAt(
    staleAccountingTimestamp,
  ).reserve(
    reservation({
      runId: 'run-stale-accounting-period',
      userId: 'stale-accounting-period-user',
      keyHash: hash('3'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(staleAccountingPeriodResult.ok, false);
  assert.equal(staleAccountingPeriodResult.error.code, 'policy_mismatch');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-stale-accounting-period' },
    }),
    0,
  );
  assert.equal(
    await prisma.knowledgeLlmBudgetPeriod.count({
      where: { policyId: 'policy-stale-accounting-period' },
    }),
    0,
  );
  assert.equal(
    (
      await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'knowledge_llm_budget_blocked',
          targetId: 'run-stale-accounting-period',
        },
      })
    ).metadata.resultCode,
    'configuration_blocked',
  );

  await policy({
    id: 'policy-concurrent-replay',
    subjectType: 'user',
    subjectId: 'concurrent-replay-user',
    soft: 1000n,
    hard: 1000n,
    rate: 10,
  });
  const concurrentReplayInput = reservation({
    runId: 'run-concurrent-replay',
    userId: 'concurrent-replay-user',
    keyHash: knowledgeTextHash('llm-test-request-key', 'concurrent-replay'),
    maximumCostMicros: 1n,
  });
  const concurrentReplay = await Promise.all([
    service.reserve(concurrentReplayInput),
    service.reserve(concurrentReplayInput),
  ]);
  assert.equal(
    concurrentReplay.every((result) => result.ok),
    true,
  );
  assert.deepEqual(
    concurrentReplay
      .map((result) => result.value.created)
      .sort((left, right) => Number(left) - Number(right)),
    [false, true],
  );
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-concurrent-replay' },
    }),
    1,
  );
  assert.equal(
    await prisma.knowledgeLlmReservation.count({
      where: { runId: 'run-concurrent-replay' },
    }),
    1,
  );

  const economicReplayConflict = await service.reserve({
    ...firstInput,
    runId: 'run-economic-conflicting-replay',
    reservationInputTokenFloor: 90,
  });
  assert.equal(economicReplayConflict.ok, false);
  assert.equal(economicReplayConflict.error.code, 'idempotency_conflict');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-economic-conflicting-replay' },
    }),
    0,
  );

  const conflict = await service.reserve({
    ...firstInput,
    runId: 'run-conflicting-replay',
    userPrompt: 'Different canonical request',
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'idempotency_conflict');
  const conflictAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'knowledge_llm_duplicate_detected',
      targetId: 'run-first',
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(conflictAudit?.metadata?.resultCode, 'conflict');

  const secondInput = reservation({
    runId: 'run-second',
    userId: 'budget-user',
    keyHash: hash('e'),
    maximumCostMicros: 40n,
  });
  const second = await service.reserve(secondInput);
  assert.equal(second.ok, true);
  assert.equal(second.value.softLimitWarning, true);
  const secondReplay = await service.reserve(secondInput);
  assert.equal(secondReplay.ok, true);
  assert.equal(secondReplay.value.created, false);
  assert.equal(secondReplay.value.softLimitWarning, true);

  const blocked = await service.reserve(
    reservation({
      runId: 'run-hard-blocked',
      userId: 'budget-user',
      keyHash: hash('1'),
      maximumCostMicros: 30n,
    }),
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'budget_hard_limit');
  assert.equal(
    await prisma.knowledgeLlmRun.count({ where: { id: 'run-hard-blocked' } }),
    0,
  );

  const firstReservation =
    await prisma.knowledgeLlmReservation.findFirstOrThrow({
      where: { runId: firstRun.id },
    });
  const directRunData = ({
    sourceRun,
    runId,
    requestKeyHash,
    createdAt,
    budgetPeriodId,
    accountedAt = untrustedTimestampCanary,
    softLimitWarning = sourceRun.softLimitWarning,
  }) => ({
    id: runId,
    actorUserId: sourceRun.actorUserId,
    scope: sourceRun.scope,
    organizationId: sourceRun.organizationId,
    provider: sourceRun.provider,
    model: sourceRun.model,
    catalogVersion: sourceRun.catalogVersion,
    promptTemplateVersion: sourceRun.promptTemplateVersion,
    requestPayloadHash: knowledgeTextHash('llm-direct-request', runId),
    providerRequestHash: knowledgeTextHash('llm-direct-provider', runId),
    selectedContextFingerprint: knowledgeTextHash('llm-direct-context', runId),
    estimatedInputTokens: sourceRun.estimatedInputTokens,
    maxOutputTokens: sourceRun.maxOutputTokens,
    inputCostMicrosPerMillion: sourceRun.inputCostMicrosPerMillion,
    outputCostMicrosPerMillion: sourceRun.outputCostMicrosPerMillion,
    maximumCostMicros: sourceRun.maximumCostMicros,
    softLimitWarning,
    currency: sourceRun.currency,
    createdAt,
    createdBy: sourceRun.actorUserId,
    updatedAt: createdAt,
    updatedBy: sourceRun.actorUserId,
    request: {
      create: {
        requestKeyHash,
        requestPayloadHash: knowledgeTextHash('llm-direct-request', runId),
        createdAt,
        createdBy: sourceRun.actorUserId,
      },
    },
    reservations: {
      create: {
        budgetPeriodId,
        maximumCostMicros: sourceRun.maximumCostMicros,
        createdAt,
        accountedAt,
        updatedAt: createdAt,
      },
    },
  });
  await assert.rejects(
    prisma.knowledgeLlmRun.create({
      data: directRunData({
        sourceRun: firstRun,
        runId: 'run-direct-hard-limit-bypass',
        requestKeyHash: knowledgeTextHash(
          'llm-test-request-key',
          'direct-hard-limit-bypass',
        ),
        createdAt: now,
        budgetPeriodId: firstReservation.budgetPeriodId,
      }),
    }),
    /exceeds the locked hard budget limit/,
  );
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-direct-hard-limit-bypass' },
    }),
    0,
  );

  await policy({
    id: 'policy-version-budget-v1',
    subjectType: 'user',
    subjectId: 'policy-version-budget-user',
    soft: 100n,
    hard: 100n,
  });
  assert.equal(
    (
      await service.reserve(
        reservation({
          runId: 'run-policy-version-budget-v1',
          userId: 'policy-version-budget-user',
          keyHash: hash('a'),
          maximumCostMicros: 60n,
        }),
      )
    ).ok,
    true,
  );
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: 'policy-version-budget-v1' },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-version-budget-v2',
    subjectType: 'user',
    subjectId: 'policy-version-budget-user',
    soft: 100n,
    hard: 100n,
    version: 2,
  });
  const versionBudgetBlocked = await service.reserve(
    reservation({
      runId: 'run-policy-version-budget-blocked',
      userId: 'policy-version-budget-user',
      keyHash: hash('d'),
      maximumCostMicros: 50n,
    }),
  );
  assert.equal(versionBudgetBlocked.ok, false);
  assert.equal(versionBudgetBlocked.error.code, 'budget_hard_limit');
  const versionBudgetRemaining = await service.reserve(
    reservation({
      runId: 'run-policy-version-budget-remaining',
      userId: 'policy-version-budget-user',
      keyHash: hash('f'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(versionBudgetRemaining.ok, true);

  await policy({
    id: 'policy-version-rate-v1',
    subjectType: 'user',
    subjectId: 'policy-version-rate-user',
    hard: 1000n,
    rate: 1,
  });
  assert.equal(
    (
      await service.reserve(
        reservation({
          runId: 'run-policy-version-rate-v1',
          userId: 'policy-version-rate-user',
          keyHash: hash('1'),
          maximumCostMicros: 1n,
        }),
      )
    ).ok,
    true,
  );
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: 'policy-version-rate-v1' },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-version-rate-v2',
    subjectType: 'user',
    subjectId: 'policy-version-rate-user',
    hard: 1000n,
    rate: 1,
    version: 2,
  });
  const versionRateBlocked = await service.reserve(
    reservation({
      runId: 'run-policy-version-rate-blocked',
      userId: 'policy-version-rate-user',
      keyHash: hash('3'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(versionRateBlocked.ok, false);
  assert.equal(versionRateBlocked.error.code, 'rate_limit');

  const versionRateSourceRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-policy-version-rate-v1' },
  });
  const versionRateCurrentPeriod =
    await prisma.knowledgeLlmBudgetPeriod.findFirstOrThrow({
      where: { policyId: 'policy-version-rate-v2' },
      orderBy: { periodStartUtc: 'desc' },
    });
  const directBackdatedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  await assert.rejects(
    prisma.knowledgeLlmRun.create({
      data: directRunData({
        sourceRun: versionRateSourceRun,
        runId: 'run-direct-rate-limit-bypass',
        requestKeyHash: knowledgeTextHash(
          'llm-test-request-key',
          'direct-rate-limit-bypass',
        ),
        createdAt: directBackdatedAt,
        budgetPeriodId: versionRateCurrentPeriod.id,
        // A direct writer can set the warning bit. The database rate guard must
        // still reject the second request independently of the soft threshold.
        softLimitWarning: true,
      }),
    }),
    /exceeds the locked request rate limit/,
  );
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-direct-rate-limit-bypass' },
    }),
    0,
  );

  const previousRateWindow = knowledgeLlmMonthlyPeriod(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)),
    versionRateCurrentPeriod.timezone,
  );
  const versionRatePreviousPeriod =
    await prisma.knowledgeLlmBudgetPeriod.create({
      data: {
        id: 'period-direct-backdated-bypass',
        policyId: 'policy-version-rate-v2',
        periodStartUtc: previousRateWindow.start,
        periodEndUtc: previousRateWindow.end,
        timezone: versionRateCurrentPeriod.timezone,
        currency: versionRateSourceRun.currency,
        createdAt: now,
        updatedAt: now,
      },
    });
  const previousRateCreatedAt = new Date(
    previousRateWindow.end.getTime() - 60_000,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.create({
      data: directRunData({
        sourceRun: versionRateSourceRun,
        runId: 'run-direct-prior-period-bypass',
        requestKeyHash: knowledgeTextHash(
          'llm-test-request-key',
          'direct-prior-period-bypass',
        ),
        createdAt: previousRateCreatedAt,
        budgetPeriodId: versionRatePreviousPeriod.id,
      }),
    }),
    /must use the current trusted accounting period/,
  );
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-direct-prior-period-bypass' },
    }),
    0,
  );

  await policy({
    id: 'policy-rollover-race-v1',
    subjectType: 'user',
    subjectId: 'policy-rollover-race-user',
    soft: 1000n,
    hard: 1000n,
  });
  let signalPolicyTransitionReady;
  const policyTransitionReady = new Promise((resolve) => {
    signalPolicyTransitionReady = resolve;
  });
  let releasePolicyTransition;
  const policyTransitionRelease = new Promise((resolve) => {
    releasePolicyTransition = resolve;
  });
  const policyTransition = prisma.$transaction(
    async (transaction) => {
      const [{ pid }] = await transaction.$queryRaw`
        SELECT pg_backend_pid()::INTEGER AS pid
      `;
      await transaction.knowledgeLlmBudgetPolicy.update({
        where: { id: 'policy-rollover-race-v1' },
        data: { active: false, updatedBy: 'synthetic-admin' },
      });
      await transaction.knowledgeLlmBudgetPolicy.create({
        data: {
          id: 'policy-rollover-race-v2',
          subjectType: 'user',
          subjectId: 'policy-rollover-race-user',
          currency: 'JPY',
          timezone: 'Asia/Tokyo',
          softLimitMicros: 1n,
          hardLimitMicros: 1n,
          requestsPerHour: 10,
          version: 2,
          createdBy: 'synthetic-admin',
          updatedBy: 'synthetic-admin',
        },
      });
      signalPolicyTransitionReady(pid);
      await policyTransitionRelease;
    },
    { timeout: 15_000 },
  );
  const policyTransitionPid = await policyTransitionReady;
  const reservationDuringPolicyTransition = service.reserve(
    reservation({
      runId: 'run-policy-rollover-race',
      userId: 'policy-rollover-race-user',
      keyHash: hash('4'),
      maximumCostMicros: 2n,
    }),
  );
  let policyTransitionError;
  try {
    await waitForPolicyLock(policyTransitionPid);
  } catch (error) {
    policyTransitionError = error;
  } finally {
    releasePolicyTransition();
  }
  await policyTransition;
  if (policyTransitionError) throw policyTransitionError;
  const rolloverRaceResult = await reservationDuringPolicyTransition;
  assert.equal(rolloverRaceResult.ok, false);
  assert.equal(rolloverRaceResult.error.code, 'budget_hard_limit');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-policy-rollover-race' },
    }),
    0,
  );

  await policy({
    id: 'policy-timezone-drift-v1',
    subjectType: 'user',
    subjectId: 'policy-timezone-drift-user',
    soft: 1000n,
    hard: 1000n,
    rate: 1,
    timezone: 'Asia/Tokyo',
  });
  assert.equal(
    (
      await service.reserve(
        reservation({
          runId: 'run-policy-timezone-drift-v1',
          userId: 'policy-timezone-drift-user',
          keyHash: hash('6'),
          maximumCostMicros: 1n,
        }),
      )
    ).ok,
    true,
  );
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: 'policy-timezone-drift-v1' },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-timezone-drift-v2',
    subjectType: 'user',
    subjectId: 'policy-timezone-drift-user',
    soft: 1000n,
    hard: 1000n,
    rate: 1,
    timezone: 'UTC',
    version: 2,
  });
  const timezoneDriftPeriodsBefore =
    await prisma.knowledgeLlmBudgetPeriod.count({
      where: { policyId: 'policy-timezone-drift-v2' },
    });
  const timezoneDriftBlocked = await service.reserve(
    reservation({
      runId: 'run-policy-timezone-drift-v2',
      userId: 'policy-timezone-drift-user',
      keyHash: hash('8'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(timezoneDriftBlocked.ok, false);
  assert.equal(timezoneDriftBlocked.error.code, 'policy_mismatch');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-policy-timezone-drift-v2' },
    }),
    0,
  );
  assert.equal(
    await prisma.knowledgeLlmBudgetPeriod.count({
      where: { policyId: 'policy-timezone-drift-v2' },
    }),
    timezoneDriftPeriodsBefore,
  );

  // The database assigns the reservation accounting instant. Use the current
  // month on both policy versions to prove the rolling rate guard survives an
  // inactive-to-active version change without relying on an injectable clock.
  const previousPolicyTimestamp = new Date(now);
  const currentPolicyTimestamp = new Date(now);
  await policy({
    id: 'policy-boundary-rollover-v1',
    subjectType: 'user',
    subjectId: 'policy-boundary-rollover-user',
    soft: 1000n,
    hard: 1000n,
    rate: 1,
    timezone: 'UTC',
  });
  assert.equal(
    (
      await serviceAt(previousPolicyTimestamp).reserve(
        reservation({
          runId: 'run-policy-boundary-rollover-v1',
          userId: 'policy-boundary-rollover-user',
          keyHash: hash('9'),
          maximumCostMicros: 1n,
        }),
      )
    ).ok,
    true,
  );
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: 'policy-boundary-rollover-v1' },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-boundary-rollover-v2',
    subjectType: 'user',
    subjectId: 'policy-boundary-rollover-user',
    soft: 1000n,
    hard: 1000n,
    rate: 1,
    timezone: 'UTC',
    version: 2,
  });
  const boundaryRolloverRateBlocked = await serviceAt(
    currentPolicyTimestamp,
  ).reserve(
    reservation({
      runId: 'run-policy-boundary-rollover-v2',
      userId: 'policy-boundary-rollover-user',
      keyHash: hash('0'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(boundaryRolloverRateBlocked.ok, false);
  assert.equal(boundaryRolloverRateBlocked.error.code, 'rate_limit');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-policy-boundary-rollover-v2' },
    }),
    0,
  );

  const priorMonthReference = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 0, 0, 0),
  );
  const priorMonthWindow = knowledgeLlmMonthlyPeriod(
    priorMonthReference,
    'UTC',
  );
  await prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id: 'policy-boundary-currency-v1',
      subjectType: 'user',
      subjectId: 'policy-boundary-currency-user',
      currency: 'USD',
      timezone: 'UTC',
      softLimitMicros: 1000n,
      hardLimitMicros: 1000n,
      requestsPerHour: 10,
      version: 1,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
      periods: {
        create: {
          periodStartUtc: priorMonthWindow.start,
          periodEndUtc: priorMonthWindow.end,
          timezone: 'UTC',
          currency: 'USD',
        },
      },
    },
  });
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: 'policy-boundary-currency-v1' },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-boundary-currency-v2',
    subjectType: 'user',
    subjectId: 'policy-boundary-currency-user',
    soft: 1000n,
    hard: 1000n,
    rate: 10,
    timezone: 'UTC',
    version: 2,
  });
  const boundaryCurrencyRollover = await serviceAt(
    currentPolicyTimestamp,
  ).reserve(
    reservation({
      runId: 'run-policy-boundary-currency-v2',
      userId: 'policy-boundary-currency-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'policy-boundary-currency-v2',
      ),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(boundaryCurrencyRollover.ok, true);

  await policy({
    id: 'policy-period-mismatch',
    subjectType: 'user',
    subjectId: 'policy-period-mismatch-user',
    soft: 1000n,
    hard: 1000n,
    timezone: 'UTC',
  });
  const currentWindow = knowledgeLlmMonthlyPeriod(now, 'UTC');
  const noncanonicalPeriod = {
    policyId: 'policy-period-mismatch',
    periodStartUtc: currentWindow.start,
    periodEndUtc: new Date(currentWindow.end.getTime() - 86_400_000),
    timezone: 'UTC',
    currency: 'JPY',
  };
  await assert.rejects(
    prisma.knowledgeLlmBudgetPeriod.create({ data: noncanonicalPeriod }),
    /monthly boundary mismatch/,
  );
  await assert.rejects(
    prisma.knowledgeLlmBudgetPeriod.create({
      data: {
        ...noncanonicalPeriod,
        periodStartUtc: new Date(currentWindow.start.getTime() + 86_400_000),
        periodEndUtc: new Date(currentWindow.end.getTime() + 86_400_000),
      },
    }),
    /monthly boundary mismatch/,
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "KnowledgeLlmBudgetPeriod" DISABLE TRIGGER "KnowledgeLlmBudgetPeriod_boundary_guard"',
  );
  try {
    await prisma.knowledgeLlmBudgetPeriod.create({ data: noncanonicalPeriod });
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "KnowledgeLlmBudgetPeriod" ENABLE TRIGGER "KnowledgeLlmBudgetPeriod_boundary_guard"',
    );
  }
  const periodMismatch = await service.reserve(
    reservation({
      runId: 'run-policy-period-mismatch',
      userId: 'policy-period-mismatch-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'policy-period-mismatch',
      ),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(periodMismatch.ok, false);
  assert.equal(periodMismatch.error.code, 'policy_mismatch');
  assert.equal(
    (
      await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'knowledge_llm_budget_blocked',
          targetId: 'run-policy-period-mismatch',
        },
      })
    ).metadata.resultCode,
    'configuration_blocked',
  );
  await prisma.knowledgeLlmBudgetPeriod.delete({
    where: {
      policyId_periodStartUtc: {
        policyId: 'policy-period-mismatch',
        periodStartUtc: currentWindow.start,
      },
    },
  });

  await policy({
    id: 'policy-ambiguous-month-start',
    subjectType: 'user',
    subjectId: 'ambiguous-month-start-user',
    soft: 1000n,
    hard: 1000n,
    timezone: 'America/Havana',
  });
  const ambiguousMonthWindow = knowledgeLlmMonthlyPeriod(
    new Date('2020-11-15T12:00:00.000Z'),
    'America/Havana',
  );
  assert.equal(
    ambiguousMonthWindow.start.toISOString(),
    '2020-11-01T05:00:00.000Z',
  );
  const ambiguousMonthPeriod = await prisma.knowledgeLlmBudgetPeriod.create({
    data: {
      id: 'period-ambiguous-month-start',
      policyId: 'policy-ambiguous-month-start',
      periodStartUtc: ambiguousMonthWindow.start,
      periodEndUtc: ambiguousMonthWindow.end,
      timezone: 'America/Havana',
      currency: 'JPY',
    },
  });
  await assert.rejects(
    prisma.knowledgeLlmBudgetPeriod.create({
      data: {
        id: 'period-ambiguous-month-start-alternate',
        policyId: 'policy-ambiguous-month-start',
        periodStartUtc: new Date('2020-11-01T04:00:00.000Z'),
        periodEndUtc: ambiguousMonthWindow.end,
        timezone: 'America/Havana',
        currency: 'JPY',
      },
    }),
    /monthly boundary mismatch/,
  );

  let signalPolicyLocked;
  const policyLocked = new Promise((resolve) => {
    signalPolicyLocked = resolve;
  });
  let releasePolicyLock;
  const policyLockRelease = new Promise((resolve) => {
    releasePolicyLock = resolve;
  });
  const heldPolicyLock = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM "KnowledgeLlmBudgetPolicy"
        WHERE id = 'policy-ambiguous-month-start'
        FOR UPDATE
      `;
      signalPolicyLocked();
      await policyLockRelease;
    },
    { timeout: 15_000 },
  );
  await policyLocked;
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(
          "SET LOCAL lock_timeout = '1000ms'",
        );
        await transaction.knowledgeLlmBudgetPeriod.update({
          where: { id: ambiguousMonthPeriod.id },
          data: {
            version: { increment: 1 },
            updatedAt: after(100_000),
          },
        });
      },
      { timeout: 5_000 },
    );
  } finally {
    releasePolicyLock();
  }
  await heldPolicyLock;

  await policy({
    id: 'policy-period-order-user',
    subjectType: 'user',
    subjectId: 'period-order-user',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
  });
  await policy({
    id: 'policy-period-order-org',
    subjectType: 'organization',
    subjectId: 'period-order-org',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
  });
  const periodOrderWindow = knowledgeLlmMonthlyPeriod(now, 'UTC');
  const organizationFirstPeriod = await prisma.knowledgeLlmBudgetPeriod.create({
    data: {
      id: '00000000-period-order-organization',
      policyId: 'policy-period-order-org',
      periodStartUtc: periodOrderWindow.start,
      periodEndUtc: periodOrderWindow.end,
      timezone: 'UTC',
      currency: 'JPY',
    },
  });
  const userSecondPeriod = await prisma.knowledgeLlmBudgetPeriod.create({
    data: {
      id: 'zzzzzzzz-period-order-user',
      policyId: 'policy-period-order-user',
      periodStartUtc: periodOrderWindow.start,
      periodEndUtc: periodOrderWindow.end,
      timezone: 'UTC',
      currency: 'JPY',
    },
  });
  const lockOrderApplicationName = 'erp4-knowledge-llm-period-order';
  const lockOrderUrl = new URL(process.env.DATABASE_URL);
  lockOrderUrl.searchParams.set('application_name', lockOrderApplicationName);
  const lockOrderPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: lockOrderUrl.toString() }),
  });
  const lockOrderService = createKnowledgeLlmBudgetUseCases(
    new PrismaKnowledgeLlmBudgetAdapter(lockOrderPrisma),
    { version: 1, models: catalogModels },
    stubProvider,
    () => new Date(now.getTime()),
  );
  let signalOrganizationPeriodLocked;
  const organizationPeriodLocked = new Promise((resolve) => {
    signalOrganizationPeriodLocked = resolve;
  });
  let releaseOrganizationPeriod;
  const organizationPeriodRelease = new Promise((resolve) => {
    releaseOrganizationPeriod = resolve;
  });
  const heldOrganizationPeriod = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM "KnowledgeLlmBudgetPeriod"
        WHERE id = ${organizationFirstPeriod.id}
        FOR UPDATE
      `;
      signalOrganizationPeriodLocked();
      await organizationPeriodRelease;
    },
    { timeout: 15_000 },
  );
  await organizationPeriodLocked;
  const periodOrderReservation = lockOrderService.reserve(
    reservation({
      runId: 'run-period-order',
      userId: 'period-order-user',
      organizationId: 'period-order-org',
      keyHash: hash('e'),
      maximumCostMicros: 1n,
    }),
  );
  let periodOrderProbeError;
  try {
    await waitForNamedDatabaseLock(lockOrderApplicationName);
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(
          "SET LOCAL lock_timeout = '1000ms'",
        );
        await transaction.$queryRaw`
          SELECT id
          FROM "KnowledgeLlmBudgetPeriod"
          WHERE id = ${userSecondPeriod.id}
          FOR UPDATE
        `;
      },
      { timeout: 5_000 },
    );
  } catch (error) {
    periodOrderProbeError = error;
  } finally {
    releaseOrganizationPeriod();
  }
  const periodOrderResults = await Promise.allSettled([
    heldOrganizationPeriod,
    periodOrderReservation,
  ]);
  await lockOrderPrisma.$disconnect();
  if (periodOrderProbeError) throw periodOrderProbeError;
  for (const result of periodOrderResults) {
    if (result.status === 'rejected') throw result.reason;
  }
  assert.equal(periodOrderResults[1].value.ok, true);

  // Inactive policy versions can retain a current-window period. Their IDs
  // and the active user/organization period IDs may have opposite subject
  // order, so admission must lock the complete union in one global ID order.
  // The database supplies the accounting clock, therefore this deterministic
  // race test uses the actual current monthly window rather than a future
  // application-injected month boundary.
  await policy({
    id: 'policy-historical-period-order-user-v1',
    subjectType: 'user',
    subjectId: 'historical-period-order-user',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
  });
  await policy({
    id: 'policy-historical-period-order-org-v1',
    subjectType: 'organization',
    subjectId: 'historical-period-order-org',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
  });
  await prisma.knowledgeLlmBudgetPolicy.updateMany({
    where: {
      id: {
        in: [
          'policy-historical-period-order-user-v1',
          'policy-historical-period-order-org-v1',
        ],
      },
    },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await policy({
    id: 'policy-historical-period-order-user-v2',
    subjectType: 'user',
    subjectId: 'historical-period-order-user',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
    version: 2,
  });
  await policy({
    id: 'policy-historical-period-order-org-v2',
    subjectType: 'organization',
    subjectId: 'historical-period-order-org',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
    version: 2,
  });
  const historicalBoundaryNow = new Date(now);
  const historicalCurrentWindow = knowledgeLlmMonthlyPeriod(
    historicalBoundaryNow,
    'UTC',
  );
  const historicalOrganizationFirst =
    await prisma.knowledgeLlmBudgetPeriod.create({
      data: {
        id: '00000000-historical-version-organization',
        policyId: 'policy-historical-period-order-org-v1',
        periodStartUtc: historicalCurrentWindow.start,
        periodEndUtc: historicalCurrentWindow.end,
        timezone: 'UTC',
        currency: 'JPY',
      },
    });
  await prisma.knowledgeLlmBudgetPeriod.createMany({
    data: [
      {
        id: '10000000-historical-current-user',
        policyId: 'policy-historical-period-order-user-v2',
        periodStartUtc: historicalCurrentWindow.start,
        periodEndUtc: historicalCurrentWindow.end,
        timezone: 'UTC',
        currency: 'JPY',
      },
      {
        id: '20000000-historical-current-organization',
        policyId: 'policy-historical-period-order-org-v2',
        periodStartUtc: historicalCurrentWindow.start,
        periodEndUtc: historicalCurrentWindow.end,
        timezone: 'UTC',
        currency: 'JPY',
      },
      {
        id: 'zzzzzzzz-historical-version-user',
        policyId: 'policy-historical-period-order-user-v1',
        periodStartUtc: historicalCurrentWindow.start,
        periodEndUtc: historicalCurrentWindow.end,
        timezone: 'UTC',
        currency: 'JPY',
      },
    ],
  });
  const historicalLockApplicationName =
    'erp4-knowledge-llm-historical-period-order';
  const historicalLockUrl = new URL(process.env.DATABASE_URL);
  historicalLockUrl.searchParams.set(
    'application_name',
    historicalLockApplicationName,
  );
  const historicalLockPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: historicalLockUrl.toString() }),
  });
  const historicalLockService = createKnowledgeLlmBudgetUseCases(
    new PrismaKnowledgeLlmBudgetAdapter(historicalLockPrisma),
    { version: 1, models: catalogModels },
    stubProvider,
    () => new Date(historicalBoundaryNow.getTime()),
  );
  let signalHistoricalOrganizationPeriodLocked;
  const historicalOrganizationPeriodLocked = new Promise((resolve) => {
    signalHistoricalOrganizationPeriodLocked = resolve;
  });
  let releaseHistoricalOrganizationPeriod;
  const historicalOrganizationPeriodRelease = new Promise((resolve) => {
    releaseHistoricalOrganizationPeriod = resolve;
  });
  const heldHistoricalOrganizationPeriod = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM "KnowledgeLlmBudgetPeriod"
        WHERE id = ${historicalOrganizationFirst.id}
        FOR UPDATE
      `;
      signalHistoricalOrganizationPeriodLocked();
      await historicalOrganizationPeriodRelease;
    },
    { timeout: 15_000 },
  );
  await historicalOrganizationPeriodLocked;
  const historicalPeriodOrderReservation = historicalLockService.reserve(
    reservation({
      runId: 'run-historical-period-order',
      userId: 'historical-period-order-user',
      organizationId: 'historical-period-order-org',
      keyHash: hash('0'),
      maximumCostMicros: 1n,
    }),
  );
  let historicalPeriodOrderProbeError;
  try {
    await waitForNamedDatabaseLock(historicalLockApplicationName);
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(
          "SET LOCAL lock_timeout = '1000ms'",
        );
        await transaction.$queryRaw`
          SELECT id
          FROM "KnowledgeLlmBudgetPeriod"
          WHERE id = 'zzzzzzzz-historical-version-user'
          FOR UPDATE
        `;
      },
      { timeout: 5_000 },
    );
  } catch (error) {
    historicalPeriodOrderProbeError = error;
  } finally {
    releaseHistoricalOrganizationPeriod();
  }
  const historicalPeriodOrderResults = await Promise.allSettled([
    heldHistoricalOrganizationPeriod,
    historicalPeriodOrderReservation,
  ]);
  await historicalLockPrisma.$disconnect();
  if (historicalPeriodOrderProbeError) throw historicalPeriodOrderProbeError;
  for (const result of historicalPeriodOrderResults) {
    if (result.status === 'rejected') throw result.reason;
  }
  assert.equal(historicalPeriodOrderResults[1].value.ok, true);

  await policy({
    id: 'policy-org-user',
    subjectType: 'user',
    subjectId: 'org-user',
    soft: 100n,
    hard: 200n,
  });
  await policy({
    id: 'policy-org',
    subjectType: 'organization',
    subjectId: 'synthetic-org',
    soft: 100n,
    hard: 200n,
    timezone: 'UTC',
  });
  const organization = await service.reserve(
    reservation({
      runId: 'run-org',
      userId: 'org-user',
      organizationId: 'synthetic-org',
      keyHash: hash('3'),
      maximumCostMicros: 25n,
    }),
  );
  assert.equal(organization.ok, true);
  assert.equal(
    await prisma.knowledgeLlmReservation.count({ where: { runId: 'run-org' } }),
    2,
  );

  const organizationSourceRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-org' },
    include: {
      reservations: {
        include: { budgetPeriod: { include: { policy: true } } },
      },
    },
  });
  const organizationUserPeriod = organizationSourceRun.reservations.find(
    (entry) => entry.budgetPeriod.policy.subjectType === 'user',
  ).budgetPeriod;
  const organizationBudgetPeriod = organizationSourceRun.reservations.find(
    (entry) => entry.budgetPeriod.policy.subjectType === 'organization',
  ).budgetPeriod;
  const directOrganizationRunData = (runId, requestKeyHash) => {
    const data = directRunData({
      sourceRun: organizationSourceRun,
      runId,
      requestKeyHash,
      createdAt: now,
      budgetPeriodId: organizationUserPeriod.id,
    });
    delete data.reservations;
    return data;
  };
  await prisma.$transaction(async (transaction) => {
    // Seed two internally consistent run/request intents without reservations.
    // User triggers are disabled only for this owner-only ephemeral fixture;
    // each concurrent transaction below must satisfy the live reservation
    // admission and deferred consistency guards.
    await transaction.$executeRawUnsafe(
      'SET LOCAL session_replication_role = replica',
    );
    await transaction.knowledgeLlmRun.create({
      data: directOrganizationRunData(
        'run-direct-org-lock-order-a',
        knowledgeTextHash('llm-test-request-key', 'direct-org-lock-order-a'),
      ),
    });
    await transaction.knowledgeLlmRun.create({
      data: directOrganizationRunData(
        'run-direct-org-lock-order-b',
        knowledgeTextHash('llm-test-request-key', 'direct-org-lock-order-b'),
      ),
    });
    await transaction.$executeRawUnsafe(
      'SET LOCAL session_replication_role = origin',
    );
  });
  const directReservationData = (runId, budgetPeriodId) => ({
    runId,
    budgetPeriodId,
    maximumCostMicros: organizationSourceRun.maximumCostMicros,
    createdAt: now,
    updatedAt: now,
  });
  let signalFirstDirectReservation;
  const firstDirectReservationInserted = new Promise((resolve) => {
    signalFirstDirectReservation = resolve;
  });
  let releaseFirstDirectWriter;
  const firstDirectWriterRelease = new Promise((resolve) => {
    releaseFirstDirectWriter = resolve;
  });
  const firstDirectWriter = prisma.$transaction(
    async (transaction) => {
      await transaction.knowledgeLlmReservation.create({
        data: directReservationData(
          'run-direct-org-lock-order-a',
          organizationUserPeriod.id,
        ),
      });
      signalFirstDirectReservation();
      await firstDirectWriterRelease;
      await transaction.knowledgeLlmReservation.create({
        data: directReservationData(
          'run-direct-org-lock-order-a',
          organizationBudgetPeriod.id,
        ),
      });
    },
    { timeout: 15_000 },
  );
  await Promise.race([
    firstDirectReservationInserted,
    firstDirectWriter.then(
      () => {
        throw new Error(
          'knowledge_llm_first_direct_writer_finished_before_release',
        );
      },
      (error) => {
        throw error;
      },
    ),
  ]);
  const directOrganizationLockApplicationName =
    'erp4-knowledge-llm-direct-org-lock-order';
  const directOrganizationLockUrl = new URL(process.env.DATABASE_URL);
  directOrganizationLockUrl.searchParams.set(
    'application_name',
    directOrganizationLockApplicationName,
  );
  const directOrganizationLockPrisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: directOrganizationLockUrl.toString(),
    }),
  });
  const secondDirectWriter = directOrganizationLockPrisma.$transaction(
    async (transaction) => {
      await transaction.knowledgeLlmReservation.create({
        data: directReservationData(
          'run-direct-org-lock-order-b',
          organizationBudgetPeriod.id,
        ),
      });
      await transaction.knowledgeLlmReservation.create({
        data: directReservationData(
          'run-direct-org-lock-order-b',
          organizationUserPeriod.id,
        ),
      });
    },
    { timeout: 15_000 },
  );
  let directOrganizationLockProbeError;
  try {
    await waitForNamedDatabaseLock(directOrganizationLockApplicationName);
  } catch (error) {
    directOrganizationLockProbeError = error;
  } finally {
    releaseFirstDirectWriter();
  }
  const directOrganizationLockResults = await Promise.allSettled([
    firstDirectWriter,
    secondDirectWriter,
  ]);
  await directOrganizationLockPrisma.$disconnect();
  if (directOrganizationLockProbeError) {
    throw directOrganizationLockProbeError;
  }
  for (const result of directOrganizationLockResults) {
    if (result.status === 'rejected') throw result.reason;
  }
  assert.equal(
    await prisma.knowledgeLlmReservation.count({
      where: {
        runId: {
          in: ['run-direct-org-lock-order-a', 'run-direct-org-lock-order-b'],
        },
      },
    }),
    4,
  );

  await policy({
    id: 'policy-rate',
    subjectType: 'user',
    subjectId: 'rate-user',
    hard: 1000n,
    rate: 1,
  });
  assert.equal(
    (
      await service.reserve(
        reservation({
          runId: 'run-rate-first',
          userId: 'rate-user',
          keyHash: hash('5'),
          maximumCostMicros: 1n,
        }),
      )
    ).ok,
    true,
  );
  const rateBlocked = await service.reserve(
    reservation({
      runId: 'run-rate-second',
      userId: 'rate-user',
      keyHash: hash('7'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(rateBlocked.ok, false);
  assert.equal(rateBlocked.error.code, 'rate_limit');

  const boundaryNow = new Date('2026-09-01T00:15:00.000Z');
  const priorReservationAt = new Date('2026-08-31T23:45:00.000Z');
  await policy({
    id: 'policy-rate-boundary',
    subjectType: 'user',
    subjectId: 'rate-boundary-user',
    hard: 1000n,
    rate: 1,
    timezone: 'UTC',
  });
  const priorPeriod = await prisma.knowledgeLlmBudgetPeriod.create({
    data: {
      id: 'period-rate-boundary-prior',
      policyId: 'policy-rate-boundary',
      periodStartUtc: new Date('2026-08-01T00:00:00.000Z'),
      periodEndUtc: new Date('2026-09-01T00:00:00.000Z'),
      timezone: 'UTC',
      currency: 'JPY',
      createdAt: priorReservationAt,
      updatedAt: priorReservationAt,
    },
  });
  await prisma.$transaction(async (transaction) => {
    // Seed a synthetic request that was admitted in the prior month. The
    // production trigger must own accountedAt for live writes, so this
    // ephemeral owner-only fixture disables user triggers only while it
    // constructs an internally consistent historical ledger and counters.
    await transaction.$executeRawUnsafe(
      'SET LOCAL session_replication_role = replica',
    );
    await transaction.knowledgeLlmRun.create({
      data: {
        id: 'run-rate-boundary-prior',
        actorUserId: 'rate-boundary-user',
        scope: 'personal',
        provider: 'stub',
        model: 'stub-v1',
        catalogVersion: 1,
        promptTemplateVersion: 1,
        requestPayloadHash: hash('d'),
        providerRequestHash: hash('c'),
        selectedContextFingerprint: hash('e'),
        estimatedInputTokens: 10,
        maxOutputTokens: 10,
        inputCostMicrosPerMillion: 100_000n,
        outputCostMicrosPerMillion: 0n,
        maximumCostMicros: 1n,
        currency: 'JPY',
        createdAt: priorReservationAt,
        updatedAt: priorReservationAt,
        createdBy: 'rate-boundary-user',
        updatedBy: 'rate-boundary-user',
        request: {
          create: {
            requestKeyHash: hash('f'),
            requestPayloadHash: hash('d'),
            createdAt: priorReservationAt,
            createdBy: 'rate-boundary-user',
          },
        },
        reservations: {
          create: {
            budgetPeriodId: priorPeriod.id,
            maximumCostMicros: 1n,
            createdAt: priorReservationAt,
            accountedAt: priorReservationAt,
            updatedAt: priorReservationAt,
          },
        },
      },
    });
    await transaction.knowledgeLlmBudgetPeriod.update({
      where: { id: priorPeriod.id },
      data: {
        activeReservedMicros: 1n,
        acceptedRequestCount: 1,
        version: { increment: 1 },
        updatedAt: priorReservationAt,
      },
    });
    await transaction.$executeRawUnsafe(
      'SET LOCAL session_replication_role = origin',
    );
  });
  const boundaryService = createKnowledgeLlmBudgetUseCases(
    new PrismaKnowledgeLlmBudgetAdapter(prisma),
    { version: 1, models: catalogModels },
    stubProvider,
    () => new Date(boundaryNow.getTime()),
  );
  const boundaryRateBlocked = await boundaryService.reserve({
    ...reservation({
      runId: 'run-rate-boundary-current',
      userId: 'rate-boundary-user',
      keyHash: hash('0'),
      maximumCostMicros: 1n,
    }),
  });
  assert.equal(boundaryRateBlocked.ok, false);
  assert.equal(boundaryRateBlocked.error.code, 'rate_limit');
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-rate-boundary-current' },
    }),
    0,
  );

  await policy({
    id: 'policy-race',
    subjectType: 'user',
    subjectId: 'race-user',
    soft: 100n,
    hard: 100n,
  });
  const concurrent = await Promise.all([
    service.reserve(
      reservation({
        runId: 'run-race-a',
        userId: 'race-user',
        keyHash: hash('9'),
        maximumCostMicros: 60n,
      }),
    ),
    service.reserve(
      reservation({
        runId: 'run-race-b',
        userId: 'race-user',
        keyHash: hash('b'),
        maximumCostMicros: 60n,
      }),
    ),
  ]);
  assert.equal(concurrent.filter((result) => result.ok).length, 1);
  assert.equal(
    concurrent.filter(
      (result) => !result.ok && result.error.code === 'budget_hard_limit',
    ).length,
    1,
  );

  await policy({
    id: 'policy-settlement',
    subjectType: 'user',
    subjectId: 'settlement-user',
    soft: 1000n,
    hard: 2000n,
    rate: 100,
  });
  await policy({
    id: 'policy-released-counter-boundary',
    subjectType: 'user',
    subjectId: 'released-counter-boundary-user',
    soft: 8_000_000_000_000_000_000n,
    hard: 9_000_000_000_000_000_000n,
    rate: 10,
  });
  await policy({
    id: 'policy-token-ceiling-guard',
    subjectType: 'user',
    subjectId: 'token-ceiling-user',
    soft: 1_000n,
    hard: 2_000n,
    rate: 10,
  });
  const releasedCounterInputCost = 5_000_000_000_000_000_000n;
  const firstReleasedCounterReservation = await service.reserve(
    reservation({
      runId: 'run-released-counter-release',
      userId: 'released-counter-boundary-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'released-counter-release',
      ),
      maximumCostMicros: 5_000_000_000_000_000_000n,
      inputCostMicrosPerMillion: releasedCounterInputCost,
      estimatedInputTokens: 1_000_000,
    }),
  );
  assert.equal(firstReleasedCounterReservation.ok, true);
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: 'run-released-counter-release',
      actorUserId: 'released-counter-boundary-user',
      auditActor: terminalAuditActor(
        'released-counter-boundary-user',
        'released-counter-release',
      ),
      completedAt: after(700),
      settlement: { type: 'release', failureCode: 'disabled' },
    }),
  );
  const secondReleasedCounterReservation = await service.reserve(
    reservation({
      runId: 'run-released-counter-actual',
      userId: 'released-counter-boundary-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'released-counter-actual',
      ),
      maximumCostMicros: 5_000_000_000_000_000_000n,
      inputCostMicrosPerMillion: releasedCounterInputCost,
      estimatedInputTokens: 1_000_000,
    }),
  );
  assert.equal(secondReleasedCounterReservation.ok, true);
  await policy({
    id: 'policy-invalid-settlement-state',
    subjectType: 'user',
    subjectId: 'invalid-settlement-state-user',
    soft: 100n,
    hard: 100n,
  });
  const invalidFailedUnknownReservation = await service.reserve(
    reservation({
      runId: 'run-invalid-failed-unknown',
      userId: 'invalid-settlement-state-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'invalid-failed-unknown',
      ),
      maximumCostMicros: 10n,
    }),
  );
  assert.equal(invalidFailedUnknownReservation.ok, true);
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-invalid-failed-unknown',
        actorUserId: 'invalid-settlement-state-user',
        auditActor: terminalAuditActor(
          'invalid-settlement-state-user',
          'invalid-failed-unknown-dispatch',
        ),
        dispatchedAt: after(900),
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-invalid-failed-unknown',
        actorUserId: 'invalid-settlement-state-user',
        auditActor: terminalAuditActor(
          'invalid-settlement-state-user',
          'invalid-failed-unknown-settle',
        ),
        completedAt: after(950),
        settlement: {
          type: 'hold',
          executionStatus: 'failed',
          failureCode: 'connection_outcome_unknown',
        },
      });
    }),
    /knowledge_llm_settlement_invalid/,
  );
  assert.equal(
    (
      await prisma.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: 'run-invalid-failed-unknown' },
      })
    ).executionStatus,
    'reserved',
  );
  const settlementReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-actual',
      userId: 'settlement-user',
      keyHash: hash('f'),
      maximumCostMicros: 100n,
      inputCostMicrosPerMillion: 250_000n,
      outputCostMicrosPerMillion: 750_000n,
    }),
  );
  assert.equal(settlementReservation.ok, true);
  const settlementConversation = await prisma.$transaction(
    async (transaction) => {
      const conversation = await transaction.knowledgeConversation.create({
        data: {
          id: 'llm-settlement-conversation',
          ownerUserId: 'settlement-user',
          title: 'Synthetic settlement conversation',
          sourceType: 'manual',
          provider: 'stub',
          model: 'stub-v1',
          contentHash: hash('1'),
          createdBy: 'settlement-user',
          updatedBy: 'settlement-user',
        },
      });
      const user = await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 1,
          role: 'user',
          origin: 'user',
          content: 'Synthetic prompt',
          contentHash: conversationTurnHash('Synthetic prompt'),
          createdBy: 'settlement-user',
        },
      });
      const assistant = await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 2,
          role: 'assistant',
          origin: 'ai',
          content: 'Synthetic result',
          contentHash: conversationTurnHash('Synthetic result'),
          createdBy: 'settlement-user',
        },
      });
      const directGuardAssistant =
        await transaction.knowledgeConversationTurn.create({
          data: {
            conversationId: conversation.id,
            sequence: 3,
            role: 'assistant',
            origin: 'ai',
            content: 'Synthetic direct guard result',
            contentHash: conversationTurnHash('Synthetic direct guard result'),
            createdBy: 'settlement-user',
          },
        });
      return { conversation, user, assistant, directGuardAssistant };
    },
  );
  const releasedCounterConversation = await prisma.knowledgeConversation.create(
    {
      data: {
        id: 'llm-released-counter-conversation',
        ownerUserId: 'released-counter-boundary-user',
        title: 'Synthetic released counter conversation',
        sourceType: 'manual',
        provider: 'stub',
        model: 'stub-released-counter-boundary',
        contentHash: hash('2'),
        createdBy: 'released-counter-boundary-user',
        updatedBy: 'released-counter-boundary-user',
        turns: {
          create: {
            sequence: 1,
            role: 'assistant',
            origin: 'ai',
            content: 'Synthetic released counter result',
            contentHash: conversationTurnHash(
              'Synthetic released counter result',
            ),
            createdBy: 'released-counter-boundary-user',
          },
        },
      },
      include: { turns: true },
    },
  );
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-released-counter-actual',
      actorUserId: 'released-counter-boundary-user',
      auditActor: terminalAuditActor(
        'released-counter-boundary-user',
        'released-counter-actual-dispatch',
      ),
      dispatchedAt: after(710),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-released-counter-actual',
        status: 'valid',
        normalizedContent: 'Synthetic released counter result',
        contentHash: releasedCounterConversation.turns[0].contentHash,
        inputTokens: 1,
        outputTokens: 0,
        createdAt: after(720),
        capturedAt: after(720),
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId: 'run-released-counter-actual' },
      data: { normalizedContent: null, finalizedAt: after(730) },
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-released-counter-actual',
      actorUserId: 'released-counter-boundary-user',
      auditActor: terminalAuditActor(
        'released-counter-boundary-user',
        'released-counter-actual-settle',
      ),
      completedAt: after(740),
      settlement: {
        type: 'actual',
        actualInputTokens: 1,
        actualOutputTokens: 0,
        actualCostMicros: 5_000_000_000_000n,
        conversationId: releasedCounterConversation.id,
        assistantTurnId: releasedCounterConversation.turns[0].id,
      },
    });
  });
  const releasedCounterRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-released-counter-actual' },
    include: { reservations: true },
  });
  const releasedCounterPeriod =
    await prisma.knowledgeLlmBudgetPeriod.findUniqueOrThrow({
      where: { id: releasedCounterRun.reservations[0].budgetPeriodId },
    });
  assert.equal(
    releasedCounterPeriod.releasedMicros.toString(),
    '9999995000000000000',
  );

  const tokenCeilingConversation = await prisma.knowledgeConversation.create({
    data: {
      id: 'llm-token-ceiling-conversation',
      ownerUserId: 'token-ceiling-user',
      title: 'Synthetic token ceiling conversation',
      sourceType: 'manual',
      provider: 'stub',
      model: 'stub-zero-cost',
      contentHash: hash('3'),
      createdBy: 'token-ceiling-user',
      updatedBy: 'token-ceiling-user',
      turns: {
        create: [
          {
            sequence: 1,
            role: 'assistant',
            origin: 'ai',
            content: 'Synthetic input ceiling result',
            contentHash: conversationTurnHash('Synthetic input ceiling result'),
            createdBy: 'token-ceiling-user',
          },
          {
            sequence: 2,
            role: 'assistant',
            origin: 'ai',
            content: 'Synthetic output ceiling result',
            contentHash: conversationTurnHash(
              'Synthetic output ceiling result',
            ),
            createdBy: 'token-ceiling-user',
          },
        ],
      },
    },
    include: { turns: { orderBy: { sequence: 'asc' } } },
  });

  for (const [suffix, usage, assistant, economics] of [
    [
      'input',
      { inputTokens: 101, outputTokens: 0 },
      tokenCeilingConversation.turns[0],
      {
        maximumCostMicros: 0n,
        inputCostMicrosPerMillion: 0n,
        estimatedInputTokens: 100,
      },
    ],
    [
      'output',
      { inputTokens: 0, outputTokens: 101 },
      tokenCeilingConversation.turns[1],
      { maximumCostMicros: 100n },
    ],
  ]) {
    const runId = `run-${suffix}-token-ceiling`;
    const ceilingReservation = await service.reserve(
      reservation({
        runId,
        userId: 'token-ceiling-user',
        keyHash: knowledgeTextHash('llm-test-request-key', runId),
        ...economics,
      }),
    );
    assert.equal(ceilingReservation.ok, true);
    await prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId,
        actorUserId: 'token-ceiling-user',
        auditActor: terminalAuditActor(
          'token-ceiling-user',
          `${runId}-dispatch`,
        ),
        dispatchedAt: after(750),
      });
    });
    await assert.rejects(
      prisma.knowledgeLlmProviderOutcome.create({
        data: {
          runId,
          status: 'valid',
          normalizedContent: assistant.content,
          contentHash: assistant.contentHash,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          createdAt: after(760),
          capturedAt: after(760),
        },
      }),
      /usage exceeds run token ceiling/,
    );
    await prisma.$transaction(async (transaction) => {
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId,
          status: 'usage_unknown',
          normalizedContent: assistant.content,
          contentHash: assistant.contentHash,
          failureCode: 'usage_invalid',
          createdAt: after(765),
          capturedAt: after(765),
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId },
        data: { normalizedContent: null, finalizedAt: after(770) },
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId,
        actorUserId: 'token-ceiling-user',
        auditActor: terminalAuditActor('token-ceiling-user', `${runId}-hold`),
        completedAt: after(780),
        settlement: {
          type: 'hold',
          executionStatus: 'result_ready',
          failureCode: 'usage_invalid',
          conversationId: tokenCeilingConversation.id,
          assistantTurnId: assistant.id,
        },
      });
    });
    const heldCeilingRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
      where: { id: runId },
      include: { outcome: true, reservations: true },
    });
    assert.equal(heldCeilingRun.executionStatus, 'result_ready');
    assert.equal(heldCeilingRun.settlementStatus, 'held_maximum');
    assert.equal(heldCeilingRun.failureCode, 'usage_invalid');
    assert.equal(heldCeilingRun.outcome?.status, 'usage_unknown');
    assert.equal(heldCeilingRun.outcome?.normalizedContent, null);
    assert.equal(heldCeilingRun.outcome?.contentHash, assistant.contentHash);
    assert.ok(
      heldCeilingRun.reservations.every(
        (entry) => entry.status === 'held_maximum',
      ),
    );
  }
  const directCostGuardReservation = await service.reserve(
    reservation({
      runId: 'run-direct-cost-guard',
      userId: 'settlement-user',
      keyHash: knowledgeTextHash('llm-test-request-key', 'direct-cost-guard'),
      maximumCostMicros: 100n,
      inputCostMicrosPerMillion: 250_000n,
      outputCostMicrosPerMillion: 750_000n,
    }),
  );
  assert.equal(directCostGuardReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-direct-cost-guard',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-direct-cost-guard-dispatch',
      ),
      dispatchedAt: after(30_000),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-direct-cost-guard',
        status: 'valid',
        normalizedContent: 'Synthetic direct guard result',
        contentHash: settlementConversation.directGuardAssistant.contentHash,
        inputTokens: 80,
        outputTokens: 20,
        createdAt: after(31_000),
        capturedAt: after(31_000),
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId: 'run-direct-cost-guard' },
      data: { normalizedContent: null, finalizedAt: after(32_000) },
    });
  });
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-direct-cost-guard' },
      data: {
        executionStatus: 'result_ready',
        settlementStatus: 'settled_actual',
        conversationId: settlementConversation.conversation.id,
        assistantTurnId: settlementConversation.directGuardAssistant.id,
        actualInputTokens: 80,
        actualOutputTokens: 20,
        actualCostMicros: 0n,
        completedAt: after(33_000),
        updatedAt: after(33_000),
        updatedBy: 'synthetic-direct-writer',
      },
    }),
    /actual settlement cost mismatch/,
  );
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: 'run-direct-cost-guard',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-direct-cost-guard-settlement',
      ),
      completedAt: after(34_000),
      settlement: {
        type: 'actual',
        actualInputTokens: 80,
        actualOutputTokens: 20,
        actualCostMicros: 35n,
        conversationId: settlementConversation.conversation.id,
        assistantTurnId: settlementConversation.directGuardAssistant.id,
      },
    }),
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        dispatchedAt: after(1_000),
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        completedAt: after(2_000),
        settlement: {
          type: 'actual',
          actualInputTokens: 80,
          actualOutputTokens: 20,
          actualCostMicros: 35n,
          conversationId: settlementConversation.conversation.id,
          assistantTurnId: settlementConversation.assistant.id,
        },
      });
    }),
    /without_valid_outcome/,
  );
  assert.equal(
    (
      await prisma.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: 'run-settlement-actual' },
      })
    ).executionStatus,
    'reserved',
  );
  await assert.rejects(
    prisma.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-actual',
        status: 'valid',
        normalizedContent: null,
        contentHash: settlementConversation.assistant.contentHash,
        inputTokens: 80,
        outputTokens: 20,
        createdAt: after(1_500),
        capturedAt: after(1_500),
        finalizedAt: after(1_900),
      },
    }),
    /capture content before finalization/,
  );
  await assert.rejects(
    prisma.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-actual',
        status: 'valid',
        normalizedContent: 'Synthetic result',
        contentHash: conversationTurnHash('Different result'),
        inputTokens: 80,
        outputTokens: 20,
        createdAt: after(1_500),
        capturedAt: after(1_500),
      },
    }),
    /matching hash/,
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        dispatchedAt: after(1_000),
      });
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId: 'run-settlement-actual',
          status: 'valid',
          normalizedContent: 'Synthetic result',
          contentHash: settlementConversation.assistant.contentHash,
          inputTokens: 80,
          outputTokens: 20,
          createdAt: after(1_500),
          capturedAt: after(1_500),
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: 'run-settlement-actual' },
        data: { normalizedContent: null, finalizedAt: after(1_900) },
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        completedAt: after(2_000),
        settlement: {
          type: 'actual',
          actualInputTokens: 80,
          actualOutputTokens: 20,
          actualCostMicros: 0n,
          conversationId: settlementConversation.conversation.id,
          assistantTurnId: settlementConversation.assistant.id,
        },
      });
    }),
    /without_valid_outcome/,
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        dispatchedAt: after(1_000),
      });
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId: 'run-settlement-actual',
          status: 'valid',
          normalizedContent: 'Synthetic prompt',
          contentHash: settlementConversation.user.contentHash,
          inputTokens: 80,
          outputTokens: 20,
          createdAt: after(1_500),
          capturedAt: after(1_500),
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: 'run-settlement-actual' },
        data: { normalizedContent: null, finalizedAt: after(1_900) },
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        completedAt: after(2_000),
        settlement: {
          type: 'actual',
          actualInputTokens: 80,
          actualOutputTokens: 20,
          actualCostMicros: 35n,
          conversationId: settlementConversation.conversation.id,
          assistantTurnId: settlementConversation.user.id,
        },
      });
    }),
    /without_valid_outcome/,
  );
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-actual',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-actual',
      ),
      dispatchedAt: after(1_000),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-actual',
        status: 'valid',
        normalizedContent: 'Synthetic result',
        contentHash: settlementConversation.assistant.contentHash,
        inputTokens: 80,
        outputTokens: 20,
        createdAt: after(1_500),
        capturedAt: after(1_500),
      },
    });
  });
  let signalOutcomeLocked;
  const outcomeLocked = new Promise((resolve) => {
    signalOutcomeLocked = resolve;
  });
  let releaseOutcomeLock;
  const outcomeLockRelease = new Promise((resolve) => {
    releaseOutcomeLock = resolve;
  });
  const outcomeFinalization = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM "KnowledgeLlmProviderOutcome"
        WHERE "runId" = 'run-settlement-actual'
        FOR UPDATE
      `;
      signalOutcomeLocked();
      await outcomeLockRelease;
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: 'run-settlement-actual' },
        data: { normalizedContent: null, finalizedAt: after(1_900) },
      });
    },
    { timeout: 15_000 },
  );
  await outcomeLocked;

  let signalSettlementPid;
  const settlementPid = new Promise((resolve) => {
    signalSettlementPid = resolve;
  });
  const concurrentSettlement = prisma.$transaction(
    async (transaction) => {
      const [{ pid }] = await transaction.$queryRaw`
        SELECT pg_backend_pid()::INTEGER AS pid
      `;
      signalSettlementPid(pid);
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-settlement-actual',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-actual',
        ),
        completedAt: after(2_000),
        settlement: {
          type: 'actual',
          actualInputTokens: 80,
          actualOutputTokens: 20,
          actualCostMicros: 35n,
          conversationId: settlementConversation.conversation.id,
          assistantTurnId: settlementConversation.assistant.id,
        },
      });
    },
    { timeout: 15_000 },
  );
  let lockOrderProbeError;
  try {
    await waitForDatabaseLock(await settlementPid);
    await prisma.$transaction(
      (transaction) =>
        transaction.$queryRaw`
        SELECT id
        FROM "KnowledgeLlmRun"
        WHERE id = 'run-settlement-actual'
        FOR UPDATE NOWAIT
      `,
    );
  } catch (error) {
    lockOrderProbeError = error;
  } finally {
    releaseOutcomeLock();
  }
  const concurrentFinalizationResults = await Promise.allSettled([
    outcomeFinalization,
    concurrentSettlement,
  ]);
  if (lockOrderProbeError) throw lockOrderProbeError;
  for (const result of concurrentFinalizationResults) {
    if (result.status === 'rejected') throw result.reason;
  }
  const settled = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-actual' },
    include: { reservations: true },
  });
  assert.equal(settled.executionStatus, 'result_ready');
  assert.equal(settled.settlementStatus, 'settled_actual');
  assert.equal(settled.actualCostMicros, 35n);
  assert.equal(settled.reservations[0].status, 'settled_actual');
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-settlement-actual' },
      data: { dispatchedAt: after(50_000) },
    }),
    /dispatch timestamp is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-settlement-actual' },
      data: {
        updatedAt: after(50_000),
        updatedBy: 'synthetic-direct-writer',
      },
    }),
    /provenance updates require a state transition/,
  );
  const settledAfterProvenanceMutation =
    await prisma.knowledgeLlmRun.findUniqueOrThrow({
      where: { id: 'run-settlement-actual' },
    });
  assert.equal(
    settledAfterProvenanceMutation.updatedAt.getTime(),
    after(2_000).getTime(),
  );
  assert.equal(settledAfterProvenanceMutation.updatedBy, 'settlement-user');
  const settledPeriod = await prisma.knowledgeLlmBudgetPeriod.findUniqueOrThrow(
    {
      where: { id: settled.reservations[0].budgetPeriodId },
    },
  );
  assert.equal(settledPeriod.activeReservedMicros, 0n);
  // The same subject/period also contains the direct-cost-guard run. Both
  // reservations settle 100 maximum to 35 actual.
  assert.equal(settledPeriod.settledActualMicros, 70n);
  assert.equal(settledPeriod.releasedMicros.toString(), '130');
  await assert.rejects(
    prisma.knowledgeLlmReservation.update({
      where: { id: settled.reservations[0].id },
      data: { actualCostMicros: 34n },
    }),
    /accounting is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmReservation.update({
      where: { id: settled.reservations[0].id },
      data: { settledAt: after(30_000) },
    }),
    /accounting is immutable/,
  );

  const contextFreezeConversation = await prisma.knowledgeConversation.create({
    data: {
      id: 'llm-context-freeze-conversation',
      ownerUserId: 'settlement-user',
      title: 'Synthetic independent context',
      sourceType: 'manual',
      contentHash: hash('6'),
      createdBy: 'settlement-user',
      updatedBy: 'settlement-user',
      turns: {
        create: [
          {
            id: 'llm-context-freeze-user-turn',
            sequence: 1,
            role: 'user',
            origin: 'user',
            content: 'Synthetic independent prompt',
            contentHash: conversationTurnHash('Synthetic independent prompt'),
            createdBy: 'settlement-user',
          },
          {
            id: 'llm-context-freeze-assistant-turn',
            sequence: 2,
            role: 'assistant',
            origin: 'ai',
            content: 'Synthetic independent response',
            contentHash: conversationTurnHash('Synthetic independent response'),
            createdBy: 'settlement-user',
          },
        ],
      },
    },
    include: { turns: { orderBy: { sequence: 'asc' } } },
  });
  const contextFreezeUser = contextFreezeConversation.turns[0];
  const contextFreezeAssistant = contextFreezeConversation.turns[1];
  const contextFreezeSources = [
    {
      ordinal: 0,
      sourceType: 'conversation_turn',
      sourceId: contextFreezeAssistant.id,
      exactSourceVersion: contextFreezeAssistant.sequence,
      exactSourceHash: contextFreezeAssistant.contentHash,
      representation: contextFreezeAssistant.content,
      representationHash: knowledgeLlmContextRepresentationHash(
        contextFreezeAssistant.content,
      ),
      byteLength: Buffer.byteLength(contextFreezeAssistant.content, 'utf8'),
      estimatedTokens: knowledgeLlmContextEstimatedTokens(
        Buffer.byteLength(contextFreezeAssistant.content, 'utf8'),
      ),
    },
    {
      ordinal: 1,
      sourceType: 'conversation_turn',
      sourceId: contextFreezeUser.id,
      exactSourceVersion: contextFreezeUser.sequence,
      exactSourceHash: contextFreezeUser.contentHash,
      representation: contextFreezeUser.content,
      representationHash: knowledgeLlmContextRepresentationHash(
        contextFreezeUser.content,
      ),
      byteLength: Buffer.byteLength(contextFreezeUser.content, 'utf8'),
      estimatedTokens: knowledgeLlmContextEstimatedTokens(
        Buffer.byteLength(contextFreezeUser.content, 'utf8'),
      ),
    },
  ];
  const contextFreezeEstimatedTokens =
    contextFreezeSources.reduce(
      (sum, source) => sum + source.estimatedTokens,
      0,
    ) + 64;
  const contextFreezeReservation = await service.reserve(
    reservation({
      runId: 'run-context-freeze',
      userId: 'settlement-user',
      keyHash: conversationTurnHash('context-freeze-request-key'),
      maximumCostMicros: 1n,
      inputCostMicrosPerMillion: 1n,
      estimatedInputTokens: contextFreezeEstimatedTokens,
      selectedContextSources: contextFreezeSources,
    }),
  );
  assert.equal(contextFreezeReservation.ok, true);
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-context-freeze' },
      data: { conversationId: contextFreezeConversation.id },
    }),
    /conversation requires result transition|state_shape_check/,
  );
  const persistedContextSources =
    await prisma.knowledgeLlmContextSource.findMany({
      where: { runId: 'run-context-freeze' },
      orderBy: { ordinal: 'asc' },
    });
  assert.equal(persistedContextSources.length, 2);
  assert.deepEqual(
    persistedContextSources.map((source) => ({
      ordinal: source.ordinal,
      sourceType: source.sourceType,
      sourceConversationTurnId: source.sourceConversationTurnId,
      exactSourceVersion: source.exactSourceVersion,
      exactSourceHash: source.exactSourceHash,
      representationHash: source.representationHash,
    })),
    contextFreezeSources.map((source) => ({
      ordinal: source.ordinal,
      sourceType: source.sourceType,
      sourceConversationTurnId: source.sourceId,
      exactSourceVersion: source.exactSourceVersion,
      exactSourceHash: source.exactSourceHash,
      representationHash: source.representationHash,
    })),
  );
  await assert.rejects(
    prisma.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-context-freeze',
        status: 'invalid',
        failureCode: 'provider_4xx',
        createdAt: after(2_100),
        capturedAt: after(2_100),
      },
    }),
    /requires provider dispatch/,
  );
  const contextGapReservation = await service.reserve(
    reservation({
      runId: 'run-context-gap',
      userId: 'settlement-user',
      keyHash: conversationTurnHash('context-gap-request-key'),
      maximumCostMicros: 1n,
      inputCostMicrosPerMillion: 1n,
      estimatedInputTokens: 64,
      selectedContextSources: [],
    }),
  );
  assert.equal(contextGapReservation.ok, true);
  await prisma.knowledgeLlmContextSource.create({
    data: {
      id: 'context-freeze-ordinal-1',
      runId: 'run-context-gap',
      sourceType: 'conversation_turn',
      ordinal: 1,
      sourceConversationTurnId: contextFreezeUser.id,
      exactSourceVersion: contextFreezeSources[1].exactSourceVersion,
      exactSourceHash: contextFreezeSources[1].exactSourceHash,
      representationHash: contextFreezeSources[1].representationHash,
      byteLength: contextFreezeSources[1].byteLength,
      estimatedTokens: contextFreezeSources[1].estimatedTokens,
      createdBy: 'settlement-user',
    },
  });
  await assert.rejects(
    prisma.$transaction((transaction) =>
      markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-context-gap',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor('settlement-user', 'context-gap'),
        dispatchedAt: after(2_200),
      }),
    ),
    /dispatch_conflict/,
  );
  await assert.rejects(
    prisma.$transaction((transaction) =>
      markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-context-freeze',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'provider-request-mismatch',
        ),
        expectedProviderRequestHash: hash('f'),
        dispatchedAt: after(2_200),
      }),
    ),
    /dispatch_conflict/,
  );
  await prisma.$transaction((transaction) =>
    markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-context-freeze',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', 'context-dispatch'),
      dispatchedAt: after(2_200),
    }),
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-context-freeze' },
      data: { dispatchedAt: after(2_201) },
    }),
    /dispatch timestamp is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-context-freeze' },
      data: {
        executionStatus: 'failed',
        settlementStatus: 'held_maximum',
        failureCode: 'provider_5xx',
        completedAt: after(2_250),
        dispatchedAt: after(2_201),
      },
    }),
    /dispatch timestamp is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-context-freeze' },
      data: { settlementStatus: 'held_maximum' },
    }),
  );
  await assert.rejects(
    prisma.knowledgeLlmContextSource.create({
      data: {
        id: 'context-freeze-after-dispatch',
        runId: 'run-context-freeze',
        sourceType: 'conversation_turn',
        ordinal: 2,
        sourceConversationTurnId: settlementConversation.user.id,
        exactSourceVersion: settlementConversation.user.sequence,
        exactSourceHash: settlementConversation.user.contentHash,
        representationHash: settlementConversation.user.contentHash,
        byteLength: 10,
        estimatedTokens: 4,
        createdBy: 'settlement-user',
      },
    }),
    /cannot change after dispatch/,
  );
  await assert.rejects(
    prisma.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-context-freeze',
        status: 'invalid',
        failureCode: 'provider_4xx',
        createdAt: after(2_150),
        capturedAt: after(2_150),
      },
    }),
    /requires provider dispatch/,
  );
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: 'run-context-freeze',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', 'context-hold'),
      completedAt: after(2_300),
      settlement: {
        type: 'hold',
        executionStatus: 'failed',
        failureCode: 'provider_4xx',
      },
    }),
  );
  assert.equal(
    (
      await prisma.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: 'run-context-freeze' },
      })
    ).settlementStatus,
    'held_maximum',
  );

  await policy({
    id: 'policy-context-guard',
    subjectType: 'user',
    subjectId: 'context-guard-user',
    soft: 900_000n,
    hard: 1_000_000n,
    rate: 100,
  });
  const contextGuardConversation = await prisma.knowledgeConversation.create({
    data: {
      id: 'llm-context-guard-conversation',
      ownerUserId: 'context-guard-user',
      title: 'Synthetic context guard conversation',
      sourceType: 'manual',
      contentHash: hash('4'),
      createdBy: 'context-guard-user',
      updatedBy: 'context-guard-user',
    },
  });
  const contextGuardTurn = await prisma.knowledgeConversationTurn.create({
    data: {
      conversationId: contextGuardConversation.id,
      sequence: 1,
      role: 'user',
      origin: 'user',
      content: 'Synthetic exact context',
      contentHash: conversationTurnHash('Synthetic exact context'),
      createdBy: 'context-guard-user',
    },
  });

  async function reserveContextRun(
    runId,
    sources,
    reservationSources = sources,
  ) {
    const estimatedInputTokens =
      sources.reduce((sum, source) => sum + source.estimatedTokens, 0) + 64;
    const reserved = await service.reserve(
      reservation({
        runId,
        userId: 'context-guard-user',
        keyHash: knowledgeTextHash('llm-test-request-key', runId),
        maximumCostMicros: 1n,
        inputCostMicrosPerMillion: 1n,
        estimatedInputTokens,
        selectedContextSources: reservationSources,
      }),
    );
    assert.equal(
      reserved.ok,
      true,
      reserved.ok ? undefined : reserved.error.code,
    );
    if (reservationSources !== sources) {
      await prisma.knowledgeLlmContextSource.createMany({
        data: sources.map((source) => contextCreateData(runId, source)),
      });
    }
  }

  async function expectContextDispatchRejected(runId, pattern, suffix) {
    await assert.rejects(
      prisma.$transaction((transaction) =>
        markKnowledgeLlmRunDispatched(transaction, {
          runId,
          actorUserId: 'context-guard-user',
          auditActor: terminalAuditActor('context-guard-user', suffix),
          dispatchedAt: after(4_000),
        }),
      ),
      pattern,
    );
  }

  const validGuardSource = contextFromTurn(contextGuardTurn, 0);
  for (const [suffix, source] of [
    [
      'version',
      {
        ...validGuardSource,
        exactSourceVersion: validGuardSource.exactSourceVersion + 1,
      },
    ],
    ['hash', { ...validGuardSource, exactSourceHash: hash('9') }],
    [
      'representation',
      {
        ...validGuardSource,
        representation: 'Synthetic mismatched representation',
      },
    ],
  ]) {
    const runId = `run-context-invalid-${suffix}`;
    await reserveContextRun(runId, [source]);
    await expectContextDispatchRejected(
      runId,
      /context provenance is stale or invalid/,
      `context-invalid-${suffix}`,
    );
  }

  const ineligibleSystemTurn = await prisma.knowledgeConversationTurn.create({
    data: {
      conversationId: contextGuardConversation.id,
      sequence: 100,
      role: 'system',
      origin: 'system',
      content: 'Synthetic system context must remain ineligible',
      contentHash: conversationTurnHash(
        'Synthetic system context must remain ineligible',
      ),
      createdBy: 'context-guard-user',
    },
  });
  const ineligibleToolTurn = await prisma.knowledgeConversationTurn.create({
    data: {
      conversationId: contextGuardConversation.id,
      sequence: 101,
      role: 'tool',
      origin: 'tool',
      content: 'Synthetic tool context must remain ineligible',
      contentHash: conversationTurnHash(
        'Synthetic tool context must remain ineligible',
      ),
      createdBy: 'context-guard-user',
    },
  });
  for (const [suffix, turn] of [
    ['system', ineligibleSystemTurn],
    ['tool', ineligibleToolTurn],
  ]) {
    const runId = `run-context-ineligible-${suffix}-turn`;
    await reserveContextRun(runId, [contextFromTurn(turn, 0)]);
    await expectContextDispatchRejected(
      runId,
      /dispatch conversation source is not eligible/,
      `context-ineligible-${suffix}-turn`,
    );
  }

  assert.ok(
    await prisma.knowledgeLlmRun.count({
      where: { conversationId: settlementConversation.conversation.id },
    }),
  );
  await reserveContextRun('run-context-ineligible-llm-turn', [
    contextFromTurn(settlementConversation.user, 0),
  ]);
  await expectContextDispatchRejected(
    'run-context-ineligible-llm-turn',
    /dispatch conversation source is not eligible/,
    'context-ineligible-llm-turn',
  );

  async function createNestedLlmSynthesisContext({
    synthesisId,
    versionId,
    source,
  }) {
    const synthesis = await prisma.knowledgeSynthesis.create({
      data: {
        id: synthesisId,
        ownerUserId: 'context-guard-user',
        scope: 'personal',
        title: 'Synthetic LLM-derived synthesis',
        createdBy: 'context-guard-user',
        updatedBy: 'context-guard-user',
        versions: {
          create: {
            id: versionId,
            version: 1,
            content: 'Synthetic LLM-derived synthesis content',
            unresolvedQuestions: [],
            createdBy: 'context-guard-user',
            sources: {
              create: {
                relationType: 'supporting',
                ordinal: 0,
                createdBy: 'context-guard-user',
                ...source,
              },
            },
          },
        },
      },
      include: { versions: true },
    });
    const version = synthesis.versions[0];
    const byteLength = Buffer.byteLength(version.content, 'utf8');
    return {
      ordinal: 0,
      sourceType: 'synthesis_version',
      sourceId: version.id,
      exactSourceVersion: version.version,
      exactSourceHash: knowledgeTextHash('synthesis-version', version.content),
      representation: version.content,
      representationHash: knowledgeLlmContextRepresentationHash(
        version.content,
      ),
      byteLength,
      estimatedTokens: knowledgeLlmContextEstimatedTokens(byteLength),
    };
  }

  for (const [suffix, turn] of [
    ['system', ineligibleSystemTurn],
    ['tool', ineligibleToolTurn],
  ]) {
    const ineligibleRoleSynthesisContext =
      await createNestedLlmSynthesisContext({
        synthesisId: `context-${suffix}-turn-synthesis`,
        versionId: `context-${suffix}-turn-version`,
        source: { sourceConversationTurnId: turn.id },
      });
    const runId = `run-context-ineligible-${suffix}-turn-synthesis`;
    await reserveContextRun(runId, [ineligibleRoleSynthesisContext]);
    await expectContextDispatchRejected(
      runId,
      /dispatch synthesis source is not eligible/,
      `context-ineligible-${suffix}-turn-synthesis`,
    );
  }

  const ineligibleRoleConversationSynthesisContext =
    await createNestedLlmSynthesisContext({
      synthesisId: 'context-ineligible-role-conversation-synthesis',
      versionId: 'context-ineligible-role-conversation-version',
      source: { sourceConversationId: contextGuardConversation.id },
    });
  await reserveContextRun('run-context-ineligible-role-conversation-synthesis', [
    ineligibleRoleConversationSynthesisContext,
  ]);
  await expectContextDispatchRejected(
    'run-context-ineligible-role-conversation-synthesis',
    /dispatch synthesis source is not eligible/,
    'context-ineligible-role-conversation-synthesis',
  );

  const nestedLlmConversationContext = await createNestedLlmSynthesisContext({
    synthesisId: 'context-llm-conversation-synthesis',
    versionId: 'context-llm-conversation-version',
    source: {
      sourceConversationId: settlementConversation.conversation.id,
    },
  });
  await reserveContextRun('run-context-ineligible-llm-conversation-synthesis', [
    nestedLlmConversationContext,
  ]);
  await expectContextDispatchRejected(
    'run-context-ineligible-llm-conversation-synthesis',
    /dispatch synthesis source is not eligible/,
    'context-ineligible-llm-conversation-synthesis',
  );

  const nestedLlmTurnContext = await createNestedLlmSynthesisContext({
    synthesisId: 'context-llm-turn-synthesis',
    versionId: 'context-llm-turn-version',
    source: { sourceConversationTurnId: settlementConversation.user.id },
  });
  await reserveContextRun('run-context-ineligible-llm-turn-synthesis', [
    nestedLlmTurnContext,
  ]);
  await expectContextDispatchRejected(
    'run-context-ineligible-llm-turn-synthesis',
    /dispatch synthesis source is not eligible/,
    'context-ineligible-llm-turn-synthesis',
  );

  await reserveContextRun(
    'run-context-fingerprint-mismatch',
    [validGuardSource],
    [],
  );
  await expectContextDispatchRejected(
    'run-context-fingerprint-mismatch',
    /context fingerprint mismatch/,
    'context-fingerprint-mismatch',
  );

  const perTypeTurns = await Promise.all(
    Array.from({ length: 21 }, (_, index) => {
      const content = `Synthetic per-type context ${index}`;
      return prisma.knowledgeConversationTurn.create({
        data: {
          conversationId: contextGuardConversation.id,
          sequence: index + 2,
          role: 'user',
          origin: 'user',
          content,
          contentHash: conversationTurnHash(content),
          createdBy: 'context-guard-user',
        },
      });
    }),
  );
  await reserveContextRun(
    'run-context-per-type-bound',
    perTypeTurns.map((turn, ordinal) => contextFromTurn(turn, ordinal)),
    [],
  );
  await expectContextDispatchRejected(
    'run-context-per-type-bound',
    /context bounds exceeded/,
    'context-per-type-bound',
  );

  const aggregateTurns = await Promise.all(
    Array.from({ length: 5 }, (_, index) => {
      const content = `${index}${'x'.repeat(60_000)}`;
      return prisma.knowledgeConversationTurn.create({
        data: {
          conversationId: contextGuardConversation.id,
          sequence: index + 23,
          role: 'user',
          origin: 'user',
          content,
          contentHash: conversationTurnHash(content),
          createdBy: 'context-guard-user',
        },
      });
    }),
  );
  await reserveContextRun(
    'run-context-aggregate-bound',
    aggregateTurns.map((turn, ordinal) => contextFromTurn(turn, ordinal)),
    [],
  );
  await expectContextDispatchRejected(
    'run-context-aggregate-bound',
    /context bounds exceeded/,
    'context-aggregate-bound',
  );

  await prisma.knowledgeItem.createMany({
    data: Array.from({ length: 11 }, (_, index) => ({
      id: `context-selected-item-${index}`,
      ownerUserId: 'context-guard-user',
      scope: 'personal',
      sourceType: 'manual',
      title: `Synthetic selected item ${index}`,
      createdBy: 'context-guard-user',
      updatedBy: 'context-guard-user',
    })),
  });
  await prisma.knowledgeConversationItem.createMany({
    data: Array.from({ length: 11 }, (_, index) => ({
      id: `context-selected-link-${index}`,
      conversationId: contextGuardConversation.id,
      knowledgeItemId: `context-selected-item-${index}`,
      ownerUserId: 'context-guard-user',
      relationType: index === 0 ? 'primary' : 'context',
      ordinal: index,
      createdBy: 'context-guard-user',
    })),
  });
  await reserveContextRun('run-context-selected-item-bound', [
    validGuardSource,
  ]);
  await expectContextDispatchRejected(
    'run-context-selected-item-bound',
    /selected item bound exceeded/,
    'context-selected-item-bound',
  );

  const nestedSourceSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: 'context-nested-source-synthesis',
      ownerUserId: 'context-guard-user',
      scope: 'personal',
      title: 'Synthetic nested source',
      createdBy: 'context-guard-user',
      updatedBy: 'context-guard-user',
      versions: {
        create: {
          id: 'context-nested-source-version',
          version: 1,
          content: 'Synthetic nested source content',
          unresolvedQuestions: [],
          createdBy: 'context-guard-user',
        },
      },
    },
    include: { versions: true },
  });
  const nestedTargetSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: 'context-nested-target-synthesis',
      ownerUserId: 'context-guard-user',
      scope: 'personal',
      title: 'Synthetic nested target',
      createdBy: 'context-guard-user',
      updatedBy: 'context-guard-user',
      versions: {
        create: {
          id: 'context-nested-target-version',
          version: 1,
          content: 'Synthetic nested target content',
          unresolvedQuestions: [],
          createdBy: 'context-guard-user',
        },
      },
    },
    include: { versions: true },
  });
  await prisma.knowledgeSynthesisSource.create({
    data: {
      synthesisVersionId: nestedTargetSynthesis.versions[0].id,
      relationType: 'supporting',
      ordinal: 0,
      sourceSynthesisVersionId: nestedSourceSynthesis.versions[0].id,
      createdBy: 'context-guard-user',
    },
  });
  const nestedContent = nestedTargetSynthesis.versions[0].content;
  const nestedByteLength = Buffer.byteLength(nestedContent, 'utf8');
  const nestedContextSource = {
    ordinal: 0,
    sourceType: 'synthesis_version',
    sourceId: nestedTargetSynthesis.versions[0].id,
    exactSourceVersion: nestedTargetSynthesis.versions[0].version,
    exactSourceHash: knowledgeTextHash('synthesis-version', nestedContent),
    representation: nestedContent,
    representationHash: knowledgeLlmContextRepresentationHash(nestedContent),
    byteLength: nestedByteLength,
    estimatedTokens: knowledgeLlmContextEstimatedTokens(nestedByteLength),
  };
  await reserveContextRun('run-context-provenance-depth', [
    nestedContextSource,
  ]);
  await expectContextDispatchRejected(
    'run-context-provenance-depth',
    /context provenance depth exceeded/,
    'context-provenance-depth',
  );

  const turnHashReservation = await service.reserve(
    reservation({
      runId: 'run-turn-content-hash-mismatch',
      userId: 'settlement-user',
      keyHash: conversationTurnHash('turn-hash-request-key'),
      maximumCostMicros: 100n,
      inputCostMicrosPerMillion: 500_000n,
      outputCostMicrosPerMillion: 0n,
    }),
  );
  assert.equal(
    turnHashReservation.ok,
    true,
    turnHashReservation.ok ? undefined : turnHashReservation.error.code,
  );
  const mismatchedTurn = await prisma.knowledgeConversationTurn.create({
    data: {
      conversationId: settlementConversation.conversation.id,
      sequence: 4,
      role: 'assistant',
      origin: 'ai',
      content: 'Synthetic tampered displayed result',
      contentHash: conversationTurnHash('Synthetic captured provider result'),
      createdBy: 'settlement-user',
    },
  });
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-turn-content-hash-mismatch',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor('settlement-user', 'turn-hash-dispatch'),
        dispatchedAt: after(2_400),
      });
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId: 'run-turn-content-hash-mismatch',
          status: 'valid',
          normalizedContent: 'Synthetic captured provider result',
          contentHash: mismatchedTurn.contentHash,
          inputTokens: 1,
          outputTokens: 0,
          createdAt: after(2_500),
          capturedAt: after(2_500),
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: 'run-turn-content-hash-mismatch' },
        data: { normalizedContent: null, finalizedAt: after(2_600) },
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-turn-content-hash-mismatch',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor('settlement-user', 'turn-hash-settle'),
        completedAt: after(2_700),
        settlement: {
          type: 'actual',
          actualInputTokens: 1,
          actualOutputTokens: 0,
          actualCostMicros: 1n,
          conversationId: settlementConversation.conversation.id,
          assistantTurnId: mismatchedTurn.id,
        },
      });
    }),
    /without_valid_outcome/,
  );

  const heldReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-held',
      userId: 'settlement-user',
      keyHash: hash('4'),
      maximumCostMicros: 50n,
    }),
  );
  assert.equal(heldReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-held',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', 'run-settlement-held'),
      dispatchedAt: after(3_000),
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-held',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor('settlement-user', 'run-settlement-held'),
      completedAt: after(4_000),
      settlement: {
        type: 'hold',
        executionStatus: 'result_unknown',
        failureCode: 'timeout_outcome_unknown',
      },
    });
  });
  const held = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-held' },
    include: { reservations: { include: { budgetPeriod: true } } },
  });
  assert.equal(held.executionStatus, 'result_unknown');
  assert.equal(held.settlementStatus, 'held_maximum');
  assert.ok(held.reservations[0].budgetPeriod.heldMaximumMicros >= 50n);

  const usageUnknownReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-usage-unknown',
      userId: 'settlement-user',
      keyHash: hash('c'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(usageUnknownReservation.ok, true);
  const usageUnknownConversation = await prisma.$transaction(
    async (transaction) => {
      const conversation = await transaction.knowledgeConversation.create({
        data: {
          id: 'llm-usage-unknown-conversation',
          ownerUserId: 'settlement-user',
          title: 'Synthetic usage-unknown conversation',
          sourceType: 'manual',
          provider: 'stub',
          model: 'stub-v1',
          contentHash: hash('4'),
          createdBy: 'settlement-user',
          updatedBy: 'settlement-user',
        },
      });
      await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 1,
          role: 'user',
          origin: 'user',
          content: 'Synthetic usage-unknown prompt',
          contentHash: conversationTurnHash('Synthetic usage-unknown prompt'),
          createdBy: 'settlement-user',
        },
      });
      const assistant = await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 2,
          role: 'assistant',
          origin: 'ai',
          content: 'Synthetic usage-unknown result',
          contentHash: conversationTurnHash('Synthetic usage-unknown result'),
          createdBy: 'settlement-user',
        },
      });
      return { conversation, assistant };
    },
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-settlement-usage-unknown',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-usage-unknown',
        ),
        dispatchedAt: after(4_100),
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-settlement-usage-unknown',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-usage-unknown',
        ),
        completedAt: after(4_200),
        settlement: {
          type: 'hold',
          executionStatus: 'result_ready',
          failureCode: 'usage_missing',
          conversationId: usageUnknownConversation.conversation.id,
          assistantTurnId: usageUnknownConversation.assistant.id,
        },
      });
    }),
    /without_usage_unknown_outcome/,
  );
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-usage-unknown',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-usage-unknown',
      ),
      dispatchedAt: after(4_100),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-usage-unknown',
        status: 'usage_unknown',
        normalizedContent: 'Synthetic usage-unknown result',
        contentHash: usageUnknownConversation.assistant.contentHash,
        failureCode: 'usage_missing',
        createdAt: after(4_150),
        capturedAt: after(4_150),
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId: 'run-settlement-usage-unknown' },
      data: { normalizedContent: null, finalizedAt: after(4_175) },
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-usage-unknown',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-usage-unknown',
      ),
      completedAt: after(4_200),
      settlement: {
        type: 'hold',
        executionStatus: 'result_ready',
        failureCode: 'usage_missing',
        conversationId: usageUnknownConversation.conversation.id,
        assistantTurnId: usageUnknownConversation.assistant.id,
      },
    });
  });
  const usageUnknown = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-usage-unknown' },
  });
  assert.equal(usageUnknown.executionStatus, 'result_ready');
  assert.equal(usageUnknown.settlementStatus, 'held_maximum');
  assert.equal(usageUnknown.failureCode, 'usage_missing');
  await assert.rejects(
    prisma.knowledgeLlmUsageEvidence.create({
      data: {
        runId: 'run-settlement-usage-unknown',
        source: 'operator_billing',
        inputTokens: 20,
        outputTokens: 0,
        actualCostMicros: 10n,
        evidenceHash: hash('d'),
        createdAt: after(4_250),
        createdBy: 'settlement-user',
      },
    }),
    /verified held usage-unknown result/,
  );
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
        runId: 'run-settlement-usage-unknown',
        runActorUserId: 'settlement-user',
        operatorActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-usage-unknown-self-reconcile',
        ),
        source: 'operator_billing',
        evidenceHash: hash('d'),
        actualInputTokens: 20,
        actualOutputTokens: 0,
        completedAt: after(4_275),
      }),
    ),
    /usage_reconcile_conflict/,
  );
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
        runId: 'run-settlement-usage-unknown',
        runActorUserId: 'settlement-user',
        operatorActor: terminalAuditActor(
          'settlement-user\u200b',
          'run-settlement-usage-unknown-confusable-reconcile',
        ),
        source: 'operator_billing',
        evidenceHash: hash('d'),
        actualInputTokens: 20,
        actualOutputTokens: 0,
        completedAt: after(4_280),
      }),
    ),
    /usage_reconcile_invalid/,
  );
  const usageReconciliation = await Promise.all(
    [
      'run-settlement-usage-unknown-reconcile-a',
      'run-settlement-usage-unknown-reconcile-b',
    ].map((requestId) =>
      prisma.$transaction((transaction) =>
        reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
          runId: 'run-settlement-usage-unknown',
          runActorUserId: 'settlement-user',
          operatorActor: terminalAuditActor('billing-operator', requestId),
          source: 'operator_billing',
          evidenceHash: hash('d'),
          actualInputTokens: 20,
          actualOutputTokens: 0,
          completedAt: after(4_300),
        }),
      ),
    ),
  );
  assert.deepEqual(
    usageReconciliation.map((result) => result.actualCostMicros),
    [10n, 10n],
  );
  const usageReconciled = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-usage-unknown' },
    include: {
      usageEvidence: true,
      reservations: { include: { budgetPeriod: true } },
    },
  });
  assert.equal(usageReconciled.executionStatus, 'result_ready');
  assert.equal(usageReconciled.settlementStatus, 'settled_actual');
  assert.equal(usageReconciled.failureCode, null);
  assert.equal(usageReconciled.actualInputTokens, 20);
  assert.equal(usageReconciled.actualOutputTokens, 0);
  assert.equal(usageReconciled.actualCostMicros, 10n);
  assert.equal(usageReconciled.usageEvidence?.evidenceHash, hash('d'));
  assert.equal(usageReconciled.usageEvidence?.createdBy, 'billing-operator');
  assert.equal(usageReconciled.updatedBy, 'billing-operator');
  const operatorReconcileAudit = await prisma.auditLog.findFirstOrThrow({
    where: {
      action: 'knowledge_llm_reconciled',
      targetId: 'run-settlement-usage-unknown',
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(operatorReconcileAudit.userId, 'billing-operator');
  assert.equal(operatorReconcileAudit.actorRole, 'knowledge_billing_operator');
  assert.equal(
    operatorReconcileAudit.reasonCode,
    'knowledge_llm_operator_reconciled',
  );
  assert.equal(
    operatorReconcileAudit.metadata.operatorIntervention,
    'billing_evidence',
  );
  assert.equal(
    await prisma.auditLog.count({
      where: {
        action: 'knowledge_llm_reconciled',
        targetId: 'run-settlement-usage-unknown',
      },
    }),
    1,
  );
  assert.equal(usageReconciled.reservations[0].status, 'settled_actual');
  assert.ok(
    usageReconciled.reservations[0].budgetPeriod.heldMaximumMicros >= 0n,
  );
  const usageReplayed = await prisma.$transaction((transaction) =>
    reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
      runId: 'run-settlement-usage-unknown',
      runActorUserId: 'settlement-user',
      operatorActor: terminalAuditActor(
        'billing-operator',
        'run-settlement-usage-unknown-replay',
      ),
      source: 'operator_billing',
      evidenceHash: hash('d'),
      actualInputTokens: 20,
      actualOutputTokens: 0,
      completedAt: after(4_400),
    }),
  );
  assert.equal(usageReplayed.actualCostMicros, 10n);
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
        runId: 'run-settlement-usage-unknown',
        runActorUserId: 'settlement-user',
        operatorActor: terminalAuditActor(
          'billing-operator',
          'run-settlement-usage-unknown-conflict',
        ),
        source: 'operator_billing',
        evidenceHash: hash('e'),
        actualInputTokens: 20,
        actualOutputTokens: 0,
        completedAt: after(4_500),
      }),
    ),
    /usage_reconcile_conflict/,
  );
  await assert.rejects(
    prisma.knowledgeLlmUsageEvidence.update({
      where: { runId: 'run-settlement-usage-unknown' },
      data: { evidenceHash: hash('f') },
    }),
    /rows are immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmUsageEvidence.delete({
      where: { runId: 'run-settlement-usage-unknown' },
    }),
    /rows are immutable/,
  );

  const usageAuditReservation = await service.reserve(
    reservation({
      runId: 'run-usage-reconcile-audit-rollback',
      userId: 'settlement-user',
      keyHash: conversationTurnHash('usage-reconcile-audit-request-key'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(usageAuditReservation.ok, true);
  const usageAuditConversation = await prisma.$transaction(
    async (transaction) => {
      const conversation = await transaction.knowledgeConversation.create({
        data: {
          id: 'llm-usage-reconcile-audit-conversation',
          ownerUserId: 'settlement-user',
          title: 'Synthetic usage reconciliation audit rollback',
          sourceType: 'manual',
          provider: 'stub',
          model: 'stub-v1',
          contentHash: hash('5'),
          createdBy: 'settlement-user',
          updatedBy: 'settlement-user',
        },
      });
      await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 1,
          role: 'user',
          origin: 'user',
          content: 'Synthetic usage reconciliation audit prompt',
          contentHash: conversationTurnHash(
            'Synthetic usage reconciliation audit prompt',
          ),
          createdBy: 'settlement-user',
        },
      });
      const assistant = await transaction.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 2,
          role: 'assistant',
          origin: 'ai',
          content: 'Synthetic usage reconciliation audit result',
          contentHash: conversationTurnHash(
            'Synthetic usage reconciliation audit result',
          ),
          createdBy: 'settlement-user',
        },
      });
      return { conversation, assistant };
    },
  );
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-usage-reconcile-audit-rollback',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'usage-reconcile-audit-dispatch',
      ),
      dispatchedAt: after(4_600),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-usage-reconcile-audit-rollback',
        status: 'usage_unknown',
        normalizedContent: 'Synthetic usage reconciliation audit result',
        contentHash: usageAuditConversation.assistant.contentHash,
        failureCode: 'usage_missing',
        createdAt: after(4_650),
        capturedAt: after(4_650),
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId: 'run-usage-reconcile-audit-rollback' },
      data: { normalizedContent: null, finalizedAt: after(4_675) },
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-usage-reconcile-audit-rollback',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'usage-reconcile-audit-hold',
      ),
      completedAt: after(4_700),
      settlement: {
        type: 'hold',
        executionStatus: 'result_ready',
        failureCode: 'usage_missing',
        conversationId: usageAuditConversation.conversation.id,
        assistantTurnId: usageAuditConversation.assistant.id,
      },
    });
  });
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reconcileKnowledgeLlmUsageUnknownBudget(transaction, {
        runId: 'run-usage-reconcile-audit-rollback',
        runActorUserId: 'settlement-user',
        operatorActor: {
          ...terminalAuditActor(
            'billing-operator',
            'usage-reconcile-audit-invalid',
          ),
          requestId: '',
        },
        source: 'operator_billing',
        evidenceHash: hash('7'),
        actualInputTokens: 20,
        actualOutputTokens: 0,
        completedAt: after(4_800),
      }),
    ),
    /knowledge_llm_audit_invalid/,
  );
  const usageAuditRollback = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-usage-reconcile-audit-rollback' },
    include: { reservations: true, usageEvidence: true },
  });
  assert.equal(usageAuditRollback.settlementStatus, 'held_maximum');
  assert.equal(usageAuditRollback.failureCode, 'usage_missing');
  assert.equal(usageAuditRollback.usageEvidence, null);
  assert.equal(usageAuditRollback.reservations[0].status, 'held_maximum');

  const reconciliationReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-reconcile',
      userId: 'settlement-user',
      keyHash: hash('8'),
      maximumCostMicros: 60n,
      inputCostMicrosPerMillion: 250_000n,
      outputCostMicrosPerMillion: 350_000n,
    }),
  );
  assert.equal(reconciliationReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-reconcile',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-reconcile',
      ),
      dispatchedAt: after(5_000),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-reconcile',
        status: 'valid',
        normalizedContent: 'Synthetic normalized result',
        contentHash: conversationTurnHash('Synthetic normalized result'),
        inputTokens: 40,
        outputTokens: 10,
        createdAt: after(6_000),
        capturedAt: after(6_000),
      },
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-reconcile',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-reconcile',
      ),
      completedAt: after(7_000),
      settlement: {
        type: 'hold',
        executionStatus: 'result_unknown',
        failureCode: 'finalization_failed',
      },
    });
  });
  await assert.rejects(
    prisma.$transaction((transaction) =>
      reconcileKnowledgeLlmHeldBudget(transaction, {
        runId: 'run-settlement-reconcile',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-settlement-reconcile',
        ),
        completedAt: after(8_000),
        actualInputTokens: 40,
        actualOutputTokens: 10,
        actualCostMicros: 14n,
        conversationId: 'missing-conversation',
        assistantTurnId: 'missing-turn',
      }),
    ),
    /without_outcome/,
  );
  await prisma.$transaction(async (transaction) => {
    const conversation = await transaction.knowledgeConversation.create({
      data: {
        id: 'llm-reconciled-conversation',
        ownerUserId: 'settlement-user',
        title: 'Synthetic reconciled conversation',
        sourceType: 'manual',
        provider: 'stub',
        model: 'stub-v1',
        contentHash: hash('b'),
        createdBy: 'settlement-user',
        updatedBy: 'settlement-user',
      },
    });
    await transaction.knowledgeConversationTurn.create({
      data: {
        conversationId: conversation.id,
        sequence: 1,
        role: 'user',
        origin: 'user',
        content: 'Synthetic prompt',
        contentHash: conversationTurnHash('Synthetic prompt'),
        createdBy: 'settlement-user',
      },
    });
    const assistant = await transaction.knowledgeConversationTurn.create({
      data: {
        conversationId: conversation.id,
        sequence: 2,
        role: 'assistant',
        origin: 'ai',
        content: 'Synthetic normalized result',
        contentHash: conversationTurnHash('Synthetic normalized result'),
        createdBy: 'settlement-user',
      },
    });
    await transaction.knowledgeLlmProviderOutcome.update({
      where: { runId: 'run-settlement-reconcile' },
      data: { normalizedContent: null, finalizedAt: after(8_000) },
    });
    await reconcileKnowledgeLlmHeldBudget(transaction, {
      runId: 'run-settlement-reconcile',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-reconcile',
      ),
      completedAt: after(8_000),
      actualInputTokens: 40,
      actualOutputTokens: 10,
      actualCostMicros: 14n,
      conversationId: conversation.id,
      assistantTurnId: assistant.id,
    });
  });
  const reconciled = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-reconcile' },
    include: { reservations: { include: { budgetPeriod: true } } },
  });
  assert.equal(reconciled.executionStatus, 'result_ready');
  assert.equal(reconciled.settlementStatus, 'settled_actual');
  assert.equal(reconciled.actualCostMicros, 14n);
  assert.equal(reconciled.reservations[0].status, 'settled_actual');

  await exerciseResultUnknownReconciliation({
    runId: 'run-settlement-reconcile-timeout',
    keyCharacter: 'e',
    payloadCharacter: 'a',
    failureCode: 'timeout_outcome_unknown',
  });
  await exerciseResultUnknownReconciliation({
    runId: 'run-settlement-reconcile-connection',
    keyCharacter: '7',
    payloadCharacter: 'b',
    failureCode: 'connection_outcome_unknown',
  });

  const releaseReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-release',
      userId: 'settlement-user',
      keyHash: hash('6'),
      maximumCostMicros: 25n,
    }),
  );
  assert.equal(releaseReservation.ok, true);
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-release',
      actorUserId: 'settlement-user',
      auditActor: terminalAuditActor(
        'settlement-user',
        'run-settlement-release',
      ),
      completedAt: after(9_000),
      settlement: {
        type: 'release',
        failureCode: 'rejected_before_dispatch',
      },
    }),
  );
  const released = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-release' },
  });
  assert.equal(released.executionStatus, 'failed');
  assert.equal(released.settlementStatus, 'released');

  const invalidProviderRelease = await service.reserve(
    reservation({
      runId: 'run-invalid-provider-release',
      userId: 'settlement-user',
      keyHash: hash('0'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(invalidProviderRelease.ok, true);
  await assert.rejects(
    prisma.$transaction((transaction) =>
      settleKnowledgeLlmBudget(transaction, {
        runId: 'run-invalid-provider-release',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-invalid-provider-release',
        ),
        completedAt: after(10_000),
        settlement: { type: 'release', failureCode: 'provider_4xx' },
      }),
    ),
    /settlement_invalid/,
  );

  const invalidPredispatchHold = await service.reserve(
    reservation({
      runId: 'run-invalid-predispatch-hold',
      userId: 'settlement-user',
      keyHash: hash('2'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(invalidPredispatchHold.ok, true);
  await assert.rejects(
    prisma.$transaction((transaction) =>
      settleKnowledgeLlmBudget(transaction, {
        runId: 'run-invalid-predispatch-hold',
        actorUserId: 'settlement-user',
        auditActor: terminalAuditActor(
          'settlement-user',
          'run-invalid-predispatch-hold',
        ),
        completedAt: after(11_000),
        settlement: {
          type: 'hold',
          executionStatus: 'result_unknown',
          failureCode: 'connection_outcome_unknown',
        },
      }),
    ),
    /settlement_invalid/,
  );

  await assert.rejects(
    policy({
      id: 'policy-personal-version-2-active',
      subjectType: 'user',
      subjectId: 'budget-user',
    }),
  );
  const guardedPolicy = await policy({
    id: 'policy-guard',
    subjectType: 'user',
    subjectId: 'policy-guard-user',
  });
  await assert.rejects(
    prisma.knowledgeLlmBudgetPolicy.update({
      where: { id: guardedPolicy.id },
      data: { hardLimitMicros: 101n, updatedBy: 'synthetic-admin' },
    }),
    /versions are immutable/,
  );
  await prisma.knowledgeLlmBudgetPolicy.update({
    where: { id: guardedPolicy.id },
    data: { active: false, updatedBy: 'synthetic-admin' },
  });
  await assert.rejects(
    prisma.knowledgeLlmBudgetPolicy.update({
      where: { id: guardedPolicy.id },
      data: { active: true, updatedBy: 'synthetic-admin' },
    }),
    /versions are immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmBudgetPeriod.update({
      where: { id: settledPeriod.id },
      data: { timezone: 'UTC', version: { increment: 1 } },
    }),
    /boundary or monotonic counter changed/,
  );
  const firstRequest = await prisma.knowledgeLlmRequest.findUniqueOrThrow({
    where: { runId: 'run-first' },
  });
  await assert.rejects(
    prisma.knowledgeLlmRequest.update({
      where: { id: firstRequest.id },
      data: { requestPayloadHash: hash('9') },
    }),
    /rows are immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmContextSource.create({
      data: {
        id: 'invalid-context-source',
        runId: 'run-first',
        sourceType: 'snapshot',
        ordinal: 0,
        exactSourceVersion: 1,
        exactSourceHash: hash('1'),
        representationHash: hash('2'),
        byteLength: 10,
        estimatedTokens: 20,
        createdBy: 'budget-user',
      },
    }),
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-first' },
      data: { inputCostMicrosPerMillion: 1n },
    }),
    /request boundary is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: 'run-first' },
      data: {
        executionStatus: 'result_ready',
        settlementStatus: 'settled_actual',
      },
    }),
  );

  await policy({
    id: 'policy-terminal-audit-rollback',
    subjectType: 'user',
    subjectId: 'terminal-audit-rollback-user',
    hard: 1000n,
  });
  assert.equal(
    (
      await service.reserve(
        reservation({
          runId: 'run-terminal-audit-rollback',
          userId: 'terminal-audit-rollback-user',
          keyHash: hash('1'),
          maximumCostMicros: 10n,
        }),
      )
    ).ok,
    true,
  );
  await assert.rejects(
    prisma.$transaction((transaction) =>
      markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-terminal-audit-rollback',
        actorUserId: 'terminal-audit-rollback-user',
        auditActor: { userId: 'terminal-audit-rollback-user' },
        dispatchedAt: after(12_000),
      }),
    ),
    /knowledge_llm_audit_invalid/,
  );
  assert.equal(
    (
      await prisma.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: 'run-terminal-audit-rollback' },
      })
    ).executionStatus,
    'reserved',
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await markKnowledgeLlmRunDispatched(transaction, {
        runId: 'run-terminal-audit-rollback',
        actorUserId: 'terminal-audit-rollback-user',
        auditActor: terminalAuditActor(
          'terminal-audit-rollback-user',
          'run-terminal-audit-rollback',
        ),
        dispatchedAt: after(12_000),
      });
      await settleKnowledgeLlmBudget(transaction, {
        runId: 'run-terminal-audit-rollback',
        actorUserId: 'terminal-audit-rollback-user',
        auditActor: { userId: 'terminal-audit-rollback-user' },
        completedAt: after(13_000),
        settlement: {
          type: 'hold',
          executionStatus: 'result_unknown',
          failureCode: 'connection_outcome_unknown',
        },
      });
    }),
    /knowledge_llm_audit_invalid/,
  );
  const terminalAuditRollback = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-terminal-audit-rollback' },
    include: { reservations: true },
  });
  assert.equal(terminalAuditRollback.executionStatus, 'reserved');
  assert.equal(terminalAuditRollback.settlementStatus, 'reserved');
  assert.equal(terminalAuditRollback.reservations[0].status, 'reserved');

  await policy({
    id: 'policy-missing-request-ledger',
    subjectType: 'user',
    subjectId: 'missing-request-ledger-user',
    hard: 1000n,
  });
  const missingRequestLedgerReservation = await service.reserve(
    reservation({
      runId: 'run-missing-request-ledger',
      userId: 'missing-request-ledger-user',
      keyHash: knowledgeTextHash(
        'llm-test-request-key',
        'missing-request-ledger-key',
      ),
      maximumCostMicros: 10n,
    }),
  );
  assert.equal(
    missingRequestLedgerReservation.ok,
    true,
    missingRequestLedgerReservation.ok
      ? undefined
      : missingRequestLedgerReservation.error.code,
  );
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      // Simulate a direct database writer that created an otherwise complete
      // run but omitted its immutable request ledger. The DDL and delete are
      // transaction-local and roll back with the expected dispatch failure.
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "KnowledgeLlmRequest" DISABLE TRIGGER "KnowledgeLlmRequest_immutable"',
      );
      await transaction.knowledgeLlmRequest.delete({
        where: { runId: 'run-missing-request-ledger' },
      });
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "KnowledgeLlmRequest" ENABLE TRIGGER "KnowledgeLlmRequest_immutable"',
      );
      await transaction.$executeRaw`
        UPDATE "KnowledgeLlmRun"
        SET "executionStatus" = 'dispatched',
          "dispatchedAt" = ${after(12_500)},
          "updatedAt" = ${after(12_500)},
          "updatedBy" = 'missing-request-ledger-user'
        WHERE id = 'run-missing-request-ledger'
      `;
    }),
    /dispatch requires matching request ledger/,
  );
  assert.equal(
    await prisma.knowledgeLlmRequest.count({
      where: { runId: 'run-missing-request-ledger' },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: 'run-missing-request-ledger' },
      })
    ).executionStatus,
    'reserved',
  );

  await policy({
    id: 'policy-audit-rollback',
    subjectType: 'user',
    subjectId: 'audit-rollback-user',
    hard: 1000n,
  });
  await assert.rejects(
    service.reserve({
      ...reservation({
        runId: 'run-audit-rollback',
        userId: 'audit-rollback-user',
        keyHash: hash('d'),
        maximumCostMicros: 1n,
      }),
      auditActor: {},
    }),
    /knowledge_llm_audit_invalid/,
  );
  assert.equal(
    await prisma.knowledgeLlmRun.count({
      where: { id: 'run-audit-rollback' },
    }),
    0,
  );

  const lateReservation = await service.reserve(
    reservation({
      runId: 'run-late-reservation-insert',
      userId: 'settlement-user',
      keyHash: conversationTurnHash('late-reservation-request-key'),
      maximumCostMicros: 10n,
    }),
  );
  assert.equal(lateReservation.ok, true);
  const lateRun = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-late-reservation-insert' },
    include: { reservations: { include: { budgetPeriod: true } } },
  });
  const directlyMutableReservation = lateRun.reservations[0];
  const directMutationAccountingBefore = {
    active: directlyMutableReservation.budgetPeriod.activeReservedMicros,
    settled: directlyMutableReservation.budgetPeriod.settledActualMicros,
    held: directlyMutableReservation.budgetPeriod.heldMaximumMicros,
    released: directlyMutableReservation.budgetPeriod.releasedMicros.toString(),
    version: directlyMutableReservation.budgetPeriod.version,
  };
  await assert.rejects(
    prisma.knowledgeLlmReservation.update({
      where: { id: directlyMutableReservation.id },
      data: {
        status: 'released',
        settledAt: after(16_000),
        updatedAt: after(16_000),
      },
    }),
    /settlement must match its terminal run/,
  );
  await assert.rejects(
    prisma.knowledgeLlmReservation.update({
      where: { id: directlyMutableReservation.id },
      data: { accountedAt: untrustedTimestampCanary },
    }),
    /boundary is immutable/,
  );
  await assert.rejects(
    prisma.knowledgeLlmRun.update({
      where: { id: lateRun.id },
      data: {
        executionStatus: 'failed',
        settlementStatus: 'released',
        failureCode: 'disabled',
        completedAt: after(16_000),
        updatedAt: after(16_000),
        updatedBy: lateRun.actorUserId,
      },
    }),
    /run and reservations must settle atomically/i,
  );
  await assert.rejects(
    prisma.knowledgeLlmBudgetPeriod.update({
      where: { id: directlyMutableReservation.budgetPeriodId },
      data: {
        releasedMicros: { increment: '1' },
        version: { increment: 1 },
      },
    }),
    /counters may change only through reservation transitions/,
  );
  const directMutationRunAfter = await prisma.knowledgeLlmRun.findUniqueOrThrow(
    {
      where: { id: lateRun.id },
      include: { reservations: { include: { budgetPeriod: true } } },
    },
  );
  assert.equal(directMutationRunAfter.executionStatus, 'reserved');
  assert.equal(directMutationRunAfter.settlementStatus, 'reserved');
  assert.equal(directMutationRunAfter.reservations[0].status, 'reserved');
  assert.deepEqual(
    {
      active:
        directMutationRunAfter.reservations[0].budgetPeriod
          .activeReservedMicros,
      settled:
        directMutationRunAfter.reservations[0].budgetPeriod.settledActualMicros,
      held: directMutationRunAfter.reservations[0].budgetPeriod
        .heldMaximumMicros,
      released:
        directMutationRunAfter.reservations[0].budgetPeriod.releasedMicros.toString(),
      version: directMutationRunAfter.reservations[0].budgetPeriod.version,
    },
    directMutationAccountingBefore,
  );
  const lateReservationPolicy =
    await prisma.knowledgeLlmBudgetPolicy.findUniqueOrThrow({
      where: { id: lateRun.reservations[0].budgetPeriod.policyId },
    });
  await prisma.knowledgeLlmBudgetPolicy.create({
    data: {
      id: 'policy-late-reservation-insert',
      subjectType: lateReservationPolicy.subjectType,
      subjectId: lateReservationPolicy.subjectId,
      currency: lateReservationPolicy.currency,
      timezone: lateReservationPolicy.timezone,
      softLimitMicros: lateReservationPolicy.softLimitMicros,
      hardLimitMicros: lateReservationPolicy.hardLimitMicros,
      requestsPerHour: lateReservationPolicy.requestsPerHour,
      version: lateReservationPolicy.version + 100,
      active: false,
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
  const latePeriod = await prisma.knowledgeLlmBudgetPeriod.create({
    data: {
      id: 'period-late-reservation-insert',
      policyId: 'policy-late-reservation-insert',
      periodStartUtc: lateRun.reservations[0].budgetPeriod.periodStartUtc,
      periodEndUtc: lateRun.reservations[0].budgetPeriod.periodEndUtc,
      timezone: lateRun.reservations[0].budgetPeriod.timezone,
      currency: lateRun.currency,
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 1_000),
    },
  });
  await prisma.$transaction((transaction) =>
    markKnowledgeLlmRunDispatched(transaction, {
      runId: lateRun.id,
      actorUserId: lateRun.actorUserId,
      auditActor: terminalAuditActor(
        lateRun.actorUserId,
        'late-reservation-dispatch',
      ),
      dispatchedAt: after(17_000),
    }),
  );
  const assertLateReservationRejected = async (id) => {
    await assert.rejects(
      prisma.knowledgeLlmReservation.create({
        data: {
          id,
          runId: lateRun.id,
          budgetPeriodId: latePeriod.id,
          maximumCostMicros: lateRun.maximumCostMicros,
          createdAt: lateRun.createdAt,
          updatedAt: lateRun.createdAt,
        },
      }),
      /must be created with its initial run and matching budget subject/,
    );
    const unchanged = await prisma.knowledgeLlmBudgetPeriod.findUniqueOrThrow({
      where: { id: latePeriod.id },
    });
    assert.equal(unchanged.activeReservedMicros, 0n);
    assert.equal(unchanged.acceptedRequestCount, 0);
  };
  await assertLateReservationRejected('late-reservation-dispatched');
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: lateRun.id,
      actorUserId: lateRun.actorUserId,
      auditActor: terminalAuditActor(
        lateRun.actorUserId,
        'late-reservation-terminal',
      ),
      completedAt: after(18_000),
      settlement: {
        type: 'hold',
        executionStatus: 'failed',
        failureCode: 'provider_4xx',
      },
    }),
  );
  await assertLateReservationRejected('late-reservation-terminal');

  for (const status of ['reserved', 'held_maximum', 'settled_actual']) {
    const immutableReservation =
      await prisma.knowledgeLlmReservation.findFirstOrThrow({
        where: { status },
        include: { budgetPeriod: true },
      });
    const accountingBefore = {
      active: immutableReservation.budgetPeriod.activeReservedMicros,
      settled: immutableReservation.budgetPeriod.settledActualMicros,
      held: immutableReservation.budgetPeriod.heldMaximumMicros,
      released: immutableReservation.budgetPeriod.releasedMicros.toString(),
      count: immutableReservation.budgetPeriod.acceptedRequestCount,
    };
    await assert.rejects(
      prisma.knowledgeLlmReservation.delete({
        where: { id: immutableReservation.id },
      }),
      /KnowledgeLlmReservation cannot be deleted/,
    );
    assert.equal(
      await prisma.knowledgeLlmReservation.count({
        where: { id: immutableReservation.id },
      }),
      1,
    );
    const periodAfter = await prisma.knowledgeLlmBudgetPeriod.findUniqueOrThrow(
      { where: { id: immutableReservation.budgetPeriodId } },
    );
    assert.deepEqual(
      {
        active: periodAfter.activeReservedMicros,
        settled: periodAfter.settledActualMicros,
        held: periodAfter.heldMaximumMicros,
        released: periodAfter.releasedMicros.toString(),
        count: periodAfter.acceptedRequestCount,
      },
      accountingBefore,
    );
  }

  const audits = await prisma.auditLog.findMany({
    where: { action: { startsWith: 'knowledge_llm_' } },
    select: { action: true, metadata: true },
  });
  assert.ok(
    audits.some((entry) => entry.action === 'knowledge_llm_budget_reserved'),
  );
  assert.ok(
    audits.some((entry) => entry.action === 'knowledge_llm_budget_blocked'),
  );
  assert.ok(
    audits.some((entry) => entry.action === 'knowledge_llm_rate_blocked'),
  );
  for (const action of [
    'knowledge_llm_dispatched',
    'knowledge_llm_completed',
    'knowledge_llm_result_unknown',
    'knowledge_llm_usage_unknown',
    'knowledge_llm_failed',
    'knowledge_llm_reconciled',
  ]) {
    assert.ok(
      audits.some((entry) => entry.action === action),
      action,
    );
  }
  const serializedAudit = JSON.stringify(audits);
  for (const canary of [
    hash('a'),
    hash('b'),
    'synthetic-org',
    'chat-key-must-not-be-reused',
    'Synthetic result',
    'Synthetic usage-unknown result',
    'Synthetic normalized result',
    'Synthetic timeout_outcome_unknown reconciled result',
    'Synthetic connection_outcome_unknown reconciled result',
    'audit-principal-canary',
    'audit-actor-canary',
    'audit-scope-canary',
  ]) {
    assert.equal(serializedAudit.includes(canary), false, canary);
  }

  const offlineReconciliationPeriod =
    await prisma.knowledgeLlmBudgetPeriod.findFirstOrThrow({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      // The ephemeral integration role is the database owner. Disable user
      // triggers only inside this rolled-back transaction to prove the
      // explicit read-only reconciliation detects historical/manual drift.
      await transaction.$executeRawUnsafe(
        'SET LOCAL session_replication_role = replica',
      );
      await transaction.$executeRaw`
        UPDATE "KnowledgeLlmBudgetPeriod"
        SET "releasedMicros" = "releasedMicros" + 1
        WHERE id = ${offlineReconciliationPeriod.id}
      `;
      await transaction.$queryRaw`
        SELECT "erp4_knowledge_llm_assert_period_accounting"(
          ${offlineReconciliationPeriod.id}
        )::TEXT AS result
      `;
    }),
    /counters must match reservation ledger/,
  );
  await prisma.$queryRaw`
    SELECT "erp4_knowledge_llm_assert_period_accounting"(id)::TEXT AS result
    FROM "KnowledgeLlmBudgetPeriod"
    ORDER BY id
  `;

  console.log(
    JSON.stringify({
      result: 'PASS',
      personalReservation: true,
      organizationDualReservation: true,
      directOrganizationReservationLockOrderVerified: true,
      hardLimitRace: true,
      policyVersionBudgetCarryForward: true,
      policyVersionRateCarryForward: true,
      policyVersionRolloverRaceBlocked: true,
      policyTimezoneDriftBlocked: true,
      policyBoundaryRolloverRateCarryForward: true,
      policyBoundaryCurrencyRolloverAllowed: true,
      periodMismatchTypedAndAudited: true,
      policyMismatchPeriodRollback: true,
      canonicalMonthlyPeriodBoundary: true,
      ambiguousMonthStartCanonicalized: true,
      periodCounterUpdateLockOrderVerified: true,
      reservationPeriodLockOrderVerified: true,
      historicalPeriodLockOrderVerified: true,
      canonicalActorDatabaseBoundary: true,
      economicReplayConflict: true,
      concurrentReplayConvergence: true,
      rateLimit: true,
      crossPeriodRateLimit: true,
      idempotency: true,
      softLimitReplay: true,
      renderedPromptReservationBound: true,
      exactSettlement: true,
      releasedCounterBeyondBigInt: true,
      actualTokenCeilingsEnforced: true,
      heldMaximum: true,
      usageUnknownOutcomeBinding: true,
      usageUnknownReconciliation: true,
      usageUnknownReconciliationAuditRollback: true,
      operatorBillingAttribution: true,
      operatorSelfSettlementBlocked: true,
      nonCanonicalOperatorBlocked: true,
      contextPersistedWithReservation: true,
      contextFrozenAtDispatch: true,
      contextExactProvenanceVerified: true,
      contextAggregateBoundsVerified: true,
      contextSelectedItemBoundVerified: true,
      contextProvenanceDepthVerified: true,
      contextConversationEligibilityGuardVerified: true,
      contextSynthesisEligibilityGuardVerified: true,
      contextFingerprintVerified: true,
      providerOutcomeRequiresDispatch: true,
      assistantTurnContentHashVerified: true,
      trustedClockBoundaryVerified: true,
      reservationAccountingTimestampVerified: true,
      settledReservationImmutable: true,
      reservationDeletionBlocked: true,
      lateReservationInsertBlocked: true,
      directReservationSettlementBlocked: true,
      directRunCostRecalculationBlocked: true,
      runMaximumReservationRecalculationBlocked: true,
      outcomeRunLockOrderVerified: true,
      runReservationAtomicityVerified: true,
      periodCounterMutationGuardVerified: true,
      directHardLimitGuardVerified: true,
      directRateLimitGuardVerified: true,
      trustedReservationPeriodVerified: true,
      staleAccountingPeriodTypedAndAudited: true,
      periodOfflineDriftDetected: true,
      periodOfflineReconciliationVerified: true,
      terminalDispatchTimestampImmutable: true,
      terminalRunProvenanceImmutable: true,
      conversationStateGuard: true,
      outcomeUnknownRequiresReconcileableState: true,
      reconciliation: true,
      concurrentUsageReconciliation: true,
      auditRollback: true,
      terminalAuditRollback: true,
      requestLedgerRequiredBeforeDispatch: true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
