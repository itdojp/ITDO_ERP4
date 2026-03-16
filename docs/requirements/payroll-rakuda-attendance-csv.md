# 給料らくだ連携: 勤怠 CSV 仕様（repo ベース初期案）

更新日: 2026-03-15
関連 Issue: `#1437`, `#1430`, `#1433`, `#1435`, `#1440`

## 目的

- ERP4 から給料らくだへ出力する勤怠 CSV について、現時点で再利用できるデータと不足している締め/集計モデルを整理する。
- 「打刻明細」ではなく「月次確定済み勤怠集計値」を正本にする方針を前提に、必要な論理項目と責任分界を明文化する。

## 前提

- 対象製品は、ユーザー申告ベースで `給与らくだプロ Version 26.00 Rev.10.31` とする。
- 勤怠 CSV 実テンプレートの列定義、文字コード、必須列は未確定であり、`#1431`, `#1432` の確認が前提である。
- 現行運用では、給与らくだへの勤怠 CSV import は未使用である。
- 担当者確認ベースでは、勤怠集計データ CSV の取込自体は可能と認識しているが、テンプレートは取得できていない。
- 公式 Q&A ベースでは、勤怠データ CSV 取込時に従来のタイムカードではなく集計値ベースの簡略タイムカードへ移行する可能性がある。
- 現在 ERP4 にある既存 export は `GET /integrations/hr/exports/leaves` のみで、対象は approved leave 明細である。
- `TimeEntry` は案件工数/実績管理のモデルであり、給与向けの打刻・勤怠集計正本ではない。
- 月次確定値、締め版、再出力再現に必要な snapshot モデルは `AttendanceClosingPeriod` / `AttendanceMonthlySummary` として実装を開始した。
- 初期実装では `POST /integrations/hr/attendance/closings` と `GET /integrations/hr/attendance/closings` 系で月次締め済み snapshot を作成・参照できる。
- `#1442` の現時点 baseline として、最新の締め snapshot を canonical 勤怠 CSV として出力する API と dispatch log を追加する。

## 現在の ERP4 で供給可能な元データ

### 休暇

- `LeaveRequest`
  - `userId`
  - `leaveType`
  - `startDate`
  - `endDate`
  - `hours`
  - `minutes`
  - `startTimeMinutes`
  - `endTimeMinutes`
  - `status`
  - `updatedAt`
- `LeaveType`
  - `code`
  - `name`
  - `unit`
  - `isPaid`
- 既存 export
  - `GET /integrations/hr/exports/leaves?target=attendance|payroll`
  - `POST /integrations/hr/exports/leaves/dispatch`
  - `GET /integrations/hr/exports/leaves/dispatch-logs`

### 工数/作業時間

- `TimeEntry`
  - `userId`
  - `projectId`
  - `workDate`
  - `minutes`
  - `workType`
  - `location`
  - `status`
  - `approvedBy`
  - `approvedAt`

### 休暇残高・勤務日設定

- `LeaveSetting.defaultWorkdayMinutes`
- `LeaveGrant`, `LeaveCompGrant`, `LeaveCompConsumption`
- `WorkdayCalendar` 系 route

## 現在の ERP4 で不足しているもの

| 論点                          | 現状                                        | 判定     | 備考                                         |
| ----------------------------- | ------------------------------------------- | -------- | -------------------------------------------- |
| 月次締め済み勤怠確定テーブル  | なし                                        | 未実装   | issue `#1440`                                |
| 締め版（再締め/再出力の再現） | なし                                        | 未実装   | snapshot 不足                                |
| 出勤日数                      | 保存なし                                    | 未実装   | 休暇と工数からの単純推定では不十分           |
| 所定時間                      | 個人別値なし                                | 未実装   | `defaultWorkdayMinutes` は全体既定値のみ     |
| 法定内/法定外/深夜/休日残業   | 法定内/法定外/休日は初期対応、深夜は未対応  | 条件付き | 深夜は勤務時刻 source がなく算出不可         |
| 遅刻/早退/欠勤                | 区分なし                                    | 未実装   | 打刻・所定シフト情報がない                   |
| 勤怠締め状態                  | `AttendanceClosingPeriod.status` で初期対応 | 条件付き | `PeriodLock` 連動は後続                      |
| 月次勤怠の社員別集計          | `AttendanceMonthlySummary` で初期対応       | 条件付き | 出勤日数/残業内訳/休暇集計まで。深夜は未対応 |

## 論理項目定義（初期案）

実 CSV 列名は未確定のため、ERP4 側の論理項目として整理する。

