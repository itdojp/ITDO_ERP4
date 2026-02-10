# 発注書→仕入請求（VendorInvoice）連動設計（MVP確定）

## 背景
旧システムでは発注書から業者請求書（仕入請求）を作成する運用があり、参照/紐付けが前提でした。ERP4 でも PO↔VI の連動方針を MVP として確定し、段階導入（#768/#769）で拡張しています。

## 現状（ERP4）
- PurchaseOrder / VendorQuote / VendorInvoice の CRUD と承認が存在
- `VendorInvoice.purchaseOrderId`（任意）により、PO→VI の 1対多（PO:1 → VI:n、VI→PO は 0..1）を表現可能

## 差分/課題
- UI導線（PO→VI 作成/参照、VI の POリンク変更/解除、PDF表示＋必要時のみ請求明細/配賦明細入力）は実装済み
- 変更ロック/監査は status/権限により制御（paid の扱い等は後続の運用で強化可能）

## MVP方針
- 関連付け: 1対多（PO→複数VI）を前提にし、多対1（複数PO→1VI）は後続で要件確認
- POリンク: 作成時の紐づけに加え、既存仕入請求（VI）の紐づけ変更/解除を可能にする
- 制約（POリンク変更/解除の許容範囲）:
  - `received` / `draft` / `rejected`: 通常運用で変更/解除可
  - `pending_qa` 以降: admin/mgmt のみ（理由必須 + 監査）
  - `paid`: 原則禁止。ただし例外時は admin/mgmt + 理由必須 + 監査で許可
- 明細対応: MVPは「参照のみ」（明細レベルの厳密整合は後続）

## 補足（現行実装）
### 差戻し時の扱い
- 差戻し（`rejected`）時は POリンクの維持/変更を通常運用で許容する

### 状態/承認
- PurchaseOrder / VendorQuote / VendorInvoice は共通の `DocStatus` を利用する
  - PurchaseOrder: `draft` から開始
  - VendorQuote / VendorInvoice: `received` から開始
- 承認依頼（submit）により `pending_qa` へ遷移し、承認ルール（approval_rules）により `pending_exec` / `approved` 等へ遷移する
- `paid` は支払確定状態として扱い、POリンク変更/解除や配賦明細更新は原則禁止（例外は admin/mgmt + 理由 + 監査）

### UI導線（実装済み）
- Admin > VendorDocuments で PO→VI 作成、PO詳細でリンク済みVI一覧を参照できる
- VI 側で POリンクの変更/解除が可能（制約は status/権限/理由/監査で制御）
- VI の「請求明細」では、PDF表示を基本にし、必要なときだけ明細（数量/単価/税率/税額）を入力/表示する
  - PO紐づけ済みVIでは、請求明細ごとの `purchaseOrderLineId` 選択と数量上限チェックを行う
- VI の「配賦明細」では、PDF表示を基本にし、必要なときだけ配賦明細を入力/表示する
  - 参考: `docs/manual/ui-manual-admin.md`、`packages/frontend/src/sections/VendorDocuments.tsx`

### 監査/履歴
- POリンクの変更/解除、配賦明細の更新/クリアは監査ログ対象（理由必須の override は別アクションとして記録）
- 支払完了等の通知は通知体系（`docs/requirements/notifications.md`）に準拠し、運用設定で段階導入できる

## TODO
- [x] MVP: 1対多リンク（PO→複数VI、VI→POは0..1）を採用
- [x] POリンクの変更/解除の権限・監査（admin/mgmt 区別、理由必須など）を確定
- [x] 差戻し時のリンク維持/変更可否を確定
- [x] 明細レベルの対応方針（PDF表示 + 必要時のみ配賦明細入力）を確定（#768）
- [x] 多対1対応の要否を判断（当面は不要、運用で吸収。必要になった場合のみ中間テーブルへ移行）（#769）

## 追加実装: #768 配賦明細（案件/税率別）

### 決定事項（#768）
- VI明細は必須ではない（元の書類添付で代替可能）
- 1つのVIが複数案件に分割されうる。分割する場合は配賦明細（分割可能な明細）が必要
- 税計算は税率別を前提にする。配賦/按分時の端数はシステムで自動調整し、不可時は理由付きでエスカレーション
- 画面は「PDF表示 + 必要なときだけ配賦明細を入力/表示」を基本にする

