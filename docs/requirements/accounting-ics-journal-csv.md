# 経理上手くんα Pro II 連携: ICS 仕訳 CSV 仕様（repo ベース初期案）

更新日: 2026-03-19
関連 Issue: `#1438`, `#1430`, `#1433`, `#1434`, `#1435`, `#1441`, `#1443`

## 目的

- ERP4 から経理上手くんα Pro II へ出力する ICS 仕訳 CSV について、現物テンプレートと現行運用ヒアリングをもとに初期仕様を整理する。
- ERP4 側で既に供給できる項目、追加の mapping master が必要な項目、未確定の取込ルールを分離する。
- 2026-03-16 時点の baseline 実装として、`AccountingJournalStaging.status=ready` 行を ICS CSV へ出力する API と dispatch log の仕様を固定する。

## 実装済み baseline

- `GET /integrations/accounting/exports/journals`
  - canonical JSON を返す
- `GET /integrations/accounting/exports/journals?format=csv`
  - `CP932 + CRLF` の ICS CSV を返す
- `GET /integrations/accounting/exports/journals?format=ics_template`
  - 受領テンプレート互換の preamble 1〜4 行を含む CSV を返す
  - `periodKey`, `companyCode`, `companyName` が必須
  - `fiscalYearStartMonth` は省略時 `1`
- `POST /integrations/accounting/exports/journals/dispatch`
  - `idempotencyKey` 付きで export 実行結果を保存する
  - `format=ics_template` 指定時は request hash に template metadata を含める
- `GET /integrations/accounting/exports/journals/dispatch-logs`
  - dispatch 履歴を返す
- `GET /integrations/accounting/mapping-rules`
  - `mappingKey` ごとの会計 mapping rule 一覧を返す
- `POST /integrations/accounting/mapping-rules`
  - 勘定科目 / 枝番 / 税区分 / 部門コードの rule を登録する
- `PATCH /integrations/accounting/mapping-rules/:id`
  - rule を更新または無効化する
- `POST /integrations/accounting/mapping-rules/reapply`
  - `pending_mapping` / `blocked` の staging 行へ最新 rule を再適用する

### export 対象

- `AccountingJournalStaging.status='ready'` の行だけを対象にする
- 同一 scope 内に `pending_mapping` または `blocked` が残っている場合、export は `409 accounting_journal_mapping_incomplete` で停止する
- ready 行でも以下が未設定なら `409 accounting_journal_ready_row_incomplete` で停止する
  - `debitAccountCode`
  - `creditAccountCode`
  - `taxCode`
  - 正の `amount`

### scope

- 現行 baseline の絞り込み軸は `periodKey` のみ
- `periodKey` 未指定時は全期間を scope にする
- `periodKey` は `YYYY-MM` 形式で、不正値は `400 invalid_period_key`

## 前提

- 対象製品は、ユーザー申告ベースで `経理上手くんα Pro II Version 26.002` とする。
- ローカルに配置された `21期_表形式入力フォーマット（ICS取込用）.CSV` を現物テンプレートとして参照する。
- 仕様レビューと実装時の参照用として、ヘッダ行のみを抽出した `docs/requirements/samples/21ki_ics_journal_header_sample.csv` を同梱する。
- 物理レイアウト確認用として、先頭 5 行を UTF-8 で再掲した `docs/requirements/samples/21ki_ics_journal_template_excerpt.csv` を同梱する。
- 担当者ヒアリングでは、普段の取込時に主に入力している項目は以下である。
  - 日付
  - 借方コード / 貸方コード
  - 借方名称 / 貸方名称
  - 金額
  - 摘要
- ただし現物テンプレートには、上記以外にも部門、枝番、税区分、仕訳区分などの列が存在する。

## 現物テンプレートの確認結果

対象ファイル: `21期_表形式入力フォーマット（ICS取込用）.CSV`

### ファイル形式

- 文字コード: `CP932 / Shift_JIS 系` と判断
- BOM: なし
- 改行: `CRLF`
- 先頭 1〜4 行: 表題・会社情報・対象期間
- 5 行目: ヘッダ
- 実データ行: なし
- repo には、レビューと実装参照用にヘッダ行だけを UTF-8 で再掲した `docs/requirements/samples/21ki_ics_journal_header_sample.csv` を置く
- 併せて、先頭 5 行を UTF-8 で再掲した `docs/requirements/samples/21ki_ics_journal_template_excerpt.csv` を置く
- 実装出力では、このテンプレートのヘッダ列順に合わせて `CP932 + CRLF` に変換する

