import { Prisma, type PrismaClient } from '@prisma/client';

import type {
  KnowledgeLlmBudgetFailureCode,
  KnowledgeLlmBudgetPort,
  KnowledgeLlmBudgetResult,
  KnowledgeLlmReservationRecord,
  KnowledgeLlmReservationRequest,
} from '../../application/knowledge/knowledgeLlmBudgetPorts.js';
import { knowledgeLlmLimits } from '../../application/knowledge/knowledgeLlmConfig.js';
import { knowledgeLlmMonthlyPeriod } from '../../application/knowledge/knowledgeLlmBudgetUseCases.js';
import { knowledgeProvenanceAuditActor } from '../../application/knowledge/knowledgeProvenanceValidation.js';
import { PrismaKnowledgeLlmAuditWriter } from './prismaKnowledgeLlmAuditAdapter.js';

type TransactionHost = Pick<PrismaClient, '$transaction'>;
type Transaction = Prisma.TransactionClient;

class KnowledgeLlmPolicyConfigurationError extends Error {
  constructor() {
    super('knowledge_llm_policy_configuration_invalid');
  }
}

type Policy = {
  id: string;
  subjectType: 'user' | 'organization';
  subjectId: string;
  currency: string;
  timezone: string;
  softLimitMicros: bigint;
  hardLimitMicros: bigint;
  requestsPerHour: number;
};

function failure(
  status: 400 | 409 | 429,
  code: KnowledgeLlmBudgetFailureCode,
): KnowledgeLlmBudgetResult<never> {
  const messages: Record<KnowledgeLlmBudgetFailureCode, string> = {
    invalid_request: 'Invalid request',
    policy_not_found: 'Budget policy is not configured',
    policy_mismatch: 'Budget policy mismatch',
    budget_hard_limit: 'Budget hard limit reached',
    rate_limit: 'Rate limit reached',
    idempotency_conflict: 'Idempotency conflict',
    reservation_conflict: 'Reservation conflict',
  };
  return { ok: false, error: { status, code, message: messages[code] } };
}

function retryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = error.code;
  if (code === 'P2034' || code === 'P2002') return true;
  if (code !== 'P2010' || !('meta' in error)) return false;
  const text = JSON.stringify(error.meta);
  return /40001|40P01/.test(text);
}

function requiredSubjects(input: KnowledgeLlmReservationRequest) {
  const subjects: Array<{
    subjectType: 'user' | 'organization';
    subjectId: string;
  }> = [{ subjectType: 'user', subjectId: input.actor.userId }];
  if (input.scope === 'organization' && input.organizationId !== null) {
    subjects.push({
      subjectType: 'organization',
      subjectId: input.organizationId,
    });
  }
  return subjects.sort((left, right) => {
    const type = left.subjectType.localeCompare(right.subjectType);
    return type || left.subjectId.localeCompare(right.subjectId);
  });
}

function contextSourceCreateData(
  input: KnowledgeLlmReservationRequest,
  source: KnowledgeLlmReservationRequest['selectedContextSources'][number],
) {
  const common = {
    sourceType: source.sourceType,
    ordinal: source.ordinal,
    exactSourceVersion: source.exactSourceVersion,
    exactSourceHash: source.exactSourceHash,
    representationHash: source.representationHash,
    byteLength: source.byteLength,
    estimatedTokens: source.estimatedTokens,
    createdAt: input.now,
    createdBy: input.actor.userId,
  };
  switch (source.sourceType) {
    case 'snapshot':
      return {
        ...common,
        sourceSnapshot: { connect: { id: source.sourceId } },
      };
    case 'annotation_revision':
      return {
        ...common,
        sourceAnnotationRevision: { connect: { id: source.sourceId } },
      };
    case 'conversation_turn':
      return {
        ...common,
        sourceConversationTurn: { connect: { id: source.sourceId } },
      };
    case 'synthesis_version':
      return {
        ...common,
        sourceSynthesisVersion: { connect: { id: source.sourceId } },
      };
    case 'thread_promotion_message':
      return {
        ...common,
        sourceThreadPromotionMessage: { connect: { id: source.sourceId } },
      };
  }
}

