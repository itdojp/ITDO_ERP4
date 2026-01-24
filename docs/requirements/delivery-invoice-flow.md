# 見積→納品→請求の連動フロー（たたき台）

## 背景
旧システムでは見積→納品→請求が相互参照で作成でき、承認中は編集ロック、請求は発行/入金確認まで運用されていました。ERP4では納品書相当の独立ドキュメントが未確定です。

## 現状（ERP4）
- Estimate / Invoice は存在
- マイルストーン/未納品アラートは別系統
- 納品書(D)ドキュメントは未実装（番号のみ予約）

## 差分/課題
- 納品書の位置づけ（独立モデル or 請求内包）が未決定
- 見積→納品→請求の引用作成/連鎖UIが未整備
- 請求の発行/入金確認の状態遷移が未整備

## 方針案（未確定）
### A. 納品書モデルを新設
- DeliveryDocument を追加し、Estimate/Invoice と連動
- 承認/ロック/送付ログは請求と同等に扱う

### B. 納品を請求に統合
- 納品は Invoice の状態/メタ情報で表現
- モデル増設を避けるが、納品書単体運用は難しい

## TODO
- [ ] 納品書の要否を決定（A/B）
- [ ] 引用作成の導線（Estimate→Delivery→Invoice）設計
- [ ] 請求の発行/入金確認の状態遷移と権限を決定
- [ ] 監査ログ/通知との連動設計

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/alerts-notify.md`
