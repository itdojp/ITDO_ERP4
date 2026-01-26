# 見積→納品→請求の連動フロー（MVP確定）

## 背景
旧システムでは見積→納品→請求が相互参照で作成でき、承認中は編集ロック、請求は発行/入金確認まで運用されていました。ERP4では納品書相当の独立ドキュメントが未確定です。

## 現状（ERP4）
- Estimate / Invoice は存在
- マイルストーン/未納品アラートは別系統
- 納品書(D)ドキュメントは未実装（番号のみ予約）

## 差分/課題
- 納品書の位置づけはMVPで請求に統合（独立モデルは採用しない）
- 見積→納品→請求の引用作成/連鎖UIが未整備
- 請求の発行/入金確認の運用導線は未整備

## MVP方針
- 納品(D)は請求に統合（請求書の状態/メタ情報で表現）
- 納品番号（Dプレフィックス）は予約のみ。独立ドキュメントは作成しない
- 追加要件が出た場合に DeliveryDocument（A案）を検討
- 請求の発行は `/invoices/:id/send` により `sent` へ遷移
- 入金確認は admin/mgmt が `/invoices/:id/mark-paid` を実行し `paid` を記録（`paidAt/paidBy`）

## 方針案（拡張）
### A. 納品書モデルを新設
- DeliveryDocument を追加し、Estimate/Invoice と連動
- 承認/ロック/送付ログは請求と同等に扱う

### B. 納品を請求に統合（MVP）
- 納品は Invoice の状態/メタ情報で表現
- モデル増設を避けるが、納品書単体運用は難しい

## 追加で整理すべき論点（未確定）
### 連動ルール
- 見積から納品/請求を引用作成する際のコピー範囲（明細/割引/税/注記）
- 承認済みドキュメントからの引用のみ許可するか
- 納品→請求の再見積（部分納品/分割請求）の扱い

### 状態遷移（MVP確定）
- Estimate: draft → pending_qa → pending_exec → approved → sent/archived
- Delivery（A案）: draft → pending_qa → pending_exec → approved → sent
- Invoice: draft → pending_qa → pending_exec → approved → sent → paid
- 入金確認: paidAt/paidBy を保持（部分入金はMVP対象外）

### UI導線（MVP）
- Estimate 詳細から「納品作成」「請求作成」を開始
- Delivery 詳細から「請求作成」を開始
- Invoice 詳細で「入金確認」操作（admin/mgmt のみ）

### 監査/通知（MVP）
- 発行/送信/入金確認は監査ログに記録
- 送付/入金はアプリ内通知（メールは運用次第）

## 後続検討
- [ ] 引用作成の導線（Estimate→Invoice）設計
- [ ] 納品情報（Invoiceメタ）の項目を確定（必要な場合のみ）
- [ ] 監査ログ/通知との連動設計

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/alerts-notify.md`
