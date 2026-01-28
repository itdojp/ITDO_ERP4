# 発注書→仕入請求（VendorInvoice）連動設計（MVP確定）

## 背景
旧システムでは発注書から業者請求書（仕入請求）を作成する運用があり、参照/紐付けが前提でした。ERP4では PurchaseOrder / VendorQuote / VendorInvoice は存在するものの連動方針が未確定です。

## 現状（ERP4）
- PurchaseOrder / VendorQuote / VendorInvoice の CRUD と承認が存在
- `VendorInvoice.purchaseOrderId`（任意）により、PO→VI の 1対多（PO:1 → VI:n、VI→PO は 0..1）を表現可能

## 差分/課題
- UI導線（PO から VI 作成/参照）が不足
- 仕入側の承認/編集ロック、差戻し時の扱いが未整理

## MVP方針
- 関連付け: 1対多（PO→複数VI）を前提にし、多対1（複数PO→1VI）は後続で要件確認
- POリンク: 作成時の紐づけに加え、既存仕入請求（VI）の紐づけ変更/解除を可能にする
- 制約: `pending_qa` 以降は admin/mgmt のみ紐づけ変更/解除（監査ログ対象）
- 明細対応: MVPは「参照のみ」（明細レベルの厳密整合は後続）

## 追加で整理すべき論点（未確定）
### 差戻し時の扱い
- 差戻し時に POリンクの維持/変更可否（分かりません、要設計）

### 状態遷移（案）
- PurchaseOrder: `draft` → `pending_qa` → `pending_exec` → `approved` → `sent` / `acknowledged`
- VendorQuote: `received` → `approved` / `rejected`（現状の運用想定）
- VendorInvoice: `received` → `pending_qa` → `pending_exec` → `approved` → `paid`（`rejected`/`cancelled` あり）

### UI導線（案）
- PO詳細から「仕入請求作成」ボタン（POを引用して VI を作成）
- PO詳細に「リンク済み仕入請求（VI）一覧」を表示
- VI詳細に「関連PO」セクションを表示し、変更/解除を可能にする（制約: `pending_qa` 以降は admin/mgmt のみ）
- 仕入請求の支払確認は admin/mgmt 操作

### 監査/通知（案）
- 発注/請求の発行・承認・支払確定を監査ログへ
- 支払完了の通知は申請者/担当者へ（チャネルは運用次第）

## TODO
- [x] MVP: 1対多リンク（PO→複数VI、VI→POは0..1）を採用
- [ ] POリンクの変更/解除の権限・監査（admin/mgmt 区別、理由必須など）を確定
- [ ] 差戻し時のリンク維持/変更可否を確定
- [ ] 明細レベルの対応方針（参照/警告/厳密）を確定
- [ ] 多対1対応の要否を判断（後続）

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/domain-api-draft.md`
