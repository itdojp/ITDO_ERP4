# HR/CRM 連携要件（案）

## 目的

- HR: wellbeing/ID 連携の対象範囲と匿名化方針を定める。
- CRM: 顧客/業者/連絡先の同期範囲とマッピングを定める。

## 連携対象（案）

### HR

- WellbeingEntry（テーブル: wellbeing_entries）
  - status: good / not_good
  - job_engagement / stress_level / not_good_tags / help_requested / entry_date
  - notes は原則連携対象外（必要時は別途同意/匿名化方針を検討）
- UserAccount（ID 連携用）
  - externalId / department / organization / managerUserId
  - employmentType は追加要否を別途整理

### CRM

- Customer / Vendor / Contact
- プロジェクト（任意: CRM 側に案件が存在する場合）

## フィールドマッピング（暫定）

### CRM: Customer

| ERP                   | 内容           | 外部CRMキー例   | 備考           |
| --------------------- | -------------- | --------------- | -------------- |
| code                  | 顧客コード     | account_code    | 変更禁止・一意 |
| name                  | 顧客名         | account_name    | 必須           |
| invoiceRegistrationId | 適格請求書番号 | invoice_reg_id  | 任意           |
| taxRegion             | 税区分         | tax_region      | 任意           |
| billingAddress        | 請求先住所     | billing_address | 任意           |
| status                | 状態           | status          | 任意           |
| externalSource        | 連携元識別子   | source          | ERP保持        |
| externalId            | 外部ID         | external_id     | 外部主キー     |
| updatedAt             | 更新日時       | updated_at      | 差分同期キー   |

### CRM: Vendor

| ERP            | 内容         | 外部CRMキー例 | 備考           |
| -------------- | ------------ | ------------- | -------------- |
| code           | 業者コード   | vendor_code   | 変更禁止・一意 |
| name           | 業者名       | vendor_name   | 必須           |
| bankInfo       | 振込情報     | bank_info     | 任意           |
| taxRegion      | 税区分       | tax_region    | 任意           |
| status         | 状態         | status        | 任意           |
| externalSource | 連携元識別子 | source        | ERP保持        |
| externalId     | 外部ID       | external_id   | 外部主キー     |
| updatedAt      | 更新日時     | updated_at    | 差分同期キー   |

### CRM: Contact

| ERP                   | 内容     | 外部CRMキー例 | 備考         |
| --------------------- | -------- | ------------- | ------------ |
| customerId / vendorId | 紐付け   | parent_id     | どちらか必須 |
| name                  | 氏名     | name          | 必須         |
| email                 | メール   | email         | 任意         |
| phone                 | 電話     | phone         | 任意         |
| role                  | 役割     | role          | 任意         |
| isPrimary             | 主担当   | is_primary    | 任意         |
| updatedAt             | 更新日時 | updated_at    | 差分同期キー |

### HR: WellbeingEntry

| ERP           | 内容            | 外部HRキー例   | 備考         |
| ------------- | --------------- | -------------- | ------------ |
| userId        | 匿名化ユーザID  | user_hash      | salted hash  |
| entryDate     | 入力日          | entry_date     | 必須         |
| status        | good / not_good | status         | 必須         |
| helpRequested | ヘルプ要請      | help_requested | 任意         |
| notes         | メモ            | notes          | 原則除外     |
| updatedAt     | 更新日時        | updated_at     | 差分同期キー |

### HR: UserAccount

| ERP           | 内容       | 外部IDキー例 | 備考         |
| ------------- | ---------- | ------------ | ------------ |
| externalId    | 外部ID     | external_id  | 主キー       |
| userName      | ログインID | user_name    | 必須         |
| displayName   | 表示名     | display_name | 任意         |
| department    | 部門       | department   | 任意         |
| organization  | 組織       | organization | 任意         |
| managerUserId | 上長       | manager_id   | 任意         |
| active        | 在籍       | active       | 必須         |
| updatedAt     | 更新日時   | updated_at   | 差分同期キー |

## マスター/優先順位

- HR: IdP/IDaaS を一次マスター（UserAccount は IdP/IDaaS からの同期専用で、HR からは参照のみ）
- CRM: 外部CRMを一次マスター、ERPは参照/補助入力

## 差分同期キー/衝突解決

### 差分同期キー

- CRM: externalId + externalSource を主キー、updatedAt を差分同期キーとして利用
- CRM: externalId が未設定の場合は code を暫定キーとして扱う
- HR: UserAccount は externalId を主キー、updatedAt を差分同期キーとして利用
- HR: WellbeingEntry は (userId, entryDate) を重複防止キーとして扱う

### 衝突解決ルール

