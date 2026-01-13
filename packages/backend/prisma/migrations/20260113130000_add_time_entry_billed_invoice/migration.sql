-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "billedInvoiceId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN "billedAt" TIMESTAMPTZ;

-- AddForeignKey
ALTER TABLE "TimeEntry"
ADD CONSTRAINT "TimeEntry_billedInvoiceId_fkey"
FOREIGN KEY ("billedInvoiceId") REFERENCES "Invoice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "TimeEntry_billedInvoiceId_idx" ON "TimeEntry"("billedInvoiceId");
