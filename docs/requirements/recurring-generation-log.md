# 定期案件生成履歴（ドラフト）

## 目的
- 定期案件テンプレからの生成結果を追跡し、二重生成を防止する
- 監査/問い合わせ対応で「いつ何が生成されたか」を確認できるようにする

## テーブル案: recurring_generation_logs
- id
- template_id
- project_id
- period_key（例: 2025-12）
- run_at（ジョブ実行時刻）
- status（created / skipped / error）
- message（already_generated / default_amount_missing など）
- estimate_id?
- invoice_id?
- milestone_id?
- created_at
- created_by

## ルール
- 冪等性: template_id + period_key を一意キーとし、同一期間の重複生成を防止する。
- スキップ/失敗も記録し、再実行時の原因確認に使う。
- 既に status=created のログがある場合は、以降の skipped/error で上書きしない。

## 参照用途
- 定期案件テンプレ画面の「生成履歴」一覧
- ジョブ監視（エラー件数の把握）

## 実装メモ
- ジョブ完了時に 1 レコードを insert（成功/失敗を問わず）
- メッセージは固定コード + 任意詳細の組み合わせを想定