### 先頭 5 行の構造

1. `"法人"`
2. `"仕訳日記帳"`
3. `会社コード,会社名`
4. `対象期間（自/至/月分）`
5. `30 列のヘッダ`

受領テンプレートの物理レイアウト確認には有用であり、2026-03-19 時点では `format=ics_template` 指定時に 1〜4 行目の preamble を含む CSV を返せる。既定の canonical CSV は、5 行目の 30 列ヘッダだけを正本として出力する。

### ヘッダ列（30 列）

1. 日付
2. 決修
3. 伝票番号
4. 部門ｺｰﾄﾞ
5. 借方ｺｰﾄﾞ
6. 借方名称
7. 借方枝番
8. 借方枝番摘要
9. 借方枝番ｶﾅ
10. 貸方ｺｰﾄﾞ
11. 貸方名称
12. 貸方枝番
13. 貸方枝番摘要
14. 貸方枝番ｶﾅ
15. 金額
16. 摘要
17. 税区分
18. 対価
19. 仕入区分
20. 売上業種区分
21. 仕訳区分
22. ﾀﾞﾐｰ1
23. ﾀﾞﾐｰ2
24. ﾀﾞﾐｰ3
25. ﾀﾞﾐｰ4
26. ﾀﾞﾐｰ5
27. 手形番号
28. 手形期日
29. 付箋番号
30. 付箋コメント

## 現行運用で利用している主項目

担当者ヒアリングで、普段入力している主項目は以下とされた。

- `日付`
- `借方ｺｰﾄﾞ`
- `貸方ｺｰﾄﾞ`
- `借方名称`
- `貸方名称`
- `金額`
- `摘要`

このため、初期実装では上記を必須候補として扱い、それ以外の列は「固定値」「空値」「後続要確認」に分類する方針が妥当である。

## 論理項目定義（初期案）

| CSV 列       | 用途                | ERP4 供給元候補                             | 判定     | 備考                                         |
| ------------ | ------------------- | ------------------------------------------- | -------- | -------------------------------------------- |
| 日付         | 仕訳日              | 文書日付 / 計上日                           | 条件付き | どの日付を採用するかは会計イベントごとに定義 |
| 決修         | 決算/修正区分       | 空値固定                                    | 実装済み | 通常取込の baseline は空値固定               |
| 伝票番号     | 伝票識別子          | `externalRef` または `sourceTable-sourceId` | 実装済み | 再出力でも不変の値を使う                     |
| 部門ｺｰﾄﾞ     | 部門軸              | project/customer/vendor/employee 由来       | 条件付き | 共通部門コードか mapping 必須                |
| 借方ｺｰﾄﾞ     | 借方勘定科目        | 会計 mapping master                         | 未実装   | `#1441` 依存                                 |
| 借方名称     | 借方科目名          | mapping master または固定名称               | 未実装   | コードと対で管理したい                       |
| 借方枝番     | 借方補助科目        | 会計 mapping master                         | 条件付き | 勘定科目ごとの必須フラグで判定               |
| 借方枝番摘要 | 借方補助摘要        | 取引先/案件名等                             | 条件付き | 用途未確定                                   |
| 借方枝番ｶﾅ   | 借方補助カナ        | マスタ側で保持                              | 未実装   | 現行 ERP4 には保持なし                       |
| 貸方ｺｰﾄﾞ     | 貸方勘定科目        | 会計 mapping master                         | 未実装   | `#1441` 依存                                 |
| 貸方名称     | 貸方科目名          | mapping master または固定名称               | 未実装   | 同上                                         |
| 貸方枝番     | 貸方補助科目        | 会計 mapping master                         | 条件付き | 同上                                         |
| 貸方枝番摘要 | 貸方補助摘要        | 取引先/案件名等                             | 条件付き | 用途未確定                                   |
| 貸方枝番ｶﾅ   | 貸方補助カナ        | マスタ側で保持                              | 未実装   | 現行 ERP4 には保持なし                       |
| 金額         | 仕訳金額            | 文書金額/明細金額                           | 条件付き | 借貸一致の単位定義が必要                     |
| 摘要         | 仕訳摘要            | 文書番号、案件名、相手先名など              | 条件付き | `CP932 120 bytes`、改行/タブ禁止             |
| 税区分       | 税コード            | `taxRate` から mapping                      | 必須     | `#1434` `#1441` 依存                         |
| 対価         | インボイス/税額関係 | 金額 or 税抜額                              | 空値固定 | 実運用確定まで空値                           |
| 仕入区分     | 仕入分類            | mapping                                     | 空値固定 | 実運用確定まで空値                           |
| 売上業種区分 | 売上分類            | mapping                                     | 空値固定 | 実運用確定まで空値                           |
| 仕訳区分     | 仕訳種別            | 固定値 or mapping                           | 空値固定 | 実運用確定まで空値                           |
| ﾀﾞﾐｰ1-5      | 予約領域            | 固定空値候補                                | 条件付き | テンプレート上の意味未確認                   |
| 手形番号     | 手形情報            | なし                                        | 未実装   | 初期スコープ外候補                           |
| 手形期日     | 手形情報            | なし                                        | 未実装   | 同上                                         |
| 付箋番号     | メモ                | なし                                        | 未実装   | 初期スコープ外候補                           |
| 付箋コメント | メモ                | なし                                        | 未実装   | 初期スコープ外候補                           |

