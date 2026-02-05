CREATE TYPE "ExpenseSettlementStatus" AS ENUM ('unpaid', 'paid');

ALTER TABLE "Expense"
ADD COLUMN "settlementStatus" "ExpenseSettlementStatus" NOT NULL DEFAULT 'unpaid',
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "paidBy" TEXT;
