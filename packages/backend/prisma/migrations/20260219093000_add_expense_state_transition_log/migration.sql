CREATE TABLE "ExpenseStateTransitionLog" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "fromStatus" "DocStatus",
  "toStatus" "DocStatus" NOT NULL,
  "fromSettlementStatus" "ExpenseSettlementStatus",
  "toSettlementStatus" "ExpenseSettlementStatus" NOT NULL,
  "actorUserId" TEXT,
  "reasonText" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExpenseStateTransitionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpenseStateTransitionLog_expenseId_createdAt_idx"
  ON "ExpenseStateTransitionLog"("expenseId", "createdAt");

ALTER TABLE "ExpenseStateTransitionLog"
  ADD CONSTRAINT "ExpenseStateTransitionLog_expenseId_fkey"
  FOREIGN KEY ("expenseId")
  REFERENCES "Expense"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
