# ERP4正本データと項目ギャップ分析（給与/会計連携）

更新日: 2026-03-16
関連ISSUE: #1433, #1430

## 目的

- ERP4 を給料らくだ・経理上手くんα連携の前段システムとして使う際に、2026-03-10 時点の repository 実装で正本として扱えるデータと、不足しているデータを整理する。
- 外部製品の実環境差異は #1431、現物 CSV 差異は #1432 で別途確定し、本書はその前段となる ERP4 側棚卸を扱う。

## 前提

- 根拠は現行 schema / route / requirement docs とする。
- 対象は Phase 1 の片方向連携（ERP4 -> 外部システム）である。
- 実際の CSV 列定義や製品版差異は未確定のため、本書の「不足」は ERP4 実装観点の暫定判定を含む。

## 1. 現行 ERP4 で正本として扱える領域

### 1.1 従業員・組織の基本属性

- 保持済み
  - `UserAccount.userName/displayName/givenName/familyName/active/department/organization/managerUserId/externalId`
  - `GroupAccount.displayName`, `UserGroup`
- 根拠
  - `packages/backend/prisma/schema.prisma:1857`

### 1.2 勤怠・休暇の明細データ

- 保持済み
  - 休暇申請: `LeaveRequest`
  - 休暇種別/付与/残高関連: `LeaveType`, `LeaveEntitlementProfile`, `LeaveGrant`, `LeaveCompGrant`, `LeaveCompConsumption`
  - 工数/作業時間: `TimeEntry`
- 既存 export
  - `GET /integrations/hr/exports/leaves`
  - `POST /integrations/hr/exports/leaves/dispatch`
  - `GET /integrations/hr/exports/leaves/dispatch-logs`
- 根拠
  - `packages/backend/prisma/schema.prisma:653`
  - `packages/backend/prisma/schema.prisma:1130`
  - `packages/backend/prisma/schema.prisma:1300`
  - `packages/backend/src/routes/integrations.ts:1360`
  - `docs/requirements/hr-crm-integration.md`

### 1.3 申請・証憑・会計イベントの元データ

- 保持済み
  - 経費: `Expense`, `ExpenseLine`, `ExpenseAttachment`, `ExpenseQaChecklist`
  - 売上/請求: `Estimate`, `Invoice`, `BillingLine`
  - 発注/仕入: `PurchaseOrder`, `PurchaseOrderLine`, `VendorInvoice`, `VendorInvoiceLine`, `VendorInvoiceAllocation`
  - 承認/証跡: `ApprovalInstance`, `ApprovalRule`, `EvidenceSnapshot`, `Annotation`, `ReferenceLink`
- 根拠
  - `packages/backend/prisma/schema.prisma:917`
  - `packages/backend/prisma/schema.prisma:941`
  - `packages/backend/prisma/schema.prisma:989`
  - `packages/backend/prisma/schema.prisma:1053`
  - `packages/backend/prisma/schema.prisma:1175`
  - `packages/backend/prisma/schema.prisma:1339`

### 1.4 連携・ジョブ・監査の基盤

- 保持済み
  - `IntegrationSetting`, `IntegrationRun`, `LeaveIntegrationExportLog`
  - `AuditLog`
  - 冪等 dispatch / retry / metrics の基盤
- 根拠
  - `packages/backend/prisma/schema.prisma:1514`
  - `packages/backend/prisma/schema.prisma:1546`
  - `packages/backend/src/routes/integrations.ts:1142`
  - `packages/backend/src/routes/auditLogs.ts:168`

## 2. 給料らくだ連携に対するギャップ

### 2.1 社員マスタ系

ERP4 に不足している、または現行 schema では粒度が不足している項目

| 分類                         | 現状                                                | 判定           | 補足                                                         |
| ---------------------------- | --------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| 外部連携用社員コード         | `UserAccount.employeeCode` を追加                   | 初期充足       | 桁数・文字種・採番ルールは別途確定が必要                     |
| 所属/組織                    | `department`, `organization`, `GroupAccount` はある | 条件付きで充足 | 実 CSV の部門/所属コード列次第でコード値が不足する可能性あり |
| 役職                         | 専用項目なし                                        | 不足           | `group` だけでは給与連携用の役職表現にならない可能性が高い   |
| 雇用区分                     | `UserAccount.employmentType` を追加                 | 初期充足       | コード体系は別途確定が必要                                   |
| 支払口座                     | `EmployeePayrollProfile.bankInfo` を追加            | 初期充足       | 項目粒度とマスキング方針は別途確定が必要                     |
| 給与体系/締日/基準日数・時間 | `EmployeePayrollProfile` を追加                     | 初期充足       | payrollType / closingType まで。詳細コード体系は別途確定     |
| 在籍状態                     | `active` あり                                       | 充足           | ただし退職日/休職開始日などの履歴粒度は不足                  |
| 上長情報                     | `managerUserId` あり                                | 充足           | 対象製品の表現差に応じて補助コードが必要                     |

- `#1442` の初期実装で、社員マスタ canonical CSV export / dispatch / dispatch log を追加した
- ただし、実テンプレートに合わせた列最終確定、コード体系、Shift_JIS/CRLF 変換、口座項目の扱いは後続課題として残る

### 2.2 勤怠確定値系

