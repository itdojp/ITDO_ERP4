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

## TODO
- [ ] 関連付け方式（1対1/1対多/引用作成）の決定
- [ ] UI導線（PO詳細→請求作成/参照）の設計
- [ ] 承認/ロック/差戻しの運用決定
- [ ] データモデル追加の要否を判断

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/domain-api-draft.md`
