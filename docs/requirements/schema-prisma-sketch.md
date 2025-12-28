# Prisma風スキーマ叩き台（MVP）

目的: data-model-sketch を具体的な型/enum/制約に落としたラフ案。実装時は Prisma/DDL で整合させる。

## FK/削除ポリシー詳細（MVP）
物理削除は原則禁止。以下はアプリ設計上の論理削除/参照の方針。

### Project 周辺
- Project.parentId: ON DELETE RESTRICT。子が残る場合は親を論理削除できない
- Project.customerId: ON DELETE RESTRICT。顧客は論理削除のみ、参照は保持
- ProjectTask.projectId: ON DELETE RESTRICT。承認WF外で projectId の付け替えを許容
- ProjectTask.parentTaskId: ON DELETE RESTRICT。親削除時は子を移動または論理削除
- ProjectMilestone.projectId: ON DELETE RESTRICT
- TimeEntry.projectId / Expense.projectId: ON DELETE RESTRICT（必須）

### 見積/請求
- Estimate.projectId: ON DELETE RESTRICT
- Invoice.projectId: ON DELETE RESTRICT
- Invoice.estimateId / Invoice.milestoneId: ON DELETE SET NULL（見積なし請求/マイルストーン任意）
- EstimateLine.taskId / BillingLine.taskId / PurchaseOrderLine.taskId / TimeEntry.taskId: ON DELETE SET NULL（履歴保全）

### 発注/仕入
- PurchaseOrder.projectId / VendorQuote.projectId / VendorInvoice.projectId: ON DELETE RESTRICT
- PurchaseOrder.vendorId / VendorQuote.vendorId / VendorInvoice.vendorId: ON DELETE RESTRICT

### 参照のみ（FKなし）
- ApprovalInstance.targetId: polymorphic 参照のため FK を持たない
- ApprovalInstance.projectId: 対象が案件に紐づく場合は projectId を保持（一覧/アラートの絞り込み用）
- userId/ownerUserId/createdBy/updatedBy: 外部ID前提で FK なし

## NULL許容の整理（MVP）
- Invoice.estimateId / milestoneId: NULL許容（見積なし請求/マイルストーン任意、FK は ON DELETE SET NULL）
- Invoice.issueDate / dueDate, Estimate.validUntil: 起案時未確定のため NULL 許容
- VendorQuote.quoteNo / VendorInvoice.vendorInvoiceNo: 書類番号が無いケースを許容して NULL 可
- EstimateLine/BillingLine/PurchaseOrderLine の taskId/expenseId/timeEntryRange: 関連付け無しを許容、タスク削除時も NULL で履歴保持
- TimeEntry.taskId: 任意。タスク削除時は NULL（工数履歴は保持）
- Project.parentId / ProjectTask.parentTaskId: 最上位は NULL

## createdBy / updatedBy の運用方針
- API経由: 認証ヘッダの userId を createdBy/updatedBy に保存
- バッチ/移行: `system` もしくは NULL（由来を metadata/audit_log に記録）
- 論理削除時: deletedAt/deletedReason を更新し、updatedBy に操作ユーザを保存

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
enum AlertType { budget_overrun overtime approval_delay approval_escalation delivery_due }
enum TemplateKind { estimate invoice purchase_order }

// FK/削除ポリシー（案）
// - 物理削除は原則禁止。deletedAt/deletedReason で論理削除（理由コード）
// - Project 起点: child/estimate/invoice/time/expense/PO/VQ/VI は ON DELETE RESTRICT
// - 子が論理削除済みで残なしの場合のみ親を論理削除可能
// - 子は projectId の付け替えを許容（承認WF中は解除後に移動/削除）
// - Estimate→Invoice, Milestone→Invoice: NULL 許容（見積なし請求を許可、マイルストーン紐付けは任意）、ON DELETE SET NULL
// - マイルストーン未紐付け/未請求の検知はアラート/レポートで対応（納期ベース）
// - 経費は必ず projectId 必須（共通経費は社内/管理案件のプロジェクトで扱う）
// - User参照（userId/ownerUserIdなど）は外部ID想定のためFKなし、値はIDaaS連携時に整合
// - createdBy/updatedBy はアプリ層で設定し、将来 audit_log と突き合わせ可能にする

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
  customer  Customer? @relation(fields: [customerId], references: [id], onDelete: Restrict)
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
  parent    Project? @relation("ProjectToProject", fields: [parentId], references: [id], onDelete: Restrict)
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
  deletedAt DateTime?
  deletedReason String?
}

