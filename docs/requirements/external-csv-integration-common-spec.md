# 共通連携仕様（給与/会計 CSV 連携）

更新日: 2026-03-16
関連ISSUE: #1435, #1430

## 目的

- 給料らくだ・経理上手くんα向け CSV 連携で共通に使う運用ルールを定義する。
- 個別アダプタ実装前に、出力単位、再出力、監査、エラーの扱いを統一する。

## 前提

- 文字コード、列順、必須列の最終確定は `#1432` の現物テンプレート回収後に行う。
- 本書は現行の `IntegrationRun` / `LeaveIntegrationExportLog` / `AuditLog` の実装に合わせた共通設計案である。

## 1. 対象

- 給料らくだ向け
  - 社員マスタ CSV
  - 勤怠確定 CSV
- 経理上手くんα向け
  - 仕訳 CSV

## 2. ファイル仕様の共通原則

### 2.1 エンコーディング・区切り

- 既定値
  - 文字コード: `UTF-8`
  - 改行: `LF`
  - 区切り: `,`
  - ヘッダ行: あり
- 例外
  - 実製品テンプレートが `Shift_JIS` / `CRLF` を要求する場合は、アダプタ出力で変換する
  - canonical な内部生成形式は `UTF-8 + LF` とする
- 実装済み例外
  - `#1443` の ICS 仕訳 CSV は、現物テンプレートに合わせて `CP932 + CRLF` で出力する

### 2.2 日付・時刻・数値

- 日付
  - 内部 canonical: ISO 8601
  - CSV 出力時は対象製品テンプレートに合わせて `YYYY/MM/DD` などへ整形
- 時刻
  - 原則、給与連携は締め済み集計値を渡し、時刻明細は補助扱い
- 数値
  - 小数・負数・端数処理はアダプタ内で明示変換する
  - 金額は借貸一致や集計一致を機械判定できる表現に固定する

## 3. 出力単位

### 3.1 給与連携

- 社員マスタ
  - 全件出力を基本とし、差分出力は後続で検討
- 勤怠
  - 月次締め単位
  - 締め済みスナップショットを正本にする

### 3.2 会計連携

- 仕訳
  - 対象期間または対象イベント群単位で出力
  - 1 出力ごとに件数、金額合計、借貸一致を固定化する

## 4. ステータス設計

### 4.1 共通 export job 状態

- `draft`
  - 出力条件定義済みだが未生成
- `exported`
  - ファイル生成済み
- `failed`
  - 生成失敗
- `replayed`
  - 同一条件の再要求で過去結果を再利用

### 4.2 現行実装との対応

- 既存の `IntegrationRunStatus`
  - `running`, `success`, `failed`
- 既存の leave dispatch
  - `LeaveIntegrationExportLog`
  - `idempotencyKey`, `requestHash`, `reexportOfId`, `exportedUntil`, `exportedCount`
- 社員マスタ dispatch
  - `HrEmployeeMasterExportLog`
  - `idempotencyKey`, `requestHash`, `reexportOfId`, `exportedUntil`, `exportedCount`
- 勤怠 CSV dispatch
  - `HrAttendanceExportLog`
  - `idempotencyKey`, `requestHash`, `reexportOfId`, `periodKey`, `closingPeriodId`, `closingVersion`, `exportedUntil`, `exportedCount`
- ICS 仕訳 dispatch
  - `AccountingIcsExportLog`
  - `idempotencyKey`, `requestHash`, `reexportOfId`, `periodKey`, `exportedUntil`, `exportedCount`
- ICS 仕訳 mapping rule
  - `AccountingMappingRule`
  - `mappingKey`, `debitAccountCode`, `debitAccountName`, `debitSubaccountCode`, `creditAccountCode`, `creditAccountName`, `creditSubaccountCode`, `taxCode`, `departmentCode`, `requireDepartmentCode`, `requireDebitSubaccountCode`, `requireCreditSubaccountCode`, `isActive`
  - `GET /integrations/accounting/mapping-rules`
  - `POST /integrations/accounting/mapping-rules`
  - `PATCH /integrations/accounting/mapping-rules/:id`
  - `POST /integrations/accounting/mapping-rules/reapply`
