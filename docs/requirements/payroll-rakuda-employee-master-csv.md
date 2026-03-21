# 給料らくだ連携: 社員マスタ CSV 仕様（repo ベース初期案）

更新日: 2026-03-21
関連 Issue: `#1436`, `#1430`, `#1433`, `#1434`, `#1435`, `#1439`, `#1442`

## 目的

- ERP4 から給料らくだへ出力する社員マスタ CSV について、repo 内の現行実装だけで確定できる前提と未確定事項を分離する。
- 実テンプレート未入手の段階でも、ERP4 側で供給元がある項目、追加実装が必要な項目、固定値/変換値が必要な項目を棚卸しする。

## 前提

- 本書は 2026-03-10 時点の repository 実装に基づく初期案である。
- 対象製品は、ユーザー申告ベースで `給与らくだプロ Version 26.00 Rev.10.31` とする。
- 製品バージョンは確認できたが、現物 CSV 列定義と文字コード/必須列は未確定であり、`#1432` で確定する。
- 現行運用では、給与らくだへの CSV import は未使用である。
- ソフト内および公式サイト上では、社員台帳データ CSV の明示的なテンプレート配布は確認できていない。
- 既存の `GET /integrations/hr/exports/users` は HR/ID 連携用 export であり、給与専用 CSV そのものではない。
- `UserAccount.externalId` は IdP/SCIM 用の外部 ID であり、給与連携専用の社員コードとは責務を分ける前提とする。
- `#1442` の初期実装として、社員マスタ CSV の canonical export / dispatch / dispatch log を追加する。
- 現物テンプレート未回収のため、repo 内には canonical sample のみを置く。
  - `docs/requirements/samples/rakuda_employee_master_canonical_sample.csv`
  - artifact 全体の管理は `docs/requirements/external-csv-artifact-inventory.md` を正とする。
- canonical 社員マスタ export の `schemaVersion` は `rakuda_employee_master_v1` を正とする。
- `rakuda_employee_master_v1` は「給与らくだ実テンプレート互換」ではなく、「ERP4 内部で安定再現できる canonical 社員マスタ export」を意味する。

## 現在の ERP4 で供給可能なフィールド

### 既存 source

- `UserAccount`
  - `id`
  - `externalId`
  - `userName`
  - `displayName`
  - `givenName`
  - `familyName`
  - `active`
  - `emails`
  - `phoneNumbers`
  - `department`
  - `organization`
  - `managerUserId`
  - `createdAt`
  - `updatedAt`
- 既存 export
  - `GET /integrations/hr/exports/users`
  - `updatedSince`, `limit`, `offset` に対応

## 論理項目定義（初期案）

実 CSV 列名は `#1432` 後に確定する。ここでは ERP4 側の論理項目と供給可否を定義する。

| 論理項目            | 想定用途               | ERP4 供給元                                      | 判定     | 備考                                        |
| ------------------- | ---------------------- | ------------------------------------------------ | -------- | ------------------------------------------- |
| employeeCode        | 給与システムの社員キー | `UserAccount.employeeCode`                       | 供給可   | `#1439` 基盤追加                            |
| loginId             | 補助識別子             | `UserAccount.userName`                           | 供給可   | 変更可能運用のため主キーにはしない          |
| externalIdentityId  | IdP/SCIM 外部 ID       | `UserAccount.externalId`                         | 供給可   | 給与キーではなく参考値                      |
| displayName         | 氏名表示               | `UserAccount.displayName`                        | 供給可   | 未設定時の補完ルールが必要                  |
| familyName          | 姓                     | `UserAccount.familyName`                         | 供給可   | 未設定時は displayName 分解を行わない方針   |
| givenName           | 名                     | `UserAccount.givenName`                          | 供給可   | 同上                                        |
| activeFlag          | 在籍/無効              | `UserAccount.active`                             | 供給可   | 退職日ではなく現状態                        |
| departmentName      | 部門表示名             | `UserAccount.department`                         | 条件付き | 表示名のみ。部門コードは未実装              |
| organizationName    | 組織表示名             | `UserAccount.organization`                       | 条件付き | コード値未整備                              |
| managerEmployeeCode | 上長社員コード         | `managerUserId` -> 上長 `employeeCode`           | 供給可   | 上長 `employeeCode` 未設定時は export 停止  |
| email               | 連絡先                 | `UserAccount.emails`                             | 条件付き | 配列から primary 採用ルールが必要           |
| phone               | 連絡先                 | `UserAccount.phoneNumbers`                       | 条件付き | 配列から primary 採用ルールが必要           |
| employmentType      | 雇用区分               | `UserAccount.employmentType`                     | 供給可   | `#1439` 基盤追加                            |
| title               | 役職                   | なし                                             | 未実装   | 表示役職と給与上の役職の整理が必要          |
| joinDate            | 入社日                 | `UserAccount.joinedAt`                           | 供給可   | `#1439` 基盤追加                            |
| leaveDate           | 退職日                 | `UserAccount.leftAt`                             | 供給可   | `#1439` 基盤追加                            |
| payrollGroup        | 給与体系/締め区分      | `EmployeePayrollProfile.payrollType/closingType` | 条件付き | `#1439` 基盤追加、実 CSV 列との対応は要確認 |
| defaultWorkMinutes  | 所定労働時間           | `LeaveSetting.defaultWorkdayMinutes` を参照可能  | 条件付き | 個人別設定は未実装                          |
| bankAccount         | 支払口座               | `EmployeePayrollProfile.bankInfo`                | 条件付き | `#1439` 基盤追加、項目粒度は要確認          |
| note                | 備考                   | 任意                                             | 未定     | 原則不要、必要なら専用項目を設ける          |

