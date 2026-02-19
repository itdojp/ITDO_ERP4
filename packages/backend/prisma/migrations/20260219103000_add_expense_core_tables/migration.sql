CREATE TABLE "ExpenseLine" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "expenseDate" TIMESTAMP(3),
  "category" TEXT,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(65, 30) NOT NULL,
  "taxRate" DECIMAL(65, 30),
  "taxAmount" DECIMAL(65, 30),
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseAttachment" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "contentType" TEXT,
  "fileSizeBytes" INTEGER,
  "fileHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseComment" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'general',
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "ExpenseComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseLine_expenseId_lineNo_key"
  ON "ExpenseLine"("expenseId", "lineNo");
CREATE INDEX "ExpenseLine_expenseId_lineNo_idx"
  ON "ExpenseLine"("expenseId", "lineNo");
CREATE INDEX "ExpenseAttachment_expenseId_createdAt_idx"
  ON "ExpenseAttachment"("expenseId", "createdAt");
CREATE INDEX "ExpenseComment_expenseId_createdAt_idx"
  ON "ExpenseComment"("expenseId", "createdAt");

ALTER TABLE "ExpenseLine"
  ADD CONSTRAINT "ExpenseLine_expenseId_fkey"
  FOREIGN KEY ("expenseId")
  REFERENCES "Expense"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "ExpenseAttachment"
  ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey"
  FOREIGN KEY ("expenseId")
  REFERENCES "Expense"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "ExpenseComment"
  ADD CONSTRAINT "ExpenseComment_expenseId_fkey"
  FOREIGN KEY ("expenseId")
  REFERENCES "Expense"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
