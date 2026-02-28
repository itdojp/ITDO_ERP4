-- Add consultation confirmation fields for leave submit
ALTER TABLE "LeaveRequest"
  ADD COLUMN "noConsultationConfirmed" BOOLEAN,
  ADD COLUMN "noConsultationReason" TEXT;
