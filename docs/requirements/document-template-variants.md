# ドキュメントテンプレートのバリエーション（たたき台）

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

## 方式比較（テンプレ増設 vs 設定フラグ）
| 観点 | テンプレ増設（pdf-templates追加） | 設定フラグ（layoutConfig） |
| --- | --- | --- |
| 適用対象 | レイアウト差分が大きい場合 | 微差の表示切替（税/日付/印影など） |
| 運用コスト | テンプレ数が増える | フラグ設計とUIが増える |
| 実装 | テンプレファイル管理・公開 | 単一テンプレ内の条件分岐 |
| リスク | 変更影響の管理が大きい | フラグ組合せの検証増 |

### 暫定ルール案
- 原則は設定フラグで吸収し、法令/顧客要件でレイアウト差分が大きい場合のみテンプレ増設。
- フラグの組み合わせが複雑化した場合はテンプレ増設へ切替を検討。

## 権限（案）
- 現行仕様
  - テンプレ設定（`doc_template_settings`）のCRUD: admin/mgmt
  - `POST /{estimates|invoices|purchase-orders}/:id/send` の実行: admin/mgmt のみに制限
  - 上記 `/send` API 経由のテンプレ選択/切替: 現時点では admin/mgmt のみが実行可能
- 将来案（権限を広げる場合の検討メモ）
  - テンプレの選択/切替: 分かりません。以下は候補。
  - 案A: 送信権限を持つ利用者のみ（承認済みドキュメントに限定）
  - 案B: 作成者がドラフト時に選択し、承認後は変更不可
  - 案C: 送信時のみ選択可能（監査ログに保存）

## 適用タイミング（案）
- 既定: `isDefault=true` の設定を `kind` 単位で適用
- 送信時: `templateSettingId` または `templateId` を指定できる前提（送信ログに保存）
- 保存先: 分かりません。候補は以下。
  - 案A: 送信ログのみ（ドキュメント本体に保存しない）
  - 案B: ドキュメントに `templateSettingId` を保持し、送信時は上書き可

## 例外運用（案）
- テンプレ固定案件: 分かりません。プロジェクト/取引先単位で固定する要件がある場合は、別途属性追加が必要。

## TODO
- [ ] 旧システムのテンプレ一覧と差分要素を洗い出す
- [ ] フラグ候補とUI入力項目を確定
- [ ] 権限/タイミングの決定と監査ログの要件化
- [ ] テンプレ固定案件の有無とデータモデルを決定

## 関連
- `docs/requirements/pdf-email.md`
- `docs/requirements/estimate-invoice-po-ui.md`
