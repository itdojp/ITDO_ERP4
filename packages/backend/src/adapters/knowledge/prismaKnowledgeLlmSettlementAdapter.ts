import { Prisma } from '@prisma/client';

import type { KnowledgeAuditActor } from '../../application/knowledge/knowledgeItemPorts.js';
import type {
  KnowledgeLlmAuditAction,
  KnowledgeLlmClock,
  KnowledgeLlmTerminalFailureCode,
} from '../../application/knowledge/knowledgeLlmBudgetPorts.js';
import { ceilCostMicros } from '../../application/knowledge/knowledgeLlmConfig.js';
import { sha256KnowledgeText } from '../../application/knowledge/knowledgeProvenanceValidation.js';
import { PrismaKnowledgeLlmAuditWriter } from './prismaKnowledgeLlmAuditAdapter.js';

type Transaction = Prisma.TransactionClient;

function trustedTimestamp(clock: KnowledgeLlmClock): Date {
  const timestamp = clock();
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    throw new Error('knowledge_llm_clock_invalid');
  }
  return new Date(timestamp.getTime());
}

export type KnowledgeLlmFinalSettlement =
  | {
      type: 'actual';
      actualInputTokens: number;
      actualOutputTokens: number;
      actualCostMicros: bigint;
      conversationId: string;
      assistantTurnId: string;
    }
  | {
      type: 'release';
      failureCode: 'disabled' | 'rejected_before_dispatch';
    }
  | {
      type: 'hold';
      executionStatus: 'failed';
      failureCode:
        | 'provider_4xx'
        | 'provider_5xx'
        | 'malformed_response'
        | 'response_oversize'
        | 'empty_result';
    }
  | {
      type: 'hold';
      executionStatus: 'result_unknown';
      failureCode:
        | 'timeout_outcome_unknown'
        | 'connection_outcome_unknown'
        | 'finalization_failed';
    }
  | {
      type: 'hold';
      executionStatus: 'result_ready';
      failureCode: 'usage_missing' | 'usage_invalid';
      conversationId: string;
      assistantTurnId: string;
    };

type LockedRun = {
  id: string;
  actorUserId: string;
  scope: 'personal' | 'organization';
  provider: 'stub' | 'openai';
  model: string;
  catalogVersion: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  currency: string;
  executionStatus: string;
  settlementStatus: string;
  inputCostMicrosPerMillion: bigint;
  outputCostMicrosPerMillion: bigint;
  maximumCostMicros: bigint;
};

function terminalAuditMetadata(
  run: LockedRun,
  policyCount: number,
  result:
    | {
        resultCode: 'dispatched';
      }
    | {
        resultCode: 'completed' | 'reconciled';
        actualInputTokens: number;
        actualOutputTokens: number;
        actualCostMicros: bigint;
      }
    | {
        resultCode: 'failed' | 'result_unknown' | 'usage_unknown';
        failureCode: KnowledgeLlmTerminalFailureCode;
      },
) {
  return {
    provider: run.provider,
    model: run.model,
    scope: run.scope,
    catalogVersion: run.catalogVersion,
    estimatedInputTokens: run.estimatedInputTokens,
    maxOutputTokens: run.maxOutputTokens,
    reservedCostMicros: run.maximumCostMicros.toString(),
    currency: run.currency,
    policyCount,
    ...('actualCostMicros' in result
      ? {
          resultCode: result.resultCode,
          actualInputTokens: result.actualInputTokens,
          actualOutputTokens: result.actualOutputTokens,
          actualCostMicros: result.actualCostMicros.toString(),
        }
      : 'failureCode' in result
        ? {
            resultCode: result.resultCode,
            failureCode: result.failureCode,
          }
        : { resultCode: result.resultCode }),
  } as const;
}

