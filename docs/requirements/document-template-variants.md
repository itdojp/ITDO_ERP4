# ドキュメントテンプレートのバリエーション（MVP確定）

## 目的
- 旧システムのテンプレ差分を ERP4 で運用できる最小要件を整理する
- テンプレ増設 vs 設定フラグの判断基準、権限、適用タイミングを明確化する

## 対象/範囲
- 対象: Estimate / Invoice / PurchaseOrder
- 除外: VendorQuote / VendorInvoice（受領PDF添付のみ）
- 送信時の PDF/メール（`/send` API）を想定

## 前提（現行実装・資料）
- `doc_template_settings` は `kind`, `templateId`, `numberRule`, `layoutConfig`, `logoUrl`, `signatureText`, `isDefault` を保持
- `/pdf-templates?kind=` でテンプレ一覧を取得
- `POST /{estimates|invoices|purchase-orders}/:id/send` はクエリパラメータ（`?templateId=&templateSettingId=`）として `templateId` / `templateSettingId` を任意指定可能
- `layoutConfig` の想定キーは `docs/requirements/pdf-email.md` に記載（`documentTitle`, `companyName`, `footerNote` など）

## 変動要素（候補）
- 税表示: 税抜/税込/税額別記、端数処理の表示方針
- 日付表示: 発行日/期限/有効期限の表示有無
- 印影/署名: 会社印・担当者署名の表示有無（`layoutConfig.signatureImageUrl` / `signatureText`）
- タイトル/注記/フッタ: 文言・文書タイトルの差分
- ロゴ表示: `logoUrl` の有無
- その他: 旧システムのテンプレ種別の全量は分かりません

## MVP方針（確定）
- 変動要素（税/日付/印影/文言）は `layoutConfig` の設定フラグで吸収する
- レイアウト差分が大きい場合のみテンプレ増設を検討（MVPでは増設しない）
- 対象は Estimate / Invoice / PurchaseOrder に限定（VendorQuote/VendorInvoice は対象外）

## 方式比較（テンプレ増設 vs 設定フラグ）
| 観点 | テンプレ増設（pdf-templates追加） | 設定フラグ（layoutConfig） |
| --- | --- | --- |
| 適用対象 | レイアウト差分が大きい場合 | 微差の表示切替（税/日付/印影など） |
| 運用コスト | テンプレ数が増える | フラグ設計とUIが増える |
| 実装 | テンプレファイル管理・公開 | 単一テンプレ内の条件分岐 |
| リスク | 変更影響の管理が大きい | フラグ組合せの検証増 |

### MVPルール
- 原則は設定フラグで吸収し、MVPではテンプレ増設しない。
- フラグの組み合わせが複雑化した場合はテンプレ増設へ切替を検討（後続）。

## 権限（MVP確定）
- テンプレ設定（`doc_template_settings`）のCRUD: admin/mgmt
- `POST /{estimates|invoices|purchase-orders}/:id/send` の実行: admin/mgmt
- テンプレ選択/切替は `/send` 実行時のみ（admin/mgmt）

## 権限拡張（後続検討）
- 送信権限を持つ利用者への開放可否
- ドラフト時の選択・承認後のロック可否

## 適用タイミング（MVP確定）
- 既定: `isDefault=true` の設定を `kind` 単位で適用
- 送信時: `templateSettingId` または `templateId` を指定できる
- 保存先: 送信ログのみ（ドキュメント本体に保存しない）

## 例外運用（MVP）
- テンプレ固定案件はMVP対象外。必要になった場合にプロジェクト/取引先属性を追加する。

## 後続改定候補
- 旧システムのテンプレ一覧と差分要素の精査
- フラグ候補とUI入力項目の追加
- 監査ログの要件追加
- テンプレ固定案件の要否判断

## 関連
- `docs/requirements/pdf-email.md`
- `docs/requirements/estimate-invoice-po-ui.md`
