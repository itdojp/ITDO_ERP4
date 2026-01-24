# 日報未提出アラート（たたき台）

## 目的
日報未提出を検知し、本人/管理者へ通知することで運用漏れを抑止する。

## 前提
- 日報は `DailyReport`（reportDate 기준）で1日1件の upsert。
- 修正ロックは `WorklogSetting.editableDays` に準拠（workDate基準）。

## 主要論点（未確定）
- 対象ユーザ: 全員 / 一部ロール / 特定グループのみ
- 対象日: 平日限定 / 休日含む / 会社カレンダー連動
- 判定タイミング: 翌日朝 / 当日締め時刻（例: 23:59 or 25:00）
- 例外条件: 休暇申請/終日休暇/入社日/退職日/出張日
- 通知先: 本人のみ / 管理者のみ / 両方

## 判定ロジック（案）
1. 対象日を決定（例: 当日または前日）
2. 対象ユーザの一覧を取得
3. `DailyReport` に `reportDate=対象日` が存在しないユーザを抽出
4. 既に通知済みのユーザはスキップ（サプレッション）

## 実装案
- AlertSetting に `daily_report_missing` を追加
- threshold は「欠損人数」または「欠損率」で運用
- targetRef は `userId:YYYY-MM-DD` を基本とし、通知重複を防止

## TODO
- [ ] 対象ユーザの範囲を確定
- [ ] 休日/休暇の扱いを確定
- [ ] 通知チャネルと文面を決定
- [ ] 監査ログに残す範囲を決定

## 関連
- `docs/requirements/notifications.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/worklog-correction-policy.md`
