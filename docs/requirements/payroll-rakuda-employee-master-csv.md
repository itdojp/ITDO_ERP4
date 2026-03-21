# 給料らくだ連携: 社員マスタ CSV 仕様（repo ベース初期案）

更新日: 2026-03-20
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