## 初期必須列の考え方

### 現時点で必須候補

- `日付`
- `借方ｺｰﾄﾞ`
- `貸方ｺｰﾄﾞ`
- `借方名称`
- `貸方名称`
- `金額`
- `摘要`

### 条件付き必須候補

- `部門ｺｰﾄﾞ`
- `借方枝番` / `貸方枝番`

### 初期は固定値/空値候補

- `決修`
- `対価`
- `仕入区分`
- `売上業種区分`
- `仕訳区分`
- `ﾀﾞﾐｰ1` 〜 `ﾀﾞﾐｰ5`
- `手形番号`
- `手形期日`
- `付箋番号`
- `付箋コメント`

## ERP4 イベント -> 仕訳変換の初期方針

### 想定イベント

- 経費承認
- 仕入請求承認
- 請求承認
- 支払/入金の将来拡張

### 変換の考え方

- 1 文書 = 1 仕訳伝票とは限らない
- 明細単位または配賦単位で複数仕訳行に展開できる設計にする
- ERP4 では会計イベント staging を作り、その後 ICS CSV に変換する
- 2026-03-16 時点の baseline では、`expenses` / `invoices` / `vendor_invoices` の承認完了時に `AccountingEvent` と `AccountingJournalStaging` を生成し、未マッピング状態を `pending_mapping` または `blocked` で保持する
- 2026-03-17 時点の baseline では、`AccountingMappingRule` を `mappingKey` 単位で保持し、exact match または `<eventKind>:default` fallback で `debit/credit/tax/department` を自動適用する
- 2026-03-18 時点の拡張では、`AccountingMappingRule` に `requireDepartmentCode` / `requireDebitSubaccountCode` / `requireCreditSubaccountCode` を持たせ、条件付き必須を rule 側で判定する
- `#1443` の baseline 実装では、`ready` 化された staging 行だけを CSV に変換する

### 最低限必要な mapping

- 文書種別 -> 借方/貸方勘定科目
- project / department -> 部門コード
- vendor / customer / project -> 枝番候補
- taxRate -> 税区分

## 出力単位の初期案

- 1 仕訳伝票 = 1 logical voucher
- 伝票内に複数明細を持てるようにする
- CSV 上は「1 行 = 借貸 1 組」として出力する案を第一候補とする
- 借貸が複数行に分かれる場合は、同一 `伝票番号` を共有する

## baseline 実装時の CSV 出力方針

- 文字コード: `CP932`
- 改行: `CRLF`
- 行構成:
  - canonical (`format=csv`)
    - 1 行目に現物テンプレートと同じ 30 列ヘッダを出力
    - 2 行目以降に `AccountingJournalStaging.status='ready'` の行を `entryDate asc, eventId asc, lineNo asc` 順で出力
  - template (`format=ics_template`)
    - 1 行目: `法人`
    - 2 行目: `仕訳日記帳`
    - 3 行目: `companyCode, companyName`
    - 4 行目: 会計年度開始月から導出した `自/至/月分`
    - 5 行目: 30 列ヘッダ
    - 6 行目以降: `AccountingJournalStaging.status='ready'` の行を `entryDate asc, eventId asc, lineNo asc` 順で出力