async function writeTerminalAudit(
  transaction: Transaction,
  input: {
    run: LockedRun;
    auditActor: KnowledgeAuditActor;
    action: KnowledgeLlmAuditAction;
    policyCount: number;
    result: Parameters<typeof terminalAuditMetadata>[2];
  },
): Promise<void> {
  if (input.auditActor.userId !== input.run.actorUserId) {
    throw new Error('knowledge_llm_audit_invalid');
  }
  await new PrismaKnowledgeLlmAuditWriter(transaction).write({
    action: input.action,
    actor: input.auditActor,
    targetTable: 'knowledge_llm_runs',
    targetId: input.run.id,
    metadata: terminalAuditMetadata(input.run, input.policyCount, input.result),
  });
}

export async function markKnowledgeLlmRunDispatched(
  transaction: Transaction,
  input: {
    runId: string;
    actorUserId: string;
    auditActor: KnowledgeAuditActor;
  },
  clock: KnowledgeLlmClock = () => new Date(),
): Promise<void> {
  const dispatchedAt = trustedTimestamp(clock);
  const runs = await transaction.$queryRaw<Array<LockedRun>>(Prisma.sql`
    SELECT id, "actorUserId", scope, provider, model, "catalogVersion",
      "estimatedInputTokens", "maxOutputTokens", currency,
      "executionStatus", "settlementStatus", "inputCostMicrosPerMillion",
      "outputCostMicrosPerMillion", "maximumCostMicros"
    FROM "KnowledgeLlmRun"
    WHERE id = ${input.runId}
    FOR UPDATE
  `);
  const run = runs[0];
  if (
    !run ||
    run.actorUserId !== input.actorUserId ||
    run.executionStatus !== 'reserved' ||
    run.settlementStatus !== 'reserved'
  ) {
    throw new Error('knowledge_llm_dispatch_conflict');
  }
  const policyCount = await transaction.knowledgeLlmReservation.count({
    where: { runId: input.runId },
  });
  if (policyCount < 1 || policyCount > 2) {
    throw new Error('knowledge_llm_dispatch_conflict');
  }
  const contextSources = await transaction.$queryRaw<
    Array<{ ordinal: number }>
  >(
    Prisma.sql`
      SELECT ordinal
      FROM "KnowledgeLlmContextSource"
      WHERE "runId" = ${input.runId}
      ORDER BY ordinal
      FOR UPDATE
    `,
  );
  if (contextSources.some((source, index) => source.ordinal !== index)) {
    throw new Error('knowledge_llm_dispatch_conflict');
  }
  await transaction.knowledgeLlmRun.update({
    where: { id: input.runId },
    data: {
      executionStatus: 'dispatched',
      dispatchedAt,
      updatedAt: dispatchedAt,
      updatedBy: input.actorUserId,
    },
  });
  await writeTerminalAudit(transaction, {
    run,
    auditActor: input.auditActor,
    action: 'knowledge_llm_dispatched',
    policyCount,
    result: { resultCode: 'dispatched' },
  });
}

/**
 * Applies one terminal settlement while holding the run, reservation and
 * period rows. Callers compose this helper in the same transaction that
 * persists the normalized outcome/assistant turn; this helper always writes
 * the typed terminal audit before that transaction can commit.
 */
