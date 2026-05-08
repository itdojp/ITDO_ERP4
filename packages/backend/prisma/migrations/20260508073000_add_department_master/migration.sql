CREATE TABLE "DepartmentMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DepartmentMaster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepartmentMaster_code_key" ON "DepartmentMaster"("code");
CREATE UNIQUE INDEX "DepartmentMaster_externalCode_key" ON "DepartmentMaster"("externalCode");
CREATE INDEX "DepartmentMaster_active_code_idx" ON "DepartmentMaster"("active", "code");
