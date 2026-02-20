CREATE TABLE "ExpenseQaChecklist" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "amountVerified" BOOLEAN NOT NULL DEFAULT false,
  "receiptVerified" BOOLEAN NOT NULL DEFAULT false,
  "journalPrepared" BOOLEAN NOT NULL DEFAULT false,
  "projectLinked" BOOLEAN NOT NULL DEFAULT false,
  "budgetChecked" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "ExpenseQaChecklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseQaChecklist_expenseId_key"
  ON "ExpenseQaChecklist"("expenseId");

CREATE INDEX "ExpenseQaChecklist_completedAt_idx"
  ON "ExpenseQaChecklist"("completedAt");

ALTER TABLE "ExpenseQaChecklist"
  ADD CONSTRAINT "ExpenseQaChecklist_expenseId_fkey"
  FOREIGN KEY ("expenseId")
  REFERENCES "Expense"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