export async function settleKnowledgeLlmBudget(
  transaction: Transaction,
  input: {
    runId: string;
    actorUserId: string;
    auditActor: KnowledgeAuditActor;
    settlement: KnowledgeLlmFinalSettlement;
  },
  clock: KnowledgeLlmClock = () => new Date(),
): Promise<void> {
  const completedAt = trustedTimestamp(clock);
  const lockedRuns = await transaction.$queryRaw<Array<LockedRun>>(Prisma.sql`
    SELECT id, "actorUserId", scope, provider, model, "catalogVersion",
      "estimatedInputTokens", "maxOutputTokens", currency,
      "executionStatus", "settlementStatus", "inputCostMicrosPerMillion",
      "outputCostMicrosPerMillion", "maximumCostMicros"
    FROM "KnowledgeLlmRun"
    WHERE id = ${input.runId}
    FOR UPDATE
  `);
  const run = lockedRuns[0];
  if (
    !run ||
    run.actorUserId !== input.actorUserId ||
    run.settlementStatus !== 'reserved' ||
    !['reserved', 'dispatched'].includes(run.executionStatus)
  ) {
    throw new Error('knowledge_llm_settlement_conflict');
  }
  const reservations = await transaction.knowledgeLlmReservation.findMany({
    where: { runId: input.runId },
    orderBy: { budgetPeriodId: 'asc' },
  });
  if (reservations.length < 1 || reservations.length > 2) {
    throw new Error('knowledge_llm_settlement_conflict');
  }
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "KnowledgeLlmReservation"
    WHERE id IN (${Prisma.join(reservations.map((entry) => entry.id))})
    ORDER BY "budgetPeriodId", id
    FOR UPDATE
  `);
  const periodIds = reservations
    .map((entry) => entry.budgetPeriodId)
    .sort((left, right) => left.localeCompare(right));
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "KnowledgeLlmBudgetPeriod"
    WHERE id IN (${Prisma.join(periodIds)})
    ORDER BY id
    FOR UPDATE
  `);

  if (input.settlement.type === 'actual') {
    if (
      run.executionStatus !== 'dispatched' ||
      !Number.isSafeInteger(input.settlement.actualInputTokens) ||
      input.settlement.actualInputTokens < 0 ||
      !Number.isSafeInteger(input.settlement.actualOutputTokens) ||
      input.settlement.actualOutputTokens < 0 ||
      input.settlement.actualCostMicros < 0n ||
      input.settlement.actualCostMicros > run.maximumCostMicros
    ) {
      throw new Error('knowledge_llm_settlement_invalid');
    }
    const outcomes = await transaction.$queryRaw<
      Array<{
        inputTokens: number;
        outputTokens: number;
        contentHash: string;
        turnContentHash: string;
        turnContent: string;
        role: string;
        origin: string;
      }>
    >(Prisma.sql`
      SELECT
        outcome."inputTokens",
        outcome."outputTokens",
        outcome."contentHash",
        turn."contentHash" AS "turnContentHash",
        turn.content AS "turnContent",
        turn.role,
        turn.origin
      FROM "KnowledgeLlmProviderOutcome" outcome
      JOIN "KnowledgeConversationTurn" turn
        ON turn.id = ${input.settlement.assistantTurnId}
       AND turn."conversationId" = ${input.settlement.conversationId}
      WHERE outcome."runId" = ${input.runId}
        AND outcome.status = 'valid'
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
      FOR UPDATE OF outcome, turn
    `);
    const outcome = outcomes[0];
    const expectedActualCost = outcome
      ? ceilCostMicros(outcome.inputTokens, run.inputCostMicrosPerMillion) +
        ceilCostMicros(outcome.outputTokens, run.outputCostMicrosPerMillion)
      : null;
    if (
      outcomes.length !== 1 ||
      !outcome ||
      outcome.inputTokens !== input.settlement.actualInputTokens ||
      outcome.outputTokens !== input.settlement.actualOutputTokens ||
      outcome.contentHash !== outcome.turnContentHash ||
      outcome.contentHash !==
        sha256KnowledgeText('conversation-turn', outcome.turnContent) ||
      outcome.role !== 'assistant' ||
      outcome.origin !== 'ai' ||
      input.settlement.actualCostMicros !== expectedActualCost
    ) {
      throw new Error('knowledge_llm_settlement_without_valid_outcome');
    }
    for (const reservation of reservations) {
      await transaction.knowledgeLlmBudgetPeriod.update({
        where: { id: reservation.budgetPeriodId },
        data: {
          activeReservedMicros: {
            decrement: reservation.maximumCostMicros,
          },
          settledActualMicros: {
            increment: input.settlement.actualCostMicros,
          },
          releasedMicros: {
            increment:
              reservation.maximumCostMicros - input.settlement.actualCostMicros,
          },
          version: { increment: 1 },
        },
      });
      await transaction.knowledgeLlmReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'settled_actual',
          actualCostMicros: input.settlement.actualCostMicros,
          settledAt: completedAt,
        },
      });
    }
    await transaction.knowledgeLlmRun.update({
      where: { id: input.runId },
      data: {
        executionStatus: 'result_ready',
        settlementStatus: 'settled_actual',
        actualInputTokens: input.settlement.actualInputTokens,
        actualOutputTokens: input.settlement.actualOutputTokens,
        actualCostMicros: input.settlement.actualCostMicros,
        conversationId: input.settlement.conversationId,
        assistantTurnId: input.settlement.assistantTurnId,
        completedAt,
        updatedAt: completedAt,
        updatedBy: input.actorUserId,
      },
    });
    await writeTerminalAudit(transaction, {
      run,
      auditActor: input.auditActor,
      action: 'knowledge_llm_completed',
      policyCount: reservations.length,
      result: {
        resultCode: 'completed',
        actualInputTokens: input.settlement.actualInputTokens,
        actualOutputTokens: input.settlement.actualOutputTokens,
        actualCostMicros: input.settlement.actualCostMicros,
      },
    });
    return;
  }

  const holdSettlement =
    input.settlement.type === 'hold' ? input.settlement : null;
  const failedHoldCodes = new Set([
    'provider_4xx',
    'provider_5xx',
    'malformed_response',
    'response_oversize',
    'empty_result',
  ]);
  const resultUnknownHoldCodes = new Set([
    'timeout_outcome_unknown',
    'connection_outcome_unknown',
    'finalization_failed',
  ]);
  const resultReadyHoldCodes = new Set(['usage_missing', 'usage_invalid']);
  if (
    holdSettlement &&
    ((holdSettlement.executionStatus === 'failed' &&
      !failedHoldCodes.has(holdSettlement.failureCode)) ||
      (holdSettlement.executionStatus === 'result_unknown' &&
        !resultUnknownHoldCodes.has(holdSettlement.failureCode)) ||
      (holdSettlement.executionStatus === 'result_ready' &&
        !resultReadyHoldCodes.has(holdSettlement.failureCode)))
  ) {
    throw new Error('knowledge_llm_settlement_invalid');
  }
  const releaseBeforeDispatch =
    input.settlement.type === 'release' &&
    (input.settlement.failureCode === 'disabled' ||
      input.settlement.failureCode === 'rejected_before_dispatch');
  if (
    (input.settlement.type === 'release' && !releaseBeforeDispatch) ||
    (releaseBeforeDispatch && run.executionStatus !== 'reserved') ||
    (holdSettlement && run.executionStatus !== 'dispatched')
  ) {
    throw new Error('knowledge_llm_settlement_invalid');
  }
  if (holdSettlement?.executionStatus === 'result_ready') {
    const outcomes = await transaction.$queryRaw<
      Array<{
        contentHash: string;
        turnContentHash: string;
        turnContent: string;
        role: string;
        origin: string;
        failureCode: string;
      }>
    >(Prisma.sql`
      SELECT outcome."contentHash", turn."contentHash" AS "turnContentHash",
        turn.content AS "turnContent", turn.role, turn.origin,
        outcome."failureCode"
      FROM "KnowledgeLlmProviderOutcome" outcome
      JOIN "KnowledgeConversationTurn" turn
        ON turn.id = ${holdSettlement.assistantTurnId}
       AND turn."conversationId" = ${holdSettlement.conversationId}
      WHERE outcome."runId" = ${input.runId}
        AND outcome.status = 'usage_unknown'
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
      FOR UPDATE OF outcome, turn
    `);
    const outcome = outcomes[0];
    if (
      outcomes.length !== 1 ||
      !outcome ||
      outcome.failureCode !== holdSettlement.failureCode ||
      outcome.contentHash !== outcome.turnContentHash ||
      outcome.contentHash !==
        sha256KnowledgeText('conversation-turn', outcome.turnContent) ||
      outcome.role !== 'assistant' ||
      outcome.origin !== 'ai'
    ) {
      throw new Error('knowledge_llm_settlement_without_usage_unknown_outcome');
    }
  }
  for (const reservation of reservations) {
    await transaction.knowledgeLlmBudgetPeriod.update({
      where: { id: reservation.budgetPeriodId },
      data: {
        activeReservedMicros: { decrement: reservation.maximumCostMicros },
        ...(holdSettlement
          ? { heldMaximumMicros: { increment: reservation.maximumCostMicros } }
          : { releasedMicros: { increment: reservation.maximumCostMicros } }),
        version: { increment: 1 },
      },
    });
    await transaction.knowledgeLlmReservation.update({
      where: { id: reservation.id },
      data: {
        status: holdSettlement ? 'held_maximum' : 'released',
        settledAt: completedAt,
      },
    });
  }
  await transaction.knowledgeLlmRun.update({
    where: { id: input.runId },
    data: {
      executionStatus: holdSettlement
        ? holdSettlement.executionStatus
        : 'failed',
      settlementStatus: holdSettlement ? 'held_maximum' : 'released',
      failureCode: input.settlement.failureCode,
      ...(holdSettlement?.executionStatus === 'result_ready'
        ? {
            conversationId: holdSettlement.conversationId,
            assistantTurnId: holdSettlement.assistantTurnId,
          }
        : {}),
      completedAt,
      updatedAt: completedAt,
      updatedBy: input.actorUserId,
    },
  });
  const terminalResult = holdSettlement
    ? holdSettlement.executionStatus === 'result_ready'
      ? {
          action: 'knowledge_llm_usage_unknown' as const,
          resultCode: 'usage_unknown' as const,
        }
      : holdSettlement.executionStatus === 'result_unknown'
        ? {
            action: 'knowledge_llm_result_unknown' as const,
            resultCode: 'result_unknown' as const,
          }
        : {
            action: 'knowledge_llm_failed' as const,
            resultCode: 'failed' as const,
          }
    : {
        action: 'knowledge_llm_failed' as const,
        resultCode: 'failed' as const,
      };
  await writeTerminalAudit(transaction, {
    run,
    auditActor: input.auditActor,
    action: terminalResult.action,
    policyCount: reservations.length,
    result: {
      resultCode: terminalResult.resultCode,
      failureCode: input.settlement.failureCode,
    },
  });
}