| 論理項目                       | 想定内容     | ERP4 供給元                                               | 判定     | 備考                                 |
| ------------------------------ | ------------ | --------------------------------------------------------- | -------- | ------------------------------------ |
| employeeCode                   | 社員キー     | なし                                                      | 未実装   | `#1436` と同じ社員コード基盤に依存   |
| closingMonth                   | 対象月       | なし                                                      | 未実装   | 締めモデルが必要                     |
| workingDays                    | 出勤日数     | なし                                                      | 未実装   | 打刻正本がない                       |
| scheduledMinutes               | 所定時間     | `LeaveSetting.defaultWorkdayMinutes` 参照可               | 条件付き | 個人別値ではない                     |
| actualMinutes                  | 実労働時間   | `TimeEntry.minutes` から推定可                            | 条件付き | 工数入力ベースであり勤怠正本ではない |
| overtimeMinutes                | 残業時間     | `AttendanceMonthlySummary.overtimeTotalMinutes`           | 初期充足 | 総残業は安定供給可                   |
| overtimeWithinStatutoryMinutes | 法定内残業   | `AttendanceMonthlySummary.overtimeWithinStatutoryMinutes` | 初期充足 | 所定時間と 8h 基準の差分で算出       |
| overtimeOverStatutoryMinutes   | 法定外残業   | `AttendanceMonthlySummary.overtimeOverStatutoryMinutes`   | 初期充足 | 法定内残業を超える残業分             |
| holidayWorkMinutes             | 休日労働     | `AttendanceMonthlySummary.holidayWorkMinutes`             | 初期充足 | 所定 0 分日の approved work を計上   |
| lateNightMinutes               | 深夜労働     | なし                                                      | 未実装   | `TimeEntry` に勤務時刻がなく算出不可 |
| paidLeaveMinutes               | 有休取得時間 | `LeaveRequest` + `LeaveType.isPaid`                       | 供給可   | 月次確定集計ロジックは未実装         |
| unpaidLeaveMinutes             | 無給休暇時間 | `LeaveRequest` + `LeaveType.isPaid=false`                 | 供給可   | 同上                                 |
| compensatoryLeaveMinutes       | 代休/振休    | `LeaveType` / comp grant 系                               | 条件付き | どの分類で出すか未確定               |
| tardinessMinutes               | 遅刻         | なし                                                      | 未実装   | 打刻が必要                           |
| earlyLeaveMinutes              | 早退         | なし                                                      | 未実装   | 同上                                 |
| absenceDays                    | 欠勤日数     | なし                                                      | 未実装   | 打刻/所定カレンダ不足                |
| note                           | 備考         | `LeaveRequest.notes` はある                               | 条件付き | 給与 CSV へ流すか要確認              |

## 既存 leave export の位置付け

### 既にできること

- approved leave 明細を `attendance` / `payroll` target 付きで export できる
- `GET /integrations/hr/exports/leaves` で `updatedSince`, `limit`, `offset` を使った差分取得ができる
- `POST /integrations/hr/exports/leaves/dispatch` の body で `idempotencyKey` を指定して再送管理付き dispatch ができる
- `leaveTypeName`, `leaveTypeUnit`, `leaveTypeIsPaid`, `requestedMinutes` を含む
- `POST /integrations/hr/attendance/closings` で `periodKey` 単位の締め snapshot を作成できる
- `GET /integrations/hr/attendance/closings` と `GET /integrations/hr/attendance/closings/:id/summaries` で締め済みデータを参照できる
- `GET /integrations/hr/exports/attendance`
- `POST /integrations/hr/exports/attendance/dispatch`
- `GET /integrations/hr/exports/attendance/dispatch-logs`
  により、最新の closed snapshot から canonical 勤怠 CSV を出力し、履歴を保持できる

### 既存 leave export で足りないこと

- 月次締め済みの社員別集計になっていない
- 出勤日数、所定時間、残業区分のような勤怠サマリを持っていない
- 締め月・締め版・再出力再現の軸を持たない
- approved leave の明細取得と、給与 CSV に必要な「確定勤怠」責任分界が分かれていない
- `AttendanceMonthlySummary` は総残業に加え、法定内/法定外/休日労働の区分まで保持する
- 深夜労働は `TimeEntry` に勤務時刻がないため未実装のまま残る
- `AttendanceClosingPeriod` は給与向け snapshot 管理に特化しており、既存 `PeriodLock` との連動は未実装

## 締め処理条件の初期案

### 原則

- 給与向け CSV は「月次締め済み勤怠確定値」から出力する。
- 締め前の `TimeEntry` / `LeaveRequest` 明細から直接 CSV を出力しない。
- 初期実装では、未承認 `TimeEntry` / `LeaveRequest` が対象月に残っている場合は締めを拒否する。

### 締め対象

- 対象月の在籍社員
- 承認済み leave
- 給与計算対象として確定済みの time/attendance データ

### 再計算・再出力

- 締め後の明細修正が発生した場合は「再締め版」を作る
- CSV は「どの締め版から生成したか」を必ず記録する
- 初期実装では `reclose=true` で再締め版を追加作成し、前版は `superseded` に遷移する

## ERP4 -> CSV マッピングの初期案

