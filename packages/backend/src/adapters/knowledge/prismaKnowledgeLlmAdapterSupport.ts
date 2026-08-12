import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';

export type KnowledgeReadSnapshotHost<TClient> = Partial<{
  $transaction<T>(
    work: (transaction: TClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}>;

export function withKnowledgeReadSnapshot<TClient, T>(
  host: KnowledgeReadSnapshotHost<TClient>,
  fallback: TClient,
  read: (client: TClient) => Promise<T>,
): Promise<T> {
  if (typeof host.$transaction !== 'function') {
    // Injected transaction clients and lightweight unit fakes use this path.
    return read(fallback);
  }
  return host.$transaction(read, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export function knowledgeLlmBudgetSubjects(input: {
  actor: KnowledgeActor;
  scope: 'personal' | 'organization';
  organizationId: string | null;
}) {
  return [
    { subjectType: 'user' as const, subjectId: input.actor.userId },
    ...(input.scope === 'organization' && input.organizationId
      ? [
          {
            subjectType: 'organization' as const,
            subjectId: input.organizationId,
          },
        ]
      : []),
  ];
}