/**
 * Finalizes a held maximum without provider redispatch. The caller must first
 * persist/finalize a valid normalized outcome and create the conversation
 * turn in this same transaction.
 */
export async function reconcileKnowledgeLlmHeldBudget(
  transaction: Transaction,
  input: {
    runId: string;
    actorUserId: string;
    auditActor: KnowledgeAuditActor;
    actualInputTokens: number;
    actualOutputTokens: number;
    actualCostMicros: bigint;
    conversationId: string;
    assistantTurnId: string;
  },
  clock: KnowledgeLlmClock = () => new Date(),
): Promise<void> {
  const completedAt = trustedTimestamp(clock);
  if (
    !Number.isSafeInteger(input.actualInputTokens) ||
    input.actualInputTokens < 0 ||
    !Number.isSafeInteger(input.actualOutputTokens) ||
    input.actualOutputTokens < 0 ||
    input.actualCostMicros < 0n
  ) {
    throw new Error('knowledge_llm_reconcile_invalid');
  }
  const runs = await transaction.$queryRaw<Array<LockedRun>>(Prisma.sql`
    SELECT id, "actorUserId", scope, provider, model, "catalogVersion",
      "estimatedInputTokens", "maxOutputTokens", currency,
      "executionStatus", "settlementStatus", "inputCostMicrosPerMillion",
      "outputCostMicrosPerMillion", "maximumCostMicros"
    FROM "KnowledgeLlmRun"
    WHERE id = ${input.runId}
      AND "executionStatus" = 'result_unknown'
      AND "settlementStatus" = 'held_maximum'
      AND "failureCode" IN (
        'timeout_outcome_unknown',
        'connection_outcome_unknown',
        'finalization_failed'
      )
    FOR UPDATE
  `);
  const run = runs[0];
  if (
    !run ||
    run.actorUserId !== input.actorUserId ||
    input.actualCostMicros > run.maximumCostMicros
  ) {
    throw new Error('knowledge_llm_reconcile_conflict');
  }
  const outcomes = await transaction.$queryRaw<
    Array<{
      inputTokens: number;
      outputTokens: number;
      contentHash: string;
      turnContentHash: string;
      turnContent: string;
      role: string;
      origin: string;
    }>
  >(Prisma.sql`
    SELECT
      outcome."inputTokens",
      outcome."outputTokens",
      outcome."contentHash",
      turn."contentHash" AS "turnContentHash",
      turn.content AS "turnContent",
      turn.role,
      turn.origin
    FROM "KnowledgeLlmProviderOutcome" outcome
    JOIN "KnowledgeConversationTurn" turn
      ON turn.id = ${input.assistantTurnId}
     AND turn."conversationId" = ${input.conversationId}
    WHERE outcome."runId" = ${input.runId}
      AND outcome.status = 'valid'
      AND outcome."finalizedAt" IS NOT NULL
      AND outcome."normalizedContent" IS NULL
    FOR UPDATE OF outcome, turn
  `);
  const outcome = outcomes[0];
  const expectedActualCost = outcome
    ? ceilCostMicros(outcome.inputTokens, run.inputCostMicrosPerMillion) +
      ceilCostMicros(outcome.outputTokens, run.outputCostMicrosPerMillion)
    : null;
  if (
    outcomes.length !== 1 ||
    !outcome ||
    outcome.inputTokens !== input.actualInputTokens ||
    outcome.outputTokens !== input.actualOutputTokens ||
    outcome.contentHash !== outcome.turnContentHash ||
    outcome.contentHash !==
      sha256KnowledgeText('conversation-turn', outcome.turnContent) ||
    outcome.role !== 'assistant' ||
    outcome.origin !== 'ai' ||
    input.actualCostMicros !== expectedActualCost
  ) {
    throw new Error('knowledge_llm_reconcile_without_outcome');
  }
  const reservations = await transaction.knowledgeLlmReservation.findMany({
    where: { runId: input.runId, status: 'held_maximum' },
    orderBy: { budgetPeriodId: 'asc' },
  });
  if (reservations.length < 1 || reservations.length > 2) {
    throw new Error('knowledge_llm_reconcile_conflict');
  }
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "KnowledgeLlmReservation"
    WHERE id IN (${Prisma.join(reservations.map((entry) => entry.id))})
    ORDER BY "budgetPeriodId", id
    FOR UPDATE
  `);
  const periodIds = reservations
    .map((entry) => entry.budgetPeriodId)
    .sort((left, right) => left.localeCompare(right));
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "KnowledgeLlmBudgetPeriod"
    WHERE id IN (${Prisma.join(periodIds)})
    ORDER BY id
    FOR UPDATE
  `);
  for (const reservation of reservations) {
    await transaction.knowledgeLlmBudgetPeriod.update({
      where: { id: reservation.budgetPeriodId },
      data: {
        heldMaximumMicros: { decrement: reservation.maximumCostMicros },
        settledActualMicros: { increment: input.actualCostMicros },
        releasedMicros: {
          increment: reservation.maximumCostMicros - input.actualCostMicros,
        },
        version: { increment: 1 },
      },
    });
    await transaction.knowledgeLlmReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'settled_actual',
        actualCostMicros: input.actualCostMicros,
        settledAt: completedAt,
      },
    });
  }
  await transaction.knowledgeLlmRun.update({
    where: { id: input.runId },
    data: {
      executionStatus: 'result_ready',
      settlementStatus: 'settled_actual',
      failureCode: null,
      actualInputTokens: input.actualInputTokens,
      actualOutputTokens: input.actualOutputTokens,
      actualCostMicros: input.actualCostMicros,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      completedAt,
      updatedAt: completedAt,
      updatedBy: input.actorUserId,
    },
  });
  await writeTerminalAudit(transaction, {
    run,
    auditActor: input.auditActor,
    action: 'knowledge_llm_reconciled',
    policyCount: reservations.length,
    result: {
      resultCode: 'reconciled',
      actualInputTokens: input.actualInputTokens,
      actualOutputTokens: input.actualOutputTokens,
      actualCostMicros: input.actualCostMicros,
    },
  });
}
