# 経費ワークフロー運用ガイド（拡張）

## 目的

- 経費申請の「起票→承認→精算→監査」を運用で再現可能な形に統一する
- 証憑不足・予算超過・承認漏れを早期に検知し、差戻しを減らす

## 対象読者

- 申請者（`user`）
- 承認者/経理（`mgmt` / `exec`）
- 管理者（`admin`）

## 対象範囲

- 経費本体（`Expense`）
- 経費明細（`ExpenseLine`）
- 証憑添付（`ExpenseAttachment`）
- コメント（`ExpenseComment`）
- QAチェック（`ExpenseQaChecklist`）
- 状態遷移ログ（`ExpenseStateTransitionLog`）

## 状態遷移（業務フロー）

- 承認状態: `draft` → `pending_qa` → `pending_exec` → `approved` / `rejected`
- 精算状態: `unpaid` ↔ `paid`

補足:

- 経費の一次承認（`pending_qa`）は QA チェックリスト完了が必須
- `mark-paid` は `approved` のみ許可
- `unmark-paid` は理由必須

## 申請時の必須チェック

### 1) 証憑必須

- 以下のどちらかを満たす必要があります
  - `receiptUrl` が設定されている
  - `attachments` が 1 件以上ある
- 未充足時は `POST /expenses/:id/submit` が `RECEIPT_REQUIRED` で拒否されます

### 2) 予算超過時のエスカレーション必須

- 予算判定で超過となる場合、以下 3 項目が必須です
  - `budgetEscalationReason`
  - `budgetEscalationImpact`
  - `budgetEscalationAlternative`
- 未入力時は `BUDGET_ESCALATION_REQUIRED` で拒否されます

### 3) 明細合計整合

- `lines` を使う場合は `sum(lines.amount) == amount` が必須です
- 不整合時は `INVALID_AMOUNT` で拒否されます

## 承認時（QA/Exec）の運用

- `pending_qa` 承認前に QA チェックリストを更新する
  - `amountVerified`
  - `receiptVerified`
  - `journalPrepared`
  - `projectLinked`
  - `budgetChecked`
- すべて `true` でない場合、承認は `EXPENSE_QA_CHECKLIST_REQUIRED` で拒否されます

## 精算時の運用

- 支払実行: `POST /expenses/:id/mark-paid`
  - `admin/mgmt` のみ
  - 任意で `paidAt`, `reasonText` を指定
- 支払取消: `POST /expenses/:id/unmark-paid`
  - `admin/mgmt` のみ
  - `reasonText` 必須

## 監査・追跡

### 監査ログ

- `expense_comment_add`
- `expense_qa_checklist_upsert`
- `expense_budget_escalation_update`
- `expense_mark_paid`
- `expense_unmark_paid`

### 状態遷移ログ

- `GET /expenses/:id/state-transitions` で参照
- 代表的な `metadata.trigger`
  - `create`
  - `submit`
  - `mark_paid`
  - `unmark_paid`
- 権限:
  - `admin/mgmt` は参照可能
  - 一般ユーザは「自分が作成者の経費」のみ参照可能

## 代表エラーコード（運用時の一次切り分け）

- `RECEIPT_REQUIRED`
  - 原因: 申請時に証憑（`receiptUrl` / `attachments`）が未設定
  - 対処: URL添付またはファイル添付を登録後、再申請
- `BUDGET_ESCALATION_REQUIRED`
  - 原因: 予算超過かつエスカレーション情報未入力
  - 対処: 理由/影響/代替案の3項目を入力
- `EXPENSE_QA_CHECKLIST_REQUIRED`
  - 原因: `pending_qa` 承認時に QA チェック未完了
  - 対処: QA チェック5項目を完了して再承認
- `INVALID_STATUS`（精算系）
  - 原因: `approved` 以外で `mark-paid` 実行、または未払いに対する `unmark-paid`
  - 対処: 承認状態・精算状態を確認し、正しい順序で再実行

## 関連UI/手順

- 利用者UI: [ui-manual-user](ui-manual-user.md) の「経費入力」
- 承認運用: [approval-operations](approval-operations.md)
- 手動確認観点: [manual-test-checklist](manual-test-checklist.md)

## 参考要件

- [expense-settlement](../requirements/expense-settlement.md)
- [approval-alerts](../requirements/approval-alerts.md)
