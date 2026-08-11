import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaKnowledgeLlmBudgetAdapter } from '../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js';
import {
  markKnowledgeLlmRunDispatched,
  reconcileKnowledgeLlmHeldBudget,
  settleKnowledgeLlmBudget,
} from '../dist/adapters/knowledge/prismaKnowledgeLlmSettlementAdapter.js';
import { createKnowledgeLlmBudgetUseCases } from '../dist/application/knowledge/knowledgeLlmBudgetUseCases.js';

const parsed = new URL(process.env.DATABASE_URL || '');
if (
  process.env.KNOWLEDGE_LLM_BUDGET_INTEGRATION_CONFIRM !== '1' ||
  !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
  parsed.pathname !== '/erp4_knowledge_llm_budget'
) {
  throw new Error('Refusing non-ephemeral Knowledge LLM budget database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const service = createKnowledgeLlmBudgetUseCases(
  new PrismaKnowledgeLlmBudgetAdapter(prisma),
);
const now = new Date();
const after = (milliseconds) => new Date(now.getTime() + milliseconds);
const hash = (character) => character.repeat(64);

function auditActor(userId, suffix) {
  return {
    requestId: `knowledge-llm-budget-${suffix}`,
    source: 'api',
    principalUserId: userId,
    actorUserId: userId,
    authScopes: ['knowledge:write'],
  };
}

function reservation({
  runId,
  userId,
  keyHash,
  payloadHash,
  maximumCostMicros,
  organizationId = null,
  auditSuffix = runId,
}) {
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
    model: 'stub-v1',
    catalogVersion: 1,
    promptTemplateVersion: 1,
    requestKeyHash: keyHash,
    requestPayloadHash: payloadHash,
    selectedContextFingerprint: hash('c'),
    estimatedInputTokens: 100,
    maxOutputTokens: 100,
    maximumCostMicros,
    currency: 'JPY',
    now,
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
      createdBy: 'synthetic-admin',
      updatedBy: 'synthetic-admin',
    },
  });
}

