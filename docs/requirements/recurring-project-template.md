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
- dueDateRule
  - 保存形式: JSON オブジェクト
  - 例: 月度終了日から 30 日後を支払期日にする場合
    ```json
    { "type": "periodEndPlusOffset", "offsetDays": 30 }
    ```
  - 備考: 「period_end + offset_days」は概念的な表現（擬似コード）として扱う
- shouldGenerateEstimate (bool)
- shouldGenerateInvoice (bool)

## 生成ルール（MVP）
- バッチジョブ（スケジュールは `docs/requirements/batch-jobs.md` を参照）が `nextRunAt <= now` のテンプレを取得する。
- project.status が active のみ生成対象とする（draft/on_hold/closed は生成しない）。
- 期間キー: projectId + period（例: 2025-12）で冪等性を担保する。
- 生成物:
  - ProjectMilestone（defaultMilestoneName, amount, dueDateRule）
  - Estimate/Invoice はテンプレ設定に従いドラフト作成
  - Estimate/Invoice と ProjectMilestone の紐付けルール
    - テンプレから同時生成された ProjectMilestone がある場合、milestoneId を必須で紐付ける
    - 手入力などの非テンプレ起案では milestoneId を任意とする
- 生成時点では番号採番しない。submit 時に発番し、承認ルールを適用する。
- 生成後に nextRunAt を frequency に応じて更新する。

## 承認/採番との接続
- 生成されたドラフトには `isRecurring=true` を設定する。
- approval_rules の conditions.isRecurring でスキップ条件を判定する。
- draft → submit 時に番号採番し、ApprovalInstance を生成する。

## UI設計（MVP）
### 画面構成
- Project詳細の「定期案件テンプレ」タブ
  - 基本設定（頻度/有効化/次回実行）
  - 金額/通貨/税率/支払条件
  - 生成対象（見積/請求/マイルストーン）
  - 期日ルール（dueDateRule）
  - 保存/無効化
- 生成履歴（period, 作成日時, 作成者, 生成物）を一覧表示

### 入力項目とバリデーション
- frequency: 必須。monthly/quarterly/semiannual/annual のみ
- isActive: 初期 true。false の場合は生成停止
- nextRunAt: 任意。空の場合は直近実行（job 実行時に now を採用）
- timezone: 任意。未指定時は `Asia/Tokyo`
- defaultAmount: 必須（見積/請求/マイルストーン生成のいずれかが有効な場合）
- defaultCurrency: 任意。未指定時は project.currency を使用
- defaultTaxRate: 任意（0〜）
- defaultTerms: 任意（支払条件/備考）
- defaultMilestoneName: 任意。入力がある場合はマイルストーン生成対象
- billUpon: default `date`。マイルストーン生成時は必須
- dueDateRule: 任意。初期は `periodEndPlusOffset` + offsetDays（0〜365）のみ対応
- shouldGenerateEstimate / shouldGenerateInvoice: 任意。初期は請求のみ（Invoice=true, Estimate=false）。いずれも false の場合でも、マイルストーン設定があればマイルストーンのみ生成

### 操作/ガード
- 生成済みドラフトの更新は行わず、次回以降の生成にのみ反映
- isActive=false は即停止（次回実行予定のみ更新）
  - 参照: `docs/requirements/recurring-generation-log.md`

## 変更/停止ルール
- テンプレ変更は「今後の生成」にのみ反映する（過去のドラフトは更新しない）。
- isActive=false で生成停止。
- 誤生成時はドラフトを論理削除し、生成履歴に理由を記録する。

## 未決定/確認事項
- なし（MVP方針は上記にて確定）
