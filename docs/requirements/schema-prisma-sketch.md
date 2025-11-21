# Prisma風スキーマ叩き台（MVP）

目的: data-model-sketch を具体的な型/enum/制約に落としたラフ案。実装時は Prisma/DDL で整合させる。

```prisma
// 共通
model AuditFields { // 擬似: 実際は全modelにmixin
  createdAt DateTime @default(now()) @map("created_at")
  createdBy String?  @map("created_by")
  updatedAt DateTime @updatedAt @map("updated_at")
  updatedBy String?  @map("updated_by")
}

enum ProjectStatus { draft active on_hold closed }
enum DocStatus { draft pending_qa pending_exec approved rejected sent paid cancelled received acknowledged }
enum TimeStatus { submitted approved rejected }
enum LeaveStatus { draft pending_manager approved rejected }
enum FlowType { estimate invoice expense leave time purchase_order vendor_invoice vendor_quote }
enum AlertType { budget_overrun overtime approval_delay }

// 備考: DocStatus は用途によりサブセットのみを使用（vendor_quote は received/approved/rejected 等）

// マスタ
model Customer {
  id        String  @id @default(uuid())
  code      String  @unique
  name      String
  invoiceRegistrationId String?
  taxRegion String?
  billingAddress String?
  status    String
  externalSource String?
  externalId String?
  contacts  Contact[]
  projects  Project[]
}

model Vendor {
  id        String  @id @default(uuid())
  code      String  @unique
  name      String
  bankInfo  String?
  taxRegion String?
  status    String
  externalSource String?
  externalId String?
  contacts  Contact[]
  purchaseOrders PurchaseOrder[]
  vendorQuotes VendorQuote[]
  vendorInvoices VendorInvoice[]
}

model Contact {
  id        String  @id @default(uuid())
  customer  Customer? @relation(fields: [customerId], references: [id])
  customerId String?
  vendor    Vendor?   @relation(fields: [vendorId], references: [id])
  vendorId  String?
  name      String
  email     String?
  phone     String?
  role      String?
  isPrimary Boolean @default(false)
}

// プロジェクト
model Project {
  id        String  @id @default(uuid())
  code      String  @unique
  name      String
  status    ProjectStatus @default(draft)
  projectType String?
  parent    Project? @relation("ProjectToProject", fields: [parentId], references: [id])
  parentId  String?
  children  Project[] @relation("ProjectToProject")
  customer  Customer? @relation(fields: [customerId], references: [id])
  customerId String?
  ownerUserId String?
  orgUnitId   String?
  startDate DateTime?
  endDate   DateTime?
  currency  String?
  recurringTemplate RecurringProjectTemplate?
  tasks     ProjectTask[]
  milestones ProjectMilestone[]
  estimates Estimate[]
  invoices  Invoice[]
  timeEntries TimeEntry[]
  expenses  Expense[]
  purchaseOrders PurchaseOrder[]
  vendorQuotes VendorQuote[]
  vendorInvoices VendorInvoice[]
}

model ProjectTask {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  parentTask ProjectTask? @relation("TaskToTask", fields: [parentTaskId], references: [id])
  parentTaskId String?
  children  ProjectTask[] @relation("TaskToTask")
  name      String
  wbsCode   String?
  assigneeId String?
  status    String?
  planStart DateTime?
  planEnd   DateTime?
  actualStart DateTime?
  actualEnd DateTime?
  baselineId String?
}

model ProjectMilestone {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  name      String
  amount    Decimal
  billUpon  String // enum: date/acceptance/time (要確定)
  dueDate   DateTime?
  taxRate   Decimal?
  invoiceTemplateId String?
}

model RecurringProjectTemplate {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  frequency String // monthly/quarterly/semiannual/annual
  defaultAmount Decimal?
  defaultTerms  String?
  nextRunAt  DateTime?
  timezone  String?
  isActive  Boolean @default(true)
}

// 見積/請求
model Estimate {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  version   Int
  totalAmount Decimal
  currency  String
  status    DocStatus @default(draft)
  validUntil DateTime?
  notes     String?
  numberingSerial Int?
  lines     EstimateLine[]
}

model EstimateLine {
  id        String  @id @default(uuid())
  estimate  Estimate @relation(fields: [estimateId], references: [id])
  estimateId String
  description String
  quantity  Decimal @default(1)
  unitPrice Decimal
  taxRate   Decimal?
  taskId    String?
}

model Invoice {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  estimate  Estimate? @relation(fields: [estimateId], references: [id])
  estimateId String?
  milestone ProjectMilestone? @relation(fields: [milestoneId], references: [id])
  milestoneId String?
  invoiceNo String @unique
  issueDate DateTime?
  dueDate   DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(draft)
  pdfUrl    String?
  emailMessageId String?
  numberingSerial Int?
  lines     BillingLine[]
}

model BillingLine {
  id        String  @id @default(uuid())
  invoice   Invoice @relation(fields: [invoiceId], references: [id])
  invoiceId String
  description String
  quantity  Decimal @default(1)
  unitPrice Decimal
  taxRate   Decimal?
  taskId    String?
  timeEntryRange String?
}

// 発注/仕入
model PurchaseOrder {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id])
  vendorId  String
  poNo      String @unique
  issueDate DateTime?
  dueDate   DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(draft)
  pdfUrl    String?
  numberingSerial Int?
  lines     PurchaseOrderLine[]
}

model PurchaseOrderLine {
  id        String @id @default(uuid())
  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])
  purchaseOrderId String
  description String
  quantity  Decimal @default(1)
  unitPrice Decimal
  taxRate   Decimal?
  taskId    String?
  expenseId String?
}

model VendorQuote {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id])
  vendorId  String
  quoteNo   String?
  issueDate DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(received) // 実使用: received/approved/rejected
  documentUrl String?
}

model VendorInvoice {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id])
  vendorId  String
  vendorInvoiceNo String?
  receivedDate DateTime?
  dueDate   DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(received) // 実使用: received/pending_qa/approved/paid/rejected
  documentUrl String?
  numberingSerial Int?
}

// タイムシート/レート
model TimeEntry {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  task      ProjectTask? @relation(fields: [taskId], references: [id])
  taskId    String?
  userId    String
  workDate  DateTime
  minutes   Int
  workType  String?
  location  String?
  notes     String?
  status    TimeStatus @default(submitted)
  approvedBy String?
  approvedAt DateTime?
}

model RateCard {
  id        String @id @default(uuid())
  project   Project? @relation(fields: [projectId], references: [id])
  projectId String?
  role      String
  workType  String?
  unitPrice Decimal
  validFrom DateTime
  validTo   DateTime?
  currency  String
}

// 経費/休暇
model Expense {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id])
  projectId String
  userId    String
  category  String
  amount    Decimal
  currency  String
  incurredOn DateTime
  isShared  Boolean @default(false)
  status    DocStatus @default(draft)
  receiptUrl String?
}

model LeaveRequest {
  id        String @id @default(uuid())
  userId    String
  leaveType String
  startDate DateTime
  endDate   DateTime
  hours     Int?
  status    LeaveStatus @default(draft)
  notes     String?
}

// 承認・アラート
model ApprovalRule {
  id        String @id @default(uuid())
  flowType  FlowType
  conditions Json
  steps     Json
}

model ApprovalInstance {
  id        String @id @default(uuid())
  flowType  FlowType
  targetTable String
  targetId  String
  status    DocStatus @default(pending_qa)
  currentStep Int?
  rule      ApprovalRule @relation(fields: [ruleId], references: [id])
  ruleId    String
  steps     ApprovalStep[]
}

model ApprovalStep {
  id        String @id @default(uuid())
  instance  ApprovalInstance @relation(fields: [instanceId], references: [id])
  instanceId String
  stepOrder Int
  approverGroupId String?
  approverUserId  String?
  status    DocStatus @default(pending_qa)
  actedBy   String?
  actedAt   DateTime?
}

model AlertSetting {
  id        String @id @default(uuid())
  type      AlertType
  threshold Decimal
  period    String // day/week/month
  scopeProjectId String?
  recipients Json // emails/roles/users
  channels  Json // email/dashboard/ext_future
  isEnabled Boolean @default(true)
}

model Alert {
  id        String @id @default(uuid())
  setting   AlertSetting @relation(fields: [settingId], references: [id])
  settingId String
  targetRef String
  triggeredAt DateTime @default(now())
  status    String @default("open") // open/ack/closed
  sentChannels Json?
  sentResult  Json?
}

// 日報/ウェルビーイング
model DailyReport {
  id        String @id @default(uuid())
  userId    String
  reportDate DateTime
  content   String
  linkedProjectIds Json?
  status    String?
}

model WellbeingEntry {
  id        String @id @default(uuid())
  userId    String
  entryDate DateTime
  status    String // good/not_good
  helpRequested Boolean @default(false)
  notes     String?
  visibilityGroupId String // 人事グループ
}

// 発番
model NumberSequence {
  id        String @id @default(uuid())
  kind      String // estimate/invoice/delivery/purchase_order/vendor_quote/vendor_invoice
  year      Int
  month     Int
  currentSerial Int
  version   Int @default(0)
  @@unique([kind, year, month])
}
```

補足
- enum は最終的に実データに合わせて整理する。DocStatus は用途により一部だけ使用。
- 金額型は Decimal 前提。通貨は必須。
- JSON を使っている部分はスキーマ確定後に正規化の有無を検討する。
