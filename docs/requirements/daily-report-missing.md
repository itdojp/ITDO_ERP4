# 日報未提出アラート（MVP確定）

## 目的
日報未提出を検知し、本人/管理者へ通知することで運用漏れを抑止する。

## 前提
- 日報は `DailyReport`（reportDate基準）で1日1件の upsert。
- 修正ロックは `WorklogSetting.editableDays` に準拠（workDate基準）。

## 確定事項（MVP）
- 対象ユーザ: `user_accounts.active=true` かつ `deletedAt IS NULL`
- 対象日: `targetDate` 指定時はその日、未指定時は `DAILY_REPORT_MISSING_TARGET_OFFSET_DAYS`（既定 1）日前
- 休日: `DAILY_REPORT_MISSING_SKIP_WEEKEND`（既定 true）で土日をスキップ
- 例外条件: 休暇/入退社/出張はMVPでは未考慮（後続拡張）
- 通知先:
  - 本人: AppNotification（`kind=daily_report_missing`）+ 通知配信ジョブによるメール
  - 管理者: `AlertSetting(type=daily_report_missing)` の閾値超過時のみアラート通知

## 判定ロジック（MVP）
1. 対象日を決定（例: 当日または前日）
2. 対象ユーザの一覧を取得
3. `DailyReport` に `reportDate=対象日` が存在しないユーザを抽出
4. 既に通知済みのユーザはスキップ（サプレッション）

## 実装（MVP）
- AppNotification で本人向け通知を作成（`kind=daily_report_missing`）
- AlertSetting に `daily_report_missing` を追加し、管理者向けに欠損人数をアラート
  - 目安: threshold は「欠損人数」
  - targetRef は `daily-report:YYYY-MM-DD`
- 通知ジョブ: `POST /jobs/daily-report-missing/run`
  - `targetDate` 未指定時は `DAILY_REPORT_MISSING_TARGET_OFFSET_DAYS`（既定 1）日だけ遡及
  - 休日スキップは `DAILY_REPORT_MISSING_SKIP_WEEKEND`（既定 true）
  - 工数入力がある人のみ対象にする場合は `DAILY_REPORT_MISSING_REQUIRE_TIME_ENTRY=true`

## 後続検討
- 休暇/入退社/出張の除外条件
- 会社カレンダー連動（休日判定）
- 監査ログの記録範囲と文面

## 関連
- `docs/requirements/notifications.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/worklog-correction-policy.md`