- CRM: 外部CRMを一次マスターとし、外部更新が常に優先
- CRM: code が一致し externalId が異なる場合は外部IDを優先し、ERP側は上書き
- HR: UserAccount は IDaaS が一次マスターのため、ERP側の更新は原則上書きしない
- HR: WellbeingEntry は追記のみ（更新/削除はしない）

## 連携方式・頻度

- 方式:
  - HR ユーザー/グループ: 原則 SCIM（詳細は `scim-sync.md`）
  - HR データの初期投入/例外対応: CSV インポート
  - CRM データ: 各システムの REST API 等による API 同期
- 頻度: 日次 or イベント駆動（必要に応じて再送）

## 代表コネクタ PoC（Phase 3 v1）

### CRM コネクタ（実装済み）

- `GET /integrations/crm/exports/customers`
- `GET /integrations/crm/exports/vendors`
- `GET /integrations/crm/exports/contacts`

### HR コネクタ（実装済み）

- `GET /integrations/hr/exports/users`
- `GET /integrations/hr/exports/wellbeing`
- `GET /integrations/hr/exports/leaves`
- `POST /integrations/hr/exports/leaves/dispatch`
- `GET /integrations/hr/exports/leaves/dispatch-logs`
- `POST /integrations/hr/attendance/closings`
- `GET /integrations/hr/attendance/closings`
- `GET /integrations/hr/attendance/closings/:id/summaries`

共通仕様（GET export）:

- query: `updatedSince?`, `limit?`, `offset?`
- 認可: `admin` / `mgmt`
- `updatedSince` は `updatedAt > updatedSince` 判定
- 不正な `updatedSince` は `400 invalid_updatedSince`

休暇 export 系 API（追加仕様）:

- `GET /integrations/hr/exports/leaves`
  - query: `target?`（`attendance|payroll`）、`updatedSince?`、`limit?`（1..2000）、`offset?`（0..100000）
  - 連携対象: `status=approved` の休暇申請のみ
  - ペイロード: `leaveTypeName` / `leaveTypeUnit` / `leaveTypeIsPaid` / `requestedMinutes` を含む
- `POST /integrations/hr/exports/leaves/dispatch`
  - body: `target`（必須）、`idempotencyKey`（必須）、`updatedSince?`、`limit?`、`offset?`
  - 応答: `replayed`（再利用判定）、`payload`（export結果）、`log`（実行ログ）
  - 冪等制御:
    - 同一 `idempotencyKey` + 同一条件: 前回成功/失敗結果を再利用（`replayed=true`）
    - 同一 `idempotencyKey` + 異なる条件: `409 idempotency_conflict`
    - 同一 `idempotencyKey` の実行中再入: `409 dispatch_in_progress`
- `GET /integrations/hr/exports/leaves/dispatch-logs`
  - query: `target?`, `idempotencyKey?`, `limit?`（1..1000）, `offset?`（0..100000）
  - 監査確認項目: `status` / `exportedCount` / `updatedSince` / `exportedUntil` / `message`

勤怠締め系 API（追加仕様）:

- `POST /integrations/hr/attendance/closings`
  - body: `periodKey`（`YYYY-MM`、必須）、`reclose?`
  - 対象月に未承認 `TimeEntry` / `LeaveRequest` が残っている場合は `409 attendance_period_unconfirmed`
  - `employeeCode` 未設定の対象者がいる場合は `409 attendance_employee_code_missing`
  - `reclose=true` 時は新しい `version` を採番し、前版を `superseded` に更新
- `GET /integrations/hr/attendance/closings`
  - query: `periodKey?`, `limit?`, `offset?`
  - 締め版一覧と総計メタデータを返す
- `GET /integrations/hr/attendance/closings/:id/summaries`
  - query: `limit?`, `offset?`
  - 指定締め版の `AttendanceMonthlySummary` を返す

## EvidencePack と外部連携実行の関連付け仕様（確定）

v1 方針:

- SoR は `integration_runs.id` と `approval_instances.id` を基準に紐付ける。
- 監査再現は audit log を主経路にする（`targetTable=integration_runs`, `targetId=<runId>`）。
- 参照キーは以下を標準化する。
  - `approvalInstanceId`（必須）
  - `evidenceSnapshotVersion`（任意）
  - `evidencePackDigest`（任意、PDF/JSON export の SHA-256）

運用ルール:

- 外部連携を承認付き操作として扱う場合、少なくとも `approvalInstanceId` を記録する。
- digest が存在する場合は再計算可能な形式（SHA-256 hex）で保持する。
- 監査時は `integration_runs` と EvidenceSnapshot/EvidencePack を上記キーで突合する。

段階導入:

