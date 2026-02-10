CREATE TABLE "VendorInvoiceLine" (
  "id" TEXT NOT NULL,
  "vendorInvoiceId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(65,30) NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "taxRate" DECIMAL(65,30),
  "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "grossAmount" DECIMAL(65,30) NOT NULL,
  "purchaseOrderLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "VendorInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorInvoiceLine_vendorInvoiceId_lineNo_key"
  ON "VendorInvoiceLine"("vendorInvoiceId", "lineNo");
CREATE INDEX "VendorInvoiceLine_vendorInvoiceId_idx"
  ON "VendorInvoiceLine"("vendorInvoiceId");
CREATE INDEX "VendorInvoiceLine_purchaseOrderLineId_idx"
  ON "VendorInvoiceLine"("purchaseOrderLineId");

ALTER TABLE "VendorInvoiceLine"
  ADD CONSTRAINT "VendorInvoiceLine_vendorInvoiceId_fkey"
  FOREIGN KEY ("vendorInvoiceId")
  REFERENCES "VendorInvoice"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "VendorInvoiceLine"
  ADD CONSTRAINT "VendorInvoiceLine_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId")
  REFERENCES "PurchaseOrderLine"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
