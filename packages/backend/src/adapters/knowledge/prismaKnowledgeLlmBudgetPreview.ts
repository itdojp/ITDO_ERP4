import type { Prisma } from '@prisma/client';

import { knowledgeLlmMonthlyPeriod } from '../../application/knowledge/knowledgeLlmBudgetUseCases.js';
import type {
  KnowledgeLlmBudgetPreview,
  KnowledgeLlmRunPort,
} from '../../application/knowledge/knowledgeLlmRunPorts.js';
import { knowledgeLlmBudgetSubjects } from './prismaKnowledgeLlmAdapterSupport.js';

export type KnowledgeLlmBudgetPreviewClient = Pick<
  Prisma.TransactionClient,
  | 'knowledgeLlmBudgetPolicy'
  | 'knowledgeLlmBudgetPeriod'
  | 'knowledgeLlmReservation'
>;

function blockedBudgetPreview(policyCount: number): KnowledgeLlmBudgetPreview {
  return {
    configured: false,
    policyCount,
    currency: null,
    softLimitWarning: false,
    hardLimitBlocked: true,
    rateBlocked: false,
    subjects: [],
  };
}

export async function loadKnowledgeLlmBudgetPreview(
  client: KnowledgeLlmBudgetPreviewClient,
  input: Parameters<KnowledgeLlmRunPort['budgetPreview']>[0],
): Promise<KnowledgeLlmBudgetPreview> {
  const expected = knowledgeLlmBudgetSubjects(input);
  const policies = await client.knowledgeLlmBudgetPolicy.findMany({
    where: {
      active: true,
      OR: expected.map((subject) => ({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
      })),
    },
    orderBy: [{ subjectType: 'asc' }, { subjectId: 'asc' }],
  });
  const policiesBySubject = new Map(
    policies.map((policy) => [
      `${policy.subjectType}\0${policy.subjectId}`,
      policy,
    ]),
  );
  const orderedPolicies = expected.map((subject) =>
    policiesBySubject.get(`${subject.subjectType}\0${subject.subjectId}`),
  );
  if (
    policies.length !== expected.length ||
    orderedPolicies.some((policy) => policy === undefined)
  ) {
    return blockedBudgetPreview(policies.length);
  }
  const currencies = new Set(policies.map((policy) => policy.currency));
  if (
    currencies.size !== 1 ||
    (input.expectedCurrency !== null &&
      policies.some((policy) => policy.currency !== input.expectedCurrency))
  ) {
    return blockedBudgetPreview(policies.length);
  }

  const subjects: KnowledgeLlmBudgetPreview['subjects'] = [];
  const oneHourAgo = new Date(input.now.getTime() - 60 * 60 * 1000);
  for (const policy of orderedPolicies) {
    if (!policy) return blockedBudgetPreview(policies.length);
    const periodWindow = knowledgeLlmMonthlyPeriod(input.now, policy.timezone);
    const periods = await client.knowledgeLlmBudgetPeriod.findMany({
      where: {
        periodStartUtc: { lt: periodWindow.end },
        periodEndUtc: { gt: periodWindow.start },
        policy: {
          is: {
            subjectType: policy.subjectType,
            subjectId: policy.subjectId,
          },
        },
      },
      select: {
        currency: true,
        timezone: true,
        activeReservedMicros: true,
        settledActualMicros: true,
        heldMaximumMicros: true,
      },
    });
    if (
      periods.some(
        (period) =>
          period.currency !== policy.currency ||
          period.timezone !== policy.timezone,
      )
    ) {
      return blockedBudgetPreview(policies.length);
    }
    const acceptedRequestsLastHour = await client.knowledgeLlmReservation.count(
      {
        where: {
          accountedAt: { gte: oneHourAgo, lt: periodWindow.end },
          budgetPeriod: {
            is: {
              policy: {
                is: {
                  subjectType: policy.subjectType,
                  subjectId: policy.subjectId,
                },
              },
            },
          },
        },
      },
    );
    subjects.push({
      subjectType: policy.subjectType,
      currency: policy.currency,
      softLimitMicros: policy.softLimitMicros,
      hardLimitMicros: policy.hardLimitMicros,
      activeReservedMicros: periods.reduce(
        (total, period) => total + period.activeReservedMicros,
        0n,
      ),
      settledActualMicros: periods.reduce(
        (total, period) => total + period.settledActualMicros,
        0n,
      ),
      heldMaximumMicros: periods.reduce(
        (total, period) => total + period.heldMaximumMicros,
        0n,
      ),
      requestsPerHour: policy.requestsPerHour,
      acceptedRequestsLastHour,
    });
  }
  const afterReservation = subjects.map(
    (subject) =>
      subject.activeReservedMicros +
      subject.settledActualMicros +
      subject.heldMaximumMicros +
      input.maximumCostMicros,
  );
  return {
    configured: true,
    policyCount: subjects.length,
    currency: policies[0]?.currency ?? null,
    softLimitWarning: subjects.some(
      (subject, index) =>
        (afterReservation[index] ?? 0n) > subject.softLimitMicros,
    ),
    hardLimitBlocked: subjects.some(
      (subject, index) =>
        (afterReservation[index] ?? 0n) > subject.hardLimitMicros,
    ),
    rateBlocked: subjects.some(
      (subject) => subject.acceptedRequestsLastHour >= subject.requestsPerHour,
    ),
    subjects,
  };
}
