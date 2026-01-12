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
| ERP | 内容 | 外部CRMキー例 | 備考 |
| --- | --- | --- | --- |
| code | 顧客コード | account_code | 変更禁止・一意 |
| name | 顧客名 | account_name | 必須 |
| invoiceRegistrationId | 適格請求書番号 | invoice_reg_id | 任意 |
| taxRegion | 税区分 | tax_region | 任意 |
| billingAddress | 請求先住所 | billing_address | 任意 |
| status | 状態 | status | 任意 |
| externalSource | 連携元識別子 | source | ERP保持 |
| externalId | 外部ID | external_id | 外部主キー |
| updatedAt | 更新日時 | updated_at | 差分同期キー |

### CRM: Vendor
| ERP | 内容 | 外部CRMキー例 | 備考 |
| --- | --- | --- | --- |
| code | 業者コード | vendor_code | 変更禁止・一意 |
| name | 業者名 | vendor_name | 必須 |
| bankInfo | 振込情報 | bank_info | 任意 |
| taxRegion | 税区分 | tax_region | 任意 |
| status | 状態 | status | 任意 |
| externalSource | 連携元識別子 | source | ERP保持 |
| externalId | 外部ID | external_id | 外部主キー |
| updatedAt | 更新日時 | updated_at | 差分同期キー |

### CRM: Contact
| ERP | 内容 | 外部CRMキー例 | 備考 |
| --- | --- | --- | --- |
| customerId / vendorId | 紐付け | parent_id | どちらか必須 |
| name | 氏名 | name | 必須 |
| email | メール | email | 任意 |
| phone | 電話 | phone | 任意 |
| role | 役割 | role | 任意 |
| isPrimary | 主担当 | is_primary | 任意 |
| updatedAt | 更新日時 | updated_at | 差分同期キー |

### HR: WellbeingEntry
| ERP | 内容 | 外部HRキー例 | 備考 |
| --- | --- | --- | --- |
| userId | 匿名化ユーザID | user_hash | salted hash |
| entryDate | 入力日 | entry_date | 必須 |
| status | good / not_good | status | 必須 |
| helpRequested | ヘルプ要請 | help_requested | 任意 |
| notes | メモ | notes | 原則除外 |
| updatedAt | 更新日時 | updated_at | 差分同期キー |

### HR: UserAccount
| ERP | 内容 | 外部IDキー例 | 備考 |
| --- | --- | --- | --- |
| externalId | 外部ID | external_id | 主キー |
| userName | ログインID | user_name | 必須 |
| displayName | 表示名 | display_name | 任意 |
| department | 部門 | department | 任意 |
| organization | 組織 | organization | 任意 |
| managerUserId | 上長 | manager_id | 任意 |
| active | 在籍 | active | 必須 |
| updatedAt | 更新日時 | updated_at | 差分同期キー |

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

## 運用検証（手順）
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

## オープン事項
- CRM 側のフィールド定義
  - code 以外の追加コードが必要か（部門コード/請求コード など）
  - 階層構造の想定（顧客グループ/業種カテゴリ等）
  - 担当者の表現（Contact を使うか、Customer/Vendor に追加するか）
- HR 側の属性範囲と既存スキーマの対応整理
  - department / organization / managerUserId の運用
  - employmentType の追加有無
- 双方向同期の必要性（片方向で足りるか）