- 対外出力の既定は `format=ics_template` を推奨し、内部確認・回帰テストでは canonical CSV を継続利用する
- 初期 baseline で値を埋める列:
  - `日付`
  - `伝票番号`
  - `借方ｺｰﾄﾞ`
  - `借方名称`（現行 baseline は借方コードと同値）
  - `借方枝番`
  - `貸方ｺｰﾄﾞ`
  - `貸方名称`（現行 baseline は貸方コードと同値）
  - `貸方枝番`
  - `金額`
  - `摘要`
  - `税区分`
  - `部門ｺｰﾄﾞ`（required rule または共通部門コードがある場合）
- 初期 baseline で空値固定の列:
  - `決修`
  - `借方枝番摘要`
  - `借方枝番ｶﾅ`
  - `貸方枝番摘要`
  - `貸方枝番ｶﾅ`
  - `対価`
  - `仕入区分`
  - `売上業種区分`
  - `仕訳区分`
  - `ﾀﾞﾐｰ1`〜`ﾀﾞﾐｰ5`
  - `手形番号`
  - `手形期日`
  - `付箋番号`
  - `付箋コメント`

この空値固定列は、現行運用での必須度が確定するまでの暫定方針である。

### 摘要バリデーション方針

- `CP932` へ round-trip できない文字は不可
- 改行、タブは不可
- `CP932 120 bytes` を超える摘要は不可
- 超過や不正文字は切り捨てず、export error として停止する

## エラーパターンの初期分類

### 出力停止

- 借方/貸方コード未設定
- 部門コード未設定
- 必須枝番未設定
- 税区分未マッピング
- 借貸不一致
- 金額 0 または負値が業務ルールに合致しない
- 摘要が `CP932 120 bytes` を超える
- 摘要に改行、タブ、`CP932` 非対応文字が含まれる
- `pending_mapping` / `blocked` 行が scope に残っている
- rule 更新後に `reapply` を実行していないため、既存 staging が古い mapping のまま残っている

### 警告

- 名称列が mapping master と一致しない
- 摘要が文字数上限に近い
- 初期スコープ外列に値を入れられないため空値出力する

## テスト観点（初期案）

### 正常系

- 現行テンプレート 30 列に合わせた CSV が出力される
- `CP932 + CRLF` で書き出せる
- 主運用項目だけで取り込み可能なサンプルを作成できる
- 同一伝票番号で複数明細を出力できる

### 異常系

- 借方/貸方コード未設定で失敗
- 部門コード未設定で失敗
- 税区分未マッピングで失敗
- 借貸不一致で失敗
- 必須枝番未設定で失敗
- 摘要制約違反で失敗

## 2026-03-18 時点の推奨仕様

1. `決修` は空値固定
2. `伝票番号` は不変で再出力でも同一値を使う
3. `部門ｺｰﾄﾞ` は条件付き必須
4. `税区分` は必須、`対価/仕入区分/売上業種区分/仕訳区分` は空値固定
5. `借方枝番/貸方枝番` は勘定科目ごとの条件付き必須
6. `摘要` は `CP932 120 bytes`、改行/タブ禁止
7. 対外出力は `format=ics_template` を正とし、内部 canonical CSV は継続利用する

## 実データ確認が必要な事項

1. `借方名称` / `貸方名称` はコードと一致必須か、任意補助表示か
2. `template layout` の preamble 1〜4 行で、会社コード/会社名/期間書式の厳密一致が必要か
3. `CP932 + CRLF` が実運用上必須か
4. `対価`, `仕入区分`, `売上業種区分`, `仕訳区分` に実値が必要か
5. `摘要` の製品上限値が `120 bytes` より厳しいか

## 現時点の結論

- `#1438` は、現物テンプレートが得られたため「列一覧の棚卸し」段階から前進できる。
- `#1443` の baseline として、ICS CSV export / dispatch / dispatch-log の API を実装した。
- 2026-03-18 時点で、`決修`、部門コード、税区分、枝番、摘要制約の推奨仕様は決定した。
- 次の実務上の論点は、`名称列の扱い`、template preamble の厳密書式、補助列の実値要否の確認である。
- baseline 実装後も、`#1434` と `#1441` の mapping master / 出力判定 / CSV 化ルールを合わせて確定する必要がある。

## 根拠ファイル

- `21期_表形式入力フォーマット（ICS取込用）.CSV`
- `docs/requirements/erp4-payroll-accounting-gap-analysis.md`
- `docs/requirements/samples/21ki_ics_journal_header_sample.csv`
- `docs/requirements/samples/21ki_ics_journal_template_excerpt.csv`
- `docs/requirements/external-code-system-design.md`
- `docs/requirements/external-csv-integration-common-spec.md`
