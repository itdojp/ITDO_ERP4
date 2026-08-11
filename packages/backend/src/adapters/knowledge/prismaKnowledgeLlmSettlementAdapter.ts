import { Prisma } from '@prisma/client';

import { ceilCostMicros } from '../../application/knowledge/knowledgeLlmConfig.js';

type Transaction = Prisma.TransactionClient;

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
      failureCode: 'disabled' | 'rejected_before_dispatch' | 'provider_4xx';
    }
  | {
      type: 'hold';
      executionStatus: 'failed' | 'result_unknown' | 'result_ready';
      failureCode:
        | 'provider_5xx'
        | 'malformed_response'
        | 'response_oversize'
        | 'empty_result'
        | 'timeout_outcome_unknown'
        | 'connection_outcome_unknown'
        | 'usage_missing'
        | 'usage_invalid'
        | 'finalization_failed';
      conversationId?: string;
      assistantTurnId?: string;
    };

export async function markKnowledgeLlmRunDispatched(
  transaction: Transaction,
  input: { runId: string; actorUserId: string; dispatchedAt: Date },
): Promise<void> {
  const updated = await transaction.knowledgeLlmRun.updateMany({
    where: {
      id: input.runId,
      actorUserId: input.actorUserId,
      executionStatus: 'reserved',
      settlementStatus: 'reserved',
    },
    data: {
      executionStatus: 'dispatched',
      dispatchedAt: input.dispatchedAt,
      updatedAt: input.dispatchedAt,
      updatedBy: input.actorUserId,
    },
  });
  if (updated.count !== 1) throw new Error('knowledge_llm_dispatch_conflict');
}

/**
 * Applies one terminal settlement while holding the run, reservation and
 * period rows. Callers compose this helper in the same transaction that
 * persists the normalized outcome/assistant turn and mandatory audit.
 */
export async function settleKnowledgeLlmBudget(
  transaction: Transaction,
  input: {
    runId: string;
    actorUserId: string;
    completedAt: Date;
    settlement: KnowledgeLlmFinalSettlement;
  },
): Promise<void> {
  const lockedRuns = await transaction.$queryRaw<
    Array<{
      id: string;
      actorUserId: string;
      executionStatus: string;
      settlementStatus: string;
      inputCostMicrosPerMillion: bigint;
      outputCostMicrosPerMillion: bigint;
      maximumCostMicros: bigint;
    }>
  >(Prisma.sql`
    SELECT id, "actorUserId", "executionStatus", "settlementStatus",
      "inputCostMicrosPerMillion", "outputCostMicrosPerMillion", "maximumCostMicros"
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
        role: string;
        origin: string;
      }>
    >(Prisma.sql`
      SELECT
        outcome."inputTokens",
        outcome."outputTokens",
        outcome."contentHash",
        turn."contentHash" AS "turnContentHash",
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
          settledAt: input.completedAt,
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
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
        updatedBy: input.actorUserId,
      },
    });
    return;
  }

  const holdSettlement =
    input.settlement.type === 'hold' ? input.settlement : null;
  const releaseBeforeDispatch =
    input.settlement.type === 'release' &&
    (input.settlement.failureCode === 'disabled' ||
      input.settlement.failureCode === 'rejected_before_dispatch');
  const releaseAfterDispatch =
    input.settlement.type === 'release' &&
    input.settlement.failureCode === 'provider_4xx';
  if (
    (releaseBeforeDispatch && run.executionStatus !== 'reserved') ||
    (releaseAfterDispatch && run.executionStatus !== 'dispatched') ||
    (holdSettlement && run.executionStatus !== 'dispatched') ||
    (holdSettlement?.executionStatus === 'result_ready' &&
      (!holdSettlement.conversationId || !holdSettlement.assistantTurnId))
  ) {
    throw new Error('knowledge_llm_settlement_invalid');
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
        settledAt: input.completedAt,
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
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
      updatedBy: input.actorUserId,
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
    completedAt: Date;
    actualInputTokens: number;
    actualOutputTokens: number;
    actualCostMicros: bigint;
    conversationId: string;
    assistantTurnId: string;
  },
): Promise<void> {
  if (
    !Number.isSafeInteger(input.actualInputTokens) ||
    input.actualInputTokens < 0 ||
    !Number.isSafeInteger(input.actualOutputTokens) ||
    input.actualOutputTokens < 0 ||
    input.actualCostMicros < 0n
  ) {
    throw new Error('knowledge_llm_reconcile_invalid');
  }
  const runs = await transaction.$queryRaw<
    Array<{
      id: string;
      actorUserId: string;
      inputCostMicrosPerMillion: bigint;
      outputCostMicrosPerMillion: bigint;
      maximumCostMicros: bigint;
    }>
  >(Prisma.sql`
    SELECT id, "actorUserId", "inputCostMicrosPerMillion",
      "outputCostMicrosPerMillion", "maximumCostMicros"
    FROM "KnowledgeLlmRun"
    WHERE id = ${input.runId}
      AND "executionStatus" = 'result_unknown'
      AND "settlementStatus" = 'held_maximum'
      AND "failureCode" = 'finalization_failed'
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
      role: string;
      origin: string;
    }>
  >(Prisma.sql`
    SELECT
      outcome."inputTokens",
      outcome."outputTokens",
      outcome."contentHash",
      turn."contentHash" AS "turnContentHash",
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
        settledAt: input.completedAt,
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
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
      updatedBy: input.actorUserId,
    },
  });
}