- 共通運用参照
  - `GET /integrations/jobs/exports`
  - 既存 3 系統の export log を横断一覧化して参照する
  - 管理画面では `Settings` 内の「連携ジョブ一覧」カードから種別 / ステータス / limit / offset を指定して取得する
  - `POST /integrations/jobs/exports/:kind/:id/redispatch`
  - 既存の成功済み export payload を新しい log として再出力し、`reexportOfId` で元ジョブを追跡する
  - `GET /integrations/reconciliation/summary`
  - `periodKey` 単位で attendance closing / employee master export / accounting ICS export / journal staging の aggregate 差異を確認する
  - `GET /integrations/reconciliation/details`
  - `periodKey` 単位で社員コード差分の全件、会計 staging の `PJ別` / `部門別` breakdown、`pending_mapping` / `blocked` / `invalid ready` の sample 行を確認する

将来の共通 job model は、上記既存実装を包含する形で拡張する。

## 5. 冪等・再出力

### 5.1 冪等キー

- 手動実行時は `idempotencyKey` を付与する
- 同一 `idempotencyKey` + 同一条件
  - 過去結果を再利用して良い
- 同一 `idempotencyKey` + 異なる条件
  - `idempotency_conflict` として拒否する

### 5.2 再出力

- 再出力は「元ジョブとの関連」を保持する
- 再出力時は以下を記録する
  - 元ジョブ ID
  - 実行者
  - 新しい idempotencyKey
  - 再出力対象 payload の版
  - 差分有無

## 6. 監査・履歴

### 6.1 最低限残す項目

- 連携種別
- 対象期間または締めキー
- 出力件数
- 出力ファイル名
- 実行者
- 実行日時
- 再出力元ジョブ
- 再出力先ジョブ
- 成否
- エラーコード / メッセージ

### 6.2 既存基盤

- `AuditLog`
- `IntegrationRun`
- `LeaveIntegrationExportLog`

### 6.3 方針

- 個別アダプタは、既存 `AuditLog` と整合する監査イベント名を使う
- エビデンス追跡が必要な場合は `approvalInstanceId` / `EvidenceSnapshot` と紐付けられる形を維持する

## 7. エラー方針

### 7.1 出力前に止めるべきエラー

- 必須コード未設定
- 借貸不一致
- 月次未締め
- 取引先/社員コード未設定
- 税区分未マッピング

### 7.2 再試行可能エラー

- 一時的なファイル書き込み失敗
- 外部保管先・通知失敗

### 7.3 エラーコード方針

- 業務エラーと実行エラーを分ける
  - `validation_*`
  - `mapping_*`
  - `idempotency_*`
  - `io_*`
  - `unexpected_*`

## 8. 権限と承認

- 出力操作は管理部門または運用管理権限に限定する
- 本番送信相当の操作は理由付き再出力を許可する
- 承認済みデータを対象にする場合、承認・証跡と連携ジョブを相互参照できるようにする

## 9. 現時点の推奨実装順

- `#1436` `#1437` `#1438` で個別 CSV 列仕様を固定
- `#1442` `#1443` で個別アダプタ実装
- `#1444` で共通ジョブ管理・再出力
- `#1445` で照合レポート

## 9.1 `#1445` の初期実装範囲

- 初手は aggregate summary API に限定する
  - `GET /integrations/reconciliation/summary?periodKey=YYYY-MM`
- 管理画面では `Settings` 内の「連携照合サマリ」カードから対象月を指定して取得する
- 初期比較項目
  - attendance closing の summary count / 各種 minutes 合計
  - full 社員マスタ export と attendance closing の社員コード差分
  - accounting journal staging の `ready / pending_mapping / blocked`
  - ready 行の借貸一致フラグ
  - 最新 ICS export の件数と ready 件数の一致
- 次段では detail API を追加する
  - `GET /integrations/reconciliation/details?periodKey=YYYY-MM`
  - payroll: 社員コード差分の全件
  - accounting: `PJ別` / `部門別` breakdown と `pending_mapping` / `blocked` / `invalid ready` の sample 行
- UI への drilldown 表示は detail API の後続段階に分離する

## 10. 未確定事項

- 給料らくだ・経理上手くんαの実テンプレートにおける文字コード/改行/桁制約
- `draft/exported/imported/failed` を共通ジョブテーブルでどこまで厳密に持つか
- 外部システム側の「取込済み」確認を ERP4 に戻すか

## 11. 根拠ファイル

- `packages/backend/src/routes/integrations.ts`
- `packages/backend/prisma/schema.prisma`
- `docs/requirements/hr-crm-integration.md`
- `docs/requirements/batch-jobs.md`
- `docs/requirements/pdf-email.md`
