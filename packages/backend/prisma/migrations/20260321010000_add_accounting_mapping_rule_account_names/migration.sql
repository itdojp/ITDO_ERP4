ALTER TABLE "AccountingMappingRule"
ADD COLUMN "debitAccountName" TEXT,
ADD COLUMN "creditAccountName" TEXT;

ALTER TABLE "AccountingJournalStaging"
ADD COLUMN "debitAccountName" TEXT,
ADD COLUMN "creditAccountName" TEXT;