| 分類                                      | 現状                                                          | 判定     | 補足                                   |
| ----------------------------------------- | ------------------------------------------------------------- | -------- | -------------------------------------- |
| 日次/明細の休暇データ                     | `LeaveRequest` あり                                           | 充足     | 既存 leave export あり                 |
| 作業時間明細                              | `TimeEntry` あり                                              | 充足     | ただし給与用の勤怠集計とは別           |
| 月次締め済み勤怠確定値                    | `AttendanceClosingPeriod` / `AttendanceMonthlySummary` を追加 | 初期充足 | issue #1440 の基盤実装を開始           |
| 締め状態/締め基準日                       | `AttendanceClosingPeriod.status/closedAt`                     | 条件付き | `PeriodLock` 連動や対象環境運用は後続  |
| 出勤日数/残業/遅刻早退/有給消化の確定集計 | 出勤日数/総残業/paid-unpaid leave を集計保存                  | 条件付き | 遅刻早退、法定内外/深夜/休日残業は後続 |
| 再締め/再出力時の基準スナップショット     | `periodKey + version` で保持                                  | 初期充足 | `reclose=true` で再締め版を追加作成    |

### 2.3 給与向けに現状利用できるもの

- 既存 leave export は「休暇申請の approved 明細を HR 向けに出す」用途には使える
- ただし「給料らくだへ投入する月次勤怠確定 CSV」の代替にはならない
- 従って、`#1437` と `#1440` で法定内外/深夜/休日残業、遅刻早退、CSV 列確定を後続で詰める必要がある

## 3. 経理上手くんα連携に対するギャップ

### 3.1 仕訳元イベント

- 既存の元データは十分にある
  - 経費、請求、発注、仕入、案件、承認、証憑
- `AccountingEvent` / `AccountingJournalStaging` の baseline は追加済みだが、mapping master と CSV 出力判定は未実装

### 3.2 不足している主要要素

| 分類                                     | 現状                                                | 判定           | 補足                                                                   |
| ---------------------------------------- | --------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| 勘定科目マスタ                           | 専用モデルなし                                      | 不足           | 科目コードの責任主体も未定                                             |
| 補助科目/枝番マスタ                      | 専用モデルなし                                      | 不足           | 取引先/案件をそのまま枝番にするか未定                                  |
| 部門コード/PJコードの外部連携表現        | `Project.code` はある                               | 条件付きで充足 | 経理上手くんα側の部門体系と一致させる設計が必要                        |
| 税区分コード                             | `taxRate` は各明細にある                            | 不足           | 税率はあるが外部製品コードへの変換表がない                             |
| 仕訳候補/仕訳ヘッダ・明細 staging        | `AccountingEvent` / `AccountingJournalStaging` 追加 | 条件付きで充足 | `expenses` / `invoices` / `vendor_invoices` の承認完了を baseline 実装 |
| ICS CSV export / dispatch / dispatch-log | `AccountingIcsExportLog` と export route を追加     | 初期充足       | `ready` 行のみ出力。mapping 未完了時は停止                             |
| 借貸一致の事前検証                       | 個別画面ロジックはあるが会計連携用の共通層なし      | 不足           | CSV 出力前 validation が必要                                           |
| 再出力/取消/差戻し時の会計イベント版管理 | 専用ジョブ・版管理なし                              | 不足           | issue #1444, #1445 に接続                                              |

### 3.3 現状使えるコード・番号

- `Customer.code`, `Vendor.code`, `Project.code`
- `invoiceNo`, `poNo`, `estimateNo`
- これらは外部連携キー候補にはなるが、会計コード体系そのものではない

## 4. 証憑・監査・照合の観点

### 4.1 既に使えるもの

- `ApprovalInstance` / `EvidenceSnapshot` による承認証跡
- `Annotation` / `ReferenceLink` による内部参照・外部 URL
- `AuditLog` による出力・再送・承認・ジョブ実行の監査

### 4.2 まだ不足しているもの

- 給与 CSV / 仕訳 CSV の実行単位を共通管理するジョブモデル
- 外部取込結果と ERP4 出力結果の照合レポート
- 「いつの月次確定値を使って出したか」を一意に追跡する export snapshot

## 5. 現時点の結論

### 5.1 ERP4 で既に正本として使える領域

- 従業員の基本 ID・組織属性
- 休暇申請と付与残高
- 工数明細
- 経費/請求/発注/仕入の原票
- 承認・証跡・監査

### 5.2 実装が必要な領域

- 給与前提マスタ（社員コード、役職、雇用区分、支払口座、給与体系等）
- 月次勤怠確定モデルと締め処理
- 会計イベント -> 仕訳 staging / マッピング / 出力前検証
- 外部連携ジョブ管理、再出力管理、照合レポート

## 6. 次の設計論点

- `#1434` 外部連携コード体系設計
  - 社員コード、科目コード、枝番、部門/PJ コード、税区分コードの責任主体を確定する
- `#1435` 共通連携仕様策定
  - export 単位、再出力、idempotency、監査、エラーコードを共通化する
- `#1436` `#1437` `#1438`
  - 実サンプル CSV を基準に、給料らくだ・経理上手くんα 向けの列仕様を確定する
- `#1444`
  - ICS CSV export を共通ジョブ管理と再出力 UI に統合する

## 7. 根拠ファイル

- `packages/backend/prisma/schema.prisma`
- `packages/backend/src/routes/integrations.ts`
- `docs/requirements/hr-crm-integration.md`
- `docs/requirements/annotations.md`
- `docs/requirements/workflow-evidence-pack.md`
