# 外部 CSV sample 一覧

このディレクトリには 3 種類の sample がある。

- 実物テンプレート由来の再掲 sample
  - 現物ファイルの列構成や先頭行を repo 内で参照するためのもの
- canonical sample
  - ERP4 実装の export header / sample row を説明するためのもの
- template sample
  - ERP4 実装の `format=ics_template` 出力例を説明するためのもの

注意:

- `rakuda_*_canonical_sample.csv` は給料らくだの実テンプレートではない。
- `ics_journal_canonical_sample.csv` と `ics_journal_template_sample.csv` は ERP4 実装の v1 fixture であり、受領済み原本テンプレートそのものではない。
- 実テンプレートの回収状況は `docs/requirements/external-csv-artifact-inventory.md` を正とする。
