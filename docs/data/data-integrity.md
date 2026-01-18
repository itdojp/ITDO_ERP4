# データ整合性（DB制約・冪等性・監査ログ）

## 目的
ERP領域ではデータ不整合が業務影響に直結しやすいため、アプリ層のバリデーションだけでなく、以下を段階導入する。

- DB制約（重複/不正状態の防止）
- 冪等性（再送・二重実行で壊れない）
- 監査ログ（who/when/what の追跡）

## 対象（今回の最小導入 / Issue #595）
### 1) 重複登録の防止（DB制約）
- 日報: 同一ユーザ・同一日付の重複を禁止
  - `DailyReport` に `@@unique([userId, reportDate])`
- ウェルビーイング: 同一ユーザ・同一日付の重複を禁止
  - `WellbeingEntry` に `@@unique([userId, entryDate])`

### 2) 冪等性（再送対策）
- 承認インスタンス: 同一対象に対する「承認中（pending）」の重複作成を禁止
  - `ApprovalInstance(flowType,targetTable,targetId)` の partial unique index（`status in (pending_qa,pending_exec)`）
  - 既存がある場合は再利用（重複作成を回避）

### 3) 監査ログ（最小）
- 日報/ウェルビーイングの登録（upsert）を監査ログに記録
  - action:
    - `daily_report_upserted`
    - `wellbeing_entry_upserted`

## 実装メモ
### DBマイグレーション
- `packages/backend/prisma/migrations/20260118020000_data_integrity_595/migration.sql`

### 日報/ウェルビーイングの挙動
- `POST /daily-reports` / `POST /wellbeing-entries` は **createではなくupsert** とする
  - 二重送信/再送でも重複レコードを作らない
  - 既存があれば更新して返す

## 残課題（後続）
- 請求/見積/経費/工数の状態遷移（編集可否、承認中の再提出ルール）を明文化し、APIで強制する
- CHECK制約（数量/金額/日付範囲等）の段階導入
- 監査ログの改ざん耐性（署名ログ、外部退避等）は別Issue