## 必須/任意/固定値の初期分類

### ERP4 だけで暫定必須にできるもの

- `loginId`
- `displayName` または `familyName` / `givenName`
- `activeFlag`

### 給与運用上は必須と考えるが、ERP4 側が未実装のもの

- `payrollGroup`
- `departmentCode` または給与集計に使う組織コード

### 任意候補

- `email`
- `phone`
- `title`
- `managerEmployeeCode`

### 固定値/変換値が必要な候補

- active / inactive のコード値
- 雇用区分コード
- 所属/部門コード
- 給与体系コード

## 出力方針（初期案）

### 出力単位

- 初期は全件出力を原則とする。
- `updatedSince` を使った差分抽出は既存 users export にあるが、給与側の master import で差分が安全かは未確認のため、差分出力は後続で判断する。
- canonical export の `updatedSince` は内部連携・監査向けの技術仕様であり、実テンプレート import の差分運用を保証するものではない。

### ソート順

- 初期案: `employeeCode ASC`

### 文字コード・改行

- 内部 canonical は `UTF-8 + LF`
- 実ファイルは現物テンプレートに合わせて `Shift_JIS` / `CRLF` を許容

## 現在の実装ベースライン

- API
  - `GET /integrations/hr/exports/users/employee-master`
  - `POST /integrations/hr/exports/users/employee-master/dispatch`
  - `GET /integrations/hr/exports/users/employee-master/dispatch-logs`
- canonical CSV header
  - `employeeCode`
  - `loginId`
  - `externalIdentityId`
  - `displayName`
  - `familyName`
  - `givenName`
  - `activeFlag`
  - `employmentType`
  - `joinDate`
  - `leaveDate`
  - `departmentName`
  - `organizationName`
  - `managerEmployeeCode`
  - `departmentCode`
  - `payrollType`
  - `closingType`
  - `paymentType`
  - `titleCode`
  - `email`
  - `phone`
- canonical sample
  - `docs/requirements/samples/rakuda_employee_master_canonical_sample.csv`
- 初期 validation
  - `employeeCode` 未設定は `409 employee_master_employee_code_missing`
- dispatch
  - `idempotencyKey` による replay / conflict / in-progress 制御を持つ
  - 実行履歴は `HrEmployeeMasterExportLog` に保持する

### 実装済みエラーコード

- `invalid_updatedSince`
  - `updatedSince` が ISO-8601 datetime として不正
- `employee_master_employee_code_missing`
  - 対象社員の `employeeCode` が未設定
- `employee_master_manager_employee_code_missing`
  - `managerUserId` はあるが、上長 `employeeCode` を解決できない
- `dispatch_in_progress`
  - 同一 `idempotencyKey` の export が実行中
- `idempotency_conflict`
  - 同一 `idempotencyKey` に対して request hash が不一致

## canonical v1 の出力範囲

`rakuda_employee_master_v1` は、現物テンプレート未回収の段階で ERP4 側が安定供給できる列だけを固定した canonical export である。