- Phase 3 v1 では仕様を固定し、関連付け情報の記録経路を audit metadata に順次追加する。

## 匿名化/閲覧制御（HR）

- wellbeing の閲覧は人事グループのみ
- 集計は 5人未満を非表示（既存ルール）
- 外部連携時は個人識別子を最小化
  - user_id は匿名化ID（salted hash など）に変換
  - notes は原則除外（必要ならマスキング/同意）

## エラー/再送方針

- 失敗時は再送キューに保持（最大3回、指数バックオフ: 1h → 2h → 4h）
- 永続失敗は管理者に通知し、手動再送の導線を用意
- 失敗理由を監査ログに残す

## 運用ポリシー（Phase 3）

### 失敗分類

- `simulate_failure`: テスト用強制失敗（運用時は設定禁止）
- `invalid_updatedSince`: 差分同期キーの入力不正
- `unknown_error`: 上記以外（message 監査ログで確認）

### リトライ

- 設定値: `config.retryMax`（0..10）, `config.retryBaseMinutes`（1..1440）
- 算出: 指数バックオフ（`retryBaseMinutes * 2^(retryCount-1)`）
- 失敗時に `retryCount` / `nextRetryAt` を更新し、`/jobs/integrations/run` が期限到来分を再実行

### 信頼境界チェック（入力検証）

- `schedule`: 文字列のみ、最大200文字
- `config`: object/null のみ、最大100キー、最大32KB
- `config.retryMax`, `config.retryBaseMinutes`, `config.simulateFailure`, `config.updatedSince` を型・範囲検証
- 不正入力は `400 invalid_config` / `400 invalid_schedule` で拒否

### 監査

- `integration_setting_created`
- `integration_setting_updated`
- `integration_run_executed`（trigger: manual/retry/scheduled）
- `integration_jobs_run_executed`
- 監査メタデータは機微キー（token/secret/password/apiKey 等）を `[REDACTED]` でマスク

## 運用検証（手順）

### 自動テスト（backend integration）

- `packages/backend/test/integrationRetryRoutes.test.js`
  - `/jobs/integrations/run` が `nextRetryAt <= now` かつ `retryCount < retryMax` の失敗 run のみ再実行すること
  - `simulateFailure=true` 時に `retryCount` と `nextRetryAt`（指数バックオフ）が更新されること
  - `status=disabled` の setting が `/integration-settings/:id/run` で拒否されること
  - `/integration-runs/metrics` が成功率・遅延（avg/p95）・失敗理由・type別集計を返すこと

### 手動実行

- `/integration-settings/:id/run` を実行し、`integration_runs` に status=success が記録されることを確認。
- `metrics` に件数（CRM指標: customers/vendors/contacts、HR指標: users/wellbeing）が入ることを確認。

### 定期実行（cron）

- `/jobs/integrations/run` を定期実行し、schedule が設定された setting が実行されることを確認。
- 現状 schedule 文字列の解釈は未実装のため、cron 側で頻度を制御する。

### 差分同期（updatedSince）

- `config.updatedSince` を指定して delta が取得できることを確認（`updatedAt > updatedSince` 判定）。
- 境界値: updatedSince を直前時刻/当日 00:00 にした場合の件数と再実行時の差分を比較。

### 失敗/リトライ

- `config.simulateFailure=true` で失敗を再現し、run.status=failed/nextRetryAt を確認。
- `alert_settings`（type=integration_failure）によりアラートが作成されることを確認。
- `retryMax/retryBaseMinutes` に従って `/jobs/integrations/run` で再送されることを確認。

### 監視指標（例）

- 実行件数（runs/day）、失敗件数、リトライ件数
- delta件数（updatedSinceを指定した場合の customers/vendors/contacts/users/wellbeing）
- 実行時間（startedAt/finishedAt）

### 追加API（運用向け）

- `GET /integration-runs/metrics`
  - query: `settingId?`, `days?`（既定14）, `limit?`（既定2000）
  - response:
    - `summary`: `totalRuns/successRuns/failedRuns/runningRuns/retryScheduledRuns/successRate/avgDurationMs/p95DurationMs`
    - `failureReasons`: 失敗理由の上位件数
    - `byType`: `hr` / `crm` など type別集計

## オープン事項

- CRM 側のフィールド定義
  - code 以外の追加コードが必要か（部門コード/請求コード など）
  - 階層構造の想定（顧客グループ/業種カテゴリ等）
  - 担当者の表現（Contact を使うか、Customer/Vendor に追加するか）
- HR 側の属性範囲と既存スキーマの対応整理
  - department / organization / managerUserId の運用
  - employmentType の追加有無
- 双方向同期の必要性（片方向で足りるか）
