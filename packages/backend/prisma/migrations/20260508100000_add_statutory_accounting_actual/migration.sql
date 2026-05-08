CREATE TABLE "StatutoryAccountingActualImportBatch" (
    "importBatchKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "accountingSystem" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "StatutoryAccountingActualImportBatch_pkey" PRIMARY KEY ("importBatchKey")
);

CREATE TABLE "StatutoryAccountingActual" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "importBatchKey" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "accountingSystem" TEXT NOT NULL,
    "sourceRef" TEXT,
    "projectCode" TEXT,
    "departmentCode" TEXT,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT,
    "amountType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "StatutoryAccountingActual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StatutoryAccountingActualImportBatch_periodKey_importedAt_idx" ON "StatutoryAccountingActualImportBatch"("periodKey", "importedAt");

CREATE UNIQUE INDEX "StatutoryAccountingActual_importBatchKey_rowNo_key" ON "StatutoryAccountingActual"("importBatchKey", "rowNo");
CREATE INDEX "StatutoryAccountingActual_periodKey_amountType_currency_idx" ON "StatutoryAccountingActual"("periodKey", "amountType", "currency");
CREATE INDEX "StatutoryAccountingActual_periodKey_currency_idx" ON "StatutoryAccountingActual"("periodKey", "currency");
CREATE INDEX "StatutoryAccountingActual_periodKey_projectCode_currency_idx" ON "StatutoryAccountingActual"("periodKey", "projectCode", "currency");
CREATE INDEX "StatutoryAccountingActual_periodKey_departmentCode_currency_idx" ON "StatutoryAccountingActual"("periodKey", "departmentCode", "currency");
CREATE INDEX "StatutoryAccountingActual_importBatchKey_importedAt_idx" ON "StatutoryAccountingActual"("importBatchKey", "importedAt");

ALTER TABLE "StatutoryAccountingActual" ADD CONSTRAINT "StatutoryAccountingActual_importBatchKey_fkey" FOREIGN KEY ("importBatchKey") REFERENCES "StatutoryAccountingActualImportBatch"("importBatchKey") ON DELETE CASCADE ON UPDATE CASCADE;
