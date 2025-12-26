# 定期案件テンプレ（ドラフト）

## 目的
- 定期保守などの繰り返し案件をテンプレ化し、起案/請求の手間を削減する
- 金額・条件はデフォルト値として自動入力し、起案時に編集できるようにする

## 対象
- recurring_project_templates
- Project / ProjectMilestone / Estimate / Invoice

## 前提
- 例外日（休日調整など）は初期スコープ外。
- 生成はドラフトのみ。承認・発番は submit 時に実行。

## テンプレ項目（MVP）
- projectId
- frequency: monthly / quarterly / semiannual / annual
- isActive
- timezone
- nextRunAt
- defaultAmount / currency / taxRate
- defaultTerms（支払条件・備考）
- defaultMilestoneName
- billUpon（date/acceptance/time）
- dueDateRule（例: period_end + offset_days）
- generateEstimate (bool)
- generateInvoice (bool)

## 生成ルール（MVP）
- cron が `nextRunAt <= now` のテンプレを取得する。
- project.status が active のみ生成対象とする（draft/on_hold/closed は生成しない）。
- 期間キー: projectId + period（例: 2025-12）で冪等性を担保する。
- 生成物:
  - ProjectMilestone（defaultMilestoneName, amount, dueDateRule）
  - Estimate/Invoice はテンプレ設定に従いドラフト作成
  - milestoneId を invoice/estimate に紐付ける（任意）
- 生成時点では番号採番しない。submit 時に発番し、承認ルールを適用する。
- 生成後に nextRunAt を frequency に応じて更新する。

## 承認/採番との接続
- 生成されたドラフトには `isRecurring=true` を設定する。
- approval_rules の conditions.isRecurring でスキップ条件を判定する。
- draft → submit 時に番号採番し、ApprovalInstance を生成する。

## UI想定
- Project詳細の「定期案件テンプレ」タブ
  - frequency/isActive/nextRunAt の設定
  - defaultAmount/currency/taxRate/defaultTerms の入力
  - generateEstimate/generateInvoice の選択
  - dueDateRule の設定
- 生成履歴（period, 作成日時, 作成者, 生成物）を一覧表示

## 変更/停止ルール
- テンプレ変更は「今後の生成」にのみ反映する（過去のドラフトは更新しない）。
- isActive=false で生成停止。
- 誤生成時はドラフトを論理削除し、生成履歴に理由を記録する。

## 未決定/確認事項
- generateEstimate/generateInvoice の初期値（請求のみ or 両方）
- dueDateRule の最小粒度（日付固定 or 月末 + offset のみ）
- 生成履歴テーブルの仕様（recurring_generation_logs を追加するか）
