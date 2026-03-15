-- CreateEnum
CREATE TYPE "AccountingEventKind" AS ENUM ('expense_approved', 'invoice_approved', 'vendor_invoice_approved');

-- CreateEnum
CREATE TYPE "AccountingJournalStagingStatus" AS ENUM ('pending_mapping', 'ready', 'blocked', 'exported', 'superseded');

-- CreateTable
CREATE TABLE "AccountingEvent" (
    "id" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventKind" "AccountingEventKind" NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "periodKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "projectId" TEXT,
    "projectCode" TEXT,
    "customerCode" TEXT,
    "vendorCode" TEXT,
    "employeeCode" TEXT,
    "departmentCode" TEXT,
    "externalRef" TEXT,
    "description" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "AccountingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingJournalStaging" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingJournalStagingStatus" NOT NULL DEFAULT 'pending_mapping',
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "mappingKey" TEXT,
    "debitAccountCode" TEXT,
    "debitSubaccountCode" TEXT,
    "creditAccountCode" TEXT,
    "creditSubaccountCode" TEXT,
    "departmentCode" TEXT,
    "taxCode" TEXT,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "AccountingJournalStaging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEvent_sourceTable_sourceId_eventKind_key" ON "AccountingEvent"("sourceTable", "sourceId", "eventKind");
CREATE INDEX "AccountingEvent_eventKind_eventAt_idx" ON "AccountingEvent"("eventKind", "eventAt");
CREATE INDEX "AccountingEvent_periodKey_eventKind_idx" ON "AccountingEvent"("periodKey", "eventKind");
CREATE INDEX "AccountingEvent_projectId_eventAt_idx" ON "AccountingEvent"("projectId", "eventAt");
CREATE UNIQUE INDEX "AccountingJournalStaging_eventId_lineNo_key" ON "AccountingJournalStaging"("eventId", "lineNo");
CREATE INDEX "AccountingJournalStaging_status_entryDate_idx" ON "AccountingJournalStaging"("status", "entryDate");
CREATE INDEX "AccountingJournalStaging_mappingKey_status_idx" ON "AccountingJournalStaging"("mappingKey", "status");

-- AddForeignKey
ALTER TABLE "AccountingJournalStaging"
  ADD CONSTRAINT "AccountingJournalStaging_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "AccountingEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
