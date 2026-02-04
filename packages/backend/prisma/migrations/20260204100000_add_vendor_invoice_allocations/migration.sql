CREATE TABLE "VendorInvoiceAllocation" (
  "id" TEXT NOT NULL,
  "vendorInvoiceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT,
  "amount" DECIMAL(65,30) NOT NULL,
  "taxRate" DECIMAL(65,30),
  "taxAmount" DECIMAL(65,30),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "VendorInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorInvoiceAllocation_vendorInvoiceId_idx" ON "VendorInvoiceAllocation"("vendorInvoiceId");
CREATE INDEX "VendorInvoiceAllocation_projectId_idx" ON "VendorInvoiceAllocation"("projectId");
CREATE INDEX "VendorInvoiceAllocation_purchaseOrderLineId_idx" ON "VendorInvoiceAllocation"("purchaseOrderLineId");

ALTER TABLE "VendorInvoiceAllocation" ADD CONSTRAINT "VendorInvoiceAllocation_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "VendorInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceAllocation" ADD CONSTRAINT "VendorInvoiceAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceAllocation" ADD CONSTRAINT "VendorInvoiceAllocation_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
