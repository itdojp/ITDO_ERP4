# 承認運用ガイド（ルール設定・承認処理・監査）

## 目的
- 承認フローの「設定」「運用」「監査」を一貫させ、例外処理を減らす

## 対象読者
- 管理者（`admin/mgmt`）
- 承認者（`mgmt/exec` など）

## 参照
- 承認/アラート（要件）: [approval-alerts](../requirements/approval-alerts.md)
- 監査ログ（要件）: [approval-log](../requirements/approval-log.md)
- UI 操作（管理者）: [ui-manual-admin](ui-manual-admin.md)（承認/管理設定/監査ログ）
- 権限/可視範囲: [role-permissions](role-permissions.md)

## 1. 承認ルール（approval_rules）の考え方
- `flowType`（見積/請求/経費/休暇/工数/発注/仕入）ごとにルールを定義する
- `conditions` で適用範囲（例: 金額/定期案件/案件種別）を制御する
- `steps` で承認ステップ（グループ/ユーザ、順序、並列）を定義する

conditions/steps の例は [approval-alerts](../requirements/approval-alerts.md) を参照。

## 2. ルール設定（管理設定画面）
管理設定（AdminSettings）の「承認ルール」で JSON を編集します。

運用上の注意:
- JSON は最小から開始し、変更は Issue/PR で履歴を残す
- ルールが複数ある場合、適用優先順位（どのルールを採用するか）は実装仕様に依存するため、
  追加ルール導入前に PoC で検証する

## 3. 承認処理（承認一覧）
- フィルタ（flowType/status/projectId/approver/requester 等）で対象を絞り込む
- 承認/却下時は **理由（reason）** を残す（監査・後追い前提）

## 4. 遅延アラート（approval_delay / approval_escalation）
- 閾値/通知先/再通知は「アラート設定」で管理する
- 24h 超などの初期値は運用で調整し、設定変更の理由を記録する

## 5. 取消/修正の標準
- 承認後に修正が必要な場合は「取消→修正→再申請」を標準とする
- 工数は「通常は承認なし、修正時のみ承認」方針（詳細は要件参照）

## 6. 監査（AuditLog）
最低限追跡するイベント例:
- 承認/却下/取消（from/to、理由、実行者）
- ルール変更（誰が/いつ/何を）

監査ログの参照方法は [ui-manual-admin](ui-manual-admin.md) を参照。

## 7. 経費フローの固有ルール
- `flowType=expense` は `pending_qa`（経理一次）を通過する構成を維持する
- 申請時は証憑必須（`receiptUrl` または `attachments`）を前提に運用する
- 予算超過時はエスカレーション項目（理由/影響/代替案）が必須
- `pending_qa` 承認前に QA チェックリスト（5項目）を完了させる
- 精算操作（`mark-paid`/`unmark-paid`）は admin/mgmt で統制し、取消理由を必須にする

経費の詳細手順は [expense-workflow-guide](expense-workflow-guide.md) を参照。

## 関連画面（証跡）
![承認](../test-results/2026-02-05-frontend-e2e-r1/07-approvals.png)

![管理設定](../test-results/2026-02-05-frontend-e2e-r1/11-admin-settings.png)

![監査ログ](../test-results/2026-02-05-frontend-e2e-r1/29-audit-logs.png)
