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

## マスター/優先順位
- HR: IdP/IDaaS を一次マスター（UserAccount は IdP/IDaaS からの同期専用で、HR からは参照のみ）
- CRM: 外部CRMを一次マスター、ERPは参照/補助入力

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
- 失敗時は再送キューに保持（最大3回、指数バックオフ）
- 永続失敗は管理者に通知し、手動再送の導線を用意
- 失敗理由を監査ログに残す

## オープン事項
- CRM 側のフィールド定義
  - code 以外の追加コードが必要か（部門コード/請求コード など）
  - 階層構造の想定（顧客グループ/業種カテゴリ等）
  - 担当者の表現（Contact を使うか、Customer/Vendor に追加するか）
- HR 側の属性範囲と既存スキーマの対応整理
  - department / organization / managerUserId の運用
  - employmentType の追加有無
- 双方向同期の必要性（片方向で足りるか）
