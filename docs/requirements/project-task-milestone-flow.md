# 案件/タスク/マイルストーン編集フロー（ドラフト）

## 目的
- 案件階層/タスク/マイルストーンの編集・付け替え・削除のルールを明確化する
- 見積/請求/工数/経費と連動する際の制約を整理する

## 対象
- Project（案件）
- ProjectTask（タスク）
- ProjectMilestone（マイルストーン）

## 参照
- `docs/requirements/reassignment-policy.md`
- `docs/requirements/access-control.md`
- `docs/requirements/approval-alerts.md`

## 前提/基本ルール
- 工数/経費/見積/請求/発注は必ず projectId を持つ（管理業務/社内案件は専用Projectで扱う）。
- 見積なし請求を許容。マイルストーン紐付けは任意。
- 納期超過未請求は due_date ベースのアラート/レポートで検知する。
- 付け替え・削除は理由必須。監査ログに記録する。

## 論理削除ルール
- 物理削除は行わず、deletedAt + deletedReason をセットする。
- deletedReason は以下のコードを初期セットとする（必要に応じて拡張）。
  - `mistake`（誤登録）
  - `duplicate`（重複）
  - `merged`（統合）
  - `moved`（移動済み/付け替え）
  - `cancelled`（中止）
  - `scope_change`（スコープ変更）
- 付け替え（reassign）の reasonCode も、特段の理由がない限り deletedReason と同一コード体系を用いる。

## 編集可否の共通チェック
- deletedAt 済みのデータは更新不可（再編集には復元フローが必要）。
- 承認ワークフロー中（ApprovalInstance が active）の伝票に紐づく場合は編集/削除不可（取消後に実施）。
- 確定状態（approved/sent/paid/closed など）の伝票に紐づく場合は編集/削除不可。
- 付け替えは理由必須 + 監査ログ必須（from/to/actor/理由コード/自由記述）。

## 編集フロー（MVP）
### Project（案件）
- 作成: name, customerId, status=draft を必須。parentProjectId は任意。
- 変更:
  - name/status/customer/owner は admin/mgmt/PM が変更可。
  - parentProjectId 変更は admin/mgmt のみ。理由必須 + 監査ログ必須。承認中の伝票（見積/請求/発注）がある場合は変更不可（承認解除/取消後に実施）。
- 削除:
  - 子案件/タスク/マイルストーンが無く、伝票（見積/請求/発注）に紐づいていない場合のみ論理削除可。

### ProjectTask（タスク）
- 作成: projectId, name を必須。parentTaskId は任意。
- 変更:
  - name/status/assignee/dates の更新は project メンバー以上。
  - parentTaskId の変更は理由必須。親は同一 project 内のみ許容。
  - 子タスクがある場合は一括移動のみ。
- 付け替え（Project間移動）:
  - `docs/requirements/reassignment-policy.md` に従う。
  - time_entries/expenses などの紐付けがある場合は一括移動が前提。件数サマリを提示し、同意が無い場合は移動不可。
  - `POST /projects/:id/tasks/:taskId/reassign` に `moveTimeEntries=true` を指定した場合、承認/締めチェック済みの time_entries を一括で projectId 更新する。
- 削除:
  - 子タスクがある場合は削除不可（先に移動/削除を完了させる）。
  - time_entries がある場合は削除不可。廃止する場合は `docs/requirements/reassignment-policy.md` に従い別タスクへ付け替える。
  - 請求/発注明細に紐づく場合は削除不可。

### ProjectMilestone（マイルストーン）
- 作成: projectId, name, amount, due_date を必須。
- 変更:
  - name/amount/due_date は invoice が draft の場合のみ変更可（変更時は明細を再計算）。
  - invoice が pending_qa 以降の場合は変更不可（請求取消後に修正）。
  - amount 変更時は milestoneId 付き draft invoice の単一行のみ unitPrice/totalAmount を更新（複数行/手動調整はスキップ）。
- 付け替え:
  - projectId 変更は原則不可（必要なら新規作成 + 旧マイルストーンは論理削除）。
  - 旧マイルストーンは deletedReason=`moved` とし、新マイルストーンIDを監査ログまたは詳細メモに記録する。
- 削除:
  - invoice が紐づく場合は削除不可。

## UIの想定（要件）
- Project詳細: 階層ツリー表示 + 子案件/タスク/マイルストーンの一覧。
- Task: WBS（Work Breakdown Structure）/ツリー表示、ドラッグ移動は「理由入力 + 権限チェック」付き。
- Milestone: 期限/金額/請求状態の一覧、未請求アラートの視認性を重視。

## API想定（ドラフト）
- `POST /projects` / `PATCH /projects/:id`
- `POST /projects/:id/tasks` / `PATCH /projects/:id/tasks/:taskId`
- `POST /projects/:id/milestones` / `PATCH /projects/:id/milestones/:milestoneId`
- `POST /projects/:id/tasks/:taskId/reassign`（理由必須）

## 未決定/確認事項
- なし（MVP方針は上記にて確定）
