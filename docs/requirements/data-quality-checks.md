# データ品質チェック分類

## 目的

ERP4 PoC の data-quality check を、PR マージを止める **blocking** と、業務判断を含むため記録に留める **advisory** に分離する。

- blocking: 結果が決定的で、検出時にマージを止める検査
- advisory: 閾値・運用移行期・業務例外の判断を含み、GitHub Step Summary / artifact に記録する検査

CI では production DB へ接続せず、合成 fixture を入力として deterministic に検査する。fixture に production data や個人情報を含めない。

## 実行コマンド

```bash
npm run data-quality:test --prefix packages/backend
npm run data-quality:blocking --prefix packages/backend
npm run data-quality:advisory --prefix packages/backend
```

負例確認:

```bash
node scripts/data-quality-check.mjs \
  --mode=blocking \
  --fixture scripts/fixtures/data-quality-invalid.json \
  --output tmp/data-quality-invalid.json \
  --summary tmp/data-quality-invalid.md
```

上記負例は blocking finding を検出し、終了コード 1 になることが期待値。

## fixture

| fixture                                               | 用途                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `scripts/fixtures/data-quality-valid.json`            | CI の blocking/advisory 正常系。finding 0 を期待する。                        |
| `scripts/fixtures/data-quality-invalid.json`          | blocking 分類の意図的な不整合を含む負例。runner が非0終了することを確認する。 |
| `scripts/fixtures/data-quality-advisory-warning.json` | advisory 警告のみの負例。warning を記録しつつ終了コード 0 を確認する。        |

## blocking 分類

| check                                        | 対応する最低ライン         | 判定内容                                                                                   |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `required_id_missing`                        | 必須ID欠落                 | fixture record の `id` または import batch の `importBatchKey` が空でないこと              |
| `required_code_missing`                      | 必須コード欠落             | `Project` / `Customer` / `Vendor` の `code` が空でないこと                                 |
| `duplicate_project_code`                     | 一意コード重複             | active project code が重複しないこと                                                       |
| `duplicate_customer_code`                    | 一意コード重複             | customer code が重複しないこと                                                             |
| `duplicate_vendor_code`                      | 一意コード重複             | vendor code が重複しないこと                                                               |
| `orphan_time_entry_project`                  | 参照切れ/orphan            | `TimeEntry.projectId` が既存 `Project.id` を参照すること                                   |
| `orphan_billing_line_invoice`                | 参照切れ/orphan            | `BillingLine.invoiceId` が既存 `Invoice.id` を参照すること                                 |
| `orphan_accounting_journal_event`            | 参照切れ/orphan            | `AccountingJournalStaging.eventId` が既存 `AccountingEvent.id` を参照すること              |
| `invoice_currency_missing`                   | 必須コード欠落             | `Invoice.currency` が空でないこと                                                          |
| `billing_tax_rate_missing`                   | 必須コード欠落             | `BillingLine.taxRate` が明示されていること                                                 |
| `invoice_header_line_total_mismatch`         | header/line合計不一致      | `Invoice.totalAmount` と `BillingLine.quantity * unitPrice` 合計の差が 0.01 以下であること |
| `accounting_event_source_key_duplicate`      | 重複連携キー               | `AccountingEvent.sourceTable/sourceId/eventKind` が重複しないこと                          |
| `accounting_journal_ready_missing_side`      | 借貸不整合                 | `status=ready` の `AccountingJournalStaging` が借方/貸方の少なくとも一方を持つこと         |
| `accounting_journal_debit_credit_mismatch`   | 借貸不整合                 | `status=ready` 行の借方科目あり金額合計と貸方科目あり金額合計が一致すること                |
| `statutory_accounting_import_count_mismatch` | migration/import件数不一致 | `StatutoryAccountingActualImportBatch.importedCount` と actual row 件数が一致すること      |

### 現行モデル上の注記

`AccountingJournalStaging` は借方金額・貸方金額を別フィールドでは持たず、`amount` と `debitAccountCode` / `creditAccountCode` の有無で片側明細を表現する。そのため借貸チェックは、`status=ready` 行のうち debit code を持つ行の `amount` 合計と credit code を持つ行の `amount` 合計を比較する。

## advisory 分類

| check                                  | 理由                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `time_entries_daily_over_1440`         | 1日 1,440 分超は強い警告だが、例外勤務・移行補正・入力訂正などの業務判断を含む。 |
| `invoice_number_format_invalid`        | `IYYYY-MM-NNNN` 規約からの逸脱は移行期データで許容判断が必要な場合がある。       |
| `purchase_order_number_format_invalid` | `POYYYY-MM-NNNN` 規約からの逸脱は移行期データで許容判断が必要な場合がある。      |

## 出力形式

runner は JSON report と Markdown summary を出力する。

- JSON: check名、severity、status、count、sampleIds、description、reproduction を含む。
- Markdown: GitHub Step Summary へ追記できる表形式。

CI artifact には `tmp/data-quality-*.json` と `tmp/data-quality-*.md` を保存する。

## 運用

- PR では blocking finding があれば `CI / data-quality` が fail する。
- advisory finding は report/summary に残すが、advisory runner の終了コードは 0 とする。
- production DB に直接接続する CI は非対象。実データ調査は別途、環境・権限・個人情報保護を定義した運用手順で扱う。
