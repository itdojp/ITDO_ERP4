ALTER TABLE "VendorInvoice" ADD COLUMN "purchaseOrderId" TEXT;
ALTER TABLE "VendorInvoice"
  ADD CONSTRAINT "VendorInvoice_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId")
  REFERENCES "PurchaseOrder"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
CREATE INDEX "VendorInvoice_purchaseOrderId_idx" ON "VendorInvoice"("purchaseOrderId");