async function lockPolicies(
  transaction: Transaction,
  input: KnowledgeLlmReservationRequest,
): Promise<Policy[] | null> {
  const subjects = requiredSubjects(input);
  // Select and lock the active rows in one statement. Reading active policies
  // first and locking only their IDs later leaves a TOCTOU window where a
  // version rollover can make the selected rows inactive before reservation.
  // The Serializable retry then re-resolves the active version after a
  // concurrent rollover instead of applying stale limits.
  const subjectPredicate = Prisma.join(
    subjects.map(
      (subject) => Prisma.sql`
        (
          "subjectType" =
            CAST(${subject.subjectType} AS "KnowledgeLlmBudgetSubjectType")
          AND "subjectId" = ${subject.subjectId}
        )
      `,
    ),
    ' OR ',
  );
  const policies = await transaction.$queryRaw<Policy[]>(Prisma.sql`
    SELECT
      id,
      "subjectType",
      "subjectId",
      currency,
      timezone,
      "softLimitMicros",
      "hardLimitMicros",
      "requestsPerHour"
    FROM "KnowledgeLlmBudgetPolicy"
    WHERE active
      AND (${subjectPredicate})
    ORDER BY "subjectType", "subjectId", id
    FOR UPDATE
  `);
  if (policies.length !== subjects.length) return null;
  return policies;
}

