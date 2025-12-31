# 性能/正規化チューニング方針（案）

## 目的
- 大規模データ運用を前提にクエリ/インデックスを再設計する。
- 集計用途のサマリテーブル/マテビューの方針を明確化する。

## 想定データ量（目安）
- time_entries: 月10万件〜
- expenses: 月1万件〜
- approval_instances/alerts: 日数百件
- invoices/purchase_orders: 月数千件

## 主要クエリプロファイル
- 工数集計: project/user/group + 期間
- 請求/発注一覧: project/status + 期間
- 承認一覧: status + approverGroup + 期間
- アラート一覧: status + project + 期間
- レポート: 収支/工数/残業

## 正規化/非正規化の方針
- **正規化**: 参照整合性が重要なテーブル（users/projects/vendors）。
- **非正規化**: 参照頻度が高い集計系はサマリテーブルを検討。
- **時系列パーティション**: time_entries/alerts/document_send_logs は期間パーティションを検討。

## インデックス再設計の方針
- 期間検索 + 対象ID の複合インデックスを優先。
- `deleted_at` を含むソフトデリート複合インデックスを維持。
- 承認一覧は `status + approverGroupId + createdAt` を主軸。

## 追加済み（初期）
- approval_instances: (status, created_at), (status, project_id)
- approval_steps: (status, approver_group_id), (status, approver_user_id), (approver_group_id), (approver_user_id)
- alert_settings: (type, is_enabled)
- alerts: (status, triggered_at), (target_ref, status)

## 実測計画（#154）
### 対象クエリの代表例
- 承認一覧（approval_instances + approval_steps）
  - 条件: flowType/status/projectId/approverGroupId/approverUserId/currentStep
  - SQL例:
    - `SELECT ai.* FROM "ApprovalInstance" ai WHERE ai."status" = $1 ORDER BY ai."createdAt" DESC LIMIT 100;`
    - `SELECT ai.* FROM "ApprovalInstance" ai WHERE ai."status" = $1 AND ai."projectId" = $2 ORDER BY ai."createdAt" DESC LIMIT 100;`
    - `SELECT ai.* FROM "ApprovalInstance" ai WHERE EXISTS (SELECT 1 FROM "ApprovalStep" st WHERE st."instanceId" = ai."id" AND st."status" = $1 AND st."approverGroupId" = $2) ORDER BY ai."createdAt" DESC LIMIT 100;`
- アラート一覧（alerts）
  - 条件: status/targetRef/order by triggeredAt
  - SQL例:
    - `SELECT * FROM "Alert" WHERE "status" = $1 ORDER BY "triggeredAt" DESC LIMIT 100;`
    - `SELECT * FROM "Alert" WHERE "targetRef" = $1 AND "status" = $2 ORDER BY "triggeredAt" DESC LIMIT 100;`
- 工数集計（time_entries）
  - 条件: projectId/userId/workDate
  - SQL例:
    - `SELECT "projectId", "userId", date_trunc('month', "workDate") AS period, SUM("minutes") FROM "TimeEntry" WHERE "workDate" BETWEEN $1 AND $2 GROUP BY 1,2,3;`
    - `SELECT "projectId", date_trunc('month', "workDate") AS period, SUM("minutes") FROM "TimeEntry" WHERE "projectId" = $1 AND "workDate" BETWEEN $2 AND $3 GROUP BY 1,2;`
- 収支/予実レポート（reports）
  - 条件: projectId/period/groupId/userId
  - SQL例:
    - `SELECT "projectId", date_trunc('month', "workDate") AS period, SUM("minutes") FROM "TimeEntry" WHERE "projectId" = $1 GROUP BY 1,2;`
    - `SELECT "projectId", date_trunc('month', "incurredOn") AS period, SUM("amount") FROM "Expense" WHERE "projectId" = $1 GROUP BY 1,2;`

### 計測手順
1. staging にて `EXPLAIN (ANALYZE, BUFFERS)` を取得し、結果を docs に記録。
2. `pg_stat_statements` で上位クエリの頻度/平均時間を取得。
   - 実行テンプレ: `scripts/checks/pg-stat-statements.sql`
   - podman: `scripts/podman-poc.sh stats`（コンテナ起動時に `shared_preload_libraries` に `pg_stat_statements` を含めておくと、スクリプト内の `enable_pg_stat` で自動的に有効化を試みる）
3. index/partition/summary の再設計が必要な箇所を整理。
4. 実行テンプレート: `scripts/checks/perf-explain.sql` を使用（psql の `-v` でID/期間を指定）。

## サマリテーブル案
- project_effort_summary (project_id, period_key, user_id?, group_id?, minutes, cost)
- project_profit_summary (project_id, period_key, revenue, cost)
- overtime_summary (user_id, period_key, minutes)

## 実行計画（段階）
1. 実データ想定のクエリ一覧を確定
2. EXPLAIN/ANALYZE を用いたボトルネック抽出
3. インデックス再設計とサマリテーブル設計
4. バッチ/集計ジョブの実装と監視
