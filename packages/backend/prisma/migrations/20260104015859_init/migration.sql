-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'active', 'on_hold', 'closed');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('draft', 'pending_qa', 'pending_exec', 'approved', 'rejected', 'sent', 'paid', 'cancelled', 'received', 'acknowledged');

-- CreateEnum
CREATE TYPE "TimeStatus" AS ENUM ('submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('draft', 'pending_manager', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('estimate', 'invoice', 'expense', 'leave', 'time', 'purchase_order', 'vendor_invoice', 'vendor_quote');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('budget_overrun', 'overtime', 'approval_delay', 'approval_escalation', 'delivery_due');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('estimate', 'invoice', 'purchase_order');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('hr', 'crm');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "IntegrationRunStatus" AS ENUM ('running', 'success', 'failed');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "invoiceRegistrationId" TEXT,
    "taxRegion" TEXT,
    "billingAddress" TEXT,
    "status" TEXT NOT NULL,
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankInfo" TEXT,
    "taxRegion" TEXT,
    "status" TEXT NOT NULL,
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "projectType" TEXT,
    "parentId" TEXT,
    "customerId" TEXT,
    "ownerUserId" TEXT,
    "orgUnitId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentTaskId" TEXT,
    "name" TEXT NOT NULL,
    "wbsCode" TEXT,
    "assigneeId" TEXT,
    "status" TEXT,
    "planStart" TIMESTAMP(3),
    "planEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "baselineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChatMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" JSONB,
    "reactions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ProjectChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "billUpon" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "taxRate" DECIMAL(65,30),
    "invoiceTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringProjectTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "defaultAmount" DECIMAL(65,30),
    "defaultCurrency" TEXT,
    "defaultTaxRate" DECIMAL(65,30),
    "defaultTerms" TEXT,
    "defaultMilestoneName" TEXT,
    "billUpon" TEXT,
    "dueDateRule" JSONB,
    "shouldGenerateEstimate" BOOLEAN NOT NULL DEFAULT true,
    "shouldGenerateInvoice" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "RecurringProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringGenerationLog" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "estimateId" TEXT,
    "invoiceId" TEXT,
    "milestoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "RecurringGenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'draft',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "numberingSerial" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "taxRate" DECIMAL(65,30),
    "taskId" TEXT,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateId" TEXT,
    "milestoneId" TEXT,
    "invoiceNo" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'draft',
    "pdfUrl" TEXT,
    "emailMessageId" TEXT,
    "numberingSerial" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "taxRate" DECIMAL(65,30),
    "taskId" TEXT,
    "timeEntryRange" TEXT,

    CONSTRAINT "BillingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'draft',
    "pdfUrl" TEXT,
    "numberingSerial" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "taxRate" DECIMAL(65,30),
    "taskId" TEXT,
    "expenseId" TEXT,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorQuote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "quoteNo" TEXT,
    "issueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'received',
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "VendorQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorInvoiceNo" TEXT,
    "receivedDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'received',
    "documentUrl" TEXT,
    "numberingSerial" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "workType" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "status" "TimeStatus" NOT NULL DEFAULT 'submitted',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "role" TEXT NOT NULL,
    "workType" TEXT,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "currency" TEXT NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocStatus" NOT NULL DEFAULT 'draft',
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "hours" INTEGER,
    "status" "LeaveStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "conditions" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalInstance" (
    "id" TEXT NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "targetTable" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'pending_qa',
    "currentStep" INTEGER,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ApprovalInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverGroupId" TEXT,
    "approverUserId" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'pending_qa',
    "actedBy" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSetting" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "threshold" DECIMAL(65,30) NOT NULL,
    "period" TEXT NOT NULL,
    "scopeProjectId" TEXT,
    "recipients" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "remindAfterHours" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AlertSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "sentChannels" JSONB,
    "sentResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "expirationTime" TIMESTAMP(3),
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocTemplateSetting" (
    "id" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "templateId" TEXT NOT NULL,
    "numberRule" TEXT NOT NULL,
    "layoutConfig" JSONB,
    "logoUrl" TEXT,
    "signatureText" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DocTemplateSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT,
    "provider" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "schedule" TEXT,
    "config" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "IntegrationRunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRun" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "status" "IntegrationRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "message" TEXT,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSendLog" (
    "id" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "targetTable" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipients" JSONB,
    "templateId" TEXT,
    "pdfUrl" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DocumentSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSendEvent" (
    "id" TEXT NOT NULL,
    "sendLogId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSendEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSubscription" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "reportKey" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "schedule" TEXT,
    "params" JSONB,
    "recipients" JSONB,
    "channels" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "linkedProjectIds" JSONB,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellbeingEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "helpRequested" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "visibilityGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "WellbeingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "currentSerial" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "targetTable" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "userName" TEXT NOT NULL,
    "displayName" TEXT,
    "givenName" TEXT,
    "familyName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "emails" JSONB,
    "phoneNumbers" JSONB,
    "department" TEXT,
    "organization" TEXT,
    "managerUserId" TEXT,
    "scimMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAccount" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "scimMeta" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "GroupAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_status_deletedAt_idx" ON "Project"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Project_customerId_deletedAt_idx" ON "Project"("customerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Project_ownerUserId_deletedAt_idx" ON "Project"("ownerUserId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_deletedAt_idx" ON "ProjectTask"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProjectTask_parentTaskId_deletedAt_idx" ON "ProjectTask"("parentTaskId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProjectChatMessage_projectId_createdAt_idx" ON "ProjectChatMessage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMilestone_projectId_deletedAt_idx" ON "ProjectMilestone"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProjectMilestone_deletedAt_dueDate_idx" ON "ProjectMilestone"("deletedAt", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringProjectTemplate_projectId_key" ON "RecurringProjectTemplate"("projectId");

-- CreateIndex
CREATE INDEX "RecurringGenerationLog_projectId_periodKey_idx" ON "RecurringGenerationLog"("projectId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringGenerationLog_templateId_periodKey_key" ON "RecurringGenerationLog"("templateId", "periodKey");

-- CreateIndex
CREATE INDEX "Estimate_projectId_status_deletedAt_idx" ON "Estimate"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Estimate_createdAt_idx" ON "Estimate"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "Invoice_projectId_status_deletedAt_idx" ON "Invoice"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_projectId_status_deletedAt_idx" ON "PurchaseOrder"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_status_deletedAt_idx" ON "PurchaseOrder"("vendorId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_issueDate_idx" ON "PurchaseOrder"("issueDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_dueDate_idx" ON "PurchaseOrder"("dueDate");

-- CreateIndex
CREATE INDEX "VendorQuote_projectId_status_deletedAt_idx" ON "VendorQuote"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "VendorQuote_vendorId_status_deletedAt_idx" ON "VendorQuote"("vendorId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "VendorQuote_issueDate_idx" ON "VendorQuote"("issueDate");

-- CreateIndex
CREATE INDEX "VendorInvoice_projectId_status_deletedAt_idx" ON "VendorInvoice"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "VendorInvoice_vendorId_status_deletedAt_idx" ON "VendorInvoice"("vendorId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "VendorInvoice_receivedDate_idx" ON "VendorInvoice"("receivedDate");

-- CreateIndex
CREATE INDEX "VendorInvoice_dueDate_idx" ON "VendorInvoice"("dueDate");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_workDate_deletedAt_idx" ON "TimeEntry"("projectId", "workDate", "deletedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_workDate_idx" ON "TimeEntry"("userId", "workDate");

-- CreateIndex
CREATE INDEX "TimeEntry_status_idx" ON "TimeEntry"("status");

-- CreateIndex
CREATE INDEX "Expense_projectId_deletedAt_idx" ON "Expense"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Expense_userId_incurredOn_idx" ON "Expense"("userId", "incurredOn");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_startDate_idx" ON "LeaveRequest"("userId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRule_flowType_idx" ON "ApprovalRule"("flowType");

-- CreateIndex
CREATE INDEX "ApprovalInstance_projectId_idx" ON "ApprovalInstance"("projectId");

-- CreateIndex
CREATE INDEX "ApprovalInstance_status_createdAt_idx" ON "ApprovalInstance"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalInstance_status_projectId_idx" ON "ApprovalInstance"("status", "projectId");

-- CreateIndex
CREATE INDEX "ApprovalStep_instanceId_idx" ON "ApprovalStep"("instanceId");

-- CreateIndex
CREATE INDEX "ApprovalStep_status_idx" ON "ApprovalStep"("status");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverGroupId_idx" ON "ApprovalStep"("approverGroupId");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverUserId_idx" ON "ApprovalStep"("approverUserId");

-- CreateIndex
CREATE INDEX "ApprovalStep_status_approverGroupId_idx" ON "ApprovalStep"("status", "approverGroupId");

-- CreateIndex
CREATE INDEX "ApprovalStep_status_approverUserId_idx" ON "ApprovalStep"("status", "approverUserId");

-- CreateIndex
CREATE INDEX "AlertSetting_type_isEnabled_idx" ON "AlertSetting"("type", "isEnabled");

-- CreateIndex
CREATE INDEX "Alert_settingId_idx" ON "Alert"("settingId");

-- CreateIndex
CREATE INDEX "Alert_status_triggeredAt_idx" ON "Alert"("status", "triggeredAt");

-- CreateIndex
CREATE INDEX "Alert_targetRef_status_idx" ON "Alert"("targetRef", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_isActive_idx" ON "PushSubscription"("userId", "isActive");

-- CreateIndex
CREATE INDEX "DocTemplateSetting_kind_idx" ON "DocTemplateSetting"("kind");

-- CreateIndex
CREATE INDEX "IntegrationSetting_type_status_idx" ON "IntegrationSetting"("type", "status");

-- CreateIndex
CREATE INDEX "IntegrationRun_settingId_startedAt_idx" ON "IntegrationRun"("settingId", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationRun_status_startedAt_idx" ON "IntegrationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "DocumentSendLog_targetTable_targetId_idx" ON "DocumentSendLog"("targetTable", "targetId");

-- CreateIndex
CREATE INDEX "DocumentSendLog_createdAt_idx" ON "DocumentSendLog"("createdAt");

-- CreateIndex
CREATE INDEX "DocumentSendLog_targetTable_targetId_createdAt_idx" ON "DocumentSendLog"("targetTable", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentSendEvent_sendLogId_idx" ON "DocumentSendEvent"("sendLogId");

-- CreateIndex
CREATE INDEX "DocumentSendEvent_provider_eventType_idx" ON "DocumentSendEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "DocumentSendEvent_createdAt_idx" ON "DocumentSendEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ReportSubscription_reportKey_isEnabled_idx" ON "ReportSubscription"("reportKey", "isEnabled");

-- CreateIndex
CREATE INDEX "ReportSubscription_isEnabled_lastRunAt_idx" ON "ReportSubscription"("isEnabled", "lastRunAt");

-- CreateIndex
CREATE INDEX "ReportDelivery_subscriptionId_sentAt_idx" ON "ReportDelivery"("subscriptionId", "sentAt");

-- CreateIndex
CREATE INDEX "ReportDelivery_status_sentAt_idx" ON "ReportDelivery"("status", "sentAt");

-- CreateIndex
CREATE INDEX "WellbeingEntry_userId_entryDate_idx" ON "WellbeingEntry"("userId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_kind_year_month_key" ON "NumberSequence"("kind", "year", "month");

-- CreateIndex
CREATE INDEX "AuditLog_targetTable_targetId_idx" ON "AuditLog"("targetTable", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_externalId_key" ON "UserAccount"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_userName_key" ON "UserAccount"("userName");

-- CreateIndex
CREATE INDEX "UserAccount_active_idx" ON "UserAccount"("active");

-- CreateIndex
CREATE INDEX "UserGroup_groupId_idx" ON "UserGroup"("groupId");

-- CreateIndex
CREATE INDEX "UserGroup_userId_idx" ON "UserGroup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_userId_groupId_key" ON "UserGroup"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAccount_externalId_key" ON "GroupAccount"("externalId");

-- CreateIndex
CREATE INDEX "GroupAccount_displayName_idx" ON "GroupAccount"("displayName");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatMessage" ADD CONSTRAINT "ProjectChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringProjectTemplate" ADD CONSTRAINT "RecurringProjectTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringGenerationLog" ADD CONSTRAINT "RecurringGenerationLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringProjectTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringGenerationLog" ADD CONSTRAINT "RecurringGenerationLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLine" ADD CONSTRAINT "BillingLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorQuote" ADD CONSTRAINT "VendorQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorQuote" ADD CONSTRAINT "VendorQuote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "AlertSetting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationRun" ADD CONSTRAINT "IntegrationRun_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "IntegrationSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSendEvent" ADD CONSTRAINT "DocumentSendEvent_sendLogId_fkey" FOREIGN KEY ("sendLogId") REFERENCES "DocumentSendLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ReportSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