### 現状のデータモデル/制約
- VI は `totalAmount`（請求合計）を持ち、構造化された内訳は任意の配賦明細（`VendorInvoiceAllocation`）として保持する
  - 配賦明細: `projectId/amount/taxRate/taxAmount`（+ 任意で `purchaseOrderLineId`）
  - 請求書PDFの「元明細（品目/数量/単価）」をそのまま保持するテーブルは無い
- 配賦明細の合計は請求合計と整合必須（端数は自動調整、解消不可は理由付きで運用エスカレーション）
- PO番号の記載はほぼ無く、照合キーとしては期待できない

### 段階的導入（現行 + 後続）
- Phase 0（実装済み）: PDF参照 + リンク先 PO明細の参照（read-only）
- Phase 1（実装済み）: 配賦明細（案件/税率別）を任意入力し、必要時は PO明細（`purchaseOrderLineId`）も紐付けられる
- Phase 2（後続）: PO明細↔請求内訳の厳密整合（数量/単価/部分請求）を要件化した上で導入する

### 実装状況（#768）
- Phase 0/1: 仕入請求の配賦明細（任意入力）・税率別サマリ・PDF表示・PO明細参照/選択を実装
- Phase 2: 部分請求向けの請求明細（`VendorInvoiceLine`）を実装し、`GET/PUT /vendor-invoices/:id/lines` + UI（必要時のみ入力、差分警告、修正導線）を追加
- 配賦明細は参照/監査用途のため、原価集計への反映は後続で検討

### Phase 2（着手分: #920）
- `VendorInvoiceLine` を追加し、請求内訳（lineNo/description/quantity/unitPrice/amount/taxRate/taxAmount/grossAmount）を保持
- `purchaseOrderLineId` を任意保持し、PO未紐付け時や他PO明細指定時は更新を拒否
- 更新時に以下を検証
  - 請求総額（`VendorInvoice.totalAmount`）と行合計（`grossAmount`）の整合
  - PO明細紐付け行の数量合計が、同PO明細の数量上限を超えないこと（他VIの既存行を含む）
- 監査ログ: `vendor_invoice_lines_update` / `vendor_invoice_lines_clear`

### 移行方針（既存VIに line 無しを許容）
- 既存の `VendorInvoice` は line 未登録のまま運用継続可能とする（line入力は任意）
- `GET /vendor-invoices/:id/lines` は line 未登録の場合 `items=[]` を返し、UIは「未入力」の状態として表示する
- 請求合計の厳密整合が必要なケースのみ line を入力し、段階的に line 運用へ移行する
- line 入力に移行した後も、配賦明細入力は案件別配賦の用途で並行利用できる

### 後続検討（Phase 2）: データモデル拡張案（例）
- 現行: `VendorInvoiceAllocation`（案件/税率別、任意で `purchaseOrderLineId`）で運用する
- 拡張案: 請求書明細（`VendorInvoiceLine` 等）を導入し、品目/数量/単価/税率を保持する
  - 長所: PO明細との比較や監査で説明しやすい
  - 短所: 入力負荷が増える（請求書PDFからの転記が必要）

## 後続検討: #769 多対1（複数PO→1VI）の要否判断

### 判断が必要な点（更新）
- 複数POが1枚の請求書に混在する頻度は20%以下（当面はVI分割運用で吸収）
- PO番号はほぼ記載されないため、PO番号突合は前提にしない
- 税計算は税率別（変更の可能性あり）

### 現行方針（推奨）
- まずは現行のまま（VI→PO は 0..1）で運用し、複数POが混在する請求書は「PO単位に VI を分割して登録」してリンク運用で吸収する
  - vendorInvoiceNo（請求書番号）は同一でも良い（同一番号の VI が複数件になり得る）
  - 追加の参照（他PO/案件の補足）は注釈（メモ/内部参照/外部URL）で補完する
  - 実務上は「同一請求書を分割登録」する運用であり、二重計上にならないよう合計金額の整合を必須にする
- 多対1が必須になった場合は、`VendorInvoice.purchaseOrderId` を中間テーブル（VI↔PO）へ移行し、既存のリンク変更/解除・監査ログ・履歴表示と整合させる
  - 最低限の不変条件として「同一 vendorId、原則同一 projectId」を満たす PO のみをリンク可能にする案が現実的
  - 申請時に金額分割とプロジェクト紐付けを行う運用を前提に、分割時は税率別の按分と端数調整をシステムで実施する
    - 端数調整が不可能な場合は理由付きで人にエスカレーションする

## 関連
- `docs/requirements/estimate-invoice-po-ui.md`
- `docs/requirements/domain-api-draft.md`