try {
  await policy({
    id: 'policy-personal',
    subjectType: 'user',
    subjectId: 'budget-user',
  });
  const firstInput = reservation({
    runId: 'run-first',
    userId: 'budget-user',
    keyHash: hash('a'),
    payloadHash: hash('b'),
    maximumCostMicros: 40n,
  });
  const first = await service.reserve(firstInput);
  assert.equal(first.ok, true);
  assert.equal(first.value.created, true);
  assert.equal(first.value.softLimitWarning, false);

  const replay = await service.reserve(firstInput);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.created, false);
  assert.equal(
    await prisma.knowledgeLlmReservation.count({
      where: { runId: 'run-first' },
    }),
    1,
  );

  const conflict = await service.reserve({
    ...firstInput,
    runId: 'run-conflicting-replay',
    requestPayloadHash: hash('d'),
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

  const second = await service.reserve(
    reservation({
      runId: 'run-second',
      userId: 'budget-user',
      keyHash: hash('e'),
      payloadHash: hash('f'),
      maximumCostMicros: 40n,
    }),
  );
  assert.equal(second.ok, true);
  assert.equal(second.value.softLimitWarning, true);

  const blocked = await service.reserve(
    reservation({
      runId: 'run-hard-blocked',
      userId: 'budget-user',
      keyHash: hash('1'),
      payloadHash: hash('2'),
      maximumCostMicros: 30n,
    }),
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'budget_hard_limit');
  assert.equal(
    await prisma.knowledgeLlmRun.count({ where: { id: 'run-hard-blocked' } }),
    0,
  );

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
      payloadHash: hash('4'),
      maximumCostMicros: 25n,
    }),
  );
  assert.equal(organization.ok, true);
  assert.equal(
    await prisma.knowledgeLlmReservation.count({ where: { runId: 'run-org' } }),
    2,
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
          payloadHash: hash('6'),
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
      payloadHash: hash('8'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(rateBlocked.ok, false);
  assert.equal(rateBlocked.error.code, 'rate_limit');

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
        payloadHash: hash('a'),
        maximumCostMicros: 60n,
      }),
    ),
    service.reserve(
      reservation({
        runId: 'run-race-b',
        userId: 'race-user',
        keyHash: hash('b'),
        payloadHash: hash('c'),
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
  });
  const settlementReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-actual',
      userId: 'settlement-user',
      keyHash: hash('f'),
      payloadHash: hash('0'),
      maximumCostMicros: 100n,
    }),
  );
  assert.equal(settlementReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
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
    await transaction.knowledgeConversationTurn.create({
      data: {
        conversationId: conversation.id,
        sequence: 1,
        role: 'user',
        origin: 'user',
        content: 'Synthetic prompt',
        contentHash: hash('2'),
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
        contentHash: hash('3'),
        createdBy: 'settlement-user',
      },
    });
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-actual',
      actorUserId: 'settlement-user',
      dispatchedAt: after(1_000),
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-actual',
      actorUserId: 'settlement-user',
      completedAt: after(2_000),
      settlement: {
        type: 'actual',
        actualInputTokens: 80,
        actualOutputTokens: 20,
        actualCostMicros: 35n,
        conversationId: conversation.id,
        assistantTurnId: assistant.id,
      },
    });
  });
  const settled = await prisma.knowledgeLlmRun.findUniqueOrThrow({
    where: { id: 'run-settlement-actual' },
    include: { reservations: true },
  });
  assert.equal(settled.executionStatus, 'result_ready');
  assert.equal(settled.settlementStatus, 'settled_actual');
  assert.equal(settled.actualCostMicros, 35n);
  assert.equal(settled.reservations[0].status, 'settled_actual');
  const settledPeriod = await prisma.knowledgeLlmBudgetPeriod.findUniqueOrThrow(
    {
      where: { id: settled.reservations[0].budgetPeriodId },
    },
  );
  assert.equal(settledPeriod.activeReservedMicros, 0n);
  assert.equal(settledPeriod.settledActualMicros, 35n);
  assert.equal(settledPeriod.releasedMicros, 65n);

  const heldReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-held',
      userId: 'settlement-user',
      keyHash: hash('4'),
      payloadHash: hash('5'),
      maximumCostMicros: 50n,
    }),
  );
  assert.equal(heldReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-held',
      actorUserId: 'settlement-user',
      dispatchedAt: after(3_000),
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-held',
      actorUserId: 'settlement-user',
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

  const reconciliationReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-reconcile',
      userId: 'settlement-user',
      keyHash: hash('8'),
      payloadHash: hash('9'),
      maximumCostMicros: 60n,
    }),
  );
  assert.equal(reconciliationReservation.ok, true);
  await prisma.$transaction(async (transaction) => {
    await markKnowledgeLlmRunDispatched(transaction, {
      runId: 'run-settlement-reconcile',
      actorUserId: 'settlement-user',
      dispatchedAt: after(5_000),
    });
    await transaction.knowledgeLlmProviderOutcome.create({
      data: {
        runId: 'run-settlement-reconcile',
        status: 'valid',
        normalizedContent: 'Synthetic normalized result',
        contentHash: hash('a'),
        inputTokens: 40,
        outputTokens: 10,
        capturedAt: after(6_000),
      },
    });
    await settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-reconcile',
      actorUserId: 'settlement-user',
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
        completedAt: after(8_000),
        actualInputTokens: 40,
        actualOutputTokens: 10,
        actualCostMicros: 20n,
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
        contentHash: hash('c'),
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
        contentHash: hash('a'),
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
      completedAt: after(8_000),
      actualInputTokens: 40,
      actualOutputTokens: 10,
      actualCostMicros: 20n,
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
  assert.equal(reconciled.actualCostMicros, 20n);
  assert.equal(reconciled.reservations[0].status, 'settled_actual');

  const releaseReservation = await service.reserve(
    reservation({
      runId: 'run-settlement-release',
      userId: 'settlement-user',
      keyHash: hash('6'),
      payloadHash: hash('7'),
      maximumCostMicros: 25n,
    }),
  );
  assert.equal(releaseReservation.ok, true);
  await prisma.$transaction((transaction) =>
    settleKnowledgeLlmBudget(transaction, {
      runId: 'run-settlement-release',
      actorUserId: 'settlement-user',
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
      payloadHash: hash('1'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(invalidProviderRelease.ok, true);
  await assert.rejects(
    prisma.$transaction((transaction) =>
      settleKnowledgeLlmBudget(transaction, {
        runId: 'run-invalid-provider-release',
        actorUserId: 'settlement-user',
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
      payloadHash: hash('3'),
      maximumCostMicros: 1n,
    }),
  );
  assert.equal(invalidPredispatchHold.ok, true);
  await assert.rejects(
    prisma.$transaction((transaction) =>
      settleKnowledgeLlmBudget(transaction, {
        runId: 'run-invalid-predispatch-hold',
        actorUserId: 'settlement-user',
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
      data: {
        executionStatus: 'result_ready',
        settlementStatus: 'settled_actual',
      },
    }),
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
        payloadHash: hash('e'),
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
  const serializedAudit = JSON.stringify(audits);
  for (const canary of [
    hash('a'),
    hash('b'),
    'synthetic-org',
    'chat-key-must-not-be-reused',
  ]) {
    assert.equal(serializedAudit.includes(canary), false, canary);
  }

  console.log(
    JSON.stringify({
      result: 'PASS',
      personalReservation: true,
      organizationDualReservation: true,
      hardLimitRace: true,
      rateLimit: true,
      idempotency: true,
      exactSettlement: true,
      heldMaximum: true,
      reconciliation: true,
      auditRollback: true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