### 既存データだけで論理的に作れる項目

| CSV 論理列             | 現行 source                     | 供給条件                      |
| ---------------------- | ------------------------------- | ----------------------------- |
| paidLeaveMinutes       | approved leave + `isPaid=true`  | 月次集計ロジック追加が必要    |
| unpaidLeaveMinutes     | approved leave + `isPaid=false` | 同上                          |
| leaveBreakdown         | leave type 単位内訳             | leave export を拡張すれば可能 |
| actualMinutesCandidate | `TimeEntry.minutes` 合計        | 給与確定値ではないことを注記  |

### 既存データだけでは作れない項目

| CSV 論理列                           | 理由                                             |
| ------------------------------------ | ------------------------------------------------ |
| workingDays                          | 出勤判定基準がない                               |
| scheduledMinutes                     | 個人別勤務体系がない                             |
| overtimeMinutesByType                | 深夜労働は勤務時刻 source がないため算出できない |
| tardinessMinutes / earlyLeaveMinutes | 打刻がない                                       |
| absenceDays                          | 所定勤務と実績の差分判定ができない               |
| closingMonth / closingVersion        | 締めモデルがない                                 |

## 端数処理の初期方針

- 内部 canonical は minutes 単位
- 実 CSV が時間単位・0.5h 単位・10 分単位等を要求する場合は、出力アダプタで変換する
- 端数処理ルールは社員別勤怠確定値を生成する段階で固定し、CSV 出力段階で再計算しない

## エラーパターンの初期分類

### 出力停止

- 対象月が未締め
- 社員コード未設定
- 締め対象者に欠損データがある
- 集計に必要な勤務体系/所定時間が未設定

### 警告

- leave はあるが time entry がない
- time entry はあるが approved leave と整合しない
- 工数ベースの `actualMinutes` と勤怠正本が乖離する

## テスト観点（初期案）

### 正常系

- 締め済み月について、社員別勤怠 1 行が生成される
- approved leave が paid/unpaid 別に集計される
- 再出力時に同一締め版を再現できる

### 異常系

- 未締め月の出力要求を拒否する
- 締め対象社員の社員コード欠損で失敗する
- 所定時間欠損で失敗する
- 再締め版指定なしで最新値と不整合な再出力を行わない

## この段階で確認が必要な事項

以下は repo 内だけでは確定できない。

1. 給料らくだ側が要求する勤怠 CSV の実列名、列順、必須列
2. 月次締め対象として何を「確定値」とみなすか
   - 工数承認済み
   - 勤怠専用締め済み
   - leave 承認済み
     のどこまでを要求するか
3. 出力すべき残業区分
   - 総残業だけでよいか
   - 法定内 / 法定外 / 深夜 / 休日まで必要か
4. 休暇の出力粒度
   - paid/unpaid の合計だけでよいか
   - leave type ごとの内訳が必要か
5. 所定時間の正本
   - 全社既定
   - 雇用区分ごと
   - 個人ごと
6. `TimeEntry` を勤怠実績の source とみなしてよいか
   - みなさない場合、別の勤怠正本モデルが必要

## 現時点で判明した運用事実

- 現行業務では、給与らくだへ勤怠 CSV を取り込む運用は行っていない。
- 勤怠 CSV 取込を採用した場合、タイムカード UI/運用が簡略版に変わる可能性があるため、既存運用への影響確認が必要である。
- 従って、単に列仕様だけでなく「CSV 取込へ移行してよいか」の運用判断が `#1437` の前提条件になる。

## 現時点の結論

- 勤怠 CSV の完全仕様を確定するには `#1432` の現物テンプレートと、`#1440` の月次勤怠確定モデル設計が必須である。
- 現行 repo で再利用できるのは leave export と time entry 明細であり、給与向け月次確定値そのものは未実装である。
- ただし現時点の baseline として、`AttendanceMonthlySummary` を元に canonical 勤怠 CSV を出力・dispatch する API は実装済みである。
- したがって `#1437` は本書を初期要件として先行確定し、列の最終確定、残業区分拡張、運用切替判断を後続で詳細化する進め方が妥当である。

## 根拠ファイル

- `packages/backend/prisma/schema.prisma`
- `packages/backend/src/routes/integrations.ts`
- `packages/backend/src/services/attendanceClosings.ts`
- `packages/backend/src/routes/timeEntries.ts`
- `packages/backend/test/integrationExportRoutes.test.js`
- `packages/backend/test/attendanceClosingRoutes.test.js`
- `docs/requirements/hr-crm-integration.md`
- `docs/requirements/erp4-payroll-accounting-gap-analysis.md`
- `docs/requirements/external-csv-integration-common-spec.md`
- 給与らくだプロ公式 Q&A（ユーザー共有リンク）
  - `https://site.bsl-jp.com/ssl/cgi-bin/bslkb.cgi?task=showqa&KB=KB000605`
