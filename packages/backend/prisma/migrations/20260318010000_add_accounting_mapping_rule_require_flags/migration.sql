ALTER TABLE "AccountingMappingRule"
  ADD COLUMN "requireDebitSubaccountCode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireCreditSubaccountCode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireDepartmentCode" BOOLEAN NOT NULL DEFAULT false;
