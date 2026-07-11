# External CSV artifact intake 記録テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #1432, #1875
- intakeStatus: `blocked|failed|pass`
- manifestFile:

## 目的

#1432 の完了判定に必要な現物 CSV テンプレート、マスキング済みサンプル、取込条件資料を、repo canonical sample と混同せずに記録する。
給与らくだの仕様は現物テンプレートが揃うまで推測して実装しない。

## 生成コマンド

```bash
INTAKE_STATUS=pass \
OPERATOR=alice \
MANIFEST_FILE=docs/requirements/external-csv-artifact-intake-manifest.json \
make external-csv-artifact-intake-record
```

## pass 記録の必須条件

`INTAKE_STATUS=pass` の record は、script 側で以下を強制する。

- manifest の `collectionDate` / `collector` / `maskingPolicy.approved` / `approvedBy` / `approvedAt` が確定している
- 以下の必須 artifact がすべて `status: received` である
  - `rakuda_employee_master_template`
  - `rakuda_attendance_import_template`
  - `rakuda_report_output_sample`
  - `ics_journal_import_template`
  - `ics_journal_imported_masked_sample`
  - `import_rules_material`
- `sourceType` が現物テンプレート、現物由来サンプル、または運用資料であり、`canonical_sample` / `headerOnly` ではない
- CSV/sample artifact には encoding / newline / delimiter / dateFormat / numberFormat / columns がある
- data/report sample には `sampleRows > 0` がある
- 運用資料には `fieldLengths` / `codeSets` / `reimportRules` の `ruleTopics` がある
- repo 内 file は存在し空でない、repo 外 artifact は `externalStorageRef` と sha256 を持つ
- 各 artifact が `masked` / `not_required` / 非機微と明示されている

## 判定

- `pass`: #1432 の必須 artifact が揃い、設計に利用できる状態。
- `blocked`: 現物テンプレート、マスキング済みサンプル、運用資料、承認、または保管証跡が不足している状態。
- `failed`: 受領物はあるが、文字コード、列、マスキング、保管証跡などが不適合の状態。

`blocked` または `failed` の場合は #1432 を close しない。
