# 発注書→業者請求の連動設計（たたき台）

## 背景
旧システムでは発注書から業者請求書（仕入請求）を作成する運用があり、参照/紐付けが前提でした。ERP4では PurchaseOrder / VendorQuote / VendorInvoice は存在するものの連動方針が未確定です。

## 現状（ERP4）
- PurchaseOrder / VendorQuote / VendorInvoice の CRUD と承認が存在
- PO と VendorInvoice の直接リンクは未整備

## 差分/課題
- 発注→仕入請求の関連付け（1対1/1対多/引用作成）の方針が未決定
- UI導線（PO から VQ/VI 作成/参照）が不足
- 仕入側の承認/編集ロックの運用が未整理

## 方針案（未確定）
- PO と VendorInvoice を関連付け、PO から請求作成の導線を提供
- PO の明細と VendorInvoice 明細の対応関係は「緩い紐付け（参照のみ）」で開始

## 追加で整理すべき論点（未確定）
### 関連付け方式
- 1対1: POごとに請求1件（簡易）
- 1対多: 分割納品/分割請求を想定
- 多対1: 複数POを1請求にまとめる（実務上の必要性は分かりません）

### 明細対応
- 参照のみ（PO明細IDを保持するが金額整合は警告程度）
- 厳密対応（PO明細の数量/金額を検証し、差異は承認必須）

### 状態遷移（案）
- PurchaseOrder: draft → pending → approved → issued/closed
- VendorQuote: draft → pending → approved
- VendorInvoice: draft → pending → approved → paid

### UI導線（案）
- PO詳細から「見積作成」「請求作成」ボタン
- VendorInvoice 詳細に「関連PO」セクションを表示
- 仕入請求の入金（支払）確認は admin/mgmt 操作

### 監査/通知（案）
- 発注/請求の発行・承認・支払確定を監査ログへ
- 支払完了の通知は申請者/担当者へ（チャネルは運用次第）

## TODO
- [ ] 関連付け方式（1対1/1対多/引用作成）の決定
- [ ] UI導線（PO詳細→請求作成/参照）の設計
- [ ] 承認/ロック/差戻しの運用決定
- [ ] データモデル追加の要否を判断

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/domain-api-draft.md`
