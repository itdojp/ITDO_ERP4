import type {
  DocStatus,
  ExpenseSettlementStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

type TransitionWriteClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  'expenseStateTransitionLog'
>;

export type ExpenseStateSnapshot = {
  status: DocStatus | null;
  settlementStatus: ExpenseSettlementStatus | null;
};

type LogExpenseStateTransitionInput = {
  client: TransitionWriteClient;
  expenseId: string;
  from: ExpenseStateSnapshot;
  to: ExpenseStateSnapshot;
  actorUserId?: string | null;
  reasonText?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

export function hasExpenseStateChanged(
  from: ExpenseStateSnapshot,
  to: ExpenseStateSnapshot,
) {
  return (
    from.status !== to.status || from.settlementStatus !== to.settlementStatus
  );
}

export async function logExpenseStateTransition(
  input: LogExpenseStateTransitionInput,
) {
  const { client, expenseId, from, to, actorUserId, reasonText, metadata } =
    input;
  if (!hasExpenseStateChanged(from, to)) {
    return null;
  }
  if (!to.status || !to.settlementStatus) {
    throw new Error('to.status and to.settlementStatus are required');
  }
  return client.expenseStateTransitionLog.create({
    data: {
      expenseId,
      fromStatus: from.status,
      toStatus: to.status,
      fromSettlementStatus: from.settlementStatus,
      toSettlementStatus: to.settlementStatus,
      actorUserId: actorUserId || null,
      reasonText: reasonText || null,
      metadata: metadata ?? undefined,
    },
  });
}
