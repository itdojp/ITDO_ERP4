# Project/Task 付け替え方針（ドラフト）

## 目的
- 誤登録の修正を許容しつつ、不正な損益操作や監査回避を防ぐ
- 移動の理由と影響を説明できる状態にする

## 対象
- ProjectTask
- TimeEntry
- Expense
- Invoice / PurchaseOrder / VendorInvoice / VendorQuote（原則制限）

## 想定される不正/事故
- 損益/予実の操作（赤字案件の工数・経費を移動）
- アラート回避（予算超過/残業/承認遅延の回避）
- 承認結果の無効化（承認済みデータの移動）
- 請求/発注の改ざん（送付済みの計上先変更）
- 期末処理の改ざん（締め済み期間の移動）

## 基本方針（MVP）
- 実行権限は admin/mgmt のみ
- 承認フロー中のデータは移動不可（WF解除/取消後に実施）
- approved/sent/paid/closed など確定状態は移動不可
- 請求/発注/仕入に紐づく工数・経費は移動不可
- 付け替え理由を必須入力（理由コード + 自由記述）
- 監査ログに from/to を必ず記録

## 付け替え可否の目安
- ProjectTask: 子タスク/工数がある場合は一括移動のみ
- TimeEntry: 請求・発注・承認済みでなければ可
- Expense: 承認済み/仕訳済み/請求連動済みは不可
- Invoice/PO/VendorInvoice/VendorQuote: 送信/承認後は不可

## 期間ロック
- 月次/四半期の締め済み期間は移動不可
- 例外は管理部 + 経営の二重承認（後続スコープ）

## 監査ログ・通知
- 記録項目: actor, reasonCode, reasonText, fromProjectId/fromTaskId, toProjectId/toTaskId, affectedIds, timestamp
- 付け替え発生時は管理部ダッシュボードに通知

## 実装メモ（案）
- APIは resource別に `POST /time-entries/:id/reassign` などを用意
- サーバ側で状態/関連チェックを実施し、違反時は 400/403
- 付け替え履歴テーブル（例: reassignment_log）を追加

## 次のTODO
- 締め期間の定義（締め済みフラグの持ち方）
- 付け替え理由コードの初期セット決定
- 承認解除/取消の手順と権限の明確化
