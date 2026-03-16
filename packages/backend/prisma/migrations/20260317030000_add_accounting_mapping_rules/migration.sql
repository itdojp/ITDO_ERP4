CREATE TABLE "AccountingMappingRule" (
    "id" TEXT NOT NULL,
    "mappingKey" TEXT NOT NULL,
    "debitAccountCode" TEXT NOT NULL,
    "debitSubaccountCode" TEXT,
    "creditAccountCode" TEXT NOT NULL,
    "creditSubaccountCode" TEXT,
    "departmentCode" TEXT,
    "taxCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AccountingMappingRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingMappingRule_mappingKey_key" ON "AccountingMappingRule"("mappingKey");

CREATE INDEX "AccountingMappingRule_isActive_mappingKey_idx" ON "AccountingMappingRule"("isActive", "mappingKey");