async function ensureAndLockPeriods(
  transaction: Transaction,
  policies: Policy[],
  now: Date,
) {
  const candidates = policies.map((policy) => {
    let window: ReturnType<typeof knowledgeLlmMonthlyPeriod>;
    try {
      window = knowledgeLlmMonthlyPeriod(now, policy.timezone);
    } catch {
      throw new KnowledgeLlmPolicyConfigurationError();
    }
    return { policy, window };
  });

  // Settlement locks all periods for a run in global ID order. Lock every
  // existing current period in that same order before any create/upsert-like
  // operation can acquire an individual period row in policy enum order.
  // Active policy locks serialize creation for the same subject, while a
  // missing period cannot yet be visible to a concurrent settlement.
  const predicate = Prisma.join(
    candidates.map(
      ({ policy, window }) => Prisma.sql`
        (
          "policyId" = ${policy.id}
          AND "periodStartUtc" = ${window.start}
        )
      `,
    ),
    ' OR ',
  );
  const existing = await transaction.$queryRaw<
    Array<{
      id: string;
      policyId: string;
      periodStartUtc: Date;
      periodEndUtc: Date;
      timezone: string;
      currency: string;
    }>
  >(Prisma.sql`
    SELECT id, "policyId", "periodStartUtc", "periodEndUtc", timezone, currency
    FROM "KnowledgeLlmBudgetPeriod"
    WHERE ${predicate}
    ORDER BY id
    FOR UPDATE
  `);
  const existingByPolicy = new Map(
    existing.map((period) => [period.policyId, period]),
  );
  const periods = [];
  for (const { policy, window } of candidates) {
    const period =
      existingByPolicy.get(policy.id) ??
      (await transaction.knowledgeLlmBudgetPeriod.create({
        data: {
          policyId: policy.id,
          periodStartUtc: window.start,
          periodEndUtc: window.end,
          timezone: policy.timezone,
          currency: policy.currency,
        },
      }));
    if (
      period.periodStartUtc.getTime() !== window.start.getTime() ||
      period.periodEndUtc.getTime() !== window.end.getTime() ||
      period.timezone !== policy.timezone ||
      period.currency !== policy.currency
    ) {
      throw new KnowledgeLlmPolicyConfigurationError();
    }
    periods.push({ policy, period, window });
  }
  periods.sort((left, right) => left.period.id.localeCompare(right.period.id));
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "KnowledgeLlmBudgetPeriod"
    WHERE id IN (${Prisma.join(periods.map((entry) => entry.period.id))})
    ORDER BY id
    FOR UPDATE
  `);
  return periods;
}

type SubjectUsage = {
  committedMicros: bigint;
  recentRequestCount: bigint;
  currencyMismatch: boolean;
  timezoneMismatch: boolean;
};

async function loadAndLockSubjectUsage(
  transaction: Transaction,
  entry: Awaited<ReturnType<typeof ensureAndLockPeriods>>[number],
  now: Date,
): Promise<SubjectUsage> {
  const { policy, window } = entry;
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const lockStart =
    hourAgo.getTime() < window.start.getTime() ? hourAgo : window.start;
  const lockedPeriods = await transaction.$queryRaw<
    Array<{
      id: string;
      currency: string;
      timezone: string;
      periodStartUtc: Date;
      periodEndUtc: Date;
    }>
  >(Prisma.sql`
    SELECT period.id, period.currency, period.timezone,
      period."periodStartUtc", period."periodEndUtc"
    FROM "KnowledgeLlmBudgetPeriod" period
    JOIN "KnowledgeLlmBudgetPolicy" policy
      ON policy.id = period."policyId"
    WHERE policy."subjectType" =
        CAST(${policy.subjectType} AS "KnowledgeLlmBudgetSubjectType")
      AND policy."subjectId" = ${policy.subjectId}
      AND period."periodEndUtc" > ${lockStart}
      AND period."periodStartUtc" < ${window.end}
    ORDER BY period.id
    FOR UPDATE OF period
  `);
  // Keep the wider lock set for the rolling 60-minute request count, but only
  // compare accounting metadata for periods that overlap the current monthly
  // window. A completed prior-month period can remain in the wider set for up
  // to an hour and must not block an intentional boundary policy rollover.
  const currentWindowPeriods = lockedPeriods.filter(
    (period) =>
      period.periodEndUtc.getTime() > window.start.getTime() &&
      period.periodStartUtc.getTime() < window.end.getTime(),
  );
  const currencyMismatch = currentWindowPeriods.some(
    (period) => period.currency !== policy.currency,
  );
  const timezoneMismatch = currentWindowPeriods.some(
    (period) => period.timezone !== policy.timezone,
  );
  const usage = await transaction.$queryRaw<Array<SubjectUsage>>(Prisma.sql`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN reservation."createdAt" >= ${window.start}
            AND reservation."createdAt" < ${window.end}
            AND reservation.status = 'reserved'
            THEN reservation."maximumCostMicros"
          WHEN reservation."createdAt" >= ${window.start}
            AND reservation."createdAt" < ${window.end}
            AND reservation.status = 'held_maximum'
            THEN reservation."maximumCostMicros"
          WHEN reservation."createdAt" >= ${window.start}
            AND reservation."createdAt" < ${window.end}
            AND reservation.status = 'settled_actual'
            THEN reservation."actualCostMicros"
          ELSE 0
        END
      ), 0)::bigint AS "committedMicros",
      COUNT(*) FILTER (
        WHERE reservation."createdAt" >= ${hourAgo}
      )::bigint AS "recentRequestCount",
      ${currencyMismatch}::boolean AS "currencyMismatch",
      ${timezoneMismatch}::boolean AS "timezoneMismatch"
    FROM "KnowledgeLlmReservation" reservation
    JOIN "KnowledgeLlmBudgetPeriod" period
      ON period.id = reservation."budgetPeriodId"
    JOIN "KnowledgeLlmBudgetPolicy" historical_policy
      ON historical_policy.id = period."policyId"
    WHERE historical_policy."subjectType" =
        CAST(${policy.subjectType} AS "KnowledgeLlmBudgetSubjectType")
      AND historical_policy."subjectId" = ${policy.subjectId}
      AND reservation."createdAt" >= ${lockStart}
      AND reservation."createdAt" < ${window.end}
  `);
  const result = usage[0];
  if (!result) throw new Error('knowledge_llm_period_mismatch');
  return result;
}

function auditMetadata(
  input: KnowledgeLlmReservationRequest,
  resultCode:
    | 'reserved'
    | 'reused'
    | 'conflict'
    | 'hard_blocked'
    | 'rate_blocked'
    | 'configuration_blocked'
    | 'reservation_conflict',
  policyCount: number,
  softLimitWarning: boolean,
) {
  return {
    provider: input.provider,
    model: input.model,
    scope: input.scope,
    catalogVersion: input.catalogVersion,
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    reservedCostMicros: input.maximumCostMicros.toString(),
    currency: input.currency,
    resultCode,
    policyCount,
    softLimitWarning,
  } as const;
}

async function reserveOnce(
  transaction: Transaction,
  input: KnowledgeLlmReservationRequest,
): Promise<KnowledgeLlmBudgetResult<KnowledgeLlmReservationRecord>> {
  const auditActor = knowledgeProvenanceAuditActor(
    input.actor,
    input.auditActor,
  );
  const audit = new PrismaKnowledgeLlmAuditWriter(transaction);

  const existing = await transaction.knowledgeLlmRequest.findUnique({
    where: {
      actorUserId_requestKeyHash: {
        actorUserId: input.actor.userId,
        requestKeyHash: input.requestKeyHash,
      },
    },
    include: { run: { include: { reservations: true } } },
  });
  if (existing) {
    if (
      existing.requestPayloadHash !== input.requestPayloadHash ||
      existing.run.requestPayloadHash !== input.requestPayloadHash
    ) {
      await audit.write({
        action: 'knowledge_llm_duplicate_detected',
        actor: auditActor,
        targetTable: 'knowledge_llm_runs',
        targetId: existing.runId,
        metadata: auditMetadata(
          input,
          'conflict',
          existing.run.reservations.length,
          false,
        ),
      });
      return failure(409, 'idempotency_conflict');
    }
    await audit.write({
      action: 'knowledge_llm_duplicate_detected',
      actor: auditActor,
      targetTable: 'knowledge_llm_runs',
      targetId: existing.runId,
      metadata: auditMetadata(
        input,
        'reused',
        existing.run.reservations.length,
        existing.run.softLimitWarning,
      ),
    });
    return {
      ok: true,
      value: {
        runId: existing.runId,
        created: false,
        maximumCostMicros: existing.run.maximumCostMicros,
        currency: existing.run.currency,
        softLimitWarning: existing.run.softLimitWarning,
      },
    };
  }

  const policies = await lockPolicies(transaction, input);
  if (!policies) {
    await audit.write({
      action: 'knowledge_llm_budget_blocked',
      actor: auditActor,
      targetTable: 'knowledge_llm_runs',
      targetId: input.runId,
      metadata: auditMetadata(input, 'configuration_blocked', 0, false),
    });
    return failure(400, 'policy_not_found');
  }
  if (policies.some((policy) => policy.currency !== input.currency)) {
    await audit.write({
      action: 'knowledge_llm_budget_blocked',
      actor: auditActor,
      targetTable: 'knowledge_llm_runs',
      targetId: input.runId,
      metadata: auditMetadata(
        input,
        'configuration_blocked',
        policies.length,
        false,
      ),
    });
    return failure(400, 'policy_mismatch');
  }
  const periods = await ensureAndLockPeriods(transaction, policies, input.now);
  const usages = new Map<string, SubjectUsage>();
  for (const entry of periods) {
    const usage = await loadAndLockSubjectUsage(transaction, entry, input.now);
    if (usage.currencyMismatch || usage.timezoneMismatch) {
      // Roll back the current-period upsert before writing the mandatory
      // blocked audit in the outer transaction. A rejected reservation must
      // not leave an otherwise unused accounting period behind.
      throw new KnowledgeLlmPolicyConfigurationError();
    }
    usages.set(entry.policy.id, usage);
    if (usage.recentRequestCount >= BigInt(entry.policy.requestsPerHour)) {
      await audit.write({
        action: 'knowledge_llm_rate_blocked',
        actor: auditActor,
        targetTable: 'knowledge_llm_runs',
        targetId: input.runId,
        metadata: auditMetadata(input, 'rate_blocked', policies.length, false),
      });
      return failure(429, 'rate_limit');
    }
  }

  let softLimitWarning = false;
  for (const { policy } of periods) {
    const usage = usages.get(policy.id);
    if (!usage) throw new Error('knowledge_llm_period_mismatch');
    const afterReservation = usage.committedMicros + input.maximumCostMicros;
    if (afterReservation > policy.hardLimitMicros) {
      await audit.write({
        action: 'knowledge_llm_budget_blocked',
        actor: auditActor,
        targetTable: 'knowledge_llm_runs',
        targetId: input.runId,
        metadata: auditMetadata(input, 'hard_blocked', policies.length, false),
      });
      return failure(409, 'budget_hard_limit');
    }
    if (afterReservation > policy.softLimitMicros) softLimitWarning = true;
  }

  await transaction.knowledgeLlmRun.create({
    data: {
      id: input.runId,
      actorUserId: input.actor.userId,
      scope: input.scope,
      organizationId: input.organizationId,
      provider: input.provider,
      model: input.model,
      catalogVersion: input.catalogVersion,
      promptTemplateVersion: input.promptTemplateVersion,
      requestPayloadHash: input.requestPayloadHash,
      providerRequestHash: input.providerRequestHash,
      selectedContextFingerprint: input.selectedContextFingerprint,
      estimatedInputTokens: input.estimatedInputTokens,
      maxOutputTokens: input.maxOutputTokens,
      inputCostMicrosPerMillion: input.inputCostMicrosPerMillion,
      outputCostMicrosPerMillion: input.outputCostMicrosPerMillion,
      maximumCostMicros: input.maximumCostMicros,
      softLimitWarning,
      currency: input.currency,
      createdAt: input.now,
      createdBy: input.actor.userId,
      updatedAt: input.now,
      updatedBy: input.actor.userId,
      request: {
        create: {
          requestKeyHash: input.requestKeyHash,
          requestPayloadHash: input.requestPayloadHash,
          createdAt: input.now,
          createdBy: input.actor.userId,
        },
      },
      contextSources: {
        create: input.selectedContextSources.map((source) =>
          contextSourceCreateData(input, source),
        ),
      },
      reservations: {
        create: periods.map(({ period }) => ({
          budgetPeriodId: period.id,
          maximumCostMicros: input.maximumCostMicros,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      },
    },
  });
  await audit.write({
    action: 'knowledge_llm_budget_reserved',
    actor: auditActor,
    targetTable: 'knowledge_llm_runs',
    targetId: input.runId,
    metadata: auditMetadata(
      input,
      'reserved',
      policies.length,
      softLimitWarning,
    ),
  });
  return {
    ok: true,
    value: {
      runId: input.runId,
      created: true,
      maximumCostMicros: input.maximumCostMicros,
      currency: input.currency,
      softLimitWarning,
    },
  };
}

export class PrismaKnowledgeLlmBudgetAdapter implements KnowledgeLlmBudgetPort {
  constructor(private readonly client: TransactionHost) {}

  async reserve(
    input: KnowledgeLlmReservationRequest,
  ): Promise<KnowledgeLlmBudgetResult<KnowledgeLlmReservationRecord>> {
    for (
      let attempt = 0;
      attempt < knowledgeLlmLimits.serializableAttempts;
      attempt += 1
    ) {
      try {
        return await this.client.$transaction(
          (transaction) => reserveOnce(transaction, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof KnowledgeLlmPolicyConfigurationError) {
          await this.client.$transaction(async (transaction) => {
            await new PrismaKnowledgeLlmAuditWriter(transaction).write({
              action: 'knowledge_llm_budget_blocked',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_llm_runs',
              targetId: input.runId,
              metadata: auditMetadata(
                input,
                'configuration_blocked',
                requiredSubjects(input).length,
                false,
              ),
            });
          });
          return failure(400, 'policy_mismatch');
        }
        if (!retryable(error)) throw error;
        if (attempt + 1 >= knowledgeLlmLimits.serializableAttempts) {
          await this.client.$transaction(async (transaction) => {
            const audit = new PrismaKnowledgeLlmAuditWriter(transaction);
            await audit.write({
              action: 'knowledge_llm_budget_blocked',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_llm_runs',
              targetId: input.runId,
              metadata: auditMetadata(
                input,
                'reservation_conflict',
                requiredSubjects(input).length,
                false,
              ),
            });
          });
          return failure(409, 'reservation_conflict');
        }
      }
    }
    return failure(409, 'reservation_conflict');
  }
}
