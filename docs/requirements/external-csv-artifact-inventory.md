# 外部 CSV 連携 artifact inventory

更新日: 2026-03-21
関連 Issue: `#1432`, `#1436`, `#1437`, `#1438`, `#1430`

## 目的

- 外部連携で使用する現物テンプレート、repo 内サンプル、未回収 artifact を 1 箇所で管理する。
- 現行システム担当へ依頼する際の標準テンプレートは `docs/requirements/external-csv-artifact-request-checklist.md` を正とする。
- 「実運用テンプレート」と「repo 内 canonical sample」を混同しないようにする。

## 分類

| 区分           | 意味                                        |
| -------------- | ------------------------------------------- |
| 実物回収済み   | 現行運用または現物ファイルとして受領済み    |
| repo 内 sample | repo 内で再現・説明のために置く参考サンプル |
| 未回収         | 現時点で未入手。外部確認が必要              |

## 実物回収済み artifact

| 対象                 | 種別                     | 配置/参照                                                         | 備考                                                      |
| -------------------- | ------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------- |
| 経理上手くんα Pro II | ICS 取込テンプレート原本 | repo 外保管（受領済みの非コミット原本）                           | 現物回収済み。repo には原本を置かず、抜粋 sample のみ管理 |
| 経理上手くんα Pro II | 先頭 5 行抜粋            | `docs/requirements/samples/21ki_ics_journal_template_excerpt.csv` | 現物テンプレートの構造説明用                              |
| 経理上手くんα Pro II | 30 列ヘッダ sample       | `docs/requirements/samples/21ki_ics_journal_header_sample.csv`    | repo 内参照用 UTF-8 再掲                                  |

## repo 内 canonical sample

以下は ERP4 実装の canonical export を説明するための sample であり、給与らくだの実テンプレートではない。

| 対象           | 種別                        | 配置                                                                    | 備考                                                                                 |
| -------------- | --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 給与らくだプロ | 社員マスタ canonical sample | `docs/requirements/samples/rakuda_employee_master_canonical_sample.csv` | `GET /integrations/hr/exports/users/employee-master?format=csv` の header 構造に対応 |
| 給与らくだプロ | 勤怠 canonical sample       | `docs/requirements/samples/rakuda_attendance_canonical_sample.csv`      | `GET /integrations/hr/exports/attendance?format=csv` の header 構造に対応            |

## 未回収 artifact

| 対象                 | 未回収 artifact           | 用途                                                      |
| -------------------- | ------------------------- | --------------------------------------------------------- |
| 給与らくだプロ       | 社員台帳 CSV テンプレート | 列順、必須列、文字コード、コード体系の確定                |
| 給与らくだプロ       | 勤怠集計 CSV テンプレート | 列順、必須列、残業区分、時間単位の確定                    |
| 給与らくだプロ       | 実データ入りサンプル      | import エラー条件、空値時挙動、差分/全件運用の確認        |
| 経理上手くんα Pro II | 実データ入り仕訳 CSV      | `決修`、`伝票番号`、`部門コード`、`税区分` 等の実運用確認 |
| 共通                 | 取込エラー資料            | 行単位/ファイル単位のエラー判定、再取込条件の確認         |

## 現時点の判断

- 会計連携は、ICS テンプレート原本が 1 本回収済みで、baseline 実装と仕様書を前進できる状態にある。
- 給与連携は、社員マスタ / 勤怠ともに実テンプレート未回収のため、repo 内 canonical sample を基準に初期設計までに留める。
- 給与らくだの実運用仕様を確定するには、未回収 artifact の提供が前提である。
- 実テンプレート回収依頼は `docs/requirements/external-csv-artifact-request-checklist.md` を用いて行う。
