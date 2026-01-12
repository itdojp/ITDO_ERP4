# 見積/請求/発注の運用UI要件（ドラフト）

## 目的
- 見積/請求/発注/仕入の運用フローをUI観点で整理する
- 承認/採番/アラートとの接続点を明確化する

## 対象
- Estimate / Invoice（見積/請求）
- PurchaseOrder（発注書/注文請書）
- VendorQuote / VendorInvoice（業者見積/業者請求）

## 共通一覧（MVP）
- フィルタ: status, flowType, projectId, customer/vendor, amountRange, issueDateRange, approverGroupId
- 表示列: 番号, 案件, 取引先, 金額, 状態, 承認ステップ, 発行日/期限
- 操作: 新規作成, 詳細表示, 申請（submit）, 取消/差戻し
- ページング: 初期は 100件/ページ（cursor or offset）。件数が多い場合に備えて必須
- 検索: 番号/案件名/取引先の部分一致を想定（MVPでは番号のみでも可）

## 詳細画面（MVP）
- ヘッダ: 番号/状態/案件/取引先/通貨/金額/発行日/期限
- 明細: description, quantity, unitPrice, taxRate, taskId/expenseId 参照
- 添付: PDF/受領書類のアップロード（URL保存）
- 承認: 現在ステップ/担当者/期限の表示、承認/却下/差戻し
- 操作制限: pending_qa 以降は主要項目ロック（取消して draft に戻す）
- 監査/履歴: 作成・承認・送信などの履歴をタイムライン表示（初期は簡易リスト）

## 見積（Estimate）
- 作成: Project から起案、Milestone 紐付けは任意。
- 承認: 管理部 → 経営（スキップ条件は approval_rules で設定）。
- 送信: PDFはローカル生成、メールはSMTP設定があれば送信。外部サービス連携は後続。

## 請求（Invoice）
- 作成: 見積/マイルストーンから作成、または単独起案（見積なし請求）。
- 納期: due_date を必須とし、納期超過未請求はアラート対象。
- 承認: 見積と同様（小額/定期のスキップ可）。
- 納品(D)ドキュメント: MVPでは請求に統合（番号プレフィックスDは予約のみ）。

## 発注（PurchaseOrder）
- 作成: VendorQuote を参照して起案可能。
- ステータス: draft → pending_qa → pending_exec → approved → sent/acknowledged。
- 受領書類: 注文請書/受領書を添付として登録。

## 仕入（VendorQuote/VendorInvoice）
- 受領登録: 取引先/案件/金額/受領日を登録し、PDFを添付。
- 番号: PO/VQ/VI の各種別で採番（手入力/自動採番を併用）。
- 連動: PO と紐付け可能（任意）。
- ステータス変更は承認フローに従う（vendor_invoice は pending_qa 以降ロック）。
- VendorInvoice は承認フロー対象（小額/定期はスキップ可）。VendorQuote は承認不要。

## 採番ルール
- 見積/納品/請求: `PYYYY-MM-NNNN`（P=Q（見積/Quote）/D（納品）/I（請求））。
- 仕入関連: `POYYYY-MM-NNNN` / `VQYYYY-MM-NNNN` / `VIYYYY-MM-NNNN` を想定。
- 採番タイミング: ドラフト作成時に採番（draft でも番号あり）。取消/却下/キャンセルも履歴として残す前提。

## 承認ルールとの接続
- approval_rules の conditions に含まれる isRecurring と amount でスキップ判定。
- 並列承認/二重チェックは stepOrder/parallelKey で表現。

## APIマッピング（ドラフト）
- `POST /projects/:id/estimates`
- `POST /projects/:id/invoices`
- `POST /projects/:id/purchase-orders`
- `POST /vendor-quotes`
- `POST /vendor-invoices`
- `POST /approval-instances/:id/act`

## 未決定/確認事項
- なし（MVP方針は上記にて確定）