| 列名                | 出力 | source                                                | 備考                                                             |
| ------------------- | ---- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| employeeCode        | 出力 | `UserAccount.employeeCode`                            | 未設定時は `409 employee_master_employee_code_missing`           |
| loginId             | 出力 | `UserAccount.userName`                                | 補助識別子。給与キーではない                                     |
| externalIdentityId  | 出力 | `UserAccount.externalId`                              | IdP/SCIM 用。給与専用キーではない                                |
| displayName         | 出力 | `displayName` 優先、未設定時は `familyName+givenName` | 氏名分解は逆算しない                                             |
| familyName          | 出力 | `UserAccount.familyName`                              | 未設定時は空値                                                   |
| givenName           | 出力 | `UserAccount.givenName`                               | 未設定時は空値                                                   |
| activeFlag          | 出力 | `UserAccount.active`                                  | `1` / `0` に正規化                                               |
| employmentType      | 出力 | `UserAccount.employmentType`                          | `#1439` で追加済み                                               |
| joinDate            | 出力 | `UserAccount.joinedAt`                                | `YYYY-MM-DD`                                                     |
| leaveDate           | 出力 | `UserAccount.leftAt`                                  | `YYYY-MM-DD`                                                     |
| departmentName      | 出力 | `UserAccount.department`                              | 表示名のみ。コード体系は別論点                                   |
| organizationName    | 出力 | `UserAccount.organization`                            | 表示名のみ。コード体系は別論点                                   |
| managerEmployeeCode | 出力 | `managerUserId` -> 上長 `employeeCode`                | 解決不能時は `409 employee_master_manager_employee_code_missing` |
| departmentCode      | 出力 | `EmployeePayrollProfile.departmentCode`               | 未設定時は空値                                                   |
| payrollType         | 出力 | `EmployeePayrollProfile.payrollType`                  | 実コード体系は未確定                                             |
| closingType         | 出力 | `EmployeePayrollProfile.closingType`                  | 実コード体系は未確定                                             |
| paymentType         | 出力 | `EmployeePayrollProfile.paymentType`                  | 実コード体系は未確定                                             |
| titleCode           | 出力 | `EmployeePayrollProfile.titleCode`                    | 名称ではなく code を出す                                         |
| email               | 出力 | `UserAccount.emails`                                  | primary 優先                                                     |
| phone               | 出力 | `UserAccount.phoneNumbers`                            | primary 優先                                                     |

`schemaVersion` は CSV 列としては出力せず、JSON payload のメタ情報として `rakuda_employee_master_v1` を返す。CSV ファイル内では暗黙の前提として扱う。

## canonical v1 で未対応または未確定の項目

以下は ERP4 側で未実装、または現物テンプレート未回収のため `rakuda_employee_master_v1` には含めていない。

| 項目                             | 現状                                                    | 後続論点                                   |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| 銀行口座の列分割                 | `EmployeePayrollProfile.bankInfo` は保持するが未出力    | 支店名/口座種別/口座番号の実列仕様確定     |
| 役職名                           | `titleCode` のみ出力                                    | 名称列が必要か、code のみで足りるかの確認  |
| 部門コードの必須度               | `departmentCode` は空値許容                             | 実テンプレート上で必須か任意かの確認       |
| 組織コード/所属コード体系        | 表示名のみ出力                                          | `#1434` の code system 確定後に反映        |
| 所定勤務時間/給与基準日数        | canonical v1 には含めない                               | 給与計算前提マスタとして別列が必要かの確認 |
| 差分 import の安全性             | `updatedSince` 付き export は可能だが import 方針未確定 | 全件/差分 import の運用判断                |
| 給与らくだ実列名/列順/文字コード | 未回収                                                  | `#1432` でテンプレート原本回収             |

## canonical v1 の運用判断

- `rakuda_employee_master_v1` は、給与らくだの実 import テンプレートを確定する前の内部 canonical として扱う。
- 現物テンプレート未回収のため、`rakuda_employee_master_v1` をそのまま給与らくだ import に用いる前提ではない。
- 実運用へ進める条件は以下とする。
  1. 社員台帳 CSV テンプレート原本の回収
  2. 列順、必須列、文字コード、空値時挙動の確定
  3. `employeeCode` 桁数・採番ルールの確定
  4. `payrollType` / `closingType` / `paymentType` / `titleCode` の実コード体系確定
  5. 銀行口座を ERP4 正本で持つか、外部正本参照に留めるかの運用判断

