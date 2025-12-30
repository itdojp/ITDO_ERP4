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

## サマリテーブル案
- project_effort_summary (project_id, period_key, user_id?, group_id?, minutes, cost)
- project_profit_summary (project_id, period_key, revenue, cost)
- overtime_summary (user_id, period_key, minutes)

## 実行計画（段階）
1. 実データ想定のクエリ一覧を確定
2. EXPLAIN/ANALYZE を用いたボトルネック抽出
3. インデックス再設計とサマリテーブル設計
4. バッチ/集計ジョブの実装と監視
