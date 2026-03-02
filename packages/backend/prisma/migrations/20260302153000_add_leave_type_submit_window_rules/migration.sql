ALTER TABLE "LeaveType"
ADD COLUMN "submitLeadDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "allowRetroactiveSubmit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "retroactiveLimitDays" INTEGER;