model ProjectTask {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  parentTask ProjectTask? @relation("TaskToTask", fields: [parentTaskId], references: [id], onDelete: Restrict)
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
  deletedAt DateTime?
  deletedReason String?
}

model ProjectChatMessage {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  userId    String
  body      String
  tags      Json?
  reactions Json?
  createdAt DateTime @default(now())
  createdBy String?
  updatedAt DateTime @updatedAt
  updatedBy String?
  deletedAt DateTime?
  deletedReason String?
}

model ProjectMilestone {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  name      String
  amount    Decimal
  billUpon  String // enum: date/acceptance/time (要確定)
  dueDate   DateTime?
  taxRate   Decimal?
  invoiceTemplateId String?
  deletedAt DateTime?
  deletedReason String?
}

model RecurringProjectTemplate {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String @unique
  frequency String // monthly/quarterly/semiannual/annual
  defaultAmount Decimal?
  defaultCurrency String?
  defaultTaxRate Decimal?
  defaultTerms  String?
  defaultMilestoneName String?
  billUpon String? // date/acceptance/time
  dueDateRule Json?
  shouldGenerateEstimate Boolean?
  shouldGenerateInvoice Boolean?
  nextRunAt  DateTime?
  timezone  String?
  isActive  Boolean @default(true)
}

// 見積/請求
model Estimate {
  id        String  @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  version   Int
  totalAmount Decimal
  currency  String
  status    DocStatus @default(draft)
  validUntil DateTime?
  notes     String?
  numberingSerial Int?
  lines     EstimateLine[]
  deletedAt DateTime?
  deletedReason String?
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
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  estimate  Estimate? @relation(fields: [estimateId], references: [id], onDelete: SetNull)
  estimateId String? // 見積なし請求を許容
  milestone ProjectMilestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)
  milestoneId String? // 任意。未紐付けは納品請求漏れチェック対象
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
  deletedAt DateTime?
  deletedReason String?
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
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id], onDelete: Restrict)
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
  deletedAt DateTime?
  deletedReason String?
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
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  vendorId  String
  quoteNo   String?
  issueDate DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(received) // 実使用: received/approved/rejected
  documentUrl String?
  deletedAt DateTime?
  deletedReason String?
}

model VendorInvoice {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  vendor    Vendor @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  vendorId  String
  vendorInvoiceNo String?
  receivedDate DateTime?
  dueDate   DateTime?
  currency  String
  totalAmount Decimal
  status    DocStatus @default(received) // 実使用: received/pending_qa/approved/paid/rejected
  documentUrl String?
  numberingSerial Int?
  deletedAt DateTime?
  deletedReason String?
}

// タイムシート/レート
model TimeEntry {
  id        String @id @default(uuid())
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  task      ProjectTask? @relation(fields: [taskId], references: [id], onDelete: SetNull)
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
  deletedAt DateTime?
  deletedReason String?
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
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  projectId String
  userId    String
  category  String
  amount    Decimal
  currency  String
  incurredOn DateTime
  isShared  Boolean @default(false)
  status    DocStatus @default(draft)
  receiptUrl String?
  deletedAt DateTime?
  deletedReason String?
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
  project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  projectId String?
  status    DocStatus @default(pending_qa)
  currentStep Int?
  rule      ApprovalRule @relation(fields: [ruleId], references: [id])
  ruleId    String
  steps     ApprovalStep[]

  @@index([projectId])
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
  remindAfterHours Int?
}

model Alert {
  id        String @id @default(uuid())
  setting   AlertSetting @relation(fields: [settingId], references: [id])
  settingId String
  targetRef String
  triggeredAt DateTime @default(now())
  reminderAt  DateTime?
  status    String @default("open") // open/ack/closed
  sentChannels Json?
  sentResult  Json?
}

model DocTemplateSetting {
  id           String @id @default(uuid())
  kind         TemplateKind
  templateId   String
  numberRule   String
  layoutConfig Json?
  logoUrl      String?
  signatureText String?
  isDefault    Boolean @default(false)
}

model DocumentSendLog {
  id               String @id @default(uuid())
  kind             TemplateKind
  targetTable      String
  targetId         String
  channel          String
  status           String
  recipients       Json?
  templateId       String?
  pdfUrl           String?
  providerMessageId String?
  error            String?
  metadata         Json?
  createdAt        DateTime @default(now())
  createdBy        String?

  @@index([targetTable, targetId])
  @@index([createdAt])
  @@index([targetTable, targetId, createdAt])
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
