# 休暇管理: 人事向け集計/台帳CSV（Phase 5）

## 目的

- 人事運用で必要な「滞留申請」と「失効見込み」をAPIで可視化する。
- 休暇台帳（付与/取得/失効見込み）をCSVで抽出し、運用検証と監査補助に利用する。

## API

### 1) 人事向け集計

- `GET /leave-entitlements/hr-summary`
- 主なクエリ:
  - `asOfDate` (`YYYY-MM-DD`, 任意)
  - `staleDays`（滞留判定日数, 既定14）
  - `expiringWithinDays`（失効見込み窓, 既定60）
  - `limit`（明細件数上限, 既定50）
- 主な返却:
  - `pending.total` / `pending.stale` / `pending.staleItems`
  - `expiring.paidGrantCount` / `expiring.paidGrantUpperBoundMinutes`
  - `expiring.compGrantCount` / `expiring.compGrantRemainingMinutes`

### 2) 休暇台帳（JSON/CSV）

- `GET /leave-entitlements/hr-ledger`
- 主なクエリ:
  - `userId`（任意）
  - `from` / `to` (`YYYY-MM-DD`, 任意。未指定時は直近90日)
  - `from` / `to` の期間は最大366日（超過時は `400 INVALID_DATE_RANGE`）
  - `limit` / `offset`
  - `format` (`json` | `csv`)
- `format=csv` の出力列:
  - `eventDate,userId,eventType,direction,minutes,sourceTable,sourceId,expiresAt,note`
- `eventType`:
  - `grant`（付与）
  - `usage`（取得）
  - `expiry_scheduled`（失効予定）

## 権限制御

- 両APIとも `general_affairs` グループ所属を必須とする。
- かつ `admin/mgmt/user` ロール経由で認証済みであること。

## 実装上の前提

- `usage` の分数は `resolveLeaveRequestMinutesWithCalendar` で算出する。
- `expiry_scheduled` は `leave_grants.expiresAt` に基づく予定値であり、`direction=upper_bound_debit` / `minutes=grantedMinutes`（上限値）として返す。最終的な失効実績は運用時点の残高計算に依存する。

## 参照

- 仕様起点: Issue `#1268`
- 実装計画: Issue `#1282`（Phase 5）