### 空値時挙動

- 必須列の空値は出力停止
- 任意列は空文字出力
- コード変換不能時は出力停止し、連携ジョブを `validation_*` / `mapping_*` で失敗扱いにする

## ERP4 -> CSV マッピングの初期案

### 既存 users export をそのまま使える部分

| CSV 論理列          | 現行 export 値  | 備考                           |
| ------------------- | --------------- | ------------------------------ |
| loginId             | `userName`      | そのまま利用可能               |
| displayName         | `displayName`   | null 時の補完が必要            |
| familyName          | `familyName`    | null 許容ルール要確認          |
| givenName           | `givenName`     | null 許容ルール要確認          |
| activeFlag          | `active`        | 変換コードが必要な可能性あり   |
| departmentName      | `department`    | コード化は未対応               |
| organizationName    | `organization`  | コード化は未対応               |
| managerEmployeeCode | `managerUserId` | 上長 `employeeCode` に変換済み |

### 新設が必要なマスタ項目

| CSV 論理列           | 推奨保持場所                  | 理由                         |
| -------------------- | ----------------------------- | ---------------------------- |
| employeeCode         | `UserAccount.employeeCode`    | `externalId` と責務分離する  |
| employmentType       | `UserAccount.employmentType`  | 基本属性として持つ           |
| title                | 専用 employee profile         | 役職表現を給与連携で使うため |
| payrollGroup         | `EmployeePayrollProfile`      | 締め区分・給与体系を持つ     |
| bankAccount          | `EmployeePayrollProfile`      | 機微情報として分離管理したい |
| joinDate / leaveDate | `UserAccount.joinedAt/leftAt` | 基本属性として持つ           |
| departmentCode       | 組織/部門 master              | 表示名とは別コードが必要     |

## テスト観点（初期案）

### 正常系

- 在籍中社員が 1 行出力される
- `displayName` / `familyName` / `givenName` の優先ルールに従って出力される
- `updatedSince` 指定時に対象件数が制御される

### 異常系

- `employeeCode` 未設定で出力停止
- 必須コード変換未設定で出力停止
- `managerUserId` が存在するが上長 `employeeCode` を解決できず出力停止
- `emails` / `phoneNumbers` が複数あり primary 解決できない

### 監査

- 全件/差分の別
- 対象件数
- 実行者
- 出力条件
- 失敗時の欠損項目一覧

## この段階で確認が必要な事項

以下は repo 内だけでは確定できない。

1. 給料らくだの社員マスタ CSV 実列名、列順、必須列
2. `employeeCode` の桁数・文字種・採番ルール
3. 役職・雇用区分・給与体系・締め区分の実コード体系
4. 銀行口座を ERP4 で保持するか、別システム正本にするか
5. 差分出力が許容されるか、毎回全件出力が必要か
6. active/inactive だけでなく入社日/退職日が必須か

## 現時点で判明した運用事実

- 現行業務では、給与らくだへ社員マスタ CSV を取り込む運用は行っていない。
- 担当者確認ベースでは、社員台帳データ CSV の取込自体は可能と認識しているが、実テンプレートは未取得である。
- 従って現段階では「ERP4 側でどの項目を供給できるか」の整理を先行し、実列仕様はテンプレート入手後に詰める進め方が必要である。

## 現時点の結論

- 社員マスタ CSV の完全仕様を確定するには `#1431`, `#1432` が必須である。
- ただし実 CSV の列仕様とコード体系は未確定であり、次は `EmployeePayrollProfile` の列詳細と給与らくだ実テンプレートとの差分をテンプレートに合わせて詰める必要がある。
- したがって `#1436` は「repo ベース初期案」として本書を先行確定し、現物 CSV 入手後に列仕様を詰める進め方が妥当である。

## 根拠ファイル

- `packages/backend/prisma/schema.prisma`
- `packages/backend/src/routes/integrations.ts`
- `packages/backend/test/integrationExportRoutes.test.js`
- `docs/requirements/hr-crm-integration.md`
- `docs/requirements/erp4-payroll-accounting-gap-analysis.md`
- `docs/requirements/external-code-system-design.md`
- 給与らくだプロ公式 Q&A（ユーザー共有リンク）
  - `https://site.bsl-jp.com/ssl/cgi-bin/bslkb.cgi?task=showqa&KB=KB002470&via=KBSearch`
