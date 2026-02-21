ALTER TABLE "Expense"
  ADD COLUMN "budgetSnapshot" JSONB,
  ADD COLUMN "budgetOverrunAmount" DECIMAL(65, 30),
  ADD COLUMN "budgetEscalationReason" TEXT,
  ADD COLUMN "budgetEscalationImpact" TEXT,
  ADD COLUMN "budgetEscalationAlternative" TEXT,
  ADD COLUMN "budgetEscalationUpdatedAt" TIMESTAMP(3);
